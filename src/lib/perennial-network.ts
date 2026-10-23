import type { Address } from "viem";
import { ARC_MAINNET, ARC_TESTNET, type WalletChain } from "./chains";
import live from "./live-data.json";
import mainnetDeployment from "./deployments/arc-mainnet.json";
import testnetExtras from "./deployments/arc-testnet-perennial.json";

/**
 * Which Arc network the Perennial surface runs against. Chosen at BUILD time via
 * NEXT_PUBLIC_PERENNIAL_NETWORK = testnet | mainnet (default testnet). A static
 * export cannot switch at runtime, and a page that silently followed the
 * wallet's chain could show testnet numbers under a mainnet label.
 */
export type PerennialNetwork = "testnet" | "mainnet";

export function selectPerennialNetwork(raw: string | undefined): PerennialNetwork {
  return raw?.trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

/** The contracts Perennial needs. `null` = not deployed on that network. */
export interface PerennialContracts {
  USDC: Address | null;
  NanoLedger: Address | null;
  BuilderRegistry: Address | null;
  MarketsPerennial: Address | null;
  /** Builder income (the 50% fee leg), taxed per epoch. Optional: a network
   *  whose MarketsPerennial predates it shows the markets without the fund parts. */
  BuilderFund: Address | null;
  /** The shared season pool (the tax, frozen income, unchallenged void escrows). */
  SeasonPool: Address | null;
  CaretakerRegistry: Address | null;
  /** Optional: the soulbound Verified Builder Badge. null = badges off. */
  VerifiedBuilderBadge: Address | null;
  /** Optional: the wonder-markets escrow (phase 2). null = no wonder markets. */
  WonderEscrow: Address | null;
}

const REQUIRED: (keyof PerennialContracts)[] = [
  "USDC",
  "NanoLedger",
  "BuilderRegistry",
  "MarketsPerennial",
];

export interface PerennialDeployment {
  network: PerennialNetwork;
  chain: WalletChain;
  /** "Arc testnet" / "Arc mainnet" — for copy. */
  label: string;
  contracts: PerennialContracts;
  /** The protocol's bonded milestone agent (the caretaker operator). */
  operator: Address | null;
  /** First block worth scanning for MarketCreated. */
  deployBlock: bigint | null;
  /** True only when every required contract has an address. */
  deployed: boolean;
  /** Required contracts that have no address on this network. */
  missing: (keyof PerennialContracts)[];
  /** BuilderFund and SeasonPool both have an address (the builder economy
   *  reads run; otherwise its parts render a not-deployed state). */
  fundDeployed: boolean;
}

export interface DeploymentSource {
  contracts: Partial<Record<keyof PerennialContracts, string | null | undefined>>;
  operator?: string | null;
  deployBlock?: number | null;
}

const addr = (v: string | null | undefined): Address | null =>
  typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null;

/** Pure: resolve a deployment record for a network. */
export function resolvePerennialDeployment(
  network: PerennialNetwork,
  source: DeploymentSource,
): PerennialDeployment {
  const chain = network === "mainnet" ? ARC_MAINNET : ARC_TESTNET;
  const contracts: PerennialContracts = {
    // The ERC-20 USDC is a Circle constant of the chain, not our deployment.
    USDC: addr(source.contracts.USDC) ?? chain.usdc.address,
    NanoLedger: addr(source.contracts.NanoLedger),
    BuilderRegistry: addr(source.contracts.BuilderRegistry),
    MarketsPerennial: addr(source.contracts.MarketsPerennial),
    BuilderFund: addr(source.contracts.BuilderFund),
    SeasonPool: addr(source.contracts.SeasonPool),
    CaretakerRegistry: addr(source.contracts.CaretakerRegistry),
    VerifiedBuilderBadge: addr(source.contracts.VerifiedBuilderBadge),
    WonderEscrow: addr(source.contracts.WonderEscrow),
  };
  const missing = REQUIRED.filter((k) => contracts[k] === null);
  return {
    network,
    chain,
    label: network === "mainnet" ? "Arc mainnet" : "Arc testnet",
    contracts,
    operator: addr(source.operator),
    deployBlock:
      typeof source.deployBlock === "number" && source.deployBlock > 0
        ? BigInt(source.deployBlock)
        : null,
    deployed: missing.length === 0,
    missing,
    fundDeployed: missing.length === 0 && contracts.BuilderFund !== null && contracts.SeasonPool !== null,
  };
}

/** The phase-1 builder block of a deployments file (see builders-network.ts). */
type BuildersBlock = { BuilderRegistry?: string | null; CaretakerRegistry?: string | null; VerifiedBuilderBadge?: string | null; operator?: string | null };

/**
 * Pure: the mainnet market record. Phase 2 reuses the phase-1 registries, so a
 * registry (or the operator) left null in `contracts` falls back to the
 * `builders` block: one address per contract, never two that could disagree.
 */
export function mainnetPerennialSource(record: {
  contracts: DeploymentSource["contracts"];
  operator?: string | null;
  deployBlock?: number | null;
  builders?: BuildersBlock;
}): DeploymentSource {
  const b = record.builders ?? {};
  const c = record.contracts;
  return {
    contracts: {
      ...c,
      BuilderRegistry: c.BuilderRegistry ?? b.BuilderRegistry,
      CaretakerRegistry: c.CaretakerRegistry ?? b.CaretakerRegistry,
      VerifiedBuilderBadge: c.VerifiedBuilderBadge ?? b.VerifiedBuilderBadge,
    },
    operator: record.operator ?? b.operator,
    deployBlock: record.deployBlock,
  };
}

function sourceFor(network: PerennialNetwork): DeploymentSource {
  if (network === "mainnet") {
    return mainnetPerennialSource(mainnetDeployment as Parameters<typeof mainnetPerennialSource>[0]);
  }
  // Testnet addresses come from the synced snapshot, which is only trusted if
  // it describes the testnet chain.
  const c = live.chainId === ARC_TESTNET.id ? (live.contracts as Record<string, string>) : {};
  return {
    contracts: {
      USDC: c.USDC,
      NanoLedger: c.NanoLedger,
      BuilderRegistry: c.BuilderRegistry,
      MarketsPerennial: c.MarketsPerennial,
      // Testnet v4 (BuilderFund + SeasonPool) is not deployed yet: null until a
      // sync writes them, or the extras file names them.
      BuilderFund: c.BuilderFund ?? testnetExtras.builderFund,
      SeasonPool: c.SeasonPool ?? testnetExtras.seasonPool,
      CaretakerRegistry: c.CaretakerRegistry,
      // Deployed after the last sync may have run: the extras file carries it too.
      VerifiedBuilderBadge: c.VerifiedBuilderBadge ?? testnetExtras.verifiedBuilderBadge,
      WonderEscrow: c.WonderEscrow ?? (testnetExtras as { wonderEscrow?: string | null }).wonderEscrow ?? null,
    },
    operator: testnetExtras.operator,
    deployBlock: testnetExtras.deployBlock,
  };
}

/** A network's market deployment, whichever network the Perennial pages are built for. */
export function perennialDeploymentFor(network: PerennialNetwork): PerennialDeployment {
  return resolvePerennialDeployment(network, sourceFor(network));
}

// NEXT_PUBLIC_* must be referenced literally for Next to inline it.
export const PERENNIAL_NETWORK: PerennialNetwork = selectPerennialNetwork(
  process.env.NEXT_PUBLIC_PERENNIAL_NETWORK,
);

export const PERENNIAL: PerennialDeployment = resolvePerennialDeployment(
  PERENNIAL_NETWORK,
  sourceFor(PERENNIAL_NETWORK),
);

/** True when the build-time snapshot (live-data.json) describes the selected
 *  Perennial chain. A testnet snapshot must never be shown as mainnet data. */
export const SNAPSHOT_MATCHES_NETWORK = live.chainId === PERENNIAL.chain.id;

/** Status line for headers: never claims live when the network isn't deployed. */
export function networkStatusLine(d: PerennialDeployment): string {
  if (!d.deployed) return `${d.label} · not deployed yet`;
  return d.network === "mainnet" ? `${d.label} · live` : `${d.label} · test USDC`;
}
