import { describe, expect, test } from "vitest";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  LOG_CHUNK_BLOCKS,
  RECENT_ROUNDS,
  ROUNDS,
  candleCloseAt,
  claimList,
  roundsStatusLine,
  clockUtc,
  eventVisible,
  evidenceNote,
  feedKeyFromDescription,
  feedKind,
  formatChange,
  formatPrice,
  formatScaled,
  groupRounds,
  impliedPct,
  latestMarketFor,
  logChunks,
  mergeFeedLogs,
  nextBoundary,
  parseCoinbaseTicker,
  parseMarketLogs,
  roundLabel,
  roundStart,
  roundWindow,
  roundStatus,
  roundTradeDeadline,
  scanLogs,
  scanStart,
  seedFeedBook,
  strikeDelta,
  timeLeft,
  toScaled,
  yesWins,
  type FeedCreatedLog,
  type MarketCreatedLog,
  type RoundMarket,
  assetBySlug,
  assetHref,
  assetSlug,
  eventHref,
  extendCover,
  isMarketId,
  isProposalKey,
  nextBackfill,
  parseProposalInfo,
  proposalEventMeta,
  proposalIdOfKey,
  proposedMarketHref,
  proposedMarkets,
  sumTransfers,
  parseProposalStore,
  serializeProposalStore,
  pruneProposalStore,
  foldProposalRange,
  feedLogFromRecord,
  marketsOnUnknownFeeds,
  proposalAnswer,
  proposalRetryMs,
  type ApprovalTerms,
  type ProposalInfo,
} from "./rounds";
import { COMPARATOR, PHASE } from "./perennial-market";

const AGENT = "0x31CCE575eC134bFD57c46997A295Ab14Ab887BB4" as Address;
const OTHER = "0x000000000000000000000000000000000000dEaD" as Address;
const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const FEED_BTC = hex(0xb7c);
const FEED_ETH = hex(0xe7);
const FEED_EVT = hex(0xa4c);

const feedLog = (feedId: Hex, description: string, block: bigint, creator: Address = AGENT, window = 600n, logIndex = 0): FeedCreatedLog => ({
  args: { feedId, creator, description, disputeWindow: window },
  blockNumber: block,
  logIndex,
});

const marketLog = (
  id: number,
  feedId: Hex,
  expiry: number,
  opts: { agent?: Address; creator?: Address; threshold?: bigint; comparator?: number; block?: bigint } = {},
): MarketCreatedLog => ({
  args: {
    marketId: hex(id),
    creator: opts.creator ?? AGENT,
    feedId,
    agent: opts.agent ?? AGENT,
    threshold: opts.threshold ?? 8_396_735n,
    comparator: opts.comparator ?? COMPARATOR.GreaterThan,
    expiry: BigInt(expiry),
    liquidity: 5_000_000n,
  },
  blockNumber: opts.block ?? BigInt(id),
  logIndex: 0,
});

const book = mergeFeedLogs(
  { byKey: {}, byId: {} },
  [
    feedLog(FEED_BTC, "registrai-data:btc-usd", 10n),
    feedLog(FEED_ETH, "registrai-data:eth-usd", 11n),
    feedLog(FEED_EVT, "registrai-data:arc-token-tradable", 12n, AGENT, 43_200n),
  ],
  AGENT,
);

describe("deployment", () => {
  test("carries the addresses, agent, assets and events", () => {
    expect(ROUNDS.chainId).toBe(5042002);
    expect(ROUNDS.contracts.MarketsV4).toBe("0xddf0814e6C95E1A0585c16dbb012c611ae23A220");
    expect(ROUNDS.deployBlock).toBe(64184905n);
    expect(ROUNDS.agent).toBe(AGENT);
    expect(ROUNDS.assets.map((a) => a.symbol)).toEqual(["BTC", "ETH", "SOL", "ZEC", "HYPE"]);
    expect(ROUNDS.assets.map((a) => a.decimals)).toEqual([2, 2, 3, 2, 3]);
    expect(ROUNDS.events.find((e) => !e.rehearsal)?.expiry).toBe(1798758000);
    expect(ROUNDS.events.filter((e) => e.rehearsal)).toHaveLength(1);
  });

  test("every asset and event has a seeded feed", () => {
    const seeded = seedFeedBook(ROUNDS.feeds);
    for (const k of [...ROUNDS.assets.map((a) => a.key), ...ROUNDS.events.map((e) => e.key)]) {
      expect(seeded.byKey[k]?.feedId).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(seeded.byKey["btc-usd"].blockNumber).toBe(-1n);
  });
});

describe("feed discovery (FeedCreated logs)", () => {
  test("description -> key", () => {
    expect(feedKeyFromDescription("registrai-data:btc-usd")).toBe("btc-usd");
    expect(feedKeyFromDescription("registrai-data:arc-token-tradable-test")).toBe("arc-token-tradable-test");
    expect(feedKeyFromDescription("builder milestones #4")).toBeNull();
    expect(feedKeyFromDescription("registrai-data:")).toBeNull();
    expect(feedKeyFromDescription("registrai-data:Bad Key")).toBeNull();
    expect(feedKeyFromDescription(undefined)).toBeNull();
  });

  test("change feeds: description -> the agent's key; the book knows the asset", () => {
    expect(feedKeyFromDescription("registrai-data:btc-usd-5m-change-0")).toBe("btc-usd:5m-0");
    expect(feedKeyFromDescription("registrai-data:hype-usd-5m-change-12")).toBe("hype-usd:5m-12");
    expect(feedKind("btc-usd:5m-12")).toEqual({ asset: "btc-usd", change: true });
    expect(feedKind("btc-usd")).toEqual({ asset: "btc-usd", change: false });
    const FEED_CH = hex(0xc4a);
    const b = mergeFeedLogs(book, [feedLog(FEED_CH, "registrai-data:btc-usd-5m-change-7", 10n)], AGENT);
    expect(b.byId[FEED_CH]).toMatchObject({ key: "btc-usd:5m-7", asset: "btc-usd", change: true });
    const [m] = parseMarketLogs([marketLog(9, FEED_CH, 1_790_367_300, { threshold: 0n })], b, AGENT);
    expect(m).toMatchObject({ key: "btc-usd", change: true, threshold: 0n });
    // only the exact round shape shows (threshold 0, GreaterThan)
    expect(parseMarketLogs([marketLog(10, FEED_CH, 1_790_367_300, { threshold: 5n })], b, AGENT)).toEqual([]);
    expect(parseMarketLogs([marketLog(11, FEED_CH, 1_790_367_300, { threshold: 0n, comparator: COMPARATOR.GreaterOrEqual })], b, AGENT)).toEqual([]);
  });

  test("maps the agent's feeds by key and id, with their challenge windows", () => {
    expect(book.byKey["btc-usd"].feedId).toBe(FEED_BTC);
    expect(book.byKey["arc-token-tradable"].disputeWindow).toBe(43_200);
    expect(book.byId[FEED_ETH].key).toBe("eth-usd");
  });

  test("ignores feeds created by anyone else and foreign descriptions", () => {
    const b = mergeFeedLogs(
      { byKey: {}, byId: {} },
      [feedLog(hex(1), "registrai-data:btc-usd", 5n, OTHER), feedLog(hex(2), "my own feed", 6n)],
      AGENT,
    );
    expect(b.byKey).toEqual({});
    expect(b.byId).toEqual({});
  });

  test("a replacement feed (after a slash) takes the key; the retired one stays by id", () => {
    const replaced = hex(0xb7d);
    const b = mergeFeedLogs(book, [feedLog(replaced, "registrai-data:btc-usd", 99n)], AGENT);
    expect(b.byKey["btc-usd"].feedId).toBe(replaced);
    expect(b.byId[FEED_BTC].key).toBe("btc-usd");
    // Order of logs in the batch does not matter: the later block wins.
    const c = mergeFeedLogs({ byKey: {}, byId: {} }, [feedLog(replaced, "registrai-data:btc-usd", 99n), feedLog(FEED_BTC, "registrai-data:btc-usd", 10n)], AGENT);
    expect(c.byKey["btc-usd"].feedId).toBe(replaced);
  });

  test("a real log overrides the deploy seed; ids are lower-cased", () => {
    const seeded = seedFeedBook({ "btc-usd": { feedId: "0xABCD" as Hex, disputeWindow: 600 } });
    expect(seeded.byKey["btc-usd"].feedId).toBe("0xabcd");
    const upper = `0x${"AB".repeat(32)}` as Hex;
    const b = mergeFeedLogs(seeded, [feedLog(upper, "registrai-data:btc-usd", 1n, AGENT, 900n)], AGENT);
    expect(b.byKey["btc-usd"].feedId).toBe(upper.toLowerCase());
    expect(b.byKey["btc-usd"].disputeWindow).toBe(900);
  });

  test("does not mutate the input book", () => {
    const before = JSON.stringify(book, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    mergeFeedLogs(book, [feedLog(hex(7), "registrai-data:sol-usd", 50n)], AGENT);
    expect(JSON.stringify(book, (_, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(before);
  });
});

describe("market discovery (MarketCreated logs)", () => {
  test("keeps markets the agent opened on its feeds and settles itself", () => {
    const ms = parseMarketLogs(
      [
        marketLog(1, FEED_BTC, 1_790_367_000),
        marketLog(2, FEED_ETH, 1_790_367_000, { threshold: 268_990n }),
        marketLog(3, hex(0x999), 1_790_367_000), // unknown feed
        marketLog(4, FEED_BTC, 1_790_367_000, { agent: OTHER }), // someone else's agent
        marketLog(5, FEED_BTC, 1_790_367_000, { creator: OTHER, threshold: 1n }), // a look-alike naming our agent
      ],
      book,
      AGENT,
    );
    expect(ms.map((m) => m.key)).toEqual(["btc-usd", "eth-usd"]);
    expect(ms[0]).toMatchObject({ marketId: hex(1), feedId: FEED_BTC, threshold: 8_396_735n, comparator: 0, expiry: 1_790_367_000, liquidity: 5_000_000n, blockNumber: 1n });
    expect(ms[1].threshold).toBe(268_990n);
  });

  test("dedupes a market seen twice (overlapping scans) and skips malformed logs", () => {
    const dup = marketLog(5, FEED_BTC, 1_790_367_300);
    const broken: MarketCreatedLog = { args: { feedId: FEED_BTC }, blockNumber: 6n, logIndex: 0 };
    const ms = parseMarketLogs([dup, { ...dup }, broken], book, AGENT);
    expect(ms).toHaveLength(1);
  });

  test("event markets keep their comparator", () => {
    const [m] = parseMarketLogs([marketLog(9, FEED_EVT, 1_798_758_000, { threshold: 1n, comparator: COMPARATOR.GreaterOrEqual })], book, AGENT);
    expect(m.key).toBe("arc-token-tradable");
    expect(m.comparator).toBe(COMPARATOR.GreaterOrEqual);
  });

  test("latestMarketFor picks the newest market on a feed", () => {
    const ms = parseMarketLogs([marketLog(9, FEED_EVT, 1_798_758_000, { block: 100n }), marketLog(10, FEED_EVT, 1_798_758_000, { block: 200n })], book, AGENT);
    expect(latestMarketFor(ms, "arc-token-tradable")?.marketId).toBe(hex(10));
    expect(latestMarketFor(ms, "nope")).toBeUndefined();
  });
});

describe("log scanning", () => {
  test("scanStart: the last window of blocks, never before deploy", () => {
    expect(scanStart(100_000n, 10n, 15_000n)).toBe(85_001n);
    expect(scanStart(20_000n, 10_000n, 15_000n)).toBe(10_000n);
    expect(scanStart(100n, 0n, 15_000n)).toBe(0n);
  });

  test("chunks never exceed 5000 blocks and cover the range exactly", () => {
    const cs = logChunks(1n, 12_001n);
    expect(cs).toEqual([
      [1n, 5_000n],
      [5_001n, 10_000n],
      [10_001n, 12_001n],
    ]);
    for (const [a, b] of cs) expect(b - a + 1n <= LOG_CHUNK_BLOCKS).toBe(true);
    expect(logChunks(5n, 5n)).toEqual([[5n, 5n]]);
    expect(logChunks(6n, 5n)).toEqual([]);
    expect(() => logChunks(0n, 1n, 0n)).toThrow();
  });

  test("scanLogs collects every chunk in order", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const r = await scanLogs(async (a, b) => {
      calls.push([a, b]);
      return [Number(a)];
    }, 1n, 14_000n);
    expect(r.complete).toBe(true);
    expect(r.scannedTo).toBe(14_000n);
    expect(r.logs).toEqual([1, 5001, 10001]);
    for (const [a, b] of calls) expect(b - a + 1n <= 5_000n).toBe(true);
  });

  test("scanLogs stops at the first failure; the cursor covers only what succeeded", async () => {
    const r = await scanLogs(async (a) => {
      if (a === 10_001n) throw new Error("range too large");
      return [Number(a)];
    }, 1n, 20_000n);
    expect(r.complete).toBe(false);
    expect(r.scannedTo).toBe(10_000n);
    expect(r.logs).toEqual([1, 5001]);
  });

  test("scanLogs over an empty range is a no-op", async () => {
    const r = await scanLogs(async () => [1], 10n, 9n);
    expect(r).toEqual({ logs: [], scannedTo: 9n, complete: true });
  });
});

describe("grouping rounds per asset", () => {
  const B = 1_790_367_000; // a 5-minute boundary
  const mk = (id: number, key: string, expiry: number, block = BigInt(id)): RoundMarket => ({
    marketId: hex(id),
    feedId: key === "btc-usd" ? FEED_BTC : FEED_ETH,
    key,
    change: false,
    agent: AGENT,
    threshold: 1n,
    comparator: 0,
    expiry,
    liquidity: 0n,
    blockNumber: block,
  });

  test("current = the trading round with the soonest close; recent = closed, newest first", () => {
    const ms = Array.from({ length: 9 }, (_, i) => mk(i + 1, "btc-usd", B - 7 * 300 + (i + 1) * 300));
    // expiries: B-1800 … B+600
    const g = groupRounds(ms, ["btc-usd", "eth-usd"], B + 10);
    expect(g["btc-usd"].current?.expiry).toBe(B + 300);
    expect(g["btc-usd"].recent.map((m) => m.expiry)).toEqual([B, B - 300, B - 600, B - 900, B - 1200, B - 1500]);
    expect(g["btc-usd"].recent).toHaveLength(RECENT_ROUNDS);
    expect(g["eth-usd"]).toEqual({ recent: [] });
  });

  test("a market closing exactly now is recent, not current", () => {
    const g = groupRounds([mk(1, "btc-usd", B)], ["btc-usd"], B);
    expect(g["btc-usd"].current).toBeUndefined();
    expect(g["btc-usd"].recent).toHaveLength(1);
  });

  test("a known non-trading phase is never current", () => {
    const g = groupRounds([mk(1, "btc-usd", B + 300)], ["btc-usd"], B, { [hex(1)]: PHASE.Voided });
    expect(g["btc-usd"].current).toBeUndefined();
    const t = groupRounds([mk(1, "btc-usd", B + 300)], ["btc-usd"], B, { [hex(1)]: PHASE.Trading });
    expect(t["btc-usd"].current?.marketId).toBe(hex(1));
  });

  test("markets for unknown keys (events) are ignored; assets stay separate", () => {
    const g = groupRounds([mk(1, "btc-usd", B + 300), mk(2, "eth-usd", B + 300), mk(3, "arc-token-tradable", B + 300)], ["btc-usd", "eth-usd"], B);
    expect(g["btc-usd"].current?.marketId).toBe(hex(1));
    expect(g["eth-usd"].current?.marketId).toBe(hex(2));
    expect(Object.keys(g)).toEqual(["btc-usd", "eth-usd"]);
  });

  test("next-round markets: betting (current), in play, then recent by the round's end", () => {
    const ch = (id: number, expiry: number): RoundMarket => ({ ...mk(id, "btc-usd", expiry), change: true, threshold: 0n });
    // at B+10: [B+300, B+600] takes bets, [B, B+300] is in play, [B-300, B] ended
    const g = groupRounds([ch(1, B - 300), ch(2, B), ch(3, B + 300)], ["btc-usd"], B + 10);
    expect(g["btc-usd"].current?.marketId).toBe(hex(3));
    expect(g["btc-usd"].inPlay?.marketId).toBe(hex(2));
    expect(g["btc-usd"].recent.map((m) => m.marketId)).toEqual([hex(1)]);
    // a legacy price round closing at B ended at B: recent, never in play
    const l = groupRounds([mk(4, "btc-usd", B), ch(2, B)], ["btc-usd"], B + 10);
    expect(l["btc-usd"].inPlay?.marketId).toBe(hex(2));
    expect(l["btc-usd"].recent.map((m) => m.marketId)).toEqual([hex(4)]);
    expect(roundWindow(ch(2, B))).toEqual({ start: B, end: B + 300 });
    expect(roundWindow(mk(4, "btc-usd", B))).toEqual({ start: B - 300, end: B });
  });

  test("a custom recent count", () => {
    const ms = [mk(1, "btc-usd", B - 300), mk(2, "btc-usd", B)];
    expect(groupRounds(ms, ["btc-usd"], B + 1, {}, 1)["btc-usd"].recent.map((m) => m.marketId)).toEqual([hex(2)]);
  });
});

describe("round status", () => {
  const expiry = 1_790_367_300;
  const base = { phase: PHASE.Trading, yesWon: false, expiry, disputeWindow: 600, threshold: 8_396_735n, comparator: COMPARATOR.GreaterThan, settlementWindow: 3600 };
  const reading = (value: bigint, timestamp = expiry + 9, finalized = false) => ({ found: true, value, timestamp, finalized });

  test("live before the close", () => {
    const s = roundStatus({ ...base, now: expiry - 1 });
    expect(s.key).toBe("live");
  });

  test("next-round market: betting, then in play, then waiting for the change", () => {
    const ch = { ...base, threshold: 0n, change: true, roundSecs: 300 };
    expect(roundStatus({ ...ch, now: expiry - 1 })).toMatchObject({ key: "live", label: "Betting" });
    expect(roundStatus({ ...ch, now: expiry + 150 }).key).toBe("in-play");
    expect(roundStatus({ ...ch, now: expiry + 301 })).toMatchObject({ key: "awaiting-reading", label: "Ended" });
    const up = roundStatus({ ...ch, now: expiry + 310, reading: reading(1n, expiry + 305) });
    expect(up).toMatchObject({ key: "settling", provisional: "up", finalAt: expiry + 905 });
    expect(roundStatus({ ...ch, now: expiry + 310, reading: reading(0n, expiry + 305) }).provisional).toBe("down");
  });

  test("closed, awaiting the reading", () => {
    const s = roundStatus({ ...base, now: expiry, reading: { found: false, value: 0n, timestamp: 0, finalized: false } });
    expect(s.key).toBe("awaiting-reading");
    expect(s.voidable).toBeUndefined();
    expect(roundStatus({ ...base, now: expiry + 5, reading: null }).key).toBe("awaiting-reading");
  });

  test("no reading within the settlement window: voidable", () => {
    const s = roundStatus({ ...base, now: expiry + 3600 });
    expect(s.key).toBe("awaiting-reading");
    expect(s.voidable).toBe(true);
    expect(s.label).toBe("No reading");
  });

  test("settling: reading in, not final, with a countdown to final", () => {
    const s = roundStatus({ ...base, now: expiry + 60, reading: reading(8_400_000n) });
    expect(s.key).toBe("settling");
    expect(s.provisional).toBe("up");
    expect(s.final).toBe(false);
    expect(s.finalAt).toBe(expiry + 9 + 600);
  });

  test("settling: a tie is Down (strictly higher wins Up)", () => {
    const s = roundStatus({ ...base, now: expiry + 60, reading: reading(8_396_735n) });
    expect(s.provisional).toBe("down");
    expect(roundStatus({ ...base, now: expiry + 60, reading: reading(8_000_000n) }).provisional).toBe("down");
  });

  test("settling: final once the window passes (or the reading says so), awaiting resolve", () => {
    const byClock = roundStatus({ ...base, now: expiry + 9 + 600, reading: reading(8_400_000n) });
    expect(byClock.final).toBe(true);
    expect(byClock.label).toBe("Resolving");
    const byFlag = roundStatus({ ...base, now: expiry + 60, reading: reading(8_400_000n, expiry + 9, true) });
    expect(byFlag.final).toBe(true);
  });

  test("resolved Up / Down", () => {
    expect(roundStatus({ ...base, phase: PHASE.Resolved, yesWon: true, now: expiry + 700 }).key).toBe("resolved-up");
    expect(roundStatus({ ...base, phase: PHASE.Resolved, yesWon: false, now: expiry + 700 }).key).toBe("resolved-down");
  });

  test("voided", () => {
    expect(roundStatus({ ...base, phase: PHASE.Voided, now: expiry + 4000 }).key).toBe("voided");
  });

  test("the phase wins over the clock (settled rounds never show live)", () => {
    expect(roundStatus({ ...base, phase: PHASE.Resolved, yesWon: true, now: expiry - 10 }).key).toBe("resolved-up");
  });

  test("uses the feed's own challenge window (event feeds are 12 h)", () => {
    const s = roundStatus({ ...base, disputeWindow: 43_200, threshold: 1n, comparator: COMPARATOR.GreaterOrEqual, now: expiry + 60, reading: reading(1n) });
    expect(s.finalAt).toBe(expiry + 9 + 43_200);
    expect(s.provisional).toBe("up");
  });

  test("comparators", () => {
    expect(yesWins(2n, 1n, COMPARATOR.GreaterThan)).toBe(true);
    expect(yesWins(1n, 1n, COMPARATOR.GreaterThan)).toBe(false);
    expect(yesWins(1n, 1n, COMPARATOR.GreaterOrEqual)).toBe(true);
    expect(yesWins(0n, 1n, COMPARATOR.GreaterOrEqual)).toBe(false);
    expect(yesWins(0n, 1n, COMPARATOR.LessThan)).toBe(true);
    expect(yesWins(1n, 1n, COMPARATOR.LessOrEqual)).toBe(true);
    expect(yesWins(1n, 1n, 9)).toBe(false);
  });
});

describe("claims", () => {
  test("only markets with something to redeem, earliest close first", () => {
    const m = (id: number, expiry: number) => ({ marketId: hex(id), feedId: FEED_BTC, key: "btc-usd", change: false, agent: AGENT, threshold: 1n, comparator: 0, expiry, liquidity: 0n, blockNumber: 1n });
    const list = claimList([m(1, 300), m(2, 100), m(3, 200)], { [hex(1)]: 5n, [hex(2)]: 7n, [hex(3)]: 0n });
    expect(list.map((c) => [c.market.marketId, c.amount])).toEqual([
      [hex(2), 7n],
      [hex(1), 5n],
    ]);
  });
});

describe("event markets", () => {
  const now = 1_790_370_000;
  test("the real event always shows", () => {
    expect(eventVisible({ rehearsal: false }, PHASE.Resolved, now - 10 * 86_400, now)).toBe(true);
  });
  test("a rehearsal shows while open or settling, and a day after its deadline", () => {
    expect(eventVisible({ rehearsal: true }, undefined, now - 100_000, now)).toBe(true);
    expect(eventVisible({ rehearsal: true }, PHASE.Trading, now - 100_000, now)).toBe(true);
    expect(eventVisible({ rehearsal: true }, PHASE.Resolved, now - 3600, now)).toBe(true);
    expect(eventVisible({ rehearsal: true }, PHASE.Voided, now - 86_400, now)).toBe(false);
  });
  test("evidence note", () => {
    expect(evidenceNote(undefined)).toMatch(/Reading/);
    expect(evidenceNote(0n)).toBe("No evidence recorded yet.");
    expect(evidenceNote(1n, "https://example.com")).toMatch(/Evidence:$/);
    expect(evidenceNote(1n)).toMatch(/published with the reading/);
  });
});

describe("formatting", () => {
  test("formatScaled", () => {
    expect(formatScaled(8_396_735n, 2)).toBe("83,967.35");
    expect(formatScaled(121_670n, 3)).toBe("121.670");
    expect(formatScaled(91_540n, 3)).toBe("91.540");
    expect(formatScaled(5n, 2)).toBe("0.05");
    expect(formatScaled(-150n, 2)).toBe("-1.50");
    expect(formatScaled(1n, 0)).toBe("1");
    expect(formatScaled(123_456_789n, 2, false)).toBe("1234567.89");
  });

  test("live price at the attested precision", () => {
    expect(toScaled(83_967.354, 2)).toBe(8_396_735n);
    expect(toScaled(121.6704, 3)).toBe(121_670n);
    expect(formatPrice(4012.1, 2)).toBe("4,012.10");
  });

  test("roundLabel / clockUtc in UTC", () => {
    expect(clockUtc(1_790_367_000)).toBe("20:10");
    expect(roundLabel(1_790_367_000, 1_790_367_300)).toBe("20:10–20:15 UTC");
    expect(roundStart(1_790_367_300, 300)).toBe(1_790_367_000);
    expect(nextBoundary(1_790_367_000, 300)).toBe(1_790_367_300);
    expect(nextBoundary(1_790_367_299, 300)).toBe(1_790_367_300);
  });

  test("timeLeft", () => {
    expect(timeLeft(245)).toBe("4:05");
    expect(timeLeft(0)).toBe("0:00");
    expect(timeLeft(-12)).toBe("0:00");
    expect(timeLeft(3_720)).toBe("1h 02m");
    expect(timeLeft(3 * 86_400 + 4 * 3600 + 59)).toBe("3d 4h");
  });

  test("strikeDelta", () => {
    expect(strikeDelta(8_400_000n, 8_396_735n)).toMatchObject({ dir: "above", diff: 3_265n });
    expect(strikeDelta(8_396_735n, 8_396_735n).dir).toBe("at");
    const d = strikeDelta(9_900n, 10_000n);
    expect(d.dir).toBe("below");
    expect(d.pct).toBeCloseTo(-1);
  });

  test("impliedPct", () => {
    expect(impliedPct(500_000_000_000_000_000n)).toBe(50);
    expect(impliedPct(0n)).toBe(0);
  });

  test("round trade deadline: short, and never past the close", () => {
    expect(roundTradeDeadline(1_000n, 5_000n)).toBe(1_120n);
    expect(roundTradeDeadline(4_950n, 5_000n)).toBe(5_000n);
    expect(roundTradeDeadline(1_000n, 1_000_000n, 600n)).toBe(1_600n);
  });

  test("formatChange", () => {
    expect(formatChange(19_000n, 2)).toBe("+190.00");
    expect(formatChange(-35n, 2)).toBe("−0.35");
    expect(formatChange(0n, 3)).toBe("±0.000");
  });

  test("candleCloseAt: the close of the minute ending exactly at `at`", () => {
    const rows = [[1_790_367_240, 1, 3, 2, 80_310.04, 5], [1_790_367_180, 1, 3, 2, 80_300, 5]];
    expect(candleCloseAt(rows, 1_790_367_300)).toBe(80_310.04);
    expect(candleCloseAt(rows, 1_790_367_360)).toBeUndefined();
    expect(candleCloseAt({ message: "rate limited" }, 1_790_367_300)).toBeUndefined();
  });

  test("Coinbase ticker parsing", () => {
    expect(parseCoinbaseTicker({ price: "83967.35", time: "x" })).toBe(83_967.35);
    expect(parseCoinbaseTicker({ message: "NotFound" })).toBeUndefined();
    expect(parseCoinbaseTicker({ price: "0" })).toBeUndefined();
    expect(parseCoinbaseTicker(null)).toBeUndefined();
  });
});

describe("footer status line", () => {
  const d = { deployed: true, chainId: 5042, label: "Arc mainnet", testnet: false };
  test("names the rounds network when it runs on the build's network, else leaves the shell's line", () => {
    expect(roundsStatusLine(d, 5042)).toBe("Arc mainnet · live");
    expect(roundsStatusLine({ ...d, chainId: 5042002, label: "Arc testnet", testnet: true }, 5042002)).toBe("Arc testnet · test USDC");
    expect(roundsStatusLine({ ...d, deployed: false }, 5042)).toBeUndefined();
    expect(roundsStatusLine(d, 5042002)).toBeUndefined();
  });
});

describe("market pages (routes)", () => {
  const assets = [
    { key: "btc-usd", symbol: "BTC", name: "Bitcoin", product: "BTC-USD", decimals: 2 },
    { key: "hype-usd", symbol: "HYPE", name: "Hyperliquid", product: "HYPE-USD", decimals: 3 },
  ];
  test("an asset's page lives at /rounds/<symbol>/", () => {
    expect(assetSlug(assets[0])).toBe("btc");
    expect(assetHref(assets[1])).toBe("/rounds/hype/");
  });
  test("a slug finds its asset, case-insensitively; an unknown one finds nothing", () => {
    expect(assetBySlug("BTC", assets)?.key).toBe("btc-usd");
    expect(assetBySlug("doge", assets)).toBeUndefined();
  });
  test("an event's page lives at /rounds/event/<key>/", () => {
    expect(eventHref({ key: "arc-token-tradable" })).toBe("/rounds/event/arc-token-tradable/");
  });
  test("every deployed asset and event has a distinct page", () => {
    const paths = [...ROUNDS.assets.map(assetHref), ...ROUNDS.events.map(eventHref)];
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("proposed markets", () => {
  test("a proposal feed key is recognised and yields its id", () => {
    expect(feedKeyFromDescription("registrai-data:p-pabcdefghij")).toBe("p-pabcdefghij");
    expect(isProposalKey("p-pabcdefghij")).toBe(true);
    expect(isProposalKey("btc-usd:5m-3")).toBe(false);
    expect(proposalIdOfKey("p-pabcdefghij")).toBe("pabcdefghij");
  });

  test("only a well-formed proposal id counts as a proposal key", () => {
    expect(isProposalKey("p-pabcdefghi")).toBe(false); // 9 characters
    expect(isProposalKey("p-pABCDEFGHIJ")).toBe(false);
    expect(isProposalKey("p-pabcdefgh18")).toBe(false); // 1 and 8 are not base32
    expect(isProposalKey("arc-token-tradable")).toBe(false);
    expect(feedKeyFromDescription("registrai-data:p-pabcdefghij", "registrai-data:")).toBe("p-pabcdefghij");
  });

  test("market ids and the market page route", () => {
    expect(isMarketId(hex(7))).toBe(true);
    expect(isMarketId("0x12")).toBe(false);
    expect(isMarketId(`${hex(7)}00`)).toBe(false);
    expect(proposedMarketHref(`0x${"AB".repeat(32)}`)).toBe(`/rounds/market/?id=0x${"ab".repeat(32)}`);
  });

  const FEED_P1 = hex(0xf1);
  const FEED_P2 = hex(0xf2);
  const pbook = mergeFeedLogs(
    book,
    [feedLog(FEED_P1, "registrai-data:p-pabcdefghij", 20n, AGENT, 43_200n), feedLog(FEED_P2, "registrai-data:p-pqrstuvwxyz", 21n, AGENT, 600n)],
    AGENT,
  );

  test("proposal feeds join the book and their markets are discovered like events", () => {
    expect(pbook.byKey["p-pabcdefghij"]).toMatchObject({ feedId: FEED_P1, asset: "p-pabcdefghij", change: false });
    const ms = parseMarketLogs(
      [marketLog(30, FEED_P1, 5_000, { threshold: 1n, comparator: COMPARATOR.GreaterOrEqual }), marketLog(31, FEED_P2, 6_000, { threshold: 300_000n, comparator: COMPARATOR.LessOrEqual })],
      pbook,
      AGENT,
    );
    expect(ms.map((m) => m.key)).toEqual(["p-pabcdefghij", "p-pqrstuvwxyz"]);
  });

  test("a look-alike market on a proposal feed (not opened by the agent) is ignored", () => {
    expect(parseMarketLogs([marketLog(32, FEED_P1, 5_000, { creator: OTHER })], pbook, AGENT)).toEqual([]);
  });

  test("proposedMarkets: newest per proposal, open ones first by deadline, then finished newest first", () => {
    const mk = (id: number, key: string, expiry: number, block: bigint): RoundMarket => ({
      marketId: hex(id), feedId: FEED_P1, key, change: false, agent: AGENT, threshold: 1n, comparator: 1, expiry, liquidity: 0n, blockNumber: block,
    });
    const list = proposedMarkets(
      [
        mk(1, "p-paaaaaaaaaa", 900, 1n),
        mk(2, "p-paaaaaaaaaa", 2_000, 5n), // re-opened: supersedes #1
        mk(3, "p-pbbbbbbbbbb", 1_500, 2n),
        mk(4, "p-pcccccccccc", 800, 3n),
        mk(5, "p-pdddddddddd", 700, 4n),
        mk(6, "btc-usd", 5_000, 6n), // not a proposal
      ],
      1_000,
    );
    expect(list.map((m) => m.marketId)).toEqual([hex(3), hex(2), hex(4), hex(5)]);
  });

  const RULE = "Yes if the release is tagged.";
  const APPROVAL = (threshold: string, comparator: number, expiry: string, extra: Record<string, unknown> = {}) => ({
    message: { kind: 1, question: "Will X ship by Friday?", asset: "", ruleHash: keccak256(toBytes(RULE)), threshold, comparator, expiry, ...extra },
    signature: "0x",
    signer: "0x",
  });

  test("parseProposalInfo keeps only well-formed public fields, and the signed approval", () => {
    const info = parseProposalInfo(
      {
        proposal: {
          id: "pabcdefghij", kind: "event", question: "  Will X ship by Friday?  ", rule: RULE,
          source: "https://example.org/releases", creatorPayee: "0x000000000000000000000000000000000000dEaD",
          outcome: { message: { evidenceUrl: "https://example.org/v1" } }, contact: "never shown", approval: APPROVAL("1", 1, "1800000000"),
        },
      },
      "pabcdefghij",
    );
    expect(info).toEqual({
      question: "Will X ship by Friday?", kind: "event", rule: RULE, source: "https://example.org/releases",
      asset: undefined, evidenceUrl: "https://example.org/v1", creatorPayee: "0x000000000000000000000000000000000000dEaD",
      terms: { threshold: 1n, comparator: 1, expiry: 1_800_000_000, kind: 1, question: "Will X ship by Friday?", asset: "", ruleHash: keccak256(toBytes(RULE)) },
    });
    expect(parseProposalInfo({ proposal: { id: "pabcdefghij", question: "" } }, "pabcdefghij")).toBeNull();
    expect(parseProposalInfo({ error: "no such proposal" }, "pabcdefghij")).toBeNull();
    expect(parseProposalInfo(null, "pabcdefghij")).toBeNull();
    const odd = parseProposalInfo(
      { proposal: { id: "pabcdefghij", question: "Q?", kind: "wonder", source: "javascript:alert(1)", creatorPayee: "nope", outcome: { message: { evidenceUrl: "http://x" } }, approval: APPROVAL("0x1", 1, "9") } },
      "pabcdefghij",
    );
    expect(odd).toMatchObject({ kind: undefined, source: undefined, evidenceUrl: undefined, creatorPayee: "", terms: undefined });
    // an approval without the signed question or kind is no approval
    const partial = parseProposalInfo({ proposal: { id: "pabcdefghij", question: "Q?", approval: APPROVAL("1", 1, "9", { question: undefined }) } }, "pabcdefghij");
    expect(partial?.terms).toBeUndefined();
    expect(parseProposalInfo({ proposal: { id: "pabcdefghij", question: "x".repeat(301) } }, "pabcdefghij")).toBeNull();
  });

  test("parseProposalInfo refuses another proposal's record", () => {
    expect(parseProposalInfo({ proposal: { id: "pzzzzzzzzzz", question: "Will X?" } }, "pabcdefghij")).toBeNull();
    expect(parseProposalInfo({ proposal: { question: "Will X?" } }, "pabcdefghij")).toBeNull();
  });

  const EVT = { key: "p-pabcdefghij", marketId: hex(9), expiry: 1_800_000_000, threshold: 1n, comparator: COMPARATOR.GreaterOrEqual };
  const PRICE = { ...EVT, threshold: 300_000n, comparator: COMPARATOR.LessOrEqual };
  const ASSETS = { "btc-usd": { symbol: "BTC", decimals: 2 }, "eth-usd": { symbol: "ETH", decimals: 2 } };
  const PQ = "BTC at most 3,000.00 at the deadline?";
  const priceTerms = (over: Partial<ApprovalTerms> = {}): ApprovalTerms => ({
    threshold: 300_000n, comparator: 3, expiry: 1_800_000_000, kind: 2, question: PQ, asset: "btc-usd", ruleHash: keccak256(toBytes("")), ...over,
  });
  const priceInfo = (terms: ApprovalTerms = priceTerms(), over: Partial<ProposalInfo> = {}): ProposalInfo => ({
    question: PQ, kind: "price", asset: "btc-usd", rule: "", terms, ...over,
  });
  const evtTerms = (over: Partial<ApprovalTerms> = {}): ApprovalTerms => ({
    threshold: 1n, comparator: 1, expiry: 1_800_000_000, kind: 1, question: "Q?", asset: "", ruleHash: keccak256(toBytes(RULE)), ...over,
  });

  test("proposalEventMeta: without a record, Proposal #id and the chain's kind, marked unverified", () => {
    expect(proposalEventMeta(EVT, null)).toMatchObject({
      key: "p-pabcdefghij", question: "Proposal #pabcdefghij", expiry: 1_800_000_000, rehearsal: false, marketId: hex(9),
      proposal: { id: "pabcdefghij", kind: "event", verified: false },
    });
    expect(proposalEventMeta(PRICE, undefined).proposal).toMatchObject({ kind: "price", verified: false, symbol: undefined, decimals: undefined });
  });

  test("proposalEventMeta: a record whose approval matches the chain and its own words lends them", () => {
    const meta = proposalEventMeta(PRICE, priceInfo(), ASSETS);
    expect(meta.question).toBe(PQ);
    expect(meta.proposal).toMatchObject({ kind: "price", verified: true, symbol: "BTC", decimals: 2 });
    const evt = { question: "Q?", rule: RULE, evidenceUrl: "https://e.org/x", terms: evtTerms() };
    expect(proposalEventMeta(EVT, evt)).toMatchObject({ question: "Q?", evidenceUrl: "https://e.org/x", proposal: { verified: true, rule: RULE } });
  });

  test("proposalEventMeta: a rule that does not hash to the signed ruleHash is not shown", () => {
    const evt = { question: "Q?", rule: "Yes if anything at all happens.", terms: evtTerms() };
    expect(proposalEventMeta(EVT, evt).proposal).toMatchObject({ verified: true, rule: undefined });
  });

  test("proposalEventMeta: the signed kind wins over the record's and over the chain's guess", () => {
    // a degenerate price market: BTC at least $0.01 is threshold 1 with >=, like a yes/no market
    const cent = priceInfo(priceTerms({ threshold: 1n, comparator: 1 }), { question: PQ });
    expect(proposalEventMeta(EVT, cent, ASSETS).proposal).toMatchObject({ kind: "price", verified: true, symbol: "BTC" });
    // the record's own kind field does not count
    expect(proposalEventMeta(PRICE, priceInfo(priceTerms(), { kind: "event" }), ASSETS).proposal?.kind).toBe("price");
    // no matching record: the chain's kind
    const bad = priceInfo(priceTerms({ threshold: 2n, comparator: 1 }));
    expect(proposalEventMeta(EVT, bad, ASSETS).proposal).toMatchObject({ kind: "event", verified: false });
  });

  test("proposalEventMeta: any mismatch in threshold, comparator, expiry or kind (or no terms) drops the record", () => {
    for (const terms of [priceTerms({ threshold: 310_000n }), priceTerms({ comparator: 1 }), priceTerms({ expiry: 1_800_000_300 }), priceTerms({ kind: 3 })]) {
      const meta = proposalEventMeta(PRICE, priceInfo(terms), ASSETS);
      expect(meta.question).toBe("Proposal #pabcdefghij");
      expect(meta.proposal).toMatchObject({ verified: false, symbol: undefined, decimals: undefined, rule: undefined });
    }
    const noTerms = { question: "Q?", evidenceUrl: "https://e.org/x" };
    expect(proposalEventMeta(EVT, noTerms)).toMatchObject({ question: "Proposal #pabcdefghij", evidenceUrl: null });
  });

  test("proposalEventMeta: a record whose question or asset differs from the signed one is dropped", () => {
    // terms match the chain, but the record swaps the asset (ETH for the signed BTC)...
    const swappedAsset = priceInfo(priceTerms(), { asset: "eth-usd" });
    expect(proposalEventMeta(PRICE, swappedAsset, ASSETS)).toMatchObject({ question: "Proposal #pabcdefghij", proposal: { verified: false, symbol: undefined } });
    // ...or rewrites the question
    const swappedQ = priceInfo(priceTerms(), { question: "Will ETH be at most $3,000?" });
    expect(proposalEventMeta(PRICE, swappedQ, ASSETS)).toMatchObject({ question: "Proposal #pabcdefghij", proposal: { verified: false } });
    // a yes/no record that names an asset the approval did not sign
    expect(proposalEventMeta(EVT, { question: "Q?", asset: "btc-usd", terms: evtTerms() }).proposal?.verified).toBe(false);
  });

  test("proposals API answers: only 404 and 410 are kept; everything else is retried with backoff", () => {
    expect(proposalAnswer(200)).toBe("ok");
    expect(proposalAnswer(404)).toBe("missing");
    expect(proposalAnswer(410)).toBe("missing");
    for (const s of ["network", 400, 403, 408, 429, 500, 502, 503] as const) expect(proposalAnswer(s)).toBe("retry");
    expect([1, 2, 3, 4, 5, 6, 10].map(proposalRetryMs)).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  });

  test("nextBackfill: newest chunk first, then new blocks, then back to the floor", () => {
    expect(nextBackfill(undefined, 20_000n, 0n, 5_000n)).toEqual([15_001n, 20_000n]);
    expect(nextBackfill(undefined, 3_000n, 1_000n, 5_000n)).toEqual([1_000n, 3_000n]);
    expect(nextBackfill({ lo: 15_001n, hi: 20_000n }, 20_000n, 0n, 5_000n)).toEqual([10_001n, 15_000n]);
    expect(nextBackfill({ lo: 15_001n, hi: 20_000n }, 27_000n, 0n, 5_000n)).toEqual([20_001n, 25_000n]);
    // under a chunk of new blocks: the page's recent scan has them, keep going back
    expect(nextBackfill({ lo: 15_001n, hi: 20_000n }, 24_999n, 0n, 5_000n)).toEqual([10_001n, 15_000n]);
    expect(nextBackfill({ lo: 0n, hi: 20_000n }, 24_999n, 0n, 5_000n)).toBeNull();
    expect(nextBackfill({ lo: 15_001n, hi: 20_000n }, 20_000n, 12_000n, 5_000n)).toEqual([12_000n, 15_000n]);
    expect(nextBackfill({ lo: 12_000n, hi: 20_000n }, 20_000n, 12_000n, 5_000n)).toBeNull();
    expect(nextBackfill(undefined, 10n, 20n, 5_000n)).toBeNull();
  });

  test("extendCover grows only over a touching range", () => {
    expect(extendCover(undefined, 10n, 20n)).toEqual({ lo: 10n, hi: 20n });
    expect(extendCover({ lo: 10n, hi: 20n }, 21n, 30n)).toEqual({ lo: 10n, hi: 30n });
    expect(extendCover({ lo: 10n, hi: 20n }, 1n, 9n)).toEqual({ lo: 1n, hi: 20n });
    expect(extendCover({ lo: 10n, hi: 20n }, 22n, 30n)).toEqual({ lo: 10n, hi: 20n }); // a gap: unchanged
    expect(extendCover({ lo: 10n, hi: 20n }, 30n, 29n)).toEqual({ lo: 10n, hi: 20n }); // empty range
  });

  test("sumTransfers adds the forwarded amounts", () => {
    expect(sumTransfers([{ args: { amount: 1_000_000n } }, { args: {} }, { args: { amount: 250_000n } }])).toBe(1_250_000n);
    expect(sumTransfers([])).toBe(0n);
  });

  test("the scan store round-trips (ids and blocks only) and a malformed one starts afresh", () => {
    const store = {
      cover: { lo: 100n, hi: 20_000n },
      feeds: {
        [hex(0xf1)]: { feedId: hex(0xf1), block: 160n, marketId: hex(0x51), marketBlock: 170n },
        [hex(0xf2)]: { feedId: hex(0xf2), block: 150n, marketId: undefined, marketBlock: undefined },
      },
      orphans: { [hex(0xf3)]: { marketId: hex(0x53), block: 180n } },
    };
    expect(parseProposalStore(serializeProposalStore(store))).toEqual(store);
    const EMPTY = { feeds: {}, orphans: {} };
    expect(parseProposalStore(null)).toEqual(EMPTY);
    expect(parseProposalStore("{nope")).toEqual(EMPTY);
    expect(parseProposalStore(JSON.stringify({ cover: { lo: "9", hi: "1" }, feeds: [] }))).toEqual(EMPTY);
    const badBlock = JSON.parse(serializeProposalStore(store));
    badBlock.feeds[0].block = "-1";
    expect(parseProposalStore(JSON.stringify(badBlock))).toEqual(EMPTY);
    const badId = JSON.parse(serializeProposalStore(store));
    badId.feeds[1].marketId = "0x12";
    expect(parseProposalStore(JSON.stringify(badId))).toEqual(EMPTY);
    const badOrphan = JSON.parse(serializeProposalStore(store));
    badOrphan.orphans[0].marketId = "nope";
    expect(parseProposalStore(JSON.stringify(badOrphan))).toEqual(EMPTY);
    // a planted key or label is not part of the record: it is dropped, never trusted
    const planted = JSON.parse(serializeProposalStore(store));
    planted.feeds[0].key = "p-pzzzzzzzzzz";
    expect(Object.keys(parseProposalStore(JSON.stringify(planted)).feeds[hex(0xf1)]).sort()).toEqual(["block", "feedId", "marketBlock", "marketId"]);
  });

  test("the store keeps the newest records by block, up to 2000", () => {
    const feeds = Array.from({ length: 2_005 }, (_, i) => ({ feedId: hex(0x10000 + i), block: BigInt(i), marketId: hex(0x90000 + i) }));
    const raw = serializeProposalStore({ feeds: Object.fromEntries(feeds.map((f) => [f.feedId, f])), orphans: {} });
    const kept = Object.values(parseProposalStore(raw).feeds).map((f) => f.block);
    expect(kept.length).toBe(2_000);
    expect(kept.includes(2_004n) && !kept.includes(4n) && kept.includes(5n)).toBe(true);
  });

  test("pruneProposalStore: feeds and orphans before the floor go; a never-opened feed stays (the agent may still open it)", () => {
    const s = {
      cover: { lo: 0n, hi: 50_000n },
      feeds: {
        [hex(1)]: { feedId: hex(1), block: 900n, marketId: hex(0x11) }, // before the floor
        [hex(2)]: { feedId: hex(2), block: 2_000n }, // no market yet, long ago
        [hex(3)]: { feedId: hex(3), block: 3_000n }, // no market yet, recent
        [hex(4)]: { feedId: hex(4), block: 4_000n, marketId: hex(0x44) }, // opened
      },
      orphans: { [hex(5)]: { marketId: hex(0x55), block: 800n }, [hex(6)]: { marketId: hex(0x66), block: 5_000n } },
    };
    const out = pruneProposalStore(s, 1_000n, 2_500n);
    expect(Object.keys(out.feeds).sort()).toEqual([hex(2), hex(3), hex(4)].sort());
    expect(Object.keys(out.orphans)).toEqual([hex(6)]);
    expect(out.cover).toEqual(s.cover);
  });

  test("pruneProposalStore over the cap evicts never-opened feeds past their search first", () => {
    const s = {
      feeds: {
        [hex(2)]: { feedId: hex(2), block: 9_000n }, // newest, but no market and past its search
        [hex(3)]: { feedId: hex(3), block: 2_000n, marketId: hex(0x33) }, // oldest, opened
        [hex(4)]: { feedId: hex(4), block: 9_990n }, // no market, still within its search
      },
      orphans: {},
    };
    expect(Object.keys(pruneProposalStore(s, 0n, 9_500n, 2).feeds).sort()).toEqual([hex(3), hex(4)].sort());
    expect(Object.keys(pruneProposalStore(s, 0n, 9_500n, 1).feeds)).toEqual([hex(4)]);
  });

  describe("foldProposalRange: markets found wherever they open", () => {
    const P1 = hex(0xf1);
    const ROUND = FEED_BTC;
    const DAY = 172_800n; // blocks per day at 0.5 s
    const feedAt = (block: bigint) => feedLog(P1, "registrai-data:p-pabcdefghij", block, AGENT, 43_200n);
    const marketAt = (id: number, feedId: Hex, block: bigint, creator: Address = AGENT) =>
      marketLog(id, feedId, 1_800_000_000, { block, threshold: 1n, comparator: COMPARATOR.GreaterOrEqual, creator });
    const other = (f: string) => f === ROUND.toLowerCase();
    const EMPTY = { feeds: {}, orphans: {} };

    test("a market opened on day 4 is found by a first-time visitor (backward scan: market before feed)", () => {
      const feedBlock = 1_000_000n;
      const marketBlock = feedBlock + 4n * DAY;
      // the newer range first: the market, its feed not known yet
      const r1 = foldProposalRange(EMPTY, [], [marketAt(0x71, P1, marketBlock), marketAt(0x72, ROUND, marketBlock)], AGENT, other);
      expect(r1.attached).toEqual([]);
      expect(Object.keys(r1.store.orphans)).toEqual([P1]); // the round market is not an orphan
      // ...the visitor leaves, and comes back: the store survives the round trip
      const back = parseProposalStore(serializeProposalStore(r1.store));
      // then the older range: the feed
      const r2 = foldProposalRange(back, [feedAt(feedBlock)], [], AGENT, other);
      expect(r2.attached).toEqual([hex(0x71)]);
      expect(r2.store.feeds[P1]).toMatchObject({ block: feedBlock, marketId: hex(0x71), marketBlock });
      expect(r2.store.orphans).toEqual({});
    });

    test("a market opened on day 4 is found by a returning visitor (forward scan: feed stored earlier)", () => {
      const feedBlock = 1_000_000n;
      const first = foldProposalRange(EMPTY, [feedAt(feedBlock)], [], AGENT, other);
      expect(first.store.feeds[P1].marketId).toBeUndefined();
      const stored = parseProposalStore(serializeProposalStore(first.store));
      const later = foldProposalRange(stored, [], [marketAt(0x71, P1, feedBlock + 4n * DAY)], AGENT, other);
      expect(later.attached).toEqual([hex(0x71)]);
      expect(later.store.feeds[P1].marketId).toBe(hex(0x71));
    });

    test("feed and market in one range; the newest market wins; strangers' markets are ignored", () => {
      const r = foldProposalRange(EMPTY, [feedAt(10n)], [marketAt(0x71, P1, 12n), marketAt(0x73, P1, 11n), marketAt(0x74, P1, 13n, OTHER)], AGENT, other);
      expect(r.store.feeds[P1].marketId).toBe(hex(0x71));
      expect(r.store.orphans).toEqual({});
    });

    test("only the agent's proposal feeds are stored; a round feed's orphan is dropped when the feed turns up", () => {
      const ORPH = hex(0xe1);
      const r1 = foldProposalRange(EMPTY, [], [marketAt(0x75, ORPH, 50n)], AGENT, other);
      expect(Object.keys(r1.store.orphans)).toEqual([ORPH]);
      const r2 = foldProposalRange(
        r1.store,
        [feedLog(ORPH, "registrai-data:btc-usd-5m-change-9", 10n), feedLog(hex(0xe2), "registrai-data:p-pqrstuvwxyz", 11n, OTHER)],
        [],
        AGENT,
        other,
      );
      expect(r2.store.feeds).toEqual({});
      expect(r2.store.orphans).toEqual({});
    });
  });
});

describe("R51: round feeds missing from the deployment seed", () => {
  // The testnet seed stops at change feed 12; the agent runs 15 (13 and 14 came later).
  const seed = seedFeedBook(ROUNDS.feeds);
  const FEED_13 = hex(0x1313);
  const round13 = marketLog(700, FEED_13, 1_790_000_300, { threshold: 0n, comparator: COMPARATOR.GreaterThan });
  const foreign = marketLog(701, FEED_13, 1_790_000_300, { threshold: 0n, creator: OTHER });

  test("the seed lacks the feed, so a round on it is dropped, but held", () => {
    expect(seed.byId[FEED_13]).toBeUndefined();
    expect(parseMarketLogs([round13], seed, AGENT)).toEqual([]);
    expect(marketsOnUnknownFeeds([round13, foreign], seed, AGENT)).toEqual([round13]);
  });

  test("FeedCreated(creator = agent) with the round prefix teaches the book the feed; the held round then shows", () => {
    const learned = mergeFeedLogs(seed, [feedLog(FEED_13, "registrai-data:btc-usd-5m-change-13", 900n)], AGENT);
    expect(learned.byKey["btc-usd:5m-13"]).toMatchObject({ feedId: FEED_13, asset: "btc-usd", change: true });
    const [m] = parseMarketLogs(marketsOnUnknownFeeds([round13], seed, AGENT), learned, AGENT);
    expect(m).toMatchObject({ marketId: hex(700), key: "btc-usd", change: true, threshold: 0n });
    expect(marketsOnUnknownFeeds([round13], learned, AGENT)).toEqual([]);
    // it groups with BTC's other rounds
    const g = groupRounds([m], ["btc-usd"], 1_790_000_000);
    expect(g["btc-usd"].current?.marketId).toBe(hex(700));
  });

  test("a round-prefixed feed created by someone else teaches nothing", () => {
    const spoof = mergeFeedLogs(seed, [feedLog(FEED_13, "registrai-data:btc-usd-5m-change-13", 900n, OTHER)], AGENT);
    expect(spoof.byId[FEED_13]).toBeUndefined();
  });

  test("the feed's Registry record (for a feed older than the scans) is learned the same way", () => {
    const rec = feedLogFromRecord(FEED_13, { creator: AGENT, description: "registrai-data:btc-usd-5m-change-13", disputeWindow: 600n, exists: true });
    const learned = mergeFeedLogs(seed, rec ? [rec] : [], AGENT);
    expect(parseMarketLogs([round13], learned, AGENT)).toHaveLength(1);
    expect(feedLogFromRecord(FEED_13, { creator: AGENT, description: "", disputeWindow: 0n, exists: false })).toBeNull();
  });
});
