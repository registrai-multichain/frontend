import type { Address } from "viem";
import { ARC_MAINNET, ARC_TESTNET, type WalletChain } from "./chains";
import { perennialDeploymentFor, type PerennialNetwork } from "./perennial-network";
import { badgeNetworkKey } from "./verified-builder-badge";
import mainnetDeployment from "./deployments/arc-mainnet.json";
import testnetExtras from "./deployments/arc-testnet-perennial.json";

/**
 * The network the builder side runs on: /builders (the gallery), /verify (the
 * claim) and the gallery sync. Independent of the markets network
 * (perennial-network.ts), because mainnet launches in two phases:
 *
 *   phase 1  BuilderRegistry + CaretakerRegistry + VerifiedBuilderBadge only
 *            (contracts/script/DeployBuilders.s.sol): builders claim, get
 *            onboarded and hold their badge; no market, pool, oracle or feed.
 *   phase 2  the markets, reusing the same registries.
 *
 * Mainnet is selected as soon as `builders.BuilderRegistry` is set in
 * deployments/arc-mainnet.json, whatever the market contracts say; until then
 * Arc testnet. Nothing here reads, links or needs a market contract.
 */
export type BuildersNetwork = PerennialNetwork;

/** The builder-side contracts. `null` = not deployed on that network. */
export interface BuildersContracts {
  BuilderRegistry: Address | null;
  CaretakerRegistry: Address | null;
  VerifiedBuilderBadge: Address | null;
}

export interface BuildersDeployment {
  network: BuildersNetwork;
  chain: WalletChain;
  chainId: number;
  /** Circle's official RPC for the chain (never a third-party endpoint). */
  rpc: string;
  explorer: { name: string; url: string };
  /** "Arc mainnet" / "Arc testnet" — for copy. */
  label: string;
  contracts: BuildersContracts;
  /** The keeper operator: caretaker of every verified builder, badge STATUS holder. */
  operator: Address | null;
  /** First block worth scanning. */
  deployBlock: bigint | null;
  /** `public/badge/<network>/` — "arc" / "arc-testnet". */
  badgeNetwork: string | null;
  /** The registry exists: claims can be registered and the gallery read. */
  deployed: boolean;
  /** Badges are on: a badge contract and art for its network. */
  badgesOn: boolean;
}

/** One network's builder record (the `builders` block of a deployments file). */
export interface BuildersSource {
  BuilderRegistry?: string | null;
  CaretakerRegistry?: string | null;
  VerifiedBuilderBadge?: string | null;
  operator?: string | null;
  deployBlock?: number | null;
}

const addr = (v: string | null | undefined): Address | null =>
  typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null;

/** Pure: mainnet when its BuilderRegistry is set, else testnet. */
export function selectBuildersNetwork(mainnet: BuildersSource | null | undefined): BuildersNetwork {
  return addr(mainnet?.BuilderRegistry) ? "mainnet" : "testnet";
}

/** Pure: resolve a network's builder deployment. */
export function resolveBuildersDeployment(network: BuildersNetwork, source: BuildersSource): BuildersDeployment {
  const chain = network === "mainnet" ? ARC_MAINNET : ARC_TESTNET;
  const contracts: BuildersContracts = {
    BuilderRegistry: addr(source.BuilderRegistry),
    CaretakerRegistry: addr(source.CaretakerRegistry),
    VerifiedBuilderBadge: addr(source.VerifiedBuilderBadge),
  };
  const badgeNetwork = badgeNetworkKey(chain.id);
  return {
    network,
    chain,
    chainId: chain.id,
    rpc: chain.rpcUrls[0],
    explorer: chain.explorer,
    label: network === "mainnet" ? "Arc mainnet" : "Arc testnet",
    contracts,
    operator: addr(source.operator),
    deployBlock: typeof source.deployBlock === "number" && source.deployBlock > 0 ? BigInt(source.deployBlock) : null,
    badgeNetwork,
    deployed: contracts.BuilderRegistry !== null,
    badgesOn: Boolean(contracts.VerifiedBuilderBadge && badgeNetwork),
  };
}

/** The shipped builder records, per network. */
export const BUILDERS_SOURCES: Record<BuildersNetwork, BuildersSource> = {
  mainnet: (mainnetDeployment as { builders?: BuildersSource }).builders ?? {},
  testnet: (testnetExtras as { builders?: BuildersSource }).builders ?? {},
};

export const BUILDERS_NETWORK: BuildersNetwork = selectBuildersNetwork(BUILDERS_SOURCES.mainnet);

export const BUILDERS: BuildersDeployment = resolveBuildersDeployment(
  BUILDERS_NETWORK,
  BUILDERS_SOURCES[BUILDERS_NETWORK],
);

/**
 * Whether the markets are deployed on the builders network. Phase 1 mainnet:
 * false, and every surface that would promise milestone feeds or markets says
 * they start when markets open instead.
 */
export const MARKETS_OPEN_ON_BUILDERS_NETWORK: boolean = perennialDeploymentFor(BUILDERS_NETWORK).deployed;

/** Status line for the builder pages' headers. Never mentions markets. */
export function buildersStatusLine(d: BuildersDeployment): string {
  return d.deployed ? `${d.label} · builder registry` : `${d.label} · not deployed yet`;
}
