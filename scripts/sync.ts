/**
 * Sync onchain state from Arc testnet into `src/lib/live-data.json`.
 *
 * Run before `next build` so the static site bakes in current values.
 *   RPC=https://… npx tsx scripts/sync.ts
 *
 * The frontend reads live-data.json at build time; no client-side RPC.
 */
import { createPublicClient, http, defineChain, type Address, type Hex } from "viem";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEPLOYMENT = JSON.parse(
  readFileSync(resolve(__dirname, "../../contracts/deployments/arc-testnet.json"), "utf8"),
);

const arc = defineChain({
  id: DEPLOYMENT.chainId,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC ?? DEPLOYMENT.rpc] } },
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

const builderRegistryAbi = [
  { type: "function", name: "nextId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "isActiveBuilderId",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
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
  async function getLogsFor(
    address: Address,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
    since: bigint = fromBlock,
  ) {
    const out: Awaited<ReturnType<typeof client.getLogs>> = [];
    for (let start = since; start <= latestBlock; start += CHUNK) {
      const end = start + CHUNK - 1n > latestBlock ? latestBlock : start + CHUNK - 1n;
      const logs = await client.getLogs({ address, event, fromBlock: start, toBlock: end });
      out.push(...logs);
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
  } | null = null;

  const builderAgg: Array<{
    builderId: number;
    address: string;
    lifetimeProgress: number;
    volume: string;
    country: null;
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
    };
    let cursor: AtlasCursor | undefined;
    try {
      const prev = JSON.parse(readFileSync(resolve(__dirname, "../src/lib/live-data.json"), "utf8"));
      if (prev?.atlas?.lastScannedBlock) cursor = prev.atlas as AtlasCursor;
    } catch {
      // No previous sync, or unreadable — fall through to a full scan.
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

    const nextId = (await client.readContract({
      address: builderRegistryAddr,
      abi: builderRegistryAbi,
      functionName: "nextId",
      args: [],
    })) as bigint;

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

    for (let id = 1n; id < nextId; id++) {
      const active = (await client.readContract({
        address: builderRegistryAddr,
        abi: builderRegistryAbi,
        functionName: "isActiveBuilderId",
        args: [id],
      })) as boolean;
      if (!active) continue;
      const owner = (await client.readContract({
        address: builderRegistryAddr,
        abi: builderRegistryAbi,
        functionName: "ownerOf",
        args: [id],
      })) as Address;
      builderAgg.push({
        builderId: Number(id),
        address: owner.toLowerCase(),
        lifetimeProgress: progressByBuilder.get(owner.toLowerCase()) ?? 0,
        // bigint is not JSON-serialisable; the consumer parses with BigInt().
        volume: (volumeByBuilderId.get(Number(id)) ?? 0n).toString(),
        country: null,
      });
      await pace();
    }
    atlasCursor = {
      lastScannedBlock: latestBlock.toString(),
      progressByBuilder: Object.fromEntries(progressByBuilder),
      volumeByBuilderId: Object.fromEntries(
        Array.from(volumeByBuilderId, ([k, v]) => [String(k), v.toString()]),
      ),
      marketToBuilder: Object.fromEntries(marketToBuilder),
    };
    console.log(`  ${builderAgg.length} active builder(s), cursor at block ${latestBlock}`);
  }

  const out = {
    syncedAt: new Date().toISOString(),
    builders: builderAgg,
    atlas: atlasCursor,
    chainId: DEPLOYMENT.chainId,
    explorer: DEPLOYMENT.explorer,
    contracts: DEPLOYMENT.contracts,
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
