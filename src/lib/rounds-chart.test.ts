import { describe, expect, test } from "vitest";
import {
  applyTrade,
  BAND_LABEL_Y,
  IN_PLAY_LABEL_W,
  NEXT_ROUND_LABEL_W,
  inPlayBand,
  labelWidth,
  overlaps,
  textBox,
  cashOutValue,
  niceTicks,
  pnl,
  poolPrices,
  replayPool,
  resample,
  sellQuote,
  smoothPath,
  sqrtCeil,
  stepPath,
  trimSeries,
  upProbability,
  type Trade,
} from "./rounds-chart";

const U = 1_000_000n;
const FEE = 100n; // 1%

/** BinaryMarket._buyMath, for building consistent logs. */
function buy(r: { yes: bigint; no: bigint }, outcome: number, collateral: bigint) {
  const fee = (collateral * FEE) / 10_000n;
  const eff = collateral - fee;
  const ya = r.yes + eff;
  const na = r.no + eff;
  const k = r.yes * r.no;
  const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
  if (outcome === 0) {
    const yesAfter = ceil(k, na);
    return { shares: ya - yesAfter, fee, after: { yes: yesAfter, no: na } };
  }
  const noAfter = ceil(k, ya);
  return { shares: na - noAfter, fee, after: { yes: ya, no: noAfter } };
}

describe("pool replay", () => {
  test("poolPrices mirrors priceOf (floored, 1e18)", () => {
    expect(poolPrices({ yes: 5n * U, no: 5n * U })).toEqual({ yesPrice: 5n * 10n ** 17n, noPrice: 5n * 10n ** 17n });
    expect(poolPrices({ yes: 3n, no: 1n })).toEqual({ yesPrice: 250_000_000_000_000_000n, noPrice: 750_000_000_000_000_000n });
    expect(poolPrices({ yes: 0n, no: 0n })).toEqual({ yesPrice: 0n, noPrice: 0n });
  });

  test("a fresh pool is 50/50", () => {
    expect(upProbability({ yes: 5n * U, no: 5n * U })).toBe(0.5);
  });

  test("buys and a sell replay to the contract's reserves exactly", () => {
    let r = { yes: 5n * U, no: 5n * U };
    const b1 = buy(r, 0, 8n * U);
    r = b1.after;
    const b2 = buy(r, 1, 6n * U);
    r = b2.after;
    const s = sellQuote(r, 0, b1.shares / 2n, FEE);
    const sellFee = (() => {
      // recover the fee the way the contract emits it: fee = gross * bps / BPS, out = gross - fee
      const a = r.yes + b1.shares / 2n;
      const b = r.no;
      const sum = a + b;
      const g = (sum - sqrtCeil(sum * sum - 4n * (a * b - r.yes * r.no))) / 2n;
      return (g * FEE) / 10_000n;
    })();
    const trades: Trade[] = [
      { block: 10n, logIndex: 0, kind: "buy", outcome: 0, collateral: 8n * U, shares: b1.shares, fee: b1.fee },
      { block: 12n, logIndex: 1, kind: "sell", outcome: 0, collateral: s.out, shares: b1.shares / 2n, fee: sellFee },
      { block: 12n, logIndex: 0, kind: "buy", outcome: 1, collateral: 6n * U, shares: b2.shares, fee: b2.fee },
    ];
    const pts = replayPool(5n * U, 9n, trades);
    expect(pts.map((p) => p.block)).toEqual([9n, 10n, 12n, 12n]);
    expect(pts[1].up).toBeGreaterThan(0.5);
    expect(pts[3].reserves).toEqual(s.after);
  });

  test("applyTrade: a buy mints both sides then pays out the bought side", () => {
    const r = { yes: 5n * U, no: 5n * U };
    const b = buy(r, 1, 2n * U);
    expect(applyTrade(r, { block: 1n, logIndex: 0, kind: "buy", outcome: 1, collateral: 2n * U, shares: b.shares, fee: b.fee })).toEqual(b.after);
  });
});

describe("position value", () => {
  test("sqrtCeil", () => {
    expect([0n, 1n, 2n, 4n, 5n, 99n, 100n, 101n].map(sqrtCeil)).toEqual([0n, 1n, 2n, 2n, 3n, 10n, 10n, 11n]);
    expect(sqrtCeil(10n ** 36n + 1n)).toBe(10n ** 18n + 1n);
  });

  test("selling back what was just bought returns a little less than paid (two fees)", () => {
    const r = { yes: 5n * U, no: 5n * U };
    const b = buy(r, 0, 4n * U);
    const back = sellQuote(b.after, 0, b.shares, FEE).out;
    expect(back).toBeLessThan(4n * U);
    expect(back).toBeGreaterThan((4n * U * 97n) / 100n);
  });

  test("cash-out of both sides; nothing held is worth nothing", () => {
    const r = { yes: 7n * U, no: 4n * U };
    expect(cashOutValue(r, { yes: 0n, no: 0n }, FEE)).toBe(0n);
    const both = cashOutValue(r, { yes: U, no: U }, FEE);
    const yesOnly = sellQuote(r, 0, U, FEE).out;
    expect(both).toBeGreaterThan(yesOnly);
  });

  test("pnl", () => {
    expect(pnl(12n * U, 10n * U)).toEqual({ diff: 2n * U, pct: 20 });
    expect(pnl(0n, 0n)).toEqual({ diff: 0n, pct: 0 });
  });
});

describe("drawing", () => {
  test("smoothPath passes through every point and never overshoots a flat run", () => {
    const d = smoothPath([
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith("M0,10C")).toBe(true);
    expect(d.endsWith(",20,0")).toBe(true);
    // the flat segment's control points stay at y = 10
    expect(d).toContain("C3.33,10,6.67,10,10,10");
  });

  test("smoothPath edge cases", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 1, y: 2 }])).toBe("M1,2");
  });

  test("stepPath holds each value until the next point", () => {
    expect(stepPath([{ x: 0, y: 50 }, { x: 10, y: 40 }, { x: 20, y: 45 }])).toBe("M0,50H10V40H20V45");
  });

  test("niceTicks", () => {
    expect(niceTicks(80_101, 80_390, 3)).toEqual([80_200, 80_300]);
    expect(niceTicks(0, 100, 2)).toEqual([0, 50, 100]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  test("resample averages each bucket", () => {
    const s = [{ t: 0, p: 10 }, { t: 1, p: 10 }, { t: 3, p: 13 }, { t: 4, p: 20 }, { t: 9, p: 30 }];
    expect(resample(s, 4)).toEqual([{ t: 4 / 3, p: 11 }, { t: 4, p: 20 }, { t: 9, p: 30 }]);
    expect(resample([], 4)).toEqual([]);
  });

  test("trimSeries keeps the window plus one point before it", () => {
    const s = [1, 2, 3, 4, 5].map((t) => ({ t: t * 10 }));
    expect(trimSeries(s, 50, 15).map((p) => p.t)).toEqual([30, 40, 50]);
    expect(trimSeries(s, 500, 15).map((p) => p.t)).toEqual([50]);
  });
});

describe("inPlayBand", () => {
  // a 400 px card chart: 324 px of plot, 76 px of right axis
  const W = 324;
  const SVG = 400;

  test("a round wholly on the plot draws as is, labels beside their edges", () => {
    expect(inPlayBand(100, 250, W, SVG)).toMatchObject({
      x: 100, w: 150, endX: 250,
      inPlay: { x: 104, anchor: "start" },
      next: { x: 254, anchor: "start" },
    });
  });

  test("a round whose end is past the plot is clamped to it, with no end line or next-round label", () => {
    const b = inPlayBand(290, 700, W, SVG);
    expect(b.x).toBe(290);
    expect(b.x + b.w).toBe(W);
    expect(b.endX).toBeNull();
    expect(b.next).toBeNull();
    // too little room right of the start: the label is right-aligned inside the plot
    expect(b.inPlay).toMatchObject({ x: W - 4, anchor: "end" });
  });

  test("nothing ever reaches past the plot (band, in-play label) or the chart (next-round label)", () => {
    for (const plot of [150, 230, 324, 800]) {
      const svg = plot + 76;
      for (let start = -200; start <= plot + 200; start += 7) {
        for (const len of [0, 5, 40, 120, 600]) {
          const b = inPlayBand(start, start + len, plot, svg);
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(plot);
          if (b.inPlay) {
            const [l, r] = b.inPlay.anchor === "start" ? [b.inPlay.x, b.inPlay.x + IN_PLAY_LABEL_W] : [b.inPlay.x - IN_PLAY_LABEL_W, b.inPlay.x];
            expect(l).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThanOrEqual(plot);
          }
          if (b.endX !== null) expect(b.endX).toBeLessThanOrEqual(plot);
          if (b.next) {
            const [l, r] = b.next.anchor === "start" ? [b.next.x, b.next.x + NEXT_ROUND_LABEL_W] : [b.next.x - NEXT_ROUND_LABEL_W, b.next.x];
            expect(l).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThanOrEqual(svg);
          }
        }
      }
    }
  });

  test("a round off the plot draws nothing", () => {
    expect(inPlayBand(-300, -100, W, SVG)).toMatchObject({ w: 0, endX: null, inPlay: null, next: null });
  });

  test("\"in play\" keeps off the price-to-beat caption: moved to the band's right edge, else left out", () => {
    // a 390 px phone card (plot ~238 px), the price to beat near the top of the range
    const plot = 238;
    const svg = plot + 76;
    const caption = textBox(4, 16, labelWidth("price to beat 84,732.87"));
    const free = inPlayBand(120, 238, plot, svg);
    expect(free.inPlay).toMatchObject({ x: 124, anchor: "start" });
    expect(overlaps(caption, free.inPlay!.box)).toBe(true);
    // wide band: right-aligned at its right edge, clear of the caption
    const moved = inPlayBand(120, 238, plot, svg, [caption]);
    expect(moved.inPlay).toMatchObject({ x: 234, anchor: "end" });
    expect(overlaps(caption, moved.inPlay!.box)).toBe(false);
    // band too short to get clear: left out
    expect(inPlayBand(120, 170, plot, svg, [caption]).inPlay).toBeNull();
    // caption lower down: the label stays at the band's start
    expect(inPlayBand(120, 238, plot, svg, [textBox(4, 90, labelWidth("price to beat 84,732.87"))]).inPlay).toMatchObject({ x: 124 });
  });

  test("the next-round label keeps off the live price tag", () => {
    const tagAtTop = { x0: W + 2, y0: 4, x1: SVG - 2, y1: 22 };
    expect(inPlayBand(100, 320, W, SVG).next).toMatchObject({ x: 324, anchor: "start" });
    // the tag covers the right side: it falls back to the left of the line, clear of the tag
    const b = inPlayBand(100, 320, W, SVG, [tagAtTop]);
    expect(b.next).toMatchObject({ x: 316, anchor: "end" });
    expect(overlaps(b.next!.box, tagAtTop)).toBe(false);
  });

  test("label boxes", () => {
    expect(textBox(10, BAND_LABEL_Y, 40)).toEqual({ x0: 10, y0: 3, x1: 50, y1: 16 });
    expect(textBox(50, BAND_LABEL_Y, 40, "end")).toEqual({ x0: 10, y0: 3, x1: 50, y1: 16 });
    expect(overlaps({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 10, y0: 0, x1: 20, y1: 10 })).toBe(false);
    expect(overlaps({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 9, y0: 9, x1: 20, y1: 20 })).toBe(true);
  });
});
