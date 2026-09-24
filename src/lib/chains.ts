import { defineChain, fallback, http, type Address, type Chain, type Transport } from "viem";
import live from "./live-data.json";

// Circle's official Arc RPC endpoints — the ONLY endpoints the app reads from or
// hands to a wallet. Project rule: no third-party RPC and no API keys in the
// bundle (a key here is public the moment the site is built).
export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.io";
export const ARC_MAINNET_RPC = "https://rpc.mainnet.arc.io";

/** Read transport for Arc testnet: Circle's official endpoint only. Writes go
 *  through the user's wallet RPC (custom transport), not this. */
export function arcTransport(): Transport {
  return fallback([http(ARC_TESTNET_RPC)]);
}

/** Read transport for a given chain entry: its own (official) RPC list only.
 *  `batch` coalesces concurrent reads into JSON-RPC batches (Circle's Arc
 *  endpoints accept them), which keeps multi-read views under the rate limit. */
export function transportFor(chain: WalletChain, opts: { batch?: boolean } = {}): Transport {
  return fallback(
    chain.rpcUrls.map((url) =>
      http(url, {
        batch: opts.batch ? { batchSize: 25, wait: 20 } : false,
        retryCount: 4,
        retryDelay: 400,
      }),
    ),
  );
}

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
  /** Borrow-against-bet stack. MarketsV3 = Markets v2 + share-transfer
   *  primitive; CirqueBetLending lends USDC against a held MarketsV3 position
   *  at the depth-capped mark. */
  MarketsV3?: Address;
  CirqueBetLending?: Address;
  /** Suffix Pool — two-tranche, cash-floored treasury ($ai senior + $aiLP
   *  junior). Testnet research; junior is a security (no live trading UI until
   *  counsel). */
  SuffixTreasury?: Address;
  SuffixSenior?: Address;
  SuffixJunior?: Address;
  /** OracleStake — tiered pooled stake. Stake USDC once, launch oracle feeds
   *  from the UI (tier quota); OracleStake is the feed creator + bonded agent
   *  of record, with each feed independently bonded. */
  OracleStake?: Address;
  /** NanoLedger — fully on-chain trustless nanopayment settlement. Value moves
   *  as internal balance accounting (gas decoupled from amount), with
   *  reserve-funded streams; USDC only at deposit/withdraw. */
  NanoLedger?: Address;
  /** MarketsV4 — binary prediction market settled entirely on NanoLedger:
   *  trades move internal balances, the per-trade fee is one accrual write. */
  MarketsV4nano?: Address;
  /** Perennial — fund builders by betting on their progress. 50% of every
   *  market fee is the income of the builder the market is about (BuilderFund),
   *  taxed progressively per epoch into the SeasonPool. */
  BuilderRegistry?: Address;
  BuilderFund?: Address;
  SeasonPool?: Address;
  CaretakerRegistry?: Address;
  MarketsPerennial?: Address;
}

/** What a wallet needs to know about a chain (switch/add, reads, explorer).
 *  Every chain the app can point a wallet at is one of these; only chains with
 *  the full oracle stack deployed are also a {@link ChainEntry}. */
export interface WalletChain {
  id: number;
  name: string;             // "Arc Testnet"
  shortName: string;        // "arc"
  testnet: boolean;
  /** Official RPC endpoints only — these are installed into users' wallets. */
  rpcUrls: readonly string[];
  explorer: { name: string; url: string };
  /** Native gas currency. On Arc this is USDC with 18-decimal accounting. */
  nativeCurrency: { name: string; symbol: string; decimals: number };
  /** The ERC-20 USDC interface (6 decimals on Arc). */
  usdc: { address: Address; decimals: number };
  viemChain: Chain;
}

export interface ChainEntry extends WalletChain {
  family: Family;
  contracts: ChainContracts;
  /** Optional human label for the deployment (e.g. "v1 · 2026-05"). */
  label?: string;
}

// ─────────────────────── Arc Testnet ───────────────────────
// USDC on Arc is the native gas token (18-decimal accounting) but has an
// ERC-20 interface at 0x3600…0000 with 6 decimals — that's what our
// contracts use.

/** Arc's ERC-20 USDC interface — same address on testnet and mainnet, 6
 *  decimals on both (verified on-chain). Native gas USDC is 18 decimals. */
export const ARC_USDC_ERC20 = "0x3600000000000000000000000000000000000000" as Address;

const ARC_TESTNET_VIEM = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    // Circle's official testnet endpoint only.
    default: { http: [ARC_TESTNET_RPC] },
    public: { http: [ARC_TESTNET_RPC] },
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
  rpcUrls: [ARC_TESTNET_RPC],
  explorer: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  usdc: { address: ARC_USDC_ERC20, decimals: 6 },
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
    // Borrow-against-bet stack (deployed 2026-06-01). Sibling MarketsV3 reuses
    // the v2 Registry + Attestation; CirqueBetLending lends against positions
    // on MarketsV3 markets at the depth-capped mark.
    MarketsV3: "0xDDC085320D5A739cB5726f01E9c4b5d058fFfB00" as Address,
    CirqueBetLending: "0x8168bdD7990abc42b92b59DE6d411e9C66bB93C1" as Address,
    // Suffix Pool (deployed 2026-06-08, testnet research). Read-only surface
    // for now — $aiLP is a security; no trading UI until counsel.
    SuffixTreasury: "0x0B146b14EEf4b4C0D16AEA9DADF461e714bf5Ce2" as Address,
    SuffixSenior: "0x4b3A8957BFd80fC54393CeF7fBdf1a96586fbeA1" as Address,
    SuffixJunior: "0xCa1e23c01bCF9fDf3AE1CA2d3b072cCE007fb814" as Address,
    // OracleStake (deployed 2026-06-15). Stake USDC once, launch oracle feeds
    // from the UI by tier; OracleStake is the bonded agent of record per feed.
    OracleStake: (live.contracts as { OracleStake?: string })
      .OracleStake as Address | undefined,
    // NanoLedger (deployed 2026-06-16). Fully on-chain trustless nanopayment
    // settlement: internal balances + reserve-funded streams; sub-cent flows.
    NanoLedger: (live.contracts as { NanoLedger?: string })
      .NanoLedger as Address | undefined,
    // MarketsV4 (deployed 2026-06-16). Prediction market settled on NanoLedger;
    // fee = one accrual write per trade, claimed from the ledger.
    MarketsV4nano: (live.contracts as { MarketsV4?: string })
      .MarketsV4 as Address | undefined,
    // Perennial (deployed 2026-06-29). Builder funding via betting markets.
    BuilderRegistry: (live.contracts as { BuilderRegistry?: string })
      .BuilderRegistry as Address | undefined,
    BuilderFund: (live.contracts as { BuilderFund?: string })
      .BuilderFund as Address | undefined,
    SeasonPool: (live.contracts as { SeasonPool?: string })
      .SeasonPool as Address | undefined,
    CaretakerRegistry: (live.contracts as { CaretakerRegistry?: string })
      .CaretakerRegistry as Address | undefined,
    MarketsPerennial: (live.contracts as { MarketsPerennial?: string })
      .MarketsPerennial as Address | undefined,
  },
  viemChain: ARC_TESTNET_VIEM,
  label: "v2 · 2026-05",
};

// ─────────────────────── Arc Mainnet ───────────────────────
// Chain facts mirror the bridge registry (cctp/domains.ts: chain 5042, CCTP
// domain 26, explorer.arc.io). Wallet-level only: the oracle stack is not
// deployed on mainnet, so this is deliberately NOT in `CHAINS` — pages that
// drive contracts through `currentChain` keep reading testnet. Perennial picks
// its network separately (see lib/perennial-network.ts).

const ARC_MAINNET_VIEM = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_MAINNET_RPC] },
    public: { http: [ARC_MAINNET_RPC] },
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  },
  testnet: false,
});

export const ARC_MAINNET: WalletChain = {
  id: 5042,
  name: "Arc",
  shortName: "arc",
  testnet: false,
  rpcUrls: [ARC_MAINNET_RPC],
  explorer: { name: "Arc Explorer", url: "https://explorer.arc.io" },
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  usdc: { address: ARC_USDC_ERC20, decimals: 6 },
  viemChain: ARC_MAINNET_VIEM,
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

/** Every chain the app may ask a wallet to switch to / add. */
export const WALLET_CHAINS: Record<number, WalletChain> = {
  [ARC_TESTNET.id]: ARC_TESTNET,
  [ARC_MAINNET.id]: ARC_MAINNET,
};

export function getWalletChain(id: number | undefined): WalletChain | undefined {
  if (id === undefined) return undefined;
  return WALLET_CHAINS[id];
}

// Perennial's network (testnet | mainnet) is chosen at build time in
// lib/perennial-network.ts via NEXT_PUBLIC_PERENNIAL_NETWORK; it is not pinned
// here any more.

export function getChain(id: number | undefined): ChainEntry | undefined {
  if (id === undefined) return undefined;
  return CHAINS[id];
}

export function isSupportedChain(id: number | undefined): boolean {
  return id !== undefined && id in CHAINS;
}

// ─────────────────────── Helpers ───────────────────────

export function txUrl(chain: WalletChain, hash: string): string {
  return `${chain.explorer.url}/tx/${hash}`;
}

export function addrUrl(chain: WalletChain, addr: string): string {
  return `${chain.explorer.url}/address/${addr}`;
}
