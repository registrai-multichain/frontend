/**
 * Season rewards, distribution rule v2 — a public, deterministic computation
 * from chain data (spec docs/superpowers/specs/2026-09-24-builder-income-tax-design.md,
 * "SeasonPool"). Anyone can re-run it to re-derive a published root. Reads the
 * chain only; never signs, never sends.
 *
 *   npx tsx scripts/season-rewards.ts --season N --total <USDC>
 *     (--from-block B --to-block B | --from-time UNIX --to-time UNIX)
 *     [--network testnet|mainnet|local] [--rpc URL] [--deadline UNIX | --deadline-days 90]
 *     [--out <dir>] [--markets 0x..] [--season-pool 0x..] [--builder-registry 0x..]
 *     [--caretaker-registry 0x..] [--badge 0x..] [--operator 0x..] [--chain-id N]
 *     [--builders-rpc URL] [--from-deploy-block B]
 *
 * The rule (src/lib/season-rewards.ts has the exact arithmetic):
 *   eligible  builders verified at --to-block: active, caretaker = the operator,
 *             at least one active project, and a Verified Builder Badge that is
 *             not lapsed (the keeper lapses it when no project proof holds);
 *   volume    per MarketsPerennial market on one of the builder's project
 *             milestone feeds (Registry FeedCreated by the operator, description
 *             `registrai-milestone:<source>`) that RESOLVED YES between the two
 *             blocks: the Bought.collateralIn of shares held ≥ 24 hours (or to
 *             settlement), matched FIFO per (trader, outcome) against Sold.sharesIn
 *             by block timestamp; sell volume never counts; the builder owner's,
 *             the creator's and the agent's trades are left out. A market needs
 *             ≥ $500 of it to qualify;
 *   points    one square root per builder: sqrt(USD) of its summed counted
 *             volume over all its qualifying markets;
 *   amounts   pro rata by points, ≤ 20% of --total per builder, the excess
 *             re-spread; floored to the 6-decimal unit. Dust is claimed by no one.
 *
 * Every read is pinned to --to-block (eligibility, projects, feeds, markets and
 * trades up to it), so the output depends only on the arguments and the chain.
 *
 * Writes <dir>/season-<N>.json (root, total, rows with points, amount, proof,
 * and the parameters) and <dir>/season-<N>.safe.json (a Safe Transaction
 * Builder batch: SeasonPool.publishSeason(N, root, total, deadline)); without
 * --out, both go to stdout. The human summary goes to stderr.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createPublicClient, defineChain, getAddress, http, isAddress, parseAbi, parseUnits, type Address, type PublicClient } from "viem";
import {
  allocate,
  buildSeasonTree,
  capFor,
  publishSeasonSafeJson,
  scoreMarkets,
  seasonFile,
  RULE_VERSION,
  MIN_MARKET_VOLUME,
  MIN_HOLD_SECS,
  type EligibleBuilder,
  type MarketFacts,
  type Trade,
} from "../src/lib/season-rewards";
import { verifiedBuilderAbi } from "../src/lib/verified-builders-chain";
import { badgeAbi } from "../src/lib/verified-builder-badge";
import { milestoneFeedFor, operatorFeeds } from "../src/lib/verified-builders";
import { formatUsd } from "../src/lib/builder-economy";

type Network = "testnet" | "mainnet" | "local";
const die = (msg: string): never => {
  console.error(`season-rewards: ${msg}`);
  process.exit(1);
};
const log = (msg = "") => console.error(msg);

const { values } = parseArgs({
  options: {
    season: { type: "string" },
    total: { type: "string" },
    "from-block": { type: "string" },
    "to-block": { type: "string" },
    "from-time": { type: "string" },
    "to-time": { type: "string" },
    network: { type: "string", default: "testnet" },
    rpc: { type: "string" },
    "builders-rpc": { type: "string" },
    "chain-id": { type: "string" },
    deadline: { type: "string" },
    "deadline-days": { type: "string", default: "90" },
    out: { type: "string" },
    markets: { type: "string" },
    "season-pool": { type: "string" },
    "builder-registry": { type: "string" },
    "caretaker-registry": { type: "string" },
    badge: { type: "string" },
    operator: { type: "string" },
    "from-deploy-block": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.error(readFileSync(__filename, "utf8").split("*/")[0].replace(/^\/\*\*?/, "").replace(/^ \* ?/gm, ""));
  process.exit(0);
}

const network = values.network as Network;
if (!["testnet", "mainnet", "local"].includes(network)) die(`--network must be testnet, mainnet or local (got ${network})`);

const readJson = (p: string) => JSON.parse(readFileSync(resolve(__dirname, p), "utf8"));

interface Defaults {
  rpc: string;
  chainId: number;
  markets?: string | null;
  seasonPool?: string | null;
  builderRegistry?: string | null;
  caretakerRegistry?: string | null;
  badge?: string | null;
  operator?: string | null;
  deployBlock?: number | null;
}

/** Per network; every value can be overridden on the command line. */
function defaults(n: Network): Defaults {
  if (n === "local") return { rpc: "http://127.0.0.1:8545", chainId: 31337 };
  if (n === "mainnet") {
    const d = readJson("../src/lib/deployments/arc-mainnet.json");
    const b = d.builders ?? {};
    return {
      rpc: "https://rpc.mainnet.arc.io",
      chainId: 5042,
      markets: d.contracts?.MarketsPerennial,
      seasonPool: d.contracts?.SeasonPool,
      builderRegistry: d.contracts?.BuilderRegistry ?? b.BuilderRegistry,
      caretakerRegistry: d.contracts?.CaretakerRegistry ?? b.CaretakerRegistry,
      badge: d.contracts?.VerifiedBuilderBadge ?? b.VerifiedBuilderBadge,
      operator: d.operator ?? b.operator,
      deployBlock: d.deployBlock ?? b.deployBlock,
    };
  }
  const extras = readJson("../src/lib/deployments/arc-testnet-perennial.json");
  const deploymentPath = resolve(__dirname, "../../contracts/deployments/arc-testnet.json");
  const dep = existsSync(deploymentPath) ? JSON.parse(readFileSync(deploymentPath, "utf8")) : null;
  const c = dep?.contracts ?? readJson("../src/lib/live-data.json").contracts;
  return {
    rpc: "https://rpc.testnet.arc.io",
    chainId: 5042002,
    markets: c?.MarketsPerennial,
    seasonPool: c?.SeasonPool ?? dep?.perennial?.seasonPool?.address ?? extras.seasonPool,
    builderRegistry: c?.BuilderRegistry,
    caretakerRegistry: c?.CaretakerRegistry,
    badge: c?.VerifiedBuilderBadge ?? extras.verifiedBuilderBadge,
    operator: extras.operator,
    deployBlock: extras.deployBlock,
  };
}

function addressArg(name: string, v: string | null | undefined): Address {
  if (!v) return die(`no ${name} for --network ${network}; pass --${name} 0x…`);
  if (!isAddress(v, { strict: false })) return die(`--${name} is not an address: ${v}`);
  return getAddress(v);
}

function uintArg(name: string, v: string | undefined): bigint {
  if (v === undefined || !/^\d+$/.test(v.trim())) return die(`--${name} must be a whole number (got ${v ?? "nothing"})`);
  return BigInt(v.trim());
}

const marketsAbi = parseAbi([
  "function ATTESTATION() view returns (address)",
  "function FUND() view returns (address)",
  "event MarketCreated(bytes32 indexed marketId, uint256 indexed builderId, address indexed creator, bytes32 feedId, address agent, int256 threshold, uint8 comparator, uint256 expiry)",
  "event Bought(bytes32 indexed marketId, address indexed buyer, uint8 outcome, uint256 collateralIn, uint256 sharesOut, uint256 fee)",
  "event Sold(bytes32 indexed marketId, address indexed seller, uint8 outcome, uint256 sharesIn, uint256 collateralOut, uint256 fee)",
  "event Resolved(bytes32 indexed marketId, bool yesWon, int256 value)",
]);
const oracleAbi = parseAbi([
  "function REGISTRY() view returns (address)",
  "event FeedCreated(bytes32 indexed feedId, address indexed creator, string description, bytes32 methodologyHash, uint256 minBond, uint256 disputeWindow, address resolver)",
]);
const fundAbi = parseAbi(["function SEASON_POOL() view returns (address)"]);
const poolAbi = parseAbi([
  "function seasons(uint256) view returns (bytes32 root, uint256 total, uint256 claimedAmount, uint64 deadline, bool reclaimed)",
  "function unallocated() view returns (uint256)",
  "function BUILDERS() view returns (address)",
]);

/** getLogs in ≤5,000-block chunks (Arc's cap), sequentially, with retries from the transport. */
async function logsIn(client: PublicClient, params: Record<string, unknown>, from: bigint, to: bigint) {
  const out: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  for (let a = from; a <= to; a += 5_000n) {
    const b = a + 4_999n > to ? to : a + 4_999n;
    out.push(...(await client.getLogs({ ...params, fromBlock: a, toBlock: b } as never)));
  }
  return out as unknown as { args: Record<string, unknown>; blockNumber: bigint; logIndex: number }[];
}

/** Block timestamps, fetched once per block, 20 at a time. */
async function blockTimes(client: PublicClient, blocks: readonly bigint[]): Promise<Map<bigint, bigint>> {
  const out = new Map<bigint, bigint>();
  const todo = [...new Set(blocks)];
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    const got = await Promise.all(batch.map((blockNumber) => client.getBlock({ blockNumber })));
    batch.forEach((bn, j) => out.set(bn, got[j].timestamp));
  }
  return out;
}

/** First block with timestamp >= t (binary search). */
async function blockAtOrAfter(client: PublicClient, t: bigint, lo: bigint, hi: bigint): Promise<bigint> {
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if ((await client.getBlock({ blockNumber: mid })).timestamp < t) lo = mid + 1n;
    else hi = mid;
  }
  return lo;
}

async function main() {
  const d = defaults(network);
  const seasonId = uintArg("season", values.season);
  if (!values.total) die("--total <USDC> is required (e.g. --total 12500.50)");
  let total: bigint;
  try {
    total = parseUnits(values.total!.trim(), 6);
  } catch {
    return die(`--total is not a USDC amount: ${values.total}`);
  }
  if (total <= 0n) die("--total must be above zero");

  const rpc = values.rpc ?? d.rpc;
  const chainId = values["chain-id"] ? Number(values["chain-id"]) : d.chainId;
  const chain = defineChain({ id: chainId, name: `chain ${chainId}`, nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const client = createPublicClient({ chain, transport: http(rpc, { retryCount: 6, retryDelay: 800 }) }) as PublicClient;
  const live = await client.getChainId();
  if (live !== chainId) die(`RPC ${rpc} is chain ${live}, expected ${chainId}`);
  // Phase 2 reuses the phase-1 registries on the same chain; --builders-rpc only
  // for a split setup (it must be the same chain: every read is pinned to --to-block).
  const bclient = values["builders-rpc"]
    ? (createPublicClient({ chain, transport: http(values["builders-rpc"], { retryCount: 6, retryDelay: 800 }) }) as PublicClient)
    : client;
  if (values["builders-rpc"] && (await bclient.getChainId()) !== chainId) die("--builders-rpc must serve the same chain as --rpc");

  const markets = addressArg("markets", values.markets ?? d.markets);
  const builderRegistry = addressArg("builder-registry", values["builder-registry"] ?? d.builderRegistry);
  const caretakerRegistry = addressArg("caretaker-registry", values["caretaker-registry"] ?? d.caretakerRegistry);
  const badge = addressArg("badge", values.badge ?? d.badge);
  const operator = addressArg("operator", values.operator ?? d.operator);

  // ── the window ──
  const head = await client.getBlockNumber();
  let fromBlock: bigint;
  let toBlock: bigint;
  if (values["from-block"] !== undefined || values["to-block"] !== undefined) {
    fromBlock = uintArg("from-block", values["from-block"]);
    toBlock = uintArg("to-block", values["to-block"]);
  } else if (values["from-time"] !== undefined || values["to-time"] !== undefined) {
    const ft = uintArg("from-time", values["from-time"]);
    const tt = uintArg("to-time", values["to-time"]);
    fromBlock = await blockAtOrAfter(client, ft, 0n, head);
    toBlock = (await blockAtOrAfter(client, tt, fromBlock, head + 1n)) - 1n; // last block before --to-time
  } else {
    return die("pass --from-block/--to-block or --from-time/--to-time");
  }
  if (toBlock < fromBlock) die(`--to-block ${toBlock} is before --from-block ${fromBlock}`);
  if (toBlock > head) die(`--to-block ${toBlock} is past the chain head ${head}: the season has not ended`);
  const toTime = (await client.getBlock({ blockNumber: toBlock })).timestamp;
  const deadline = values.deadline !== undefined ? uintArg("deadline", values.deadline) : toTime + uintArg("deadline-days", values["deadline-days"]) * 86_400n;
  if (deadline <= toTime) die("--deadline must be after the season's last block");
  const at = { blockNumber: toBlock };
  const scanFrom = values["from-deploy-block"] !== undefined ? uintArg("from-deploy-block", values["from-deploy-block"]) : BigInt(d.deployBlock ?? 0);

  // ── the season pool: FUND().SEASON_POOL() unless given ──
  let seasonPool: Address;
  if (values["season-pool"] ?? d.seasonPool) {
    seasonPool = addressArg("season-pool", values["season-pool"] ?? d.seasonPool);
  } else {
    const fund = (await client.readContract({ address: markets, abi: marketsAbi, functionName: "FUND" }).catch(() => die(`MarketsPerennial ${markets} has no FUND(): it predates the BuilderFund; pass --season-pool`))) as Address;
    seasonPool = (await client.readContract({ address: fund, abi: fundAbi, functionName: "SEASON_POOL" })) as Address;
  }
  const poolBuilders = (await client.readContract({ address: seasonPool, abi: poolAbi, functionName: "BUILDERS" })) as Address;
  if (poolBuilders.toLowerCase() !== builderRegistry.toLowerCase()) die(`SeasonPool ${seasonPool} pays BuilderRegistry ${poolBuilders}, not ${builderRegistry}`);

  log(`season ${seasonId} · rule ${RULE_VERSION} · chain ${chainId} · rpc ${rpc}`);
  log(`blocks ${fromBlock}..${toBlock} (ends ${new Date(Number(toTime) * 1000).toISOString()}) · total ${formatUsd(total, 6)} · deadline ${new Date(Number(deadline) * 1000).toISOString()}`);
  log(`MarketsPerennial ${markets} · SeasonPool ${seasonPool}`);
  log(`BuilderRegistry ${builderRegistry} · CaretakerRegistry ${caretakerRegistry} · badge ${badge} · operator ${operator}`);
  log();

  // ── eligible builders at --to-block ──
  const br = <T,>(address: Address, abi: readonly unknown[], functionName: string, args?: readonly unknown[]) =>
    bclient.readContract({ address, abi, functionName, args, ...at } as never) as Promise<T>;
  const caretakerAbi = parseAbi(["function caretakerOf(uint256) view returns (address)"]);
  const nextId = await br<bigint>(builderRegistry, verifiedBuilderAbi, "nextId");
  const candidates: { builderId: number; owner: Address; sources: string[] }[] = [];
  const skipped: string[] = [];
  for (let id = 1n; id < nextId; id++) {
    const [owner, , , , active] = await br<readonly [Address, string, string, bigint, boolean]>(builderRegistry, verifiedBuilderAbi, "builders", [id]);
    if (!active) { skipped.push(`#${id} inactive`); continue; }
    const caretaker = await br<Address>(caretakerRegistry, caretakerAbi, "caretakerOf", [id]);
    if (caretaker.toLowerCase() !== operator.toLowerCase()) { skipped.push(`#${id} not onboarded (caretaker ${caretaker})`); continue; }
    const serial = await br<bigint>(badge, badgeAbi, "serialOf", [id]);
    if (serial === 0n) { skipped.push(`#${id} no badge`); continue; }
    if (await br<boolean>(badge, badgeAbi, "isLapsed", [serial])) { skipped.push(`#${id} badge lapsed`); continue; }
    const pids = await br<readonly bigint[]>(builderRegistry, verifiedBuilderAbi, "projectsOf", [id]);
    const sources: string[] = [];
    for (const pid of pids) {
      const [, source, pActive] = await br<readonly [bigint, string, boolean, bigint]>(builderRegistry, verifiedBuilderAbi, "projects", [pid]);
      if (pActive) sources.push(source);
    }
    if (sources.length === 0) { skipped.push(`#${id} no active project`); continue; }
    candidates.push({ builderId: Number(id), owner, sources });
  }

  // ── the operator's milestone feeds (Registry of the markets' Attestation) ──
  const attestation = (await client.readContract({ address: markets, abi: marketsAbi, functionName: "ATTESTATION" })) as Address;
  const registry = (await client.readContract({ address: attestation, abi: oracleAbi, functionName: "REGISTRY" })) as Address;
  const feedLogs = await logsIn(client, { address: registry, event: oracleAbi[1], args: { creator: operator } }, scanFrom, toBlock);
  const feeds = operatorFeeds(feedLogs.map((l) => ({ feedId: String(l.args.feedId), creator: String(l.args.creator), description: String(l.args.description) })), operator);
  const eligible: EligibleBuilder[] = candidates.map((c) => ({
    builderId: c.builderId,
    owner: c.owner.toLowerCase(),
    feeds: c.sources.map((s) => milestoneFeedFor(feeds, s)).filter((f): f is string => Boolean(f)),
  }));

  // ── markets, resolutions in the window, trades ──
  const created = await logsIn(client, { address: markets, event: marketsAbi[2] }, scanFrom, toBlock);
  const resolved = await logsIn(client, { address: markets, event: marketsAbi[5] }, fromBlock, toBlock);
  const yes = new Set(resolved.filter((l) => l.args.yesWon === true).map((l) => String(l.args.marketId).toLowerCase()));
  const facts: MarketFacts[] = created.map((l) => ({
    marketId: String(l.args.marketId).toLowerCase(),
    builderId: Number(l.args.builderId),
    feedId: String(l.args.feedId).toLowerCase(),
    creator: String(l.args.creator).toLowerCase(),
    agent: String(l.args.agent).toLowerCase(),
    resolvedYesInSeason: yes.has(String(l.args.marketId).toLowerCase()),
  }));
  const wanted = facts.filter((f) => f.resolvedYesInSeason).map((f) => f.marketId as `0x${string}`);
  const tradesByMarket = new Map<string, Trade[]>();
  if (wanted.length) {
    const bought = await logsIn(client, { address: markets, event: marketsAbi[3], args: { marketId: wanted } }, scanFrom, toBlock);
    const sold = await logsIn(client, { address: markets, event: marketsAbi[4], args: { marketId: wanted } }, scanFrom, toBlock);
    const times = await blockTimes(client, [...bought, ...sold].map((l) => l.blockNumber));
    type Log = (typeof bought)[number];
    const push = (l: Log, kind: Trade["kind"], trader: unknown, shares: unknown, collateral: bigint) => {
      const k = String(l.args.marketId).toLowerCase();
      if (!tradesByMarket.has(k)) tradesByMarket.set(k, []);
      tradesByMarket.get(k)!.push({
        marketId: k,
        trader: String(trader).toLowerCase(),
        kind,
        outcome: Number(l.args.outcome),
        shares: shares as bigint,
        collateral,
        timestamp: times.get(l.blockNumber)!,
        blockNumber: l.blockNumber,
        logIndex: l.logIndex,
      });
    };
    for (const l of bought) push(l, "buy", l.args.buyer, l.args.sharesOut, l.args.collateralIn as bigint);
    for (const l of sold) push(l, "sell", l.args.seller, l.args.sharesIn, (l.args.collateralOut as bigint) + (l.args.fee as bigint));
  }

  // ── points, allocation, tree ──
  const scored = scoreMarkets(eligible, facts, tradesByMarket);
  const allocations = allocate(scored.points, total);
  const allocated = allocations.reduce((s, a) => s + a.amount, 0n);
  if (allocated === 0n) die("no eligible builder earned points this season: nothing to publish");
  const tree = buildSeasonTree(seasonId, allocations);

  const existing = (await client.readContract({ address: seasonPool, abi: poolAbi, functionName: "seasons", args: [seasonId] })) as readonly [string, bigint, bigint, bigint, boolean];
  const unallocated = (await client.readContract({ address: seasonPool, abi: poolAbi, functionName: "unallocated" })) as bigint;

  const params = {
    rule: RULE_VERSION,
    network,
    chainId,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    toBlockTime: toTime.toString(),
    fromTime: values["from-time"] ?? null,
    toTime: values["to-time"] ?? null,
    scanFromBlock: scanFrom.toString(),
    minMarketVolume: MIN_MARKET_VOLUME.toString(),
    minHoldSecs: MIN_HOLD_SECS.toString(),
    capBps: 2000,
    contracts: { MarketsPerennial: markets, SeasonPool: seasonPool, BuilderRegistry: builderRegistry, CaretakerRegistry: caretakerRegistry, VerifiedBuilderBadge: badge, Registry: registry },
    operator,
  };
  const file = seasonFile({ seasonId, total, deadline, chainId, params, eligible, scored: scored.markets, allocations, tree });
  const safe = publishSeasonSafeJson({ chainId, seasonPool, seasonId, root: tree.root, total, deadline, createdAt: Number(toTime) * 1000 });

  // ── summary (stderr) ──
  log(`eligible builders: ${eligible.length}${skipped.length ? ` (skipped: ${skipped.join("; ")})` : ""}`);
  for (const e of eligible) log(`  #${e.builderId} ${e.owner} · ${e.feeds.length} milestone feed(s)`);
  log(`markets resolved YES in the window: ${yes.size}; qualifying (≥ ${formatUsd(MIN_MARKET_VOLUME)} counted volume held ≥ ${MIN_HOLD_SECS / 3_600n}h, own feeds): ${scored.markets.length}`);
  for (const m of scored.markets) log(`  ${m.marketId.slice(0, 10)}… builder #${m.builderId} · counted volume ${formatUsd(m.volume)}`);
  for (const [id, v] of scored.volumes) log(`  builder #${id} · total ${formatUsd(v)} · ${(Number(scored.points.get(id) ?? 0n) / 1e6).toFixed(6)} pts`);
  log();
  log(`allocation (cap ${formatUsd(capFor(total))} per builder):`);
  for (const a of allocations) log(`  #${a.builderId} ${(Number(a.points) / 1e6).toFixed(6)} pts → ${formatUsd(a.amount, 6)}${a.capped ? " (capped)" : ""}`);
  log(`allocated ${formatUsd(allocated, 6)} of ${formatUsd(total, 6)}; unassigned ${formatUsd(total - allocated, 6)} (reclaimable after the deadline)`);
  log(`root ${tree.root}`);
  if (existing[3] !== 0n) log(`WARNING: season ${seasonId} is already published on chain (root ${existing[0]}); publishSeason would revert (SeasonExists).`);
  if (total > unallocated) log(`WARNING: --total ${formatUsd(total, 6)} exceeds the pool's unallocated ${formatUsd(unallocated, 6)}; publishSeason would revert (InsufficientUnallocated).`);
  if (deadline <= BigInt(Math.floor(Date.now() / 1000))) log("WARNING: the deadline is already in the past; publishSeason would revert (BadDeadline). Pass --deadline.");

  const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";
  if (values.out) {
    const dir = resolve(process.cwd(), values.out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `season-${seasonId}.json`), json(file));
    writeFileSync(resolve(dir, `season-${seasonId}.safe.json`), json(safe));
    log(`wrote ${resolve(dir, `season-${seasonId}.json`)} and season-${seasonId}.safe.json`);
  } else {
    process.stdout.write(`// season-${seasonId}.json\n${json(file)}// season-${seasonId}.safe.json\n${json(safe)}`);
  }
}

main().catch((e) => die(e instanceof Error ? e.message.split("\n").slice(0, 4).join(" | ") : String(e)));
