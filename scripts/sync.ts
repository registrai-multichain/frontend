/**
 * Sync onchain state from Arc testnet into `src/lib/live-data.json`.
 *
 * Run before `next build` so the static site bakes in current values.
 *   RPC=https://… npx tsx scripts/sync.ts
 *
 * The frontend reads live-data.json at build time; no client-side RPC.
 *
 * `gallery` (the /builders page) is read on the BUILDERS network instead
 * (src/lib/builders-network.ts): Arc mainnet once its phase-1 BuilderRegistry
 * is recorded, with the registries + badge only, so it needs no market contract.
 *   BUILDERS_RPC=https://…   override that network's (official) endpoint for a run
 */
import { createPublicClient, http, defineChain, type Address, type Hex } from "viem";
import { writeFileSync, readFileSync } from "node:fs";
import { EMPTY_PNL, foldTrades, seasonWindows } from "../src/lib/seasons";
import type { PnlState, Season, Trade } from "../src/lib/seasons";
import { REPUTATION_CURSOR_VERSION, type ReputationSnapshot } from "../src/lib/reputation";
import { syncReputation } from "./reputation";
import { proofConfigFromEnv, operatorFeeds } from "../src/lib/verified-builders";
import {
  feedCreatedEvent,
  makeFetchJson,
  perennialBuilderSnapshot,
  readBuilderRecords,
  verifiedOwners,
  type BuilderRecord,
  type LegacyKeeperBuilder,
  type PerennialBuilderSnapshot,
  type RegistryReader,
} from "../src/lib/verified-builders-chain";
import { BUILDERS } from "../src/lib/builders-network";
import {
  buildGallerySnapshot,
  gallerySyncPlan,
  parseGallerySnapshot,
  type GallerySnapshot,
} from "../src/lib/builders-gallery";
import perennialTestnet from "../src/lib/deployments/arc-testnet-perennial.json";
import {
  attachBadges,
  badgeImageBase,
  badgeNetworkKey,
  readBuilderBadges,
  type BadgeInfo,
  type BadgeReader,
} from "../src/lib/verified-builder-badge";

/**
 * Bump when the season fold changes shape or semantics. A cursor written by an
 * older version is replayed from the anchor rather than resumed — "state exists"
 * is not the same as "state is right", and a hollow cursor from a half-built
 * version would otherwise be trusted forever.
 *
 * v2: the Outcome enum was read backwards (MarketsPerennial declares
 * `{ Yes, No }`, so YES is 0), which inverted every trader's result at
 * resolution. Every stored `realised` value from v1 is wrong and must be
 * recomputed, not resumed.
 *
 * v3: the v2 backfill seeded the fold with the existing cursor and then replayed
 * all of history on top of it, double counting everything it re-read.
 */
const SEASONS_CURSOR_VERSION = 3;
import { resolve } from "node:path";

const DEPLOYMENT = JSON.parse(
  readFileSync(resolve(__dirname, "../../contracts/deployments/arc-testnet.json"), "utf8"),
);

const arc = defineChain({
  id: DEPLOYMENT.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  // Circle's official endpoint by default (the deployment file may name an older alias).
  rpcUrls: { default: { http: [process.env.RPC ?? "https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "ArcScan", url: DEPLOYMENT.explorer },
  },
});

const registryAbi = [
  {
    type: "function",
    name: "getFeed",
    stateMutability: "view",
    inputs: [{ name: "feedId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "description", type: "string" },
          { name: "methodologyHash", type: "bytes32" },
          { name: "minBond", type: "uint256" },
          { name: "disputeWindow", type: "uint256" },
          { name: "resolver", type: "address" },
          { name: "createdAt", type: "uint256" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getAgent",
    stateMutability: "view",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agent", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "agentMethodologyHash", type: "bytes32" },
          { name: "bond", type: "uint256" },
          { name: "lockedBond", type: "uint256" },
          { name: "registeredAt", type: "uint256" },
          { name: "lastAttestationAt", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "slashed", type: "bool" },
        ],
      },
    ],
  },
] as const;

const attestationAbi = [
  {
    type: "function",
    name: "historyLength",
    stateMutability: "view",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agent", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "historyAt",
    stateMutability: "view",
    inputs: [
      { name: "feedId", type: "bytes32" },
      { name: "agent", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "attestationId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "feedId", type: "bytes32" },
          { name: "agent", type: "address" },
          { name: "value", type: "int256" },
          { name: "timestamp", type: "uint256" },
          { name: "inputHash", type: "bytes32" },
          { name: "methodologyHash", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "finalizedAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const marketsAbi = [
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "feedId", type: "bytes32" },
          { name: "agent", type: "address" },
          { name: "threshold", type: "int256" },
          { name: "comparator", type: "uint8" },
          { name: "expiry", type: "uint256" },
          { name: "creator", type: "address" },
          { name: "yesReserve", type: "uint256" },
          { name: "noReserve", type: "uint256" },
          { name: "phase", type: "uint8" },
          { name: "yesWon", type: "bool" },
          { name: "createdAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const perennialMarketAbi = [
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "feedId", type: "bytes32" },
          { name: "agent", type: "address" },
          { name: "threshold", type: "int256" },
          { name: "comparator", type: "uint8" },
          { name: "expiry", type: "uint256" },
          { name: "creator", type: "address" },
          { name: "builderId", type: "uint256" },
          { name: "yesReserve", type: "uint256" },
          { name: "noReserve", type: "uint256" },
          { name: "phase", type: "uint8" },
          { name: "yesWon", type: "bool" },
          { name: "createdAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const progressAddedEvent = {
  type: "event",
  name: "ProgressAdded",
  inputs: [
    { name: "epoch", type: "uint256", indexed: true },
    { name: "builder", type: "address", indexed: true },
    { name: "weight", type: "uint256", indexed: false },
  ],
} as const;

const marketCreatedEvent = {
  type: "event",
  name: "MarketCreated",
  inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "builderId", type: "uint256", indexed: true },
    { name: "creator", type: "address", indexed: true },
    { name: "feedId", type: "bytes32", indexed: false },
    { name: "agent", type: "address", indexed: false },
    { name: "threshold", type: "int256", indexed: false },
    { name: "comparator", type: "uint8", indexed: false },
    { name: "expiry", type: "uint256", indexed: false },
  ],
} as const;

const perennialBoughtEvent = {
  type: "event",
  name: "Bought",
  inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "buyer", type: "address", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "collateralIn", type: "uint256", indexed: false },
    { name: "sharesOut", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
  ],
} as const;

const perennialSoldEvent = {
  type: "event",
  name: "Sold",
  inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "seller", type: "address", indexed: true },
    { name: "outcome", type: "uint8", indexed: false },
    { name: "sharesIn", type: "uint256", indexed: false },
    { name: "collateralOut", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
  ],
} as const;

const perennialVoidedEvent = {
  type: "event",
  name: "MarketVoided",
  inputs: [{ name: "marketId", type: "bytes32", indexed: true }],
} as const;

const perennialResolvedEvent = {
  type: "event",
  name: "Resolved",
  inputs: [
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "yesWon", type: "bool", indexed: false },
    { name: "value", type: "int256", indexed: false },
  ],
} as const;

async function main(): Promise<void> {
  /**
   * The public Arc testnet endpoint rate-limits ("Request exceeds defined
   * limit") well before this script finishes its reads, so the transport needs
   * real backoff rather than viem's default 3 fast retries. Set RPC= to a
   * dedicated endpoint to make this moot.
   */
  const client = createPublicClient({
    chain: arc,
    transport: http(undefined, { retryCount: 8, retryDelay: 1_200, batch: false }),
  });
  const pace = (ms = 120) => new Promise((r) => setTimeout(r, ms));

  const agent = DEPLOYMENT.agent as Address;
  const feedDefs = DEPLOYMENT.feeds as Array<{
    id: string;
    symbol: string;
    name: string;
    description: string;
    unit: string;
    decimals: number;
    displayDivisor: number;
    methodologyHashPlaceholder: string;
    methodologyDoc: string;
  }>;

  console.log(`reading ${feedDefs.length} feed(s) + agents + attestations…`);
  const feeds: Array<{
    id: Hex;
    symbol: string;
    name: string;
    description: string;
    unit: string;
    decimals: number;
    displayDivisor: number;
    methodologyHash: Hex;
    methodologyDoc: string;
    minBond: string;
    disputeWindow: number;
    resolver: Address;
    createdAt: number;
    agent: {
      address: Address;
      bond: string;
      lockedBond: string;
      registeredAt: number;
      lastAttestationAt: number;
      active: boolean;
      slashed: boolean;
    };
    attestations: Array<{
      id: Hex;
      value: number;
      timestamp: number;
      finalizedAt: number;
      inputHash: Hex;
      status: number;
    }>;
  }> = [];

  for (const def of feedDefs) {
    const feedId = def.id as Hex;
    const feedOnChain = (await client.readContract({
      address: DEPLOYMENT.contracts.Registry as Address,
      abi: registryAbi,
      functionName: "getFeed",
      args: [feedId],
    })) as {
      methodologyHash: Hex;
      minBond: bigint;
      disputeWindow: bigint;
      resolver: Address;
      createdAt: bigint;
    };
    const agentInfo = (await client.readContract({
      address: DEPLOYMENT.contracts.Registry as Address,
      abi: registryAbi,
      functionName: "getAgent",
      args: [feedId, agent],
    })) as {
      bond: bigint;
      lockedBond: bigint;
      registeredAt: bigint;
      lastAttestationAt: bigint;
      active: boolean;
      slashed: boolean;
    };
    const historyLen = (await client.readContract({
      address: DEPLOYMENT.contracts.Attestation as Address,
      abi: attestationAbi,
      functionName: "historyLength",
      args: [feedId, agent],
    })) as bigint;

    const attestations = [];
    for (let i = 0n; i < historyLen; i++) {
      const id = (await client.readContract({
        address: DEPLOYMENT.contracts.Attestation as Address,
        abi: attestationAbi,
        functionName: "historyAt",
        args: [feedId, agent, i],
      })) as Hex;
      const att = (await client.readContract({
        address: DEPLOYMENT.contracts.Attestation as Address,
        abi: attestationAbi,
        functionName: "getAttestation",
        args: [id],
      })) as {
        value: bigint;
        timestamp: bigint;
        inputHash: Hex;
        status: number;
        finalizedAt: bigint;
      };
      attestations.push({
        id,
        value: Number(att.value),
        timestamp: Number(att.timestamp),
        finalizedAt: Number(att.finalizedAt),
        inputHash: att.inputHash,
        status: att.status,
      });
    }

    feeds.push({
      id: feedId,
      symbol: def.symbol,
      name: def.name,
      description: def.description,
      unit: def.unit,
      decimals: def.decimals,
      displayDivisor: def.displayDivisor,
      methodologyHash: feedOnChain.methodologyHash,
      methodologyDoc: def.methodologyDoc,
      minBond: feedOnChain.minBond.toString(),
      disputeWindow: Number(feedOnChain.disputeWindow),
      resolver: feedOnChain.resolver,
      createdAt: Number(feedOnChain.createdAt),
      agent: {
        address: agent,
        bond: agentInfo.bond.toString(),
        lockedBond: agentInfo.lockedBond.toString(),
        registeredAt: Number(agentInfo.registeredAt),
        lastAttestationAt: Number(agentInfo.lastAttestationAt),
        active: agentInfo.active,
        slashed: agentInfo.slashed,
      },
      attestations,
    });
    console.log(`  · ${def.symbol}: ${attestations.length} attestation(s)`);
  }

  // Default feed (for backwards compat with components reading `live.feed`).
  const defaultFeed = feeds[0]!;

  console.log("reading markets + trade events + fee events…");
  const boughtEvent = {
    type: "event",
    name: "Bought",
    inputs: [
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "collateralIn", type: "uint256", indexed: false },
      { name: "sharesOut", type: "uint256", indexed: false },
    ],
  } as const;
  const feesEvent = {
    type: "event",
    name: "FeesPaid",
    inputs: [
      { name: "marketId", type: "bytes32", indexed: true },
      { name: "grossCollateral", type: "uint256", indexed: false },
      { name: "creatorFee", type: "uint256", indexed: false },
      { name: "agentFee", type: "uint256", indexed: false },
      { name: "treasuryFee", type: "uint256", indexed: false },
    ],
  } as const;

  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock > 100_000n ? latestBlock - 100_000n : 0n;

  /**
   * Arc's RPC rejects wide `eth_getLogs` windows with
   * `-32012 requested range too large`, so the 100k-block lookback has to be
   * walked in chunks rather than asked for in one call. 5k is comfortably
   * inside the limit; the chunks run sequentially because firing 20 parallel
   * requests at a public endpoint is how you get rate-limited instead.
   */
  const CHUNK = 5_000n;
  /**
   * Walk the lookback window for one event on one contract. Every log scan in
   * this script goes through here so the Arc chunking and pacing live in one
   * place. `event` is deliberately loose: viem infers `args` from a literal
   * event ABI, and that inference does not survive being passed as a
   * parameter, so each caller re-asserts the shape it expects.
   */
  type ScannedLog = Awaited<ReturnType<typeof client.getLogs>>[number] & { args: unknown };
  async function getLogsFor(
    address: Address,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
    since: bigint = fromBlock,
    /** Indexed-argument filter, e.g. `{ creator }`. */
    args?: Record<string, unknown>,
  ): Promise<ScannedLog[]> {
    const out: ScannedLog[] = [];
    for (let start = since; start <= latestBlock; start += CHUNK) {
      const end = start + CHUNK - 1n > latestBlock ? latestBlock : start + CHUNK - 1n;
      const logs = await client.getLogs({ address, event, args, fromBlock: start, toBlock: end });
      out.push(...(logs as ScannedLog[]));
      await pace();
    }
    return out;
  }

  const getLogsChunked = <E extends typeof boughtEvent | typeof feesEvent>(event: E) =>
    getLogsFor(DEPLOYMENT.contracts.Markets as Address, event);

  const allTrades = await getLogsChunked(boughtEvent);
  const allFees = await getLogsChunked(feesEvent);

  // Get block timestamps (one-shot per unique block to avoid hammering RPC).
  const uniqueBlocks = Array.from(new Set(allTrades.map((t) => t.blockNumber!)));
  const blockTs = new Map<bigint, number>();
  for (const bn of uniqueBlocks) {
    const block = await client.getBlock({ blockNumber: bn });
    blockTs.set(bn, Number(block.timestamp));
  }

  const markets = [];
  for (const m of DEPLOYMENT.markets as Array<{ id: string }>) {
    const data = (await client.readContract({
      address: DEPLOYMENT.contracts.Markets as Address,
      abi: marketsAbi,
      functionName: "getMarket",
      args: [m.id as Hex],
    })) as {
      feedId: Hex;
      agent: Address;
      threshold: bigint;
      comparator: number;
      expiry: bigint;
      creator: Address;
      yesReserve: bigint;
      noReserve: bigint;
      phase: number;
      yesWon: boolean;
      createdAt: bigint;
    };

    // Reconstruct per-trade price by simulating the AMM forward from initial state.
    const trades = allTrades
      .filter((t) => (t.args as { marketId: Hex }).marketId === m.id)
      .sort((a, b) => Number(a.blockNumber! - b.blockNumber!));

    // Initial reserves = total deposited / 2 from creation. The current reserves
    // post-all-trades equals data.yesReserve/data.noReserve. Reverse-walk to find
    // the initial liquidity: each buy added `collateralIn` to total minted complete
    // sets. So initial liquidity = (yesReserve + noReserve + sum of sharesOut*2 -
    // sum of collateralIn*2) / 2. Simpler: walk forward from a reconstructed start.
    const totalCollateralIn = trades.reduce(
      (s, t) => s + (t.args as { collateralIn: bigint }).collateralIn,
      0n,
    );
    const totalSharesOut = trades.reduce(
      (s, t) => s + (t.args as { sharesOut: bigint }).sharesOut,
      0n,
    );
    // y_now + n_now + sharesOut = y_initial + n_initial + 2 * collateralIn
    // y_initial == n_initial == L
    const twoL =
      data.yesReserve + data.noReserve + totalSharesOut - 2n * totalCollateralIn;
    const L = twoL / 2n;

    let yes = L;
    let no = L;
    const history: Array<{
      ts: number;
      yesPrice: number;
      side: "yes" | "no";
      collateral: number;
    }> = [];
    for (const t of trades) {
      const args = t.args as {
        outcome: number;
        collateralIn: bigint;
        sharesOut: bigint;
      };
      const isYes = args.outcome === 0;
      yes = yes + args.collateralIn;
      no = no + args.collateralIn;
      if (isYes) yes = yes - args.sharesOut;
      else no = no - args.sharesOut;
      const total = Number(yes + no);
      const yesPrice = total > 0 ? Number(no) / total : 0.5;
      history.push({
        ts: blockTs.get(t.blockNumber!) ?? 0,
        yesPrice,
        side: isYes ? "yes" : "no",
        collateral: Number(args.collateralIn) / 1e6,
      });
    }

    // Per-market fee totals — sum every FeesPaid event for this market.
    const fees = allFees.filter((f) => (f.args as { marketId: Hex }).marketId === m.id);
    let creatorFee = 0n;
    let agentFee = 0n;
    let treasuryFee = 0n;
    let volume = 0n;
    for (const f of fees) {
      const a = f.args as {
        grossCollateral: bigint;
        creatorFee: bigint;
        agentFee: bigint;
        treasuryFee: bigint;
      };
      creatorFee += a.creatorFee;
      agentFee += a.agentFee;
      treasuryFee += a.treasuryFee;
      volume += a.grossCollateral;
    }

    markets.push({
      id: m.id,
      feedId: data.feedId,
      agent: data.agent,
      threshold: Number(data.threshold),
      comparator: data.comparator,
      expiry: Number(data.expiry),
      creator: data.creator,
      yesReserve: data.yesReserve.toString(),
      noReserve: data.noReserve.toString(),
      phase: data.phase,
      yesWon: data.yesWon,
      createdAt: Number(data.createdAt),
      history,
      fees: {
        creator: creatorFee.toString(),
        agent: agentFee.toString(),
        treasury: treasuryFee.toString(),
        grossVolume: volume.toString(),
      },
    });
  }

  // ── builder atlas aggregates ─────────────────────────────────────────────
  // Lifetime progress MUST be summed from ProgressAdded events. The on-chain
  // progressWeight[epoch][builder] is consumed at closeEpoch, so reading the
  // current epoch reports 0 for a builder who has already been paid — which is
  // exactly what the live site shows for builder #1 today.
  const builderRegistryAddr = (DEPLOYMENT.contracts as { BuilderRegistry?: string }).BuilderRegistry as
    | Address
    | undefined;
  const perennialAddr = (DEPLOYMENT.contracts as { MarketsPerennial?: string }).MarketsPerennial as
    | Address
    | undefined;
  const poolAddr = (DEPLOYMENT.contracts as { ProgressPool?: string }).ProgressPool as Address | undefined;

  let atlasCursor: {
    lastScannedBlock: string;
    progressByBuilder: Record<string, number>;
    volumeByBuilderId: Record<string, string>;
    marketToBuilder: Record<string, number>;
    /** Resumable trader P&L fold — see seasons.ts. */
    pnl?: PnlState;
    /** seasonId -> builder address -> progress earned inside that season. */
    progressBySeason?: Record<string, Record<string, number>>;
    /** seasonId -> resolved first block. Immutable once past, so cached. */
    seasonStartBlocks?: Record<string, string>;
    seasonsVersion?: number;
    chainId?: number;
    markets?: string;
  } | null = null;

  let seasons: Season[] = [];
  let seasonBoards: Record<
    string,
    { traders: Array<[string, string]>; builders: Array<[string, number]> }
  > = {};

  const perennialMarkets: Array<{
    marketId: string;
    builderId: number;
    expiry: number;
    phase: "trading" | "resolved" | "voided";
    yesWon: boolean;
    yesReserve: string;
    noReserve: string;
    feedId: string;
    agent: string;
    threshold: string;
    comparator: number;
    creator: string;
  }> = [];

  // Every builder on chain (ids 1..nextId-1) with its verified-builder status
  // (docs/superpowers/specs/2026-09-24-verified-builders-design.md): source from
  // the `registrai:` profile link, proof fetched + validated, caretaker checked.
  // milestoneFeedId comes from the operator's Registry.FeedCreated events
  // (`registrai-milestone:<source>`, or the legacy `<owner/repo>-ships-release`);
  // keeper/builders.json is consulted only for legacy (non-`registrai:`) entries.
  let perennialBuilders: PerennialBuilderSnapshot[] = [];
  /** Resumable FeedCreated scan (operator-created feeds only). */
  type BuilderFeedsCursor = {
    chainId: number;
    registry: string;
    operator: string;
    lastScannedBlock: string;
    /** description -> feedId, latest wins. */
    feeds: Record<string, string>;
  };
  let builderFeedsCursor: BuilderFeedsCursor | null = null;
  let legacyKeeperBuilders: LegacyKeeperBuilder[] = [];
  // The Verified Builder Badge: contracts.VerifiedBuilderBadge, or the
  // perennial.verifiedBuilderBadge record the badge deploy writes. Absent = no
  // badge reads, and live-data carries no `badges` entry (render-badges.py then
  // renders nothing).
  const badgeAddr = ((DEPLOYMENT.contracts as { VerifiedBuilderBadge?: string }).VerifiedBuilderBadge ??
    (DEPLOYMENT.perennial as { verifiedBuilderBadge?: { address?: string } } | undefined)?.verifiedBuilderBadge?.address) as
    | Address
    | undefined;
  const badgeNetwork = badgeNetworkKey(DEPLOYMENT.chainId);
  /** live-data.json `badges`: { <network>: { address, maxSerial } } — scripts/render-badges.py. */
  const badges: Record<string, { address: string; maxSerial: number }> = {};
  /** What the market sync read of the testnet registry — the gallery reuses it
   *  when the builders network is that same registry. */
  let testnetRecords: BuilderRecord[] | null = null;
  let testnetBadges: ReadonlyMap<number, BadgeInfo> = new Map();
  try {
    legacyKeeperBuilders = JSON.parse(readFileSync(resolve(__dirname, "../../keeper/builders.json"), "utf8"));
  } catch {
    // no keeper checkout next to the frontend — legacy builders get no fallback
  }

  const builderAgg: Array<{
    builderId: number;
    address: string;
    lifetimeProgress: number;
    volume: string;
    /** claim.country of a verified builder. */
    country: string | null;
  }> = [];

  if (builderRegistryAddr && perennialAddr && poolAddr) {
    // Arc testnet runs ~0.555s blocks (155,712/day), so `latestBlock - 100_000`
    // is a sliding ~15h window — it cannot see a stack deployed two days ago.
    // Anchor to the recorded deployment block instead.
    // Incremental scan. A full sweep is 150+ chunks per event and grows by ~31
    // chunks/event/day at Arc's block rate, so the totals and the last scanned
    // block are carried in live-data.json and each run only covers new blocks.
    // marketToBuilder must be carried too: a trade in a new block can reference
    // a market created long before the cursor.
    type AtlasCursor = {
      lastScannedBlock: string;
      progressByBuilder: Record<string, number>;
      volumeByBuilderId: Record<string, string>;
      marketToBuilder: Record<string, number>;
      /** Which chain and contract this cursor describes. */
      chainId?: number;
      markets?: string;
      pnl?: PnlState;
      progressBySeason?: Record<string, Record<string, number>>;
      seasonStartBlocks?: Record<string, string>;
      seasonsVersion?: number;
    };
    let cursor: AtlasCursor | undefined;
    try {
      const prev = JSON.parse(readFileSync(resolve(__dirname, "../src/lib/live-data.json"), "utf8"));
      if (prev?.atlas?.lastScannedBlock) cursor = prev.atlas as AtlasCursor;
    } catch {
      // No previous sync, or unreadable — fall through to a full scan.
    }
    // A cursor is a block number plus folded state, and both are meaningless on
    // another chain or against another contract. Without this check, pointing the
    // deployment at mainnet (or redeploying on testnet) would resume the old
    // contract's P&L against the new one's events. A cursor with no stamp is
    // rescanned rather than trusted: "state exists" is not "state is right".
    if (
      cursor &&
      (cursor.chainId !== DEPLOYMENT.chainId || cursor.markets?.toLowerCase() !== perennialAddr.toLowerCase())
    ) {
      console.log(
        `  cursor belongs to chain ${cursor.chainId ?? "?"} / ${cursor.markets ?? "unstamped"}; ` +
          `rescanning for chain ${DEPLOYMENT.chainId} / ${perennialAddr}`,
      );
      cursor = undefined;
    }

    const deployBlock = BigInt(
      (DEPLOYMENT.perennial as { deployBlock?: number } | undefined)?.deployBlock ?? 0,
    );
    const anchor = deployBlock > 0n ? deployBlock : fromBlock;
    const scanFrom = cursor ? BigInt(cursor.lastScannedBlock) + 1n : anchor;
    const spanBlocks = latestBlock - scanFrom;
    console.log(
      `reading builder atlas aggregates… (from block ${scanFrom}, ${spanBlocks} blocks, ` +
        `${Math.ceil(Number(spanBlocks) / 5000)} chunks/event)`,
    );

    const progressLogs = await getLogsFor(poolAddr, progressAddedEvent, scanFrom);
    const progressByBuilder = new Map<string, number>(
      Object.entries(cursor?.progressByBuilder ?? {}),
    );
    for (const l of progressLogs) {
      const a = (l as unknown as { args: { builder: Address; weight: bigint } }).args;
      const k = a.builder.toLowerCase();
      progressByBuilder.set(k, (progressByBuilder.get(k) ?? 0) + Number(a.weight));
    }

    // Bought/Sold carry only marketId, so build marketId -> builderId from
    // MarketCreated first, then attribute each trade's notional to a builder.
    const created = await getLogsFor(perennialAddr, marketCreatedEvent, scanFrom);
    const marketToBuilder = new Map<string, number>(
      Object.entries(cursor?.marketToBuilder ?? {}),
    );
    for (const l of created) {
      const a = (l as unknown as { args: { marketId: `0x${string}`; builderId: bigint } }).args;
      marketToBuilder.set(a.marketId.toLowerCase(), Number(a.builderId));
    }

    const trades = await getLogsFor(perennialAddr, perennialBoughtEvent, scanFrom);
    const volumeByBuilderId = new Map<number, bigint>(
      Object.entries(cursor?.volumeByBuilderId ?? {}).map(([k, v]) => [Number(k), BigInt(v)]),
    );
    for (const l of trades) {
      const a = (l as unknown as { args: { marketId: `0x${string}`; collateralIn: bigint } }).args;
      const bid = marketToBuilder.get(a.marketId.toLowerCase());
      if (bid === undefined) continue;
      volumeByBuilderId.set(bid, (volumeByBuilderId.get(bid) ?? 0n) + a.collateralIn);
    }

    // ── verified builders ────────────────────────────────────────────────
    const operator = perennialTestnet.operator as Address;
    const caretakerAddr = (DEPLOYMENT.contracts as { CaretakerRegistry?: string }).CaretakerRegistry as Address | undefined;
    console.log("reading builders + proofs…");
    const records = await readBuilderRecords(client as unknown as RegistryReader, {
      builderRegistry: builderRegistryAddr,
      caretakerRegistry: caretakerAddr ?? null,
      operator,
      chainId: DEPLOYMENT.chainId,
      proofConfig: proofConfigFromEnv(process.env),
      fetchJson: makeFetchJson({ timeoutMs: 15_000 }),
      pace: async () => { await pace(); },
    });
    testnetRecords = records;
    for (const r of records) {
      console.log(`  · #${r.builderId} ${r.status}${r.source ? ` ${r.source}` : ""}${r.proofError ? ` (${r.proofError})` : ""}`);
    }

    // Milestone feeds live on the oracle Registry the markets settle against:
    // MarketsPerennial.ATTESTATION() -> Attestation.REGISTRY().
    const addrView = (address: Address, sig: "ATTESTATION" | "REGISTRY") =>
      client.readContract({
        address,
        abi: [{ type: "function", name: sig, stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
        functionName: sig,
      }) as Promise<Address>;
    const oracleRegistry = await addrView(await addrView(perennialAddr, "ATTESTATION"), "REGISTRY");
    let feedsCursor: BuilderFeedsCursor | undefined;
    try {
      const prev = JSON.parse(readFileSync(resolve(__dirname, "../src/lib/live-data.json"), "utf8"));
      const c = prev?.builderFeeds as BuilderFeedsCursor | undefined;
      if (
        c?.lastScannedBlock &&
        c.chainId === DEPLOYMENT.chainId &&
        c.registry?.toLowerCase() === oracleRegistry.toLowerCase() &&
        c.operator?.toLowerCase() === operator.toLowerCase()
      ) {
        feedsCursor = c;
      }
    } catch {
      // no previous snapshot — scan from the anchor
    }
    const feedLogs = await getLogsFor(
      oracleRegistry,
      feedCreatedEvent,
      feedsCursor ? BigInt(feedsCursor.lastScannedBlock) + 1n : anchor,
      { creator: operator },
    );
    const feeds = {
      ...(feedsCursor?.feeds ?? {}),
      ...operatorFeeds(
        feedLogs.map((l) => {
          const a = l.args as { feedId: string; creator: string; description: string };
          return { feedId: a.feedId, creator: a.creator, description: a.description };
        }),
        operator,
      ),
    };
    builderFeedsCursor = {
      chainId: DEPLOYMENT.chainId,
      registry: oracleRegistry,
      operator,
      lastScannedBlock: latestBlock.toString(),
      feeds,
    };
    perennialBuilders = perennialBuilderSnapshot(records, feeds, legacyKeeperBuilders);

    // serialOf for every builder; lapsed + issuedAt for each issued serial.
    if (badgeAddr && badgeNetwork) {
      console.log(`reading verified builder badges (${badgeAddr})…`);
      const r = await readBuilderBadges(client as unknown as BadgeReader, {
        badge: badgeAddr,
        builderIds: perennialBuilders.map((b) => b.builderId),
        imageBase: badgeImageBase(badgeNetwork),
        pace: async () => { await pace(); },
      });
      perennialBuilders = attachBadges(perennialBuilders, r.badges);
      testnetBadges = r.badges;
      badges[badgeNetwork] = { address: badgeAddr, maxSerial: r.maxSerial };
      console.log(`  ${r.badges.size} badge(s) held, highest serial ${r.maxSerial}`);
    }

    // Only verified builders reach the atlas and the season boards; country is
    // the one in their signed claim.
    for (const b of perennialBuilders) {
      if (b.status !== "verified") continue;
      builderAgg.push({
        builderId: b.builderId,
        address: b.owner,
        lifetimeProgress: progressByBuilder.get(b.owner) ?? 0,
        // bigint is not JSON-serialisable; the consumer parses with BigInt().
        volume: (volumeByBuilderId.get(b.builderId) ?? 0n).toString(),
        country: b.country,
      });
    }
    /* ── seasons ──────────────────────────────────────────────────────────
       A season is a block range, so every board below is a windowed replay of
       events already fetched above. No contract knows seasons exist. */

    // Anchor the calendar to the block the stack went live, not to "now" — the
    // season a past trade belongs to must never move because we synced again.
    const anchorBlock = await client.getBlock({ blockNumber: anchor });
    await pace();
    const windows = seasonWindows(Number(anchorBlock.timestamp), Math.floor(Date.now() / 1000));

    /** First block at or after `target`, by binary search on block timestamps. */
    async function blockAtTime(targetTs: number): Promise<bigint> {
      let lo = anchor;
      let hi = latestBlock;
      while (lo < hi) {
        const mid = lo + (hi - lo) / 2n;
        const b = await client.getBlock({ blockNumber: mid });
        await pace();
        if (Number(b.timestamp) < targetTs) lo = mid + 1n;
        else hi = mid;
      }
      return lo;
    }

    // ~20 RPC calls per boundary, once ever: a past boundary cannot move, so it
    // is cached in the cursor and never searched again.
    const startBlocks = new Map<number, bigint>(
      Object.entries(cursor?.seasonStartBlocks ?? {}).map(([k, v]) => [Number(k), BigInt(v)]),
    );
    for (const w of windows) {
      if (startBlocks.has(w.id)) continue;
      startBlocks.set(w.id, w.id === 1 ? anchor : await blockAtTime(w.startedAt));
    }

    seasons = windows.map((w, i) => {
      const next = windows[i + 1];
      const start = startBlocks.get(w.id)!;
      const end = next ? startBlocks.get(next.id)! - 1n : null;
      return {
        id: w.id,
        label: w.label,
        startBlock: Number(start),
        endBlock: end === null ? null : Number(end),
        startedAt: w.startedAt,
        endsAt: w.endsAt,
      };
    });

    // Seasons were added after this deployment had already been syncing, so the
    // fold's own history is missing from the cursor. Without a one-time backfill
    // from the anchor the boards would silently start from whenever seasons
    // shipped, and every trade before that would vanish from the record.
    const needsBackfill = cursor?.seasonsVersion !== SEASONS_CURSOR_VERSION;
    const seasonFrom = needsBackfill ? anchor : scanFrom;
    if (needsBackfill) {
      console.log(
        `  backfilling season history from block ${anchor} ` +
          `(${Math.ceil(Number(latestBlock - anchor) / 5000)} chunks/event, one time)`,
      );
    }
    const seasonProgressLogs = needsBackfill
      ? await getLogsFor(poolAddr, progressAddedEvent, anchor)
      : progressLogs;
    const boughtForPnl = needsBackfill
      ? await getLogsFor(perennialAddr, perennialBoughtEvent, anchor)
      : trades;

    // A backfill REPLACES the season state; it does not extend it. Seeding the
    // fold with the cursor and then replaying all of history on top counts every
    // event twice — which is exactly what happened: builder progress read 34
    // instead of 17, and the trader board carried a stale figure plus the
    // recomputed one. Accumulators must start empty whenever the scan does.
    const priorProgress = needsBackfill ? {} : (cursor?.progressBySeason ?? {});
    const priorPnl = needsBackfill ? EMPTY_PNL : (cursor?.pnl ?? EMPTY_PNL);

    // Per-season builder progress, from the same ProgressAdded logs.
    const progressBySeason = new Map<number, Map<string, number>>(
      Object.entries(priorProgress).map(([sid, m]) => [Number(sid), new Map(Object.entries(m))]),
    );
    for (const l of seasonProgressLogs) {
      const a = (l as unknown as { args: { builder: Address; weight: bigint } }).args;
      const blk = Number(l.blockNumber ?? 0n);
      const season = seasons.find((x) => blk >= x.startBlock && (x.endBlock === null || blk <= x.endBlock));
      if (!season) continue;
      let board = progressBySeason.get(season.id);
      if (!board) progressBySeason.set(season.id, (board = new Map()));
      const k = a.builder.toLowerCase();
      board.set(k, (board.get(k) ?? 0) + Number(a.weight));
    }

    // Trader ledger. Bought is already in hand from the volume pass; Sold and
    // Resolved are the two events that actually realise a gain or a loss.
    const sold = await getLogsFor(perennialAddr, perennialSoldEvent, seasonFrom);
    const resolved = await getLogsFor(perennialAddr, perennialResolvedEvent, seasonFrom);
    // Voids realise every position at half a unit a share (SettlementPolicy).
    const voided = await getLogsFor(perennialAddr, perennialVoidedEvent, seasonFrom);

    const seq = (l: { logIndex?: number | null }) => Number(l.logIndex ?? 0);
    const tradeEvents: Trade[] = [
      ...boughtForPnl.map((l) => {
        const a = (l as unknown as {
          args: { marketId: `0x${string}`; buyer: Address; outcome: number; collateralIn: bigint; sharesOut: bigint };
        }).args;
        return {
          kind: "buy" as const,
          block: Number(l.blockNumber ?? 0n),
          seq: seq(l),
          trader: a.buyer.toLowerCase(),
          marketId: a.marketId.toLowerCase(),
          outcome: Number(a.outcome),
          collateral: a.collateralIn,
          shares: a.sharesOut,
        };
      }),
      ...sold.map((l) => {
        const a = (l as unknown as {
          args: { marketId: `0x${string}`; seller: Address; outcome: number; sharesIn: bigint; collateralOut: bigint };
        }).args;
        return {
          kind: "sell" as const,
          block: Number(l.blockNumber ?? 0n),
          seq: seq(l),
          trader: a.seller.toLowerCase(),
          marketId: a.marketId.toLowerCase(),
          outcome: Number(a.outcome),
          collateral: a.collateralOut,
          shares: a.sharesIn,
        };
      }),
      ...resolved.map((l) => {
        const a = (l as unknown as { args: { marketId: `0x${string}`; yesWon: boolean } }).args;
        return {
          kind: "resolve" as const,
          block: Number(l.blockNumber ?? 0n),
          seq: seq(l),
          marketId: a.marketId.toLowerCase(),
          yesWon: a.yesWon,
        };
      }),
      ...voided.map((l) => ({
        kind: "void" as const,
        block: Number(l.blockNumber ?? 0n),
        seq: seq(l),
        marketId: ((l as unknown as { args: { marketId: `0x${string}` } }).args.marketId).toLowerCase(),
      })),
    ];

    const pnl = foldTrades(priorPnl, tradeEvents, seasons);
    const verified = verifiedOwners(perennialBuilders);
    seasonBoards = Object.fromEntries(
      seasons.map((x) => [
        String(x.id),
        {
          traders: Object.entries(pnl.realised[String(x.id)] ?? {}) as Array<[string, string]>,
          // The fold keeps every builder (a builder verified later keeps its
          // history); the board shows verified builders only.
          builders: [...(progressBySeason.get(x.id) ?? new Map<string, number>())].filter(([addr]) =>
            verified.has(addr),
          ) as Array<[string, number]>,
        },
      ]),
    );

    atlasCursor = {
      lastScannedBlock: latestBlock.toString(),
      progressByBuilder: Object.fromEntries(progressByBuilder),
      volumeByBuilderId: Object.fromEntries(
        Array.from(volumeByBuilderId, ([k, v]) => [String(k), v.toString()]),
      ),
      marketToBuilder: Object.fromEntries(marketToBuilder),
      pnl,
      progressBySeason: Object.fromEntries(
        [...progressBySeason].map(([sid, m]) => [String(sid), Object.fromEntries(m)]),
      ),
      seasonStartBlocks: Object.fromEntries(
        [...startBlocks].map(([sid, b]) => [String(sid), b.toString()]),
      ),
      seasonsVersion: SEASONS_CURSOR_VERSION,
      chainId: DEPLOYMENT.chainId,
      markets: perennialAddr,
    };
    // Market ids come from the cached map, so this loop is bounded by market
    // count and never by block range — no log scan, no Arc range ceiling.
    for (const [marketId, builderId] of marketToBuilder) {
      const m = (await client.readContract({
        address: perennialAddr,
        abi: perennialMarketAbi,
        functionName: "getMarket",
        args: [marketId as `0x${string}`],
      })) as {
        expiry: bigint;
        yesReserve: bigint;
        noReserve: bigint;
        phase: number;
        yesWon: boolean;
        feedId: string;
        agent: string;
        threshold: bigint;
        comparator: number;
        creator: string;
      };
      perennialMarkets.push({
        marketId,
        builderId,
        expiry: Number(m.expiry),
        // Phase enum: Trading, Resolved, Voided. "Not trading" is not "resolved".
        phase: m.phase === 0 ? "trading" : m.phase === 2 ? "voided" : "resolved",
        yesWon: m.yesWon,
        yesReserve: m.yesReserve.toString(),
        noReserve: m.noReserve.toString(),
        feedId: m.feedId,
        agent: m.agent,
        threshold: m.threshold.toString(),
        comparator: Number(m.comparator),
        creator: m.creator,
      });
      await pace();
    }

    console.log(
      `  ${builderAgg.length} verified builder(s) of ${perennialBuilders.length}, ${perennialMarkets.length} market(s), ` +
        `cursor at block ${latestBlock}`,
    );
  }

  // ── agent reputation ─────────────────────────────────────────────────────
  // A resumable fold over MarketsPerennial + MarketsV4 + Dispute logs (see
  // scripts/reputation.ts). Its cursor carries its own REPUTATION_CURSOR_VERSION
  // and a chain + contract stamp; syncReputation rescans from the anchor when
  // either no longer matches, exactly like the atlas cursor above.
  let reputation: ReputationSnapshot | null = null;
  let prevReputation: ReputationSnapshot | null = null;
  try {
    const prev = JSON.parse(readFileSync(resolve(__dirname, "../src/lib/live-data.json"), "utf8"));
    if (prev?.reputation?.cursor) prevReputation = prev.reputation as ReputationSnapshot;
  } catch {
    // no previous snapshot — full scan from the anchor
  }
  const marketsV4Addr = (DEPLOYMENT.contracts as { MarketsV4?: string }).MarketsV4 as Address | undefined;
  if (perennialAddr || marketsV4Addr) {
    const view = (address: Address, sig: "ATTESTATION" | "dispute") =>
      client.readContract({
        address,
        abi: [{ type: "function", name: sig, stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
        functionName: sig,
      }) as Promise<Address>;
    // The markets name their own Attestation; Attestation names its Dispute.
    // The deployment file's top-level Registry/Attestation/Dispute are the v1
    // stack, which the nanopay markets do not use.
    const c = DEPLOYMENT.contracts as Record<string, string | undefined>;
    let attestationAddr: Address | undefined;
    let disputeAddr: Address | undefined;
    try {
      attestationAddr = await view((perennialAddr ?? marketsV4Addr)!, "ATTESTATION");
      if (perennialAddr && marketsV4Addr) {
        const other = await view(marketsV4Addr, "ATTESTATION");
        if (other.toLowerCase() !== attestationAddr.toLowerCase()) {
          console.warn(`  MarketsV4 uses Attestation ${other}, Perennial ${attestationAddr}; indexing rulings on Perennial's stack only`);
        }
      }
      disputeAddr = await view(attestationAddr, "dispute");
    } catch (e) {
      console.warn(`  could not read ATTESTATION()/dispute() (${(e as Error).message.split("\n")[0]}); falling back to config`);
      attestationAddr ??= (c.Attestation_v2 ?? c.Attestation) as Address;
      disputeAddr ??= (c.Dispute_v2 ?? c.Dispute) as Address;
    }
    const deployBlock = (DEPLOYMENT.perennial as { deployBlock?: number } | undefined)?.deployBlock ?? 0;
    const repAnchor = deployBlock > 0 ? BigInt(deployBlock) : fromBlock;
    console.log(`reading agent reputation (cursor v${REPUTATION_CURSOR_VERSION})…`);
    try {
      const r = await syncReputation({
        rpc: arc.rpcUrls.default.http[0],
        contracts: {
          MarketsPerennial: perennialAddr ?? null,
          MarketsV4: marketsV4Addr ?? null,
          Attestation: attestationAddr!,
          Dispute: disputeAddr!,
        },
        prior: prevReputation?.cursor ?? null,
        fromBlock: repAnchor.toString(),
        toBlock: latestBlock.toString(),
        paceMs: 120,
        log: (m) => console.log(`  ${m}`),
      });
      reputation = { agents: r.reputation.agents, cursor: r.cursor };
      console.log(`  ${Object.keys(r.reputation.agents).length} agent(s) with a record, cursor at block ${r.cursor.lastScannedBlock}`);
    } catch (e) {
      // Keep the last good snapshot rather than blanking the leaderboard; its
      // cursor still says exactly how far it reaches.
      console.warn(`  reputation sync failed, keeping the previous snapshot: ${(e as Error).message.split("\n")[0]}`);
      reputation = prevReputation;
    }
  }

  // ── builders gallery (/builders) ────────────────────────────────────────
  // Read on the BUILDERS network (builders-network.ts): Arc mainnet as soon as
  // its phase-1 BuilderRegistry is recorded, else testnet. Registries + badge
  // only: phase-1 mainnet has no market, pool or oracle, and nothing here needs
  // one. A failed read keeps the previous gallery for the same registry.
  const syncedAt = new Date().toISOString();
  let gallery: GallerySnapshot | null = null;
  let prevGallery: GallerySnapshot | null = null;
  try {
    const prev = JSON.parse(readFileSync(resolve(__dirname, "../src/lib/live-data.json"), "utf8"));
    prevGallery = parseGallerySnapshot(prev?.gallery, { chainId: BUILDERS.chainId, builderRegistry: BUILDERS.contracts.BuilderRegistry });
  } catch {
    // no previous snapshot
  }
  const plan = gallerySyncPlan(BUILDERS, testnetRecords ? { chainId: DEPLOYMENT.chainId, builderRegistry: builderRegistryAddr } : null);
  console.log(`builders gallery: ${BUILDERS.label} (${plan})…`);
  if (plan === "reuse") {
    gallery = buildGallerySnapshot({
      network: BUILDERS.network,
      chainId: BUILDERS.chainId,
      builderRegistry: BUILDERS.contracts.BuilderRegistry!,
      syncedAt,
      records: testnetRecords!,
      badges: testnetBadges,
    });
  } else if (plan === "read") {
    try {
      const bc = createPublicClient({
        chain: BUILDERS.chain.viemChain,
        // Circle's official endpoint for the chain; BUILDERS_RPC overrides for a run.
        transport: http(process.env.BUILDERS_RPC ?? BUILDERS.rpc, { retryCount: 8, retryDelay: 1_200, batch: false }),
      });
      const records = await readBuilderRecords(bc as unknown as RegistryReader, {
        builderRegistry: BUILDERS.contracts.BuilderRegistry!,
        caretakerRegistry: BUILDERS.contracts.CaretakerRegistry,
        operator: BUILDERS.operator,
        chainId: BUILDERS.chainId,
        proofConfig: proofConfigFromEnv(process.env),
        fetchJson: makeFetchJson({ timeoutMs: 15_000 }),
        pace: async () => { await pace(); },
      });
      for (const r of records) {
        console.log(`  · #${r.builderId} ${r.status}${r.source ? ` ${r.source}` : ""}${r.proofError ? ` (${r.proofError})` : ""}`);
      }
      let held: ReadonlyMap<number, BadgeInfo> = new Map();
      const badgeContract = BUILDERS.contracts.VerifiedBuilderBadge;
      if (badgeContract && BUILDERS.badgeNetwork) {
        const r = await readBuilderBadges(bc as unknown as BadgeReader, {
          badge: badgeContract,
          builderIds: records.map((x) => x.builderId),
          imageBase: badgeImageBase(BUILDERS.badgeNetwork),
          pace: async () => { await pace(); },
        });
        held = r.badges;
        badges[BUILDERS.badgeNetwork] = { address: badgeContract, maxSerial: r.maxSerial };
        console.log(`  ${r.badges.size} badge(s) held, highest serial ${r.maxSerial}`);
      }
      gallery = buildGallerySnapshot({
        network: BUILDERS.network,
        chainId: BUILDERS.chainId,
        builderRegistry: BUILDERS.contracts.BuilderRegistry!,
        syncedAt,
        records,
        badges: held,
      });
    } catch (e) {
      console.warn(`  gallery read failed, keeping the previous snapshot: ${(e as Error).message.split("\n")[0]}`);
      gallery = prevGallery;
      // render-badges.py still needs the network's badge contract.
      const badgeContract = BUILDERS.contracts.VerifiedBuilderBadge;
      if (badgeContract && BUILDERS.badgeNetwork && !badges[BUILDERS.badgeNetwork]) {
        const prevSerial = Math.max(0, ...(prevGallery?.builders ?? []).map((b) => b.badge?.serial ?? 0));
        badges[BUILDERS.badgeNetwork] = { address: badgeContract, maxSerial: prevSerial };
      }
    }
  }
  if (gallery) console.log(`  ${gallery.builders.length} builder(s) in the gallery snapshot`);

  const out = {
    syncedAt,
    builders: builderAgg,
    perennialBuilders,
    builderFeeds: builderFeedsCursor,
    perennialMarkets,
    atlas: atlasCursor,
    seasons,
    seasonBoards,
    reputation,
    badges,
    gallery,
    chainId: DEPLOYMENT.chainId,
    explorer: DEPLOYMENT.explorer,
    contracts: badgeAddr ? { ...DEPLOYMENT.contracts, VerifiedBuilderBadge: badgeAddr } : DEPLOYMENT.contracts,
    // Backwards-compat: the first feed exposes a flat `feed` / `agent` /
    // `attestations` shape for components that haven't migrated to the
    // multi-feed `feeds[]` array yet.
    feed: {
      id: defaultFeed.id,
      symbol: defaultFeed.symbol,
      description: defaultFeed.description,
      unit: defaultFeed.unit,
      methodologyHash: defaultFeed.methodologyHash,
      minBond: defaultFeed.minBond,
      disputeWindow: defaultFeed.disputeWindow,
      resolver: defaultFeed.resolver,
      createdAt: defaultFeed.createdAt,
    },
    agent: defaultFeed.agent,
    attestations: defaultFeed.attestations,
    // Multi-feed surface — every registered feed with its agent state and
    // full attestation history. Components targeting more than one feed
    // read from here.
    feeds,
    markets,
  };

  const target = resolve(__dirname, "../src/lib/live-data.json");
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`wrote ${target}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
