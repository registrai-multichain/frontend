import { describe, it, expect } from "vitest";
import { aggregateByCountry, densityBucket, MIN_BUILDERS_PER_CELL } from "./atlas";
import type { BuilderAggregate } from "./atlas";

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
