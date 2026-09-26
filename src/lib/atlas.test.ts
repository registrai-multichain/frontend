import { describe, it, expect } from "vitest";
import {
  aggregateByCountry,
  atlasView,
  densityBucket,
  impliedYes,
  marketsForBuilders,
  MIN_BUILDERS_PER_CELL,
} from "./atlas";
import type { BuilderAggregate, PerennialMarket } from "./atlas";

const b = (
  id: number,
  country: string | null,
  progress = 0,
  volume = 0n,
): BuilderAggregate => ({
  builderId: id,
  address: `0x${id.toString(16).padStart(40, "0")}`,
  lifetimeProgress: progress,
  volume,
  country,
});

describe("aggregateByCountry", () => {
  it("sums builders, progress and volume per country", () => {
    const cells = aggregateByCountry([
      b(1, "DE", 7, 100n),
      b(2, "DE", 3, 50n),
      b(3, "DE", 0, 0n),
    ]);
    const de = cells.find((c) => c.code === "DE")!;
    expect(de.builders).toBe(3);
    expect(de.progress).toBe(10);
    expect(de.volume).toBe(150n);
  });

  it("suppresses countries below the small-n floor", () => {
    const cells = aggregateByCountry([b(1, "DE", 7, 100n)]);
    expect(cells.find((c) => c.code === "DE")).toBeUndefined();
    const unattributed = cells.find((c) => c.code === "??")!;
    expect(unattributed.suppressed).toBe(true);
    expect(unattributed.builders).toBe(1);
  });

  it("buckets builders with no declared country as unattributed", () => {
    const cells = aggregateByCountry([b(1, null), b(2, null), b(3, null)]);
    expect(cells.find((c) => c.code === "??")!.builders).toBe(3);
  });
});

describe("densityBucket", () => {
  it("returns 0 for no builders", () => {
    expect(densityBucket(0, 100)).toBe(0);
  });

  it("returns the top bucket for the densest country", () => {
    expect(densityBucket(100, 100)).toBe(4);
  });

  it("is non-linear so one dominant country does not flatten the rest", () => {
    // Linear would put 10-of-100 in bucket 0; a log scale must lift it clear.
    expect(densityBucket(10, 100)).toBeGreaterThan(1);
  });

  it("never exceeds the top bucket", () => {
    expect(densityBucket(1000, 100)).toBe(4);
  });
});

describe("MIN_BUILDERS_PER_CELL", () => {
  it("is 3", () => {
    expect(MIN_BUILDERS_PER_CELL).toBe(3);
  });
});

const mkt = (id: string, builderId: number, yes = 100n, no = 100n): PerennialMarket => ({
  marketId: id,
  builderId,
  expiry: 0,
  phase: "trading",
  yesWon: false,
  yesReserve: yes.toString(),
  noReserve: no.toString(),
});

describe("impliedYes", () => {
  it("is 0.5 for a balanced book", () => {
    expect(impliedYes(100n, 100n)).toBeCloseTo(0.5);
  });

  it("rises as the YES reserve is drained by buying", () => {
    // Buying YES removes from yesReserve, so a small yesReserve means a high
    // implied probability: P(yes) = no / (yes + no).
    expect(impliedYes(50n, 200n)).toBeCloseTo(0.8);
  });

  it("returns 0.5 for an empty market rather than dividing by zero", () => {
    expect(impliedYes(0n, 0n)).toBe(0.5);
  });
});

describe("marketsForBuilders", () => {
  it("keeps only markets belonging to the given builders", () => {
    const out = marketsForBuilders([mkt("0xa", 1), mkt("0xb", 2)], [1]);
    expect(out.map((m) => m.marketId)).toEqual(["0xa"]);
  });

  it("returns an empty array when no builder matches", () => {
    expect(marketsForBuilders([mkt("0xa", 1)], [9])).toEqual([]);
  });
});

describe("atlasView (empty state)", () => {
  it("no builders: the globe shows its message and no boards", () => {
    expect(atlasView(0, 0)).toEqual({ emptyGlobe: true, showBoards: false });
  });
  it("builders but nothing scored this season: the globe fills in, the boards wait", () => {
    expect(atlasView(4, 0)).toEqual({ emptyGlobe: false, showBoards: false });
  });
  it("the first verified progress brings the boards", () => {
    expect(atlasView(4, 1)).toEqual({ emptyGlobe: false, showBoards: true });
  });
});
