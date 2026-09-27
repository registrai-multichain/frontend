/**
 * app.registrai.cc/transparency: who holds which key, where fees go, the REGI
 * buyback, the contracts and the public record, for Arc MAINNET. Everything
 * here is either read from the deployment file or live from chain; the prose is
 * what each wallet/role is for, so a reader can check it against the explorer.
 */
import { keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import deployment from "./deployments/arc-mainnet.json";
import roundsDeployment from "./deployments/arc-mainnet-rounds.json";
import record from "../data/transparency-record.json";
import { shortHex } from "./perennial-market";
import { REGI_CONTRACT, REGI_DEXSCREENER_URL } from "./regi";

const B = deployment.builders as unknown as {
  BuilderRegistry: Address;
  CaretakerRegistry: Address;
  VerifiedBuilderBadge: Address;
  operator: Address;
  deployBlock: number;
  deployedAt: string;
  roles: { adminSafe: Address; onboarder: Address; deployer: Address };
};

/** The common markets, from the rounds deployment file (filled by the launch): until it
 *  names MarketsV4 and the agent, the dashboard shows none of them. */
const R = roundsDeployment as { agent?: string | null; contracts?: Record<string, string | null> };
const hexAddr = (v: unknown): Address | null => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null);
export const COMMON = {
  agent: hexAddr(R.agent),
  marketsV4: hexAddr(R.contracts?.MarketsV4),
  registry: hexAddr(R.contracts?.Registry),
  attestation: hexAddr(R.contracts?.Attestation),
  // Not in the rounds file (yet): contracts/deployments/arc-mainnet-common-markets.json, verified on chain 2026-09-27.
  dispute: "0xf62Cd073F6748F56a0233c43C2ce02640FAa75d8" as Address,
};
const COMMON_ON = Boolean(COMMON.agent && COMMON.marketsV4 && COMMON.registry && COMMON.attestation);

export type WalletKey = "safe" | "operator" | "onboarder" | "roundsAgent" | "deployer";
export interface WalletInfo { key: WalletKey; label: string; address: Address; isSafe: boolean; what: string; cannot: string }

export const WALLETS: WalletInfo[] = [
  {
    key: "safe", label: "Admin Safe", address: B.roles.adminSafe, isSafe: true,
    what: "Grants and removes every role, registers builders who ask for gas-free registration, revokes badges, recovers builders who lost their key, and rules on challenged readings of the common markets.",
    cannot: "Act alone: every transaction needs 2 of its 3 owners to sign.",
  },
  {
    key: "operator", label: "Keeper operator", address: B.operator, isSafe: false,
    what: "Runs the builders keeper every 10 minutes: re-checks every project proof and marks a badge lapsed, or verified again, to match.",
    cannot: "Issue or revoke badges, register builders, or grant roles. It is not an agent of the common markets: it can't open or settle them.",
  },
  {
    key: "onboarder", label: "Onboarder", address: B.roles.onboarder, isSafe: false,
    what: "Onboards a verified builder: links it to the keeper and issues its Verified Builder Badge.",
    cannot: "Revoke badges, register builders, or grant roles. The Safe can remove its roles at any time.",
  },
  ...(COMMON_ON ? [{
    key: "roundsAgent" as const, label: "Rounds agent", address: COMMON.agent!, isSafe: false,
    what: "Opens the 5-minute Up/Down rounds and the event markets, and posts each round's price reading (the median of Coinbase, Kraken and OKX), bonded on every feed it serves.",
    cannot: "Move anyone's funds, change a contract, or rule on a dispute: any reading can be challenged, and the Safe rules on it.",
  }] : []),
  {
    key: "deployer", label: "Deployer", address: B.roles.deployer, isSafe: false,
    what: `Deployed the contracts (the builder registries on ${B.deployedAt}).`,
    cannot: "Anything: it gave up every role after each deploy.",
  },
];

const byAddress = new Map(WALLETS.map((w) => [w.address.toLowerCase(), w]));
/** A known wallet's name, else a short address. */
export const holderLabel = (address: string) => byAddress.get(address.toLowerCase())?.label ?? shortHex(address);

export type ContractKey =
  | "registry" | "caretakers" | "badge" | "nominations" | "ledger" | "buyback" | "splitter"
  | "oracleRegistry" | "attestation" | "dispute" | "marketsV4";
export interface ContractInfo { key: ContractKey; name: string; address: Address; what: string; audit: string }

export const CONTRACTS: ContractInfo[] = [
  { key: "registry", name: "BuilderRegistry", address: B.BuilderRegistry, audit: "audited",
    what: "Every builder and project: who claimed it, with which wallet, and whether it is active." },
  { key: "caretakers", name: "CaretakerRegistry", address: B.CaretakerRegistry, audit: "audited",
    what: "Which keeper looks after each builder's milestones." },
  { key: "badge", name: "VerifiedBuilderBadge", address: B.VerifiedBuilderBadge, audit: "audited",
    what: "The soulbound Verified Builder Badge: one per builder, numbered in the order they were verified." },
  { key: "nominations", name: "ProjectNominations", address: "0x6d87C64CD64e5c8b3204fCBFD28720b27C80F354", audit: "internally reviewed",
    what: "The on-chain list of projects Registrai nominated, with a fingerprint of each one's investigated profile. Holds no funds." },
  // Deployed 2026-09-27 (block 22932186 for the buyback pair), ahead of the markets stack.
  { key: "ledger", name: "NanoLedger", address: "0x82CC64bc010Bc244E63654817202B5330f1Ac112", audit: "internally reviewed",
    what: "The shared USDC ledger: balances move as accounting and real USDC only crosses at deposit and withdraw. Nobody, the Safe included, can move or freeze a balance." },
  { key: "buyback", name: "RegiBuyback", address: "0xE6D5d4C4b8c0b3ea271c9C48De61D0cDD38Bb7e0", audit: "internally reviewed",
    what: "Spends every USDC it holds on REGI and burns it: rounds of 4 × $50, 10 minutes apart, anyone can press. No owner, no withdraw." },
  { key: "splitter", name: "RegiFeeSplitter", address: "0xd8Dc4Ca674de4571E33040EEb14D487D2Bc37Df7", audit: "internally reviewed",
    what: "The treasury address: 40% of income to the buyback (fixed), 60% recorded for the Safe to collect. The Safe can redirect the 40% only with 7 days' public notice." },
  // The common markets (launched 2026-09-27: oracle from block 23010997, MarketsV4 from 23011086).
  ...(COMMON_ON ? ([
  { key: "marketsV4", name: "MarketsV4", address: COMMON.marketsV4!, audit: "internally reviewed",
    what: "The common markets: 5-minute Up/Down rounds and event markets on the NanoLedger. Half of every 1% fee goes to the fee splitter. Settles on the first valid reading within an hour of expiry, else voids with refunds." },
  { key: "oracleRegistry", name: "Oracle Registry", address: COMMON.registry!, audit: "internally reviewed",
    what: "The price feeds and each agent's bond per feed (at least 2 USDC); a reading ruled wrong slashes the bond." },
  { key: "attestation", name: "Attestation", address: COMMON.attestation!, audit: "internally reviewed",
    what: "The agents' readings, each with a hash of its evidence, challengeable until final." },
  { key: "dispute", name: "Dispute", address: COMMON.dispute, audit: "internally reviewed",
    what: "Challenges of readings: anyone can stake to challenge, always accepted; the feed's resolver (the Safe) rules." },
  ] as ContractInfo[]) : []),
];
export const DEPLOY = { block: B.deployBlock, date: B.deployedAt };

const role = (name: string, what: string) => ({
  name,
  hash: (name === "DEFAULT_ADMIN_ROLE" ? `0x${"0".repeat(64)}` : keccak256(toBytes(name))) as Hex,
  what,
});
export const ROLES: Record<ContractKey, { name: string; hash: Hex; what: string }[]> = {
  registry: [role("DEFAULT_ADMIN_ROLE", "grants and removes roles"), role("REGISTRAR_ROLE", "registers builders and adds projects for them")],
  caretakers: [role("DEFAULT_ADMIN_ROLE", "grants and removes roles"), role("GOVERNOR_ROLE", "links a builder to its keeper")],
  ledger: [
    role("DEFAULT_ADMIN_ROLE", "grants and removes roles"),
    role("GOVERNOR_ROLE", "registers pool sources and skims USDC above what the ledger owes"),
  ],
  buyback: [],
  splitter: [],
  nominations: [role("DEFAULT_ADMIN_ROLE", "grants and removes roles"), role("NOMINATOR_ROLE", "nominates and un-nominates projects")],
  marketsV4: [role("DEFAULT_ADMIN_ROLE", "grants and removes roles"), role("GOVERNOR_ROLE", "approves the agents, resolvers and market creators of new markets")],
  oracleRegistry: [],
  attestation: [],
  dispute: [],
  badge: [
    role("DEFAULT_ADMIN_ROLE", "grants and removes roles"),
    role("ISSUER_ROLE", "issues a badge"),
    role("STATUS_ROLE", "marks a badge lapsed or verified again"),
    role("REVOKER_ROLE", "revokes a badge for good"),
  ],
};

/** A 1% fee on every buy and sell, split like this. */
export const TRADE_FEE_PCT = 1;

export const FEE_SPLITS = [
  {
    market: "Perennial markets (about builders)",
    short: "Builder markets",
    legs: [
      { pct: 50, who: "Builder", to: "the builder the market is about, paid out after each epoch (a progressive tax funds the season pool)" },
      { pct: 30, who: "Market opener", to: "whoever opened the market" },
      { pct: 20, who: "Settling agent", to: "the agent that settles it, held until it does" },
    ],
  },
  {
    market: "Common markets (5-minute rounds and events)",
    short: "Common markets",
    legs: [
      { pct: 50, who: "Treasury", to: "the Registrai treasury (part of it funds the REGI buyback and burn)" },
      { pct: 30, who: "Market opener", to: "whoever opened the market" },
      { pct: 20, who: "Settling agent", to: "the agent that settles it" },
    ],
  },
];

export const BUYBACK = {
  /** RegiBuyback on mainnet; null until it deploys with common markets (the button stays hidden). */
  contract: "0xE6D5d4C4b8c0b3ea271c9C48De61D0cDD38Bb7e0" as Address | null,
  /** RegiFeeSplitter (MarketsV4's TREASURY); null until deployed. */
  splitter: "0xd8Dc4Ca674de4571E33040EEb14D487D2Bc37Df7" as Address | null,
  /** The shared NanoLedger: common markets pay the splitter there, so its pending income is
   *  ledger balance + USDC. Null until mainnet markets deploy. */
  ledger: "0x82CC64bc010Bc244E63654817202B5330f1Ac112" as Address | null,
  /** First block to scan for Burned events; null until deployed. */
  deployBlock: 22932186n as bigint | null,
  triggerUsdc: 200,
  chunkUsdc: 50,
  chunks: 4,
  cooldownMin: 10,
  /** Share of the treasury's income (the splitter's BUYBACK_BPS / 100). */
  shareOfTreasuryPct: 40,
  burnAddress: "0x000000000000000000000000000000000000dEaD" as Address,
  token: REGI_CONTRACT as Address,
  poolUrl: REGI_DEXSCREENER_URL,
};

export interface RecordEntry { date: string; title: string; detail?: string; tx?: string; address?: string }
export const RECORD: RecordEntry[] = [...(record as RecordEntry[])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/** Arc's native gas token is USDC with 18 decimals; the site's money helpers use 6. */
export const nativeToUsdc = (v: bigint) => v / 1_000_000_000_000n;

/**
 * The roles as deployed and checked on 2026-09-25 (contracts/deployments/arc-mainnet-builders.json):
 * `contract:ROLE` -> the wallets that should hold it. The page compares the live chain against this.
 */
export const EXPECTED_ROLES: Record<string, WalletKey[]> = {
  "registry:DEFAULT_ADMIN_ROLE": ["safe"],
  "registry:REGISTRAR_ROLE": ["safe"],
  "caretakers:DEFAULT_ADMIN_ROLE": ["safe"],
  "caretakers:GOVERNOR_ROLE": ["safe", "onboarder"],
  "badge:DEFAULT_ADMIN_ROLE": ["safe"],
  "badge:ISSUER_ROLE": ["safe", "onboarder"],
  "badge:STATUS_ROLE": ["operator"],
  "badge:REVOKER_ROLE": ["safe"],
  "ledger:DEFAULT_ADMIN_ROLE": ["safe"],
  "ledger:GOVERNOR_ROLE": ["safe"],
  "nominations:DEFAULT_ADMIN_ROLE": ["safe"],
  "nominations:NOMINATOR_ROLE": ["safe", "onboarder"],
  "marketsV4:DEFAULT_ADMIN_ROLE": ["safe"],
  "marketsV4:GOVERNOR_ROLE": ["safe"],
};

const roleWords = (name: string) => name.replace(/_ROLE$/, "").replace(/_/g, " ").toLowerCase();

/** Pure: every way the live roles (`contract:ROLE:wallet` -> held) differ from EXPECTED_ROLES, in plain words. */
export function roleDiffs(live: Record<string, boolean>): string[] {
  const out: string[] = [];
  for (const c of CONTRACTS) {
    for (const r of ROLES[c.key]) {
      const expected = EXPECTED_ROLES[`${c.key}:${r.name}`] ?? [];
      for (const w of WALLETS) {
        const held = Boolean(live[`${c.key}:${r.name}:${w.key}`]);
        const should = expected.includes(w.key);
        if (held && !should) out.push(`${w.label} holds ${c.name} ${roleWords(r.name)}, which it shouldn't`);
        if (!held && should) out.push(`${w.label} no longer holds ${c.name} ${roleWords(r.name)}`);
      }
    }
  }
  return out;
}

/** "2.81%": part / whole, two decimals, "0%" for an empty whole. */
export function percentOf(part: bigint, whole: bigint): string {
  if (whole <= 0n) return "0%";
  const bp = (part * 10_000n) / whole;
  return `${(Number(bp) / 100).toFixed(2)}%`;
}

/** "28.1M", "1.2K", "999", "1B". */
export function compactNumber(n: number): string {
  const units: [number, string][] = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, u] of units) if (Math.abs(n) >= v) return `${Number((n / v).toFixed(1))}${u}`;
  return String(Math.round(n));
}

export interface DexPair { priceUsd: number; marketCapUsd: number | null; liquidityUsd: number | null }
export const DEX_PAIR_API = "https://api.dexscreener.com/latest/dex/pairs/arc/0x0530f18eb32d732cc8b067bbd0b2ba7e5d807d4f5cf4f7d74429f2a78d3120c8";

/** Pure: the REGI/USDC pair from DexScreener's pairs response, or null. */
export function parseDexPair(json: unknown): DexPair | null {
  const j = json as { pairs?: unknown[]; pair?: unknown } | null;
  const p = (j?.pairs?.[0] ?? j?.pair) as { priceUsd?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number } } | undefined;
  const price = Number(p?.priceUsd);
  if (!p || !Number.isFinite(price) || price <= 0) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { priceUsd: price, marketCapUsd: num(p.marketCap) ?? num(p.fdv), liquidityUsd: num(p.liquidity?.usd) };
}

export interface SupplyPart { key: "burned" | "protocol" | "public"; label: string; amount: bigint; pct: string }

/** Pure: REGI supply as burned / held by the protocol's wallets / everyone else. */
export function supplySplit({ supply, burned, protocol }: { supply: bigint; burned: bigint; protocol: bigint }): SupplyPart[] {
  const rest = supply - burned - protocol;
  const pub = rest > 0n ? rest : 0n;
  return [
    { key: "burned", label: "Burned", amount: burned, pct: percentOf(burned, supply) },
    { key: "protocol", label: "Protocol wallets", amount: protocol, pct: percentOf(protocol, supply) },
    { key: "public", label: "Everyone else", amount: pub, pct: percentOf(pub, supply) },
  ];
}

/** Pure: the sum of `values` over the given wallets; a wallet with no entry counts as 0. */
export const sumBy = (wallets: { key: string }[], values: Record<string, bigint>) =>
  wallets.reduce((s, w) => s + (values[w.key] ?? 0n), 0n);

/**
 * Pure: SVG donut segments for `shares` (any scale) around a circle of `circumference`.
 * A non-zero part is at least `minLength` long so a sliver stays visible; empty parts get 0.
 */
export function donutArcs(shares: number[], circumference: number, minLength = 0): { length: number; offset: number }[] {
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  let offset = 0;
  return shares.map((v) => {
    const length = v > 0 ? Math.max(minLength, (v / total) * circumference) : 0;
    const arc = { length, offset };
    offset += length;
    return arc;
  });
}

export const regiBuybackAbi = parseAbi([
  "function status() view returns (uint256 balance, uint256 chunksLeft, uint256 nextChunkAt, bool ready, uint256 totalUsdcSpent, uint256 totalRegiBurned, uint256 totalChunks)",
  "function burnChunk() returns (uint256 usdcIn, uint256 regiBurned)",
  "event Burned(uint256 indexed round, uint256 chunk, uint256 usdcIn, uint256 regiBurned, address indexed caller)",
]);
export const regiSplitterAbi = parseAbi([
  "function distribute() returns (uint256 toBuyback, uint256 toSafe)",
  "function buyback() view returns (address)",
  "function pendingBuyback() view returns (address)",
  "function pendingSince() view returns (uint256)",
]);

export interface BuybackStatus { balance: bigint; chunksLeft: number; nextChunkAt: number; ready: boolean; spent: bigint; burned: bigint; chunks: number }
export type BuybackPhase = "off" | "collecting" | "ready" | "cooldown";

export function parseBuybackStatus(r: readonly [bigint, bigint, bigint, boolean, bigint, bigint, bigint]): BuybackStatus {
  return { balance: r[0], chunksLeft: Number(r[1]), nextChunkAt: Number(r[2]), ready: r[3], spent: r[4], burned: r[5], chunks: Number(r[6]) };
}

/** Pure: what the buyback section shows. USDC in 6 decimals; `incoming` = the splitter's pending 40%. */
export function buybackView(s: BuybackStatus | null, nowSec: number, incoming = 0n) {
  const trigger = BigInt(BUYBACK.triggerUsdc) * 1_000_000n;
  const r = s ?? { balance: 0n, chunksLeft: 0, nextChunkAt: 0, ready: false, spent: 0n, burned: 0n, chunks: 0 };
  const inRound = r.chunksLeft > 0;
  const secondsToNext = Math.max(0, r.nextChunkAt - nowSec);
  // A chunk is due when a round is open or a round's worth is held; once the cooldown has
  // passed it is ready even if the last read (up to 10 s old) still said otherwise (review M2).
  const due = inRound || r.balance >= trigger;
  const phase: BuybackPhase = !s
    ? "off"
    : r.ready || (due && secondsToNext === 0 && r.balance > 0)
      ? "ready"
      : due && secondsToNext > 0
        ? "cooldown"
        : "collecting";
  const progressPct = inRound
    ? Math.round(((BUYBACK.chunks - r.chunksLeft) / BUYBACK.chunks) * 100)
    : r.balance >= trigger ? 100 : Number((r.balance * 100n) / trigger);
  return {
    live: s !== null,
    phase,
    collected: r.balance,
    incoming,
    toTrigger: r.balance >= trigger ? 0n : trigger - r.balance,
    progressPct,
    roundChunk: inRound ? BUYBACK.chunks - r.chunksLeft + 1 : 0,
    secondsToNext,
    spent: r.spent,
    burned: r.burned,
    chunks: r.chunks,
  };
}

/** "6:12"; never negative. */
export function countdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Pure: getLogs ranges of `size` blocks walking back from `head`, at most `max`, never below `floor`. */
export function logWindows(head: bigint, floor: bigint, size: bigint, max: number): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  let to = head;
  while (out.length < max && to >= floor) {
    const from = to - size + 1n > floor ? to - size + 1n : floor;
    out.push([from, to]);
    if (from === floor) break;
    to = from - 1n;
  }
  return out;
}

/** How often the dashboard re-reads: fast-moving numbers, the DexScreener price, and roles/owners. */
export const LIVE_REFRESH_MS = { fast: 10_000, price: 15_000, slow: 300_000 } as const;

/** Pure: "just now" (< 2 s), "4s ago", "2m ago". */
export function agoText(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

/** The buyback's log scan: 5,000-block windows (what Arc's RPC accepts), at most 40 back on first load (~28 h). */
export const BUYBACK_LOG_SCAN = { window: 5_000n, maxBack: 40 } as const;

/**
 * Pure: the getLogs ranges still to read. First scan (scannedTo null): walk back from the
 * head, newest first, at most `maxBack` windows, never below `floor`. Later scans: only the
 * blocks after `scannedTo`, oldest first, so a failure can stop without leaving a gap.
 */
export function nextScanRanges(head: bigint, scannedTo: bigint | null, floor: bigint, size: bigint, maxBack: number): [bigint, bigint][] {
  if (scannedTo === null) return logWindows(head, floor, size, maxBack);
  const out: [bigint, bigint][] = [];
  for (let from = scannedTo + 1n; from <= head; from += size) {
    out.push([from, from + size - 1n < head ? from + size - 1n : head]);
  }
  return out;
}

/** What the page says about who can change the buyback, in one place (review M3). */
export const BUYBACK_DISCLOSURE =
  `The ${BUYBACK.shareOfTreasuryPct}% share is fixed in the splitter contract. ` +
  "The Safe can point that share at a new buyback contract, with 7 days' public notice shown on this page; " +
  "during the notice the share waits in the splitter.";

/** Pure: who sent USDC into the buyback, in words (review M4). */
export function inflowLabel(from: string, known: { splitter?: string | null; safe?: string | null; ledger?: string | null }): string {
  const f = from.toLowerCase();
  if (known.splitter && f === known.splitter.toLowerCase()) return "the splitter (40% of treasury income)";
  if (known.safe && f === known.safe.toLowerCase()) return "the Admin Safe";
  if (known.ledger && f === known.ledger.toLowerCase()) return "the NanoLedger (a ledger payment swept in)";
  return shortHex(from);
}
