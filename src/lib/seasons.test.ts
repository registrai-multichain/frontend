import { describe, it, expect } from "vitest";
import {
  builderBoard,
  OUTCOME_YES,
  countryBoard,
  rank,
  realisedPnl,
  seasonAt,
  traderBoard, SEASON_ONE_START, seasonStatus } from "./seasons";
import type { Season, SeasonProgress, Trade } from "./seasons";

const S1: Season = { id: 1, label: "S1", startBlock: 100, endBlock: 199, startedAt: 0, endsAt: 1 };
const S2: Season = { id: 2, label: "S2", startBlock: 200, endBlock: null, startedAt: 1, endsAt: 2 };
const SEASONS = [S1, S2];

let seq = 0;
const buy = (block: number, trader: string, outcome: number, collateral: bigint, shares: bigint, marketId = "m1"): Trade =>
  ({ kind: "buy", block, seq: seq++, trader, marketId, outcome, collateral, shares });
const sell = (block: number, trader: string, outcome: number, collateral: bigint, shares: bigint, marketId = "m1"): Trade =>
  ({ kind: "sell", block, seq: seq++, trader, marketId, outcome, collateral, shares });
const resolve = (block: number, yesWon: boolean, marketId = "m1"): Trade =>
  ({ kind: "resolve", block, seq: seq++, marketId, yesWon });

describe("seasonAt", () => {
  it("places a block inside its season", () => {
    expect(seasonAt(150, SEASONS)?.id).toBe(1);
    expect(seasonAt(500, SEASONS)?.id).toBe(2);
  });

  it("treats a running season as open ended", () => {
    expect(seasonAt(9_999_999, SEASONS)?.id).toBe(2);
  });

  it("returns null before the first season", () => {
    expect(seasonAt(1, SEASONS)).toBeNull();
  });

  it("includes both boundaries", () => {
    expect(seasonAt(100, SEASONS)?.id).toBe(1);
    expect(seasonAt(199, SEASONS)?.id).toBe(1);
  });
});

describe("realisedPnl", () => {
  it("books nothing for an open position", () => {
    const out = realisedPnl([buy(110, "alice", 1, 100n, 180n)], SEASONS);
    expect(out.get(1)).toBeUndefined();
  });

  it("books a winning resolution as shares minus cost", () => {
    const out = realisedPnl([buy(110, "alice", 0, 100n, 180n), resolve(150, true)], SEASONS);
    expect(out.get(1)?.get("alice")).toBe(80n);
  });

  it("books the whole cost as a loss on the losing side", () => {
    const out = realisedPnl([buy(110, "bob", 1, 100n, 180n), resolve(150, true)], SEASONS);
    expect(out.get(1)?.get("bob")).toBe(-100n);
  });

  it("books a loss even though the holder never redeemed", () => {
    // There is no Redeemed event here at all — resolution alone settles it.
    const out = realisedPnl([buy(110, "bob", 1, 250n, 400n), resolve(160, true)], SEASONS);
    expect(out.get(1)?.get("bob")).toBe(-250n);
  });

  it("uses average cost when selling part of a position", () => {
    // 100 for 100 shares, then 300 for 100 shares => average 2 per share.
    // Selling 100 shares for 250 realises 250 - 200 = 50.
    const out = realisedPnl(
      [buy(110, "alice", 0, 100n, 100n), buy(120, "alice", 0, 300n, 100n), sell(130, "alice", 0, 250n, 100n)],
      SEASONS,
    );
    expect(out.get(1)?.get("alice")).toBe(50n);
  });

  it("leaves the remaining basis behind after a partial sell", () => {
    const out = realisedPnl(
      [
        buy(110, "alice", 0, 400n, 200n),
        sell(120, "alice", 0, 150n, 100n), // realises 150 - 200 = -50
        resolve(130, true), //                100 shares left, basis 200 => -100
      ],
      SEASONS,
    );
    expect(out.get(1)?.get("alice")).toBe(-150n);
  });

  it("books each realisation to the season it happened in", () => {
    const out = realisedPnl(
      [buy(110, "alice", 0, 100n, 200n), sell(120, "alice", 0, 60n, 100n), resolve(250, true)],
      SEASONS,
    );
    expect(out.get(1)?.get("alice")).toBe(10n); // 60 - 50
    expect(out.get(2)?.get("alice")).toBe(50n); // 100 shares - 50 basis
  });

  it("is insensitive to the order events arrive in", () => {
    const events = [buy(110, "a", 0, 100n, 100n), buy(120, "a", 0, 300n, 100n), sell(130, "a", 0, 250n, 100n)];
    const forward = realisedPnl(events, SEASONS).get(1)?.get("a");
    const backward = realisedPnl([...events].reverse(), SEASONS).get(1)?.get("a");
    expect(backward).toBe(forward);
  });

  it("keeps separate markets separate", () => {
    const out = realisedPnl(
      [buy(110, "a", 0, 100n, 200n, "m1"), buy(110, "a", 0, 100n, 200n, "m2"), resolve(150, true, "m1")],
      SEASONS,
    );
    expect(out.get(1)?.get("a")).toBe(100n); // only m1 settled
  });

  it("ignores trades before any season began", () => {
    const out = realisedPnl([buy(5, "a", 0, 100n, 200n), resolve(50, true)], SEASONS);
    expect(out.size).toBe(0);
  });

  it("does not invent a basis for shares it never saw bought", () => {
    const out = realisedPnl([sell(110, "ghost", 0, 90n, 100n)], SEASONS);
    expect(out.get(1)?.get("ghost")).toBe(90n);
  });
});

describe("rank", () => {
  const rows = [
    { key: "a", label: "a", value: 5n },
    { key: "b", label: "b", value: 50n },
    { key: "c", label: "c", value: 0n },
  ];

  it("orders by value descending", () => {
    expect(rank(rows).map((r) => r.key)).toEqual(["b", "a"]);
  });

  it("drops entries that scored nothing", () => {
    expect(rank(rows).some((r) => r.key === "c")).toBe(false);
  });

  it("keeps negative scores, which are a real result", () => {
    expect(rank([{ key: "a", label: "a", value: -9n }])).toHaveLength(1);
  });

  it("breaks ties stably rather than by input order", () => {
    const tied = [
      { key: "z", label: "z", value: 1n },
      { key: "a", label: "a", value: 1n },
    ];
    expect(rank(tied).map((r) => r.key)).toEqual(["a", "z"]);
    expect(rank([...tied].reverse()).map((r) => r.key)).toEqual(["a", "z"]);
  });

  it("honours the limit", () => {
    expect(rank(rows, 1)).toHaveLength(1);
  });
});

describe("countryBoard", () => {
  const p = (id: number, country: string | null, progress: number): SeasonProgress => ({
    builderId: id,
    address: `0x${id}`,
    country,
    progress,
  });

  it("names a country that clears the disclosure floor", () => {
    const b = countryBoard([p(1, "NG", 10), p(2, "NG", 5), p(3, "NG", 1)]);
    expect(b[0].key).toBe("NG");
    expect(b[0].value).toBe(16n);
  });

  it("never names a country below the floor", () => {
    const b = countryBoard([p(1, "DE", 10), p(2, "DE", 5)]);
    expect(b.some((r) => r.key === "DE")).toBe(false);
  });

  it("folds suppressed countries into unattributed rather than dropping them", () => {
    const b = countryBoard([p(1, "DE", 10), p(2, "BR", 5)]);
    const un = b.find((r) => r.key === "??");
    expect(un?.value).toBe(15n);
    expect(un?.detail).toBe("2 builders");
  });

  it("keeps unattributed last even when it outscores every country", () => {
    const b = countryBoard([p(1, "NG", 1), p(2, "NG", 1), p(3, "NG", 1), p(4, null, 999)]);
    expect(b[b.length - 1].key).toBe("??");
  });

  it("omits unattributed entirely when there is nothing in it", () => {
    const b = countryBoard([p(1, "NG", 3), p(2, "NG", 3), p(3, "NG", 3)]);
    expect(b.some((r) => r.key === "??")).toBe(false);
  });
});

describe("builderBoard", () => {
  it("ranks builders by progress and carries the address", () => {
    const b = builderBoard([
      { builderId: 7, address: "0xaa", country: null, progress: 3 },
      { builderId: 9, address: "0xbb", country: null, progress: 30 },
    ]);
    expect(b.map((r) => r.key)).toEqual(["9", "7"]);
    expect(b[0].detail).toBe("0xbb");
  });
});

describe("traderBoard", () => {
  it("ranks winners above losers", () => {
    const b = traderBoard(new Map([["0xwin", 500n], ["0xlose", -200n]]));
    expect(b.map((r) => r.label)).toEqual(["0xwin", "0xlose"]);
  });
});

import { EMPTY_PNL, foldTrades } from "./seasons";

describe("foldTrades resumability", () => {
  const all: Trade[] = [
    buy(110, "a", 0, 100n, 100n),
    buy(120, "a", 0, 300n, 100n),
    sell(130, "a", 0, 250n, 100n),
    buy(140, "b", 1, 200n, 400n),
    resolve(210, true),
  ];

  it("gives the same answer resumed as replayed cold", () => {
    const cold = foldTrades(EMPTY_PNL, all, SEASONS);
    const half = foldTrades(EMPTY_PNL, all.slice(0, 3), SEASONS);
    const resumed = foldTrades(half, all.slice(3), SEASONS);
    expect(resumed.realised).toEqual(cold.realised);
  });

  it("survives being round-tripped through JSON, as the cursor is", () => {
    const half = JSON.parse(JSON.stringify(foldTrades(EMPTY_PNL, all.slice(0, 3), SEASONS)));
    const resumed = foldTrades(half, all.slice(3), SEASONS);
    expect(resumed.realised).toEqual(foldTrades(EMPTY_PNL, all, SEASONS).realised);
  });

  it("carries an open position across the resume boundary", () => {
    // The buy is in the first batch, the resolution in the second: the basis has
    // to survive in the cursor or the gain is computed against nothing.
    const first = foldTrades(EMPTY_PNL, [buy(110, "c", 0, 40n, 90n)], SEASONS);
    expect(Object.keys(first.positions)).toHaveLength(1);
    const second = foldTrades(first, [resolve(150, true)], SEASONS);
    expect(second.realised["1"]["c"]).toBe("50");
  });

  it("forgets positions once they are closed", () => {
    const done = foldTrades(EMPTY_PNL, [buy(110, "c", 0, 40n, 90n), resolve(150, true)], SEASONS);
    expect(done.positions).toEqual({});
  });
});

import { seasonElapsed, seasonWindows, SEASON_DAYS } from "./seasons";

const DAY = 86_400;

describe("seasonWindows", () => {
  const T0 = 1_700_000_000;

  it("opens season 1 the moment the anchor passes", () => {
    const w = seasonWindows(T0, T0);
    expect(w).toHaveLength(1);
    expect(w[0].id).toBe(1);
  });

  it("adds a season every SEASON_DAYS", () => {
    expect(seasonWindows(T0, T0 + SEASON_DAYS * DAY).map((s) => s.id)).toEqual([1, 2]);
    expect(seasonWindows(T0, T0 + 3 * SEASON_DAYS * DAY - 1).map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it("leaves no gap or overlap between consecutive seasons", () => {
    const w = seasonWindows(T0, T0 + 5 * SEASON_DAYS * DAY);
    for (let i = 1; i < w.length; i++) expect(w[i].startedAt).toBe(w[i - 1].endsAt);
  });

  it("never returns nothing, even for a clock behind the anchor", () => {
    expect(seasonWindows(T0, T0 - 999).map((s) => s.id)).toEqual([1]);
  });
});

describe("seasonElapsed", () => {
  const s = { startedAt: 0, endsAt: 100 };
  it("runs 0 to 1 across the window", () => {
    expect(seasonElapsed(s, 0)).toBe(0);
    expect(seasonElapsed(s, 50)).toBe(0.5);
    expect(seasonElapsed(s, 100)).toBe(1);
  });
  it("clamps outside the window", () => {
    expect(seasonElapsed(s, -10)).toBe(0);
    expect(seasonElapsed(s, 500)).toBe(1);
  });
  it("does not divide by a zero-length season", () => {
    expect(seasonElapsed({ startedAt: 5, endsAt: 5 }, 5)).toBe(1);
  });
});

describe("outcome polarity, anchored to a real Arc trace", () => {
  // MarketsPerennial declares `enum Outcome { Yes, No }`, so 0 is YES. These are
  // the actual logs of market 0xb6e3a706… on Arc testnet:
  //   BUY     blk 62547786  outcome=0  paid 2000000  shares 3407414
  //   RESOLVE blk 62553541  yesWon=true
  //   REDEEM  blk 62553583  payout 3407414
  // The redeem paying out exactly the shares bought under outcome=0 while
  // yesWon is what proves 0 is the winning side here. An inverted mapping turns
  // this trader's +1.407414 into -2.000000, which is what shipped before.
  const REAL: Season[] = [
    { id: 1, label: "S1", startBlock: 62539246, endBlock: null, startedAt: 0, endsAt: 1 },
  ];

  it("books the real trade as a gain, not a loss", () => {
    const out = realisedPnl(
      [
        { kind: "buy", block: 62547786, seq: 0, trader: "0x84c7", marketId: "0xb6e3", outcome: OUTCOME_YES, collateral: 2_000_000n, shares: 3_407_414n },
        { kind: "resolve", block: 62553541, seq: 0, marketId: "0xb6e3", yesWon: true },
      ],
      REAL,
    );
    expect(out.get(1)?.get("0x84c7")).toBe(1_407_414n);
  });

  it("agrees with what redeem() would have paid", () => {
    // redeem() pays 1:1 on the winning balance, so the gain must be
    // payout - cost exactly.
    expect(3_407_414n - 2_000_000n).toBe(1_407_414n);
  });

  it("states that YES is zero", () => {
    expect(OUTCOME_YES).toBe(0);
  });
});

describe("voided markets", () => {
  const voidAt = (block: number, marketId = "m1"): Trade => ({ kind: "void", block, seq: seq++, marketId });

  it("realises half a unit per share, on both sides, less cost", () => {
    // YES bought for 100 -> 180 shares; void pays 90. Realised: -10.
    const out = realisedPnl([buy(110, "a", OUTCOME_YES, 100n, 180n), voidAt(150)], SEASONS);
    expect(out.get(1)?.get("a")).toBe(-10n);
  });

  it("pays the NO side identically", () => {
    const out = realisedPnl([buy(110, "b", 1, 40n, 100n), voidAt(150)], SEASONS);
    expect(out.get(1)?.get("b")).toBe(10n); // 50 - 40
  });

  it("closes every position in the market, so none lingers as open", () => {
    const s = foldTrades(EMPTY_PNL, [buy(110, "a", OUTCOME_YES, 100n, 180n), buy(111, "b", 1, 40n, 100n), voidAt(150)], SEASONS);
    expect(s.positions).toEqual({});
  });

  it("books to the season the void happened in", () => {
    const out = realisedPnl([buy(110, "a", OUTCOME_YES, 100n, 180n), voidAt(250)], SEASONS);
    expect(out.get(1)?.get("a")).toBeUndefined();
    expect(out.get(2)?.get("a")).toBe(-10n);
  });

  it("leaves other markets alone", () => {
    const s = foldTrades(EMPTY_PNL, [buy(110, "a", OUTCOME_YES, 100n, 180n, "m2"), voidAt(150, "m1")], SEASONS);
    expect(Object.keys(s.positions)).toHaveLength(1);
  });

  it("floors an odd share count the way the contract does", () => {
    // redeem pays (yes + no) / 2 in integer division: 181 shares -> 90.
    const out = realisedPnl([buy(110, "a", OUTCOME_YES, 100n, 181n), voidAt(150)], SEASONS);
    expect(out.get(1)?.get("a")).toBe(-10n);
  });
});

describe("voided markets, both sides held", () => {
  it("floors once over the combined position, exactly as redeem does", () => {
    // 101 YES + 100 NO: redeem pays (201) / 2 = 100. Per-side flooring would say 50 + 50.
    const out = realisedPnl(
      [buy(110, "a", OUTCOME_YES, 60n, 101n), buy(111, "a", 1, 50n, 100n), { kind: "void", block: 150, seq: seq++, marketId: "m1" }],
      SEASONS,
    );
    expect(out.get(1)?.get("a")).toBe(100n - 110n);
  });
});

describe("season 1 starts 1 Oct 2026, 00:00 UTC", () => {
  it("the fixed start", () => {
    expect(new Date(SEASON_ONE_START * 1000).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("before the start the calendar holds season 1 as upcoming, 1 Oct – 29 Oct", () => {
    const [s1, ...rest] = seasonWindows(SEASON_ONE_START, SEASON_ONE_START - 5 * 86_400);
    expect(rest).toEqual([]);
    expect(new Date(s1.endsAt * 1000).toISOString()).toBe("2026-10-29T00:00:00.000Z");
    expect(seasonStatus(s1, SEASON_ONE_START - 1)).toBe("upcoming");
    expect(seasonStatus(s1, SEASON_ONE_START)).toBe("running");
    expect(seasonStatus(s1, s1.endsAt)).toBe("ended");
  });
});
