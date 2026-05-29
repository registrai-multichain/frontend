import { defineChain, type Address, type Chain } from "viem";
import live from "./live-data.json";

/**
 * Multichain registry. The frontend is built to deploy on any chain Registrai
 * runs on — each chain entry is self-contained (RPC, explorer, contract
 * addresses, stablecoin tokens, native currency). Add a new chain by adding
 * an entry here and pointing the wallet provider at it.
 *
 * Today we live on Arc testnet. Other EVM chains can be added by appending
 * an entry here once contracts deploy there.
 */
export type Family = "evm";

export interface ChainContracts {
  Registry: Address;
  Attestation: Address;
  Dispute: Address;
  Markets: Address;
  MarketsEURC?: Address;
  MarketMakerVault?: Address;
  MedianRule?: Address;
  TrimmedMeanRule10?: Address;
  /** v1.1 Registry — kept for reading legacy markets/feeds. New agent
   *  registrations go through v2. */
  RegistryV11?: Address;
  AttestationV11?: Address;
  DisputeV11?: Address;
  MarketsV11?: Address;
  /** v2 stack — current write target for createFeed / registerAgent /
   *  createMarket. Includes rule, points, audit fixes. */
  RegistryV2?: Address;
  AttestationV2?: Address;
  DisputeV2?: Address;
  MarketsV2?: Address;
  MarketMakerVaultV2?: Address;
  /** Soulbound credit system. Awards points on register/attest/trade/resolve. */
  RegistraiPoints?: Address;
  /** Global agent identity registry (name/description/url/contact per address). */
  AgentIdentity?: Address;
  USDC: Address;
  EURC?: Address;
  /** v0.5 alpha cirque lending — cirBTC × USDC two-sided pool. */
  cirBTC?: Address;
  CirqueLending?: Address;
  AttestedBTCOracle?: Address;
}

export interface ChainEntry {
  id: number;
  family: Family;
  name: string;             // "Arc Testnet"
  shortName: string;        // "arc"
  testnet: boolean;
  rpcUrls: readonly string[];
  explorer: { name: string; url: string };
  nativeCurrency: { name: string; symbol: string; decimals: number };
  contracts: ChainContracts;
  viemChain: Chain;
  /** Optional human label for the deployment (e.g. "v1 · 2026-05"). */
  label?: string;
}

// ─────────────────────── Arc Testnet ───────────────────────
// USDC on Arc is the native gas token (18-decimal accounting) but has an
// ERC-20 interface at 0x3600…0000 with 6 decimals — that's what our
// contracts use.

const ARC_TESTNET_VIEM = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const ARC_TESTNET: ChainEntry = {
  id: 5042002,
  family: "evm",
  name: "Arc Testnet",
  shortName: "arc",
  testnet: true,
  rpcUrls: ["https://rpc.testnet.arc.network"],
  explorer: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  contracts: {
    USDC: live.contracts.USDC as Address,
    EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as Address,
    Registry: live.contracts.Registry as Address,
    Attestation: live.contracts.Attestation as Address,
    Dispute: live.contracts.Dispute as Address,
    Markets: live.contracts.Markets as Address,
    MarketsEURC: (live.contracts as { MarketsEURC?: string }).MarketsEURC as
      | Address
      | undefined,
    MarketMakerVault: (live.contracts as { MarketMakerVault?: string })
      .MarketMakerVault as Address | undefined,
    MedianRule: (live.contracts as { MedianRule?: string })
      .MedianRule as Address | undefined,
    TrimmedMeanRule10: (live.contracts as { TrimmedMeanRule10?: string })
      .TrimmedMeanRule10 as Address | undefined,
    RegistryV11: (live.contracts as { Registry_v1_1?: string })
      .Registry_v1_1 as Address | undefined,
    AttestationV11: (live.contracts as { Attestation_v1_1?: string })
      .Attestation_v1_1 as Address | undefined,
    DisputeV11: (live.contracts as { Dispute_v1_1?: string })
      .Dispute_v1_1 as Address | undefined,
    MarketsV11: (live.contracts as { Markets_v1_1?: string })
      .Markets_v1_1 as Address | undefined,
    RegistryV2: (live.contracts as { Registry_v2?: string })
      .Registry_v2 as Address | undefined,
    AttestationV2: (live.contracts as { Attestation_v2?: string })
      .Attestation_v2 as Address | undefined,
    DisputeV2: (live.contracts as { Dispute_v2?: string })
      .Dispute_v2 as Address | undefined,
    MarketsV2: (live.contracts as { Markets_v2?: string })
      .Markets_v2 as Address | undefined,
    MarketMakerVaultV2: (live.contracts as { MarketMakerVault_v2?: string })
      .MarketMakerVault_v2 as Address | undefined,
    RegistraiPoints: (live.contracts as { RegistraiPoints?: string })
      .RegistraiPoints as Address | undefined,
    AgentIdentity: (live.contracts as { AgentIdentity?: string })
      .AgentIdentity as Address | undefined,
    // v0.5 beta cirque lending (cirBTC × USDC).
    // CirqueLending redeployed for the leverageAndBet feature + the
    // full-power-review fixes (redeemPot escrow, dead-zone escape hatch,
    // resolved-only treasury sweep). Oracle unchanged from v0.5 alpha.
    cirBTC: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" as Address,
    CirqueLending: "0x2dd7bc570e876499422b8185dbb04c4b134cd504" as Address,
    AttestedBTCOracle: "0x83f3e3d6e9cc18579de577d92df1e23cc27057a1" as Address,
  },
  viemChain: ARC_TESTNET_VIEM,
  label: "v2 · 2026-05",
};

// ─────────────────────── HyperEVM (planned) ───────────────────────
// Stub entry — uncomment + fill addresses when contracts deploy on HyperEVM.
// Same Solidity, different chain. The frontend is wired to support both.
//
// export const HYPER_EVM_TESTNET: ChainEntry = {
//   id: 998,
//   family: "evm",
//   name: "HyperEVM Testnet",
//   shortName: "hyperevm",
//   testnet: true,
//   rpcUrls: ["https://rpc.hyperliquid-testnet.xyz/evm"],
//   explorer: { name: "HyperScan", url: "https://explorer.hyperliquid-testnet.xyz" },
//   nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
//   contracts: { /* deploy on HyperEVM and fill */ },
//   viemChain: defineChain({ ... }),
// };

// ─────────────────────── Registry ───────────────────────

export const CHAINS: Record<number, ChainEntry> = {
  [ARC_TESTNET.id]: ARC_TESTNET,
  // [HYPER_EVM_TESTNET.id]: HYPER_EVM_TESTNET,
};

export const DEFAULT_CHAIN_ID = ARC_TESTNET.id;
export const DEFAULT_CHAIN = ARC_TESTNET;

export function getChain(id: number | undefined): ChainEntry | undefined {
  if (id === undefined) return undefined;
  return CHAINS[id];
}

export function isSupportedChain(id: number | undefined): boolean {
  return id !== undefined && id in CHAINS;
}

// ─────────────────────── Helpers ───────────────────────

export function txUrl(chain: ChainEntry, hash: string): string {
  return `${chain.explorer.url}/tx/${hash}`;
}

export function addrUrl(chain: ChainEntry, addr: string): string {
  return `${chain.explorer.url}/address/${addr}`;
}
