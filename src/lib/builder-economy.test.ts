import { describe, expect, test } from "vitest";
import {
  LAUNCH_SCHEDULE,
  MAX_UINT128,
  durationText,
  effectiveRate,
  formatUsd,
  epochAt,
  epochEnd,
  epochState,
  marginalRateBps,
  progressiveTax,
  scheduleProblem,
  seasonCap,
  splitIncome,
  taxTable,
  toBrackets,
  type Bracket,
} from "./builder-economy";

const $ = (n: number | bigint) => BigInt(n) * 1_000_000n;

describe("progressiveTax (the contract's marginal tax, floored per slice)", () => {
  test("the spec's examples: $800 -> $0; $60,000 -> $11,900", () => {
    expect(progressiveTax($(800), LAUNCH_SCHEDULE)).toBe(0n);
    expect(progressiveTax($(60_000), LAUNCH_SCHEDULE)).toBe($(11_900));
  });
  test("bracket edges", () => {
    expect(progressiveTax(0n, LAUNCH_SCHEDULE)).toBe(0n);
    expect(progressiveTax($(1_000), LAUNCH_SCHEDULE)).toBe(0n);
    expect(progressiveTax($(1_000) + 1n, LAUNCH_SCHEDULE)).toBe(0n); // 1 unit * 10% floors to 0
    expect(progressiveTax($(1_000) + 10n, LAUNCH_SCHEDULE)).toBe(1n);
    expect(progressiveTax($(10_000), LAUNCH_SCHEDULE)).toBe($(900));
    expect(progressiveTax($(10_000) + 5n, LAUNCH_SCHEDULE)).toBe($(900) + 1n); // 5 * 20% = 1
    expect(progressiveTax($(50_000), LAUNCH_SCHEDULE)).toBe($(8_900));
    expect(progressiveTax($(50_000) + 4n, LAUNCH_SCHEDULE)).toBe($(8_900) + 1n); // 4 * 30% = 1.2 -> 1
    expect(progressiveTax($(1_000_000), LAUNCH_SCHEDULE)).toBe($(8_900) + $(285_000));
  });
  test("floors each slice separately (not the total)", () => {
    // slices: 1000 (0%), 9 units at 10% -> 0.9 floors to 0
    expect(progressiveTax($(1_000) + 9n, LAUNCH_SCHEDULE)).toBe(0n);
    const b: Bracket[] = [{ upTo: 3n, rateBps: 0 }, { upTo: 13n, rateBps: 1_500 }, { upTo: MAX_UINT128, rateBps: 3_333 }];
    // (13-3)*1500/1e4 = 1.5 -> 1 ; (20-13)*3333/1e4 = 2.33 -> 2 ; total 3 (the unfloored sum would be 3.83)
    expect(progressiveTax(20n, b)).toBe(3n);
  });
  test("income above the last bound is taxed at the last rate; one bracket works", () => {
    expect(progressiveTax(MAX_UINT128 + 10_000n, [{ upTo: MAX_UINT128, rateBps: 0 }])).toBe(0n);
    expect(progressiveTax($(5), [{ upTo: MAX_UINT128, rateBps: 1_000 }])).toBe(500_000n);
  });
  test("earning more never lowers take-home", () => {
    let prev = -1n;
    for (let g = 0n; g <= $(70_000); g += 997_123_457n) {
      const net = splitIncome(g, LAUNCH_SCHEDULE).net;
      expect(net).toBeGreaterThanOrEqual(prev);
      prev = net;
    }
  });
});

describe("splitIncome (claimFor's gross -> tax / fee / net)", () => {
  test("1% fee on the after-tax income, floored; net takes the rest", () => {
    expect(splitIncome($(60_000), LAUNCH_SCHEDULE)).toEqual({ gross: $(60_000), tax: $(11_900), fee: $(481), net: $(47_619) });
    expect(splitIncome($(800), LAUNCH_SCHEDULE)).toEqual({ gross: $(800), tax: 0n, fee: $(8), net: $(792) });
    const s = splitIncome(12_345n, LAUNCH_SCHEDULE);
    expect(s).toEqual({ gross: 12_345n, tax: 0n, fee: 123n, net: 12_222n });
    expect(s.tax + s.fee + s.net).toBe(s.gross);
    expect(splitIncome(0n, LAUNCH_SCHEDULE)).toEqual({ gross: 0n, tax: 0n, fee: 0n, net: 0n });
  });
  test("effective rate", () => {
    expect(effectiveRate(splitIncome($(60_000), LAUNCH_SCHEDULE))).toBeCloseTo(0.198333, 5);
    expect(effectiveRate({ gross: 0n, tax: 0n })).toBe(0);
  });
});

describe("marginal rate", () => {
  test("the bracket the next dollar falls in; a bound belongs to the lower bracket", () => {
    expect(marginalRateBps(0n, LAUNCH_SCHEDULE)).toBe(0);
    expect(marginalRateBps($(999), LAUNCH_SCHEDULE)).toBe(0);
    expect(marginalRateBps($(1_000), LAUNCH_SCHEDULE)).toBe(1_000);
    expect(marginalRateBps($(49_999), LAUNCH_SCHEDULE)).toBe(2_000);
    expect(marginalRateBps($(50_000), LAUNCH_SCHEDULE)).toBe(3_000);
    expect(marginalRateBps($(9_999_999), LAUNCH_SCHEDULE)).toBe(3_000);
  });
});

describe("schedule display + rules", () => {
  test("the launch table", () => {
    expect(taxTable(LAUNCH_SCHEDULE)).toEqual([
      { from: 0n, to: $(1_000), rateBps: 0, bracketTax: 0n },
      { from: $(1_000), to: $(10_000), rateBps: 1_000, bracketTax: $(900) },
      { from: $(10_000), to: $(50_000), rateBps: 2_000, bracketTax: $(8_000) },
      { from: $(50_000), to: null, rateBps: 3_000, bracketTax: null },
    ]);
  });
  test("viem tuples normalise; the launch schedule passes the contract's bounds", () => {
    expect(toBrackets([{ upTo: 5n, rateBps: 7 }])).toEqual([{ upTo: 5n, rateBps: 7 }]);
    expect(scheduleProblem(LAUNCH_SCHEDULE)).toBeNull();
    expect(scheduleProblem([{ upTo: $(50), rateBps: 0 }, { upTo: MAX_UINT128, rateBps: 100 }])).toMatch(/\$100/);
    expect(scheduleProblem([{ upTo: $(100), rateBps: 0 }, { upTo: MAX_UINT128, rateBps: 4_001 }])).toMatch(/40%/);
    expect(scheduleProblem([{ upTo: $(100), rateBps: 0 }, { upTo: $(200), rateBps: 500 }, { upTo: MAX_UINT128, rateBps: 100 }])).toMatch(/decrease/);
    expect(scheduleProblem([{ upTo: $(100), rateBps: 0 }])).toMatch(/unbounded/);
  });
});

describe("epochs and seasons", () => {
  test("epochAt / epochEnd mirror the fund", () => {
    const start = 1_000n;
    const len = 100n;
    expect(epochAt(1_000n, start, len)).toBe(0n);
    expect(epochAt(1_099n, start, len)).toBe(0n);
    expect(epochAt(1_100n, start, len)).toBe(1n);
    expect(epochEnd(0n, start, len)).toBe(1_100n);
    expect(epochEnd(4n, start, len)).toBe(1_500n);
  });
  test("epoch states", () => {
    expect(epochState({ claimed: false, ended: false })).toBe("open");
    expect(epochState({ claimed: false, ended: true })).toBe("claimable");
    expect(epochState({ claimed: true, ended: true })).toBe("claimed");
    expect(epochState({ claimed: true, ended: true, swept: true })).toBe("swept");
  });
  test("season cap is 20% of the total, floored", () => {
    expect(seasonCap($(1_000))).toBe($(200));
    expect(seasonCap(9n)).toBe(1n);
  });
  test("dollar formatting", () => {
    expect(formatUsd($(11_900))).toBe("$11,900");
    expect(formatUsd($(1_234_567) + 500_000n)).toBe("$1,234,567.5");
    expect(formatUsd(123n, 6)).toBe("$0.000123");
    expect(formatUsd(0n)).toBe("$0");
  });
  test("duration text", () => {
    expect(durationText(90_061)).toBe("1d 1h");
    expect(durationText(3_660)).toBe("1h 1m");
    expect(durationText(30)).toBe("1m");
    expect(durationText(0)).toBe("0m");
  });
});
