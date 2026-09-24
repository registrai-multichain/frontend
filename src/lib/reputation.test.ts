import { describe, expect, it } from "vitest";
import {
  CAUGHT_BANNER,
  EMPTY_REPUTATION,
  REPUTATION_CURSOR_VERSION,
  assessAgent,
  coverage,
  coverageLabel,
  coveragePct,
  coverageTier,
  coverageWarning,
  foldReputation,
  invalidationsFromRulings,
  leaderboard,
  levelOf,
  marketKey,
  multiplierBps,
  multiplierLabel,
  openMarketsFor,
  parseReputation,
  recommendedBond,
  serializeReputation,
  snapshotFor,
  tradeVolume,
  usd,
  type Level,
  type ReputationEvent,
  type ReputationSnapshot,
} from "./reputation";

const U = 1_000_000n; // one USDC
const A = "0xaaaa000000000000000000000000000000000001";
const B = "0xbbbb000000000000000000000000000000000002";
const FEED = "0xfeed";

let seq = 0;
const created = (block: number, market: string, agent = A, feed = FEED): ReputationEvent => ({ kind: "created", block, seq: seq++, market, agent, feed });
const trade = (block: number, market: string, volume: bigint): ReputationEvent => ({ kind: "trade", block, seq: seq++, market, volume });
const resolved = (block: number, market: string): ReputationEvent => ({ kind: "resolved", block, seq: seq++, market });
const voided = (block: number, market: string): ReputationEvent => ({ kind: "voided", block, seq: seq++, market });
const invalid = (block: number, agent = A, disputeId = "0xd1"): ReputationEvent => ({
  kind: "invalidated", block, seq: seq++, agent, disputeId, attestationId: "0xa1", tx: "0x7x",
});

const score = (s: ReturnType<typeof foldReputation>, agent = A) => s.agents[agent.toLowerCase()]?.score ?? 0n;

describe("levelOf", () => {
  it("applies the thresholds exactly", () => {
    const cases: [bigint, boolean, Level][] = [
      [0n, false, 1],
      [10_000n * U - 1n, false, 1],
      [10_000n * U, false, 2],
      [100_000n * U - 1n, false, 2],
      [100_000n * U, false, 3],
      [1_000_000n * U - 1n, false, 3],
      [1_000_000n * U, false, 4],
      [10_000_000n * U - 1n, false, 4],
      [10_000_000n * U, false, 5],
      [10n ** 30n, false, 5],
    ];
    for (const [s, c, l] of cases) expect(levelOf(s, c)).toBe(l);
  });

  it("puts a caught agent at 0 until it climbs past $10,000 again", () => {
    expect(levelOf(0n, true)).toBe(0);
    expect(levelOf(10_000n * U - 1n, true)).toBe(0);
    expect(levelOf(10_000n * U, true)).toBe(2);
    expect(levelOf(10_000_000n * U, true)).toBe(5);
  });

  it("maps levels to multipliers", () => {
    expect([0, 1, 2, 3, 4, 5].map((l) => multiplierBps(l as Level))).toEqual([20_000n, 10_000n, 7_500n, 5_000n, 2_500n, 1_000n]);
    expect([0, 1, 2, 3, 4, 5].map((l) => multiplierLabel(l as Level))).toEqual(["2.0×", "1.0×", "0.75×", "0.5×", "0.25×", "0.1×"]);
  });
});

describe("foldReputation", () => {
  it("credits volume only when the market resolves", () => {
    const open = foldReputation(EMPTY_REPUTATION, [created(1, "m1"), trade(2, "m1", 5n * U), trade(3, "m1", 7n * U)]);
    expect(score(open)).toBe(0n);
    expect(open.open["m1"].volume).toBe(12n * U);
    const done = foldReputation(open, [resolved(4, "m1")]);
    expect(score(done)).toBe(12n * U);
    expect(done.agents[A].settledMarkets).toBe(1);
    expect(done.open["m1"]).toBeUndefined();
  });

  it("counts a sell as collateralOut + fee (collateralOut is net)", () => {
    expect(tradeVolume({ kind: "buy", collateralIn: 10n * U })).toBe(10n * U);
    expect(tradeVolume({ kind: "sell", collateralOut: 99n * U, fee: 1n * U })).toBe(100n * U);
  });

  it("never counts a voided market", () => {
    const s = foldReputation(EMPTY_REPUTATION, [created(1, "m1"), trade(2, "m1", 50n * U), voided(3, "m1"), resolved(4, "m1")]);
    expect(score(s)).toBe(0n);
    expect(s.agents[A]).toBeUndefined();
    expect(s.open["m1"]).toBeUndefined();
  });

  it("still counts a market whose challenge was ruled Valid", () => {
    // A Valid ruling produces no invalidation event, so the resolve counts.
    const { events } = invalidationsFromRulings(
      [{ disputeId: "0xd1", outcome: 1, block: 3, seq: 0 }],
      () => "0xa1",
      () => A,
    );
    expect(events).toEqual([]);
    const s = foldReputation(EMPTY_REPUTATION, [created(1, "m1"), trade(2, "m1", 20n * U), ...events, resolved(5, "m1")]);
    expect(score(s)).toBe(20n * U);
    expect(s.agents[A].caught).toBe(false);
  });

  it("wipes on an Invalid ruling; only markets resolved after the ruling's block rebuild", () => {
    const { events: inv } = invalidationsFromRulings(
      [{ disputeId: "0xD1", outcome: 2, block: 10, seq: 5, tx: "0xT" }],
      (d) => (d === "0xd1" ? "0xa1" : undefined),
      (a) => (a === "0xa1" ? A : undefined),
    );
    expect(inv).toHaveLength(1);
    const s = foldReputation(EMPTY_REPUTATION, [
      created(1, "m1"), trade(2, "m1", 30_000n * U), resolved(3, "m1"), // earned before
      created(4, "m2"), trade(5, "m2", 4_000n * U), // open across the ruling
      created(6, "m3"), trade(7, "m3", 1_000n * U),
      ...inv,
      { kind: "resolved", block: 10, seq: 6, market: "m3" }, // same block as the ruling: not after it
      resolved(11, "m2"),
    ]);
    const r = s.agents[A];
    expect(r.caught).toBe(true);
    expect(r.caughtAt).toBe(10);
    expect(r.lastDisputeId).toBe("0xd1");
    expect(r.caughtTx).toBe("0xt");
    expect(r.score).toBe(4_000n * U);
    expect(levelOf(r.score, r.caught)).toBe(0);
    expect(r.settledMarkets).toBe(3);

    // Rebuild past $10k -> level 2 by the table; the flag stays.
    const later = foldReputation(s, [created(20, "m4"), trade(21, "m4", 6_000n * U), resolved(22, "m4")]);
    expect(later.agents[A].score).toBe(10_000n * U);
    expect(levelOf(later.agents[A].score, true)).toBe(2);
    expect(later.agents[A].caught).toBe(true);
  });

  it("never credits trades to another agent", () => {
    const s = foldReputation(EMPTY_REPUTATION, [
      created(1, "ma", A),
      created(1, "mb", B),
      trade(2, "ma", 5n * U),
      trade(2, "mb", 9n * U),
      trade(2, "unknown", 100n * U), // never seen created: dropped, not guessed
      created(3, "ma", B), // a duplicate create cannot move a market to another agent
      resolved(4, "ma"),
      resolved(4, "mb"),
      resolved(5, "unknown"),
    ]);
    expect(score(s, A)).toBe(5n * U);
    expect(score(s, B)).toBe(9n * U);
    // An invalidation of B leaves A untouched.
    const t = foldReputation(s, [invalid(6, B)]);
    expect(score(t, A)).toBe(5n * U);
    expect(score(t, B)).toBe(0n);
  });

  it("is resumable: two halves equal one pass, and the prior is not mutated", () => {
    const all: ReputationEvent[] = [
      created(1, "m1"), trade(2, "m1", 3n * U), created(2, "m2", B), trade(3, "m2", 8n * U),
      resolved(4, "m1"), trade(5, "m2", 2n * U), invalid(6, B), created(7, "m3"), trade(8, "m3", 1n * U),
      resolved(9, "m2"), voided(10, "m3"), created(11, "m4", B), trade(12, "m4", 4n * U), resolved(13, "m4"),
    ];
    const once = foldReputation(EMPTY_REPUTATION, all);
    for (let cut = 0; cut <= all.length; cut++) {
      const first = foldReputation(EMPTY_REPUTATION, all.slice(0, cut));
      const frozen = JSON.stringify(serializeReputation(first));
      // Through the JSON form, as the cursor travels.
      const resumed = foldReputation(parseReputation(JSON.parse(frozen)), all.slice(cut));
      expect(serializeReputation(resumed)).toEqual(serializeReputation(once));
      expect(JSON.stringify(serializeReputation(first))).toBe(frozen);
    }
    expect(score(once, A)).toBe(3n * U);
    // m2 resolved after B's ruling, so it counts in full; m4 too.
    expect(score(once, B)).toBe(14n * U);
  });

  it("orders by block then log index regardless of input order", () => {
    const e = [resolved(4, "m1"), trade(2, "m1", 3n * U), created(1, "m1")];
    expect(score(foldReputation(EMPTY_REPUTATION, e))).toBe(3n * U);
  });
});

describe("invalidationsFromRulings", () => {
  it("reports rulings it cannot trace instead of dropping them", () => {
    const { events, unresolved } = invalidationsFromRulings(
      [
        { disputeId: "0x01", outcome: 2, block: 1, seq: 0 },
        { disputeId: "0x02", outcome: 2, block: 1, seq: 1 },
        { disputeId: "0x03", outcome: 0, block: 1, seq: 2 },
      ],
      (d) => (d === "0x01" ? "0xaa" : d === "0x02" ? "0xbb" : undefined),
      (a) => (a === "0xaa" ? A : undefined),
    );
    expect(events.map((e) => (e.kind === "invalidated" ? e.agent : ""))).toEqual([A]);
    expect(unresolved).toEqual(["0x02"]);
  });
});

describe("recommendedBond & coverage", () => {
  it("is $50 × multiplier per $1,000 open", () => {
    expect(recommendedBond(1_000n * U, 1)).toBe(50n * U);
    expect(recommendedBond(1_000n * U, 0)).toBe(100n * U);
    expect(recommendedBond(1_000n * U, 2)).toBe(37_500_000n);
    expect(recommendedBond(1_000n * U, 5)).toBe(5n * U);
    expect(recommendedBond(20_000n * U, 3)).toBe(500n * U);
  });

  it("floors in integer units", () => {
    // 50e6 * 7500 * 1 / (1e4 * 1e9) = 0.0375 -> 0
    expect(recommendedBond(1n, 2)).toBe(0n);
    // $3 open at 1.0× = $0.15 exactly
    expect(recommendedBond(3n * U, 1)).toBe(150_000n);
    // $0.333333 open at 0.75× = 0.0124999875 USDC -> 12_499 units
    expect(recommendedBond(333_333n, 2)).toBe(12_499n);
  });

  it("handles nothing at risk and a zero bond", () => {
    expect(recommendedBond(0n, 1)).toBe(0n);
    expect(coverage(10n * U, 0n)).toBe(Number.POSITIVE_INFINITY);
    expect(coverage(0n, 0n)).toBe(Number.POSITIVE_INFINITY);
    expect(coveragePct(0n, 0n)).toBeNull();
    expect(coverageTier(0n, 0n)).toBe("full");
    expect(coverage(0n, 50n * U)).toBe(0);
    expect(coverageTier(0n, 50n * U)).toBe("thin");
  });

  it("never rounds up across a tier boundary", () => {
    const rec = 3n * U;
    expect(coverageTier(rec, rec)).toBe("full");
    expect(coverageTier(rec - 1n, rec)).toBe("partial");
    expect(coveragePct(rec - 1n, rec)).toBe(99);
    expect(coverage(rec - 1n, rec)).toBeLessThan(1);
    expect(coverageTier(rec / 2n, rec)).toBe("partial");
    expect(coverageTier(rec / 2n - 1n, rec)).toBe("thin");
    expect(coveragePct(rec / 2n - 1n, rec)).toBe(49);
  });
});

describe("assessment & copy", () => {
  const rec = (over: Partial<ReturnType<typeof serializeReputation>["agents"][string]> = {}) => ({
    score: "0", level: 1 as Level, caught: false, caughtAt: null, lastDisputeId: null, caughtTx: null, settledMarkets: 0, ...over,
  });

  it("stays silent when fully covered", () => {
    const a = assessAgent({ indexed: true, record: rec(), bond: 100n * U, openCollateral: 1_000n * U });
    expect(a.tier).toBe("full");
    expect(coverageWarning(a)).toBeUndefined();
    expect(coverageLabel(a)).toBe("200% covered");
  });

  it("says partially covered with the exact numbers", () => {
    const a = assessAgent({ indexed: true, record: rec({ score: String(20_000n * U), level: 2 }), bond: 30n * U, openCollateral: 1_000n * U });
    expect(a.level).toBe(2);
    expect(a.recommended).toBe(37_500_000n);
    expect(a.tier).toBe("partial");
    expect(coverageWarning(a)).toBe(
      "This agent's bond is partially covered: $30.00 bonded vs $37.50 recommended (80%) for $1,000.00 open on this feed at level 2 (0.75×).",
    );
  });

  it("says thinly covered below 50%", () => {
    const a = assessAgent({ indexed: true, record: rec(), bond: 10n * U, openCollateral: 1_000n * U });
    expect(a.tier).toBe("thin");
    expect(coverageWarning(a)).toBe(
      "This agent's bond is thinly covered: $10.00 bonded vs $50.00 recommended (20%) for $1,000.00 open on this feed at level 1 (1.0×).",
    );
  });

  it("labels nothing at risk as fully covered", () => {
    const a = assessAgent({ indexed: true, record: rec(), bond: 0n, openCollateral: 0n });
    expect(a.tier).toBe("full");
    expect(coverageLabel(a)).toBe("fully covered · nothing at risk");
  });

  it("hides coverage when the deployment can't report open collateral (legacy)", () => {
    const a = assessAgent({ indexed: true, record: rec({ score: "5" }), bond: 10n * U });
    expect(a.tier).toBeUndefined();
    expect(coverageWarning(a)).toBeUndefined();
    expect(coverageLabel(a)).toBeUndefined();
    expect(a.score).toBe(5n);
  });

  it("applies a fresh catch after the snapshot: wipe, level 0, 2.0×", () => {
    const a = assessAgent({
      indexed: true,
      record: rec({ score: String(200_000n * U), level: 3, settledMarkets: 7 }),
      fresh: { disputeId: "0xd9", block: 99, tx: "0xabc" },
      bond: 100n * U,
      openCollateral: 1_000n * U,
    });
    expect(a).toMatchObject({ caught: true, score: 0n, level: 0, caughtTx: "0xabc", disputeId: "0xd9", settledMarkets: 7 });
    expect(a.recommended).toBe(100n * U);
    expect(a.tier).toBe("full");
    expect(CAUGHT_BANNER).toBe("This market's agent gave a proven wrong answer on another market");
  });

  it("treats an unindexed agent as new (level 1, no discount)", () => {
    const a = assessAgent({ indexed: false, record: null, bond: 25n * U, openCollateral: 1_000n * U });
    expect(a).toMatchObject({ indexed: false, level: 1, caught: false, score: 0n, tier: "partial" });
  });

  it("formats USDC for display", () => {
    expect(usd(1_234_567_890n)).toBe("$1,234.56");
    expect(usd(0n)).toBe("$0.00");
    expect(usd(10_000_000n * U, 0)).toBe("$10,000,000");
  });
});

describe("snapshot", () => {
  const snap = (over: Partial<ReputationSnapshot["cursor"]> = {}): ReputationSnapshot => ({
    agents: {
      [A]: { score: String(50n * U), level: 1, caught: false, caughtAt: null, lastDisputeId: null, caughtTx: null, settledMarkets: 2 },
      [B]: { score: String(90n * U), level: 1, caught: true, caughtAt: 5, lastDisputeId: "0xd", caughtTx: null, settledMarkets: 1 },
    },
    cursor: {
      version: REPUTATION_CURSOR_VERSION,
      chainId: 5042002,
      contracts: { MarketsPerennial: "0xMP", MarketsV4: "0xV4", Attestation: "0xat", Dispute: "0xdi" },
      fromBlock: "0",
      lastScannedBlock: "100",
      state: {
        agents: {},
        open: {
          [marketKey("0xV4", "0xM1")]: { agent: A, feed: FEED, volume: "0" },
          [marketKey("0xV4", "0xM2")]: { agent: B, feed: FEED, volume: "0" },
          [marketKey("0xMP", "0xM3")]: { agent: A, feed: FEED, volume: "0" },
        },
      },
      challenges: {},
      attesters: {},
      ...over,
    },
  });

  it("accepts a snapshot of this chain and contract", () => {
    expect(snapshotFor(snap(), { chainId: 5042002, market: "0xmp" })).not.toBeNull();
    expect(snapshotFor(snap(), { chainId: 5042002, market: "0xv4" })).not.toBeNull();
  });

  it("falls back to nothing when missing, stale or foreign", () => {
    expect(snapshotFor(undefined, { chainId: 5042002 })).toBeNull();
    expect(snapshotFor({ agents: {} }, { chainId: 5042002 })).toBeNull();
    expect(snapshotFor(snap({ version: REPUTATION_CURSOR_VERSION - 1 }), { chainId: 5042002 })).toBeNull();
    expect(snapshotFor(snap(), { chainId: 5042, market: "0xmp" })).toBeNull();
    expect(snapshotFor(snap(), { chainId: 5042002, market: "0xother" })).toBeNull();
  });

  it("lists the snapshot's open markets of one agent on one feed and contract", () => {
    expect(openMarketsFor(snap(), "0xv4", A, FEED)).toEqual(["0xm1"]);
    expect(openMarketsFor(snap(), "0xmp", A, FEED)).toEqual(["0xm3"]);
    expect(openMarketsFor(null, "0xv4", A, FEED)).toEqual([]);
  });

  it("ranks the leaderboard by score, then settled markets", () => {
    expect(leaderboard(snap()).map((r) => r.agent)).toEqual([B, A]);
    expect(leaderboard(null)).toEqual([]);
  });
});
