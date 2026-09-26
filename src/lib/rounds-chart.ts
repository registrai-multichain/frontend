/**
 * Pure math behind the common-markets charts and live position values.
 *
 * The pool is BinaryMarket's constant-product YES/NO AMM, so its whole history
 * replays exactly from MarketCreated (both reserves = the seed) plus the
 * Bought / Sold logs, and a position's cash-out value is the contract's own
 * sell math run locally on the live reserves (no RPC per repaint).
 */

export const BPS = 10_000n;

export interface Reserves {
  yes: bigint;
  no: bigint;
}

/** A Bought or Sold log, decoded. `collateral` is collateralIn (buy) or collateralOut (sell). */
export interface Trade {
  block: bigint;
  logIndex: number;
  kind: "buy" | "sell";
  /** 0 = Yes (Up), 1 = No (Down). */
  outcome: number;
  collateral: bigint;
  shares: bigint;
  fee: bigint;
}

/** priceOf(Yes) and priceOf(No), 1e18-scaled, exactly as MarketsV4 computes them. */
export function poolPrices(r: Reserves): { yesPrice: bigint; noPrice: bigint } {
  const total = r.yes + r.no;
  if (total === 0n) return { yesPrice: 0n, noPrice: 0n };
  return { yesPrice: (r.no * 10n ** 18n) / total, noPrice: (r.yes * 10n ** 18n) / total };
}

/** Up's implied probability (0..1): priceOf(Yes) = no / (yes + no). */
export function upProbability(r: Reserves): number {
  const total = r.yes + r.no;
  return total === 0n ? 0.5 : Number((r.no * 1_000_000n) / total) / 1_000_000;
}

/** Apply one trade to the reserves, exactly as BinaryMarket does. */
export function applyTrade(r: Reserves, t: Trade): Reserves {
  if (t.kind === "buy") {
    const eff = t.collateral - t.fee;
    const yes = r.yes + eff;
    const no = r.no + eff;
    return t.outcome === 0 ? { yes: yes - t.shares, no } : { yes, no: no - t.shares };
  }
  const gross = t.collateral + t.fee;
  const yes = (t.outcome === 0 ? r.yes + t.shares : r.yes) - gross;
  const no = (t.outcome === 1 ? r.no + t.shares : r.no) - gross;
  return { yes, no };
}

const order = (a: Trade, b: Trade) => (a.block !== b.block ? (a.block < b.block ? -1 : 1) : a.logIndex - b.logIndex);

/** The pool after each trade, from the seed: [{block, reserves, up}], opening point first. */
export function replayPool(
  liquidity: bigint,
  openBlock: bigint,
  trades: readonly Trade[],
): Array<{ block: bigint; reserves: Reserves; up: number }> {
  let r: Reserves = { yes: liquidity, no: liquidity };
  const out = [{ block: openBlock, reserves: r, up: upProbability(r) }];
  for (const t of [...trades].sort(order)) {
    r = applyTrade(r, t);
    out.push({ block: t.block, reserves: r, up: upProbability(r) });
  }
  return out;
}

/** Integer square root, rounded up (OpenZeppelin Math.sqrt(x, Ceil)). */
export function sqrtCeil(x: bigint): bigint {
  if (x < 0n) throw new Error("sqrt of a negative");
  if (x < 2n) return x;
  let z = x;
  let y = (x >> 1n) + 1n;
  while (y < z) {
    z = y;
    y = (x / y + y) >> 1n;
  }
  return z * z < x ? z + 1n : z;
}

/** What selling `shares` of `outcome` pays now (net of the fee), and the pool
 *  after: BinaryMarket._sellMath. 0 when the curve pays nothing. */
export function sellQuote(r: Reserves, outcome: number, shares: bigint, feeBps: bigint): { out: bigint; after: Reserves } {
  if (shares <= 0n) return { out: 0n, after: r };
  const a = outcome === 0 ? r.yes + shares : r.yes;
  const b = outcome === 1 ? r.no + shares : r.no;
  const sum = a + b;
  const disc = sum * sum - 4n * (a * b - r.yes * r.no);
  const gross = (sum - sqrtCeil(disc)) / 2n;
  if (gross <= 0n) return { out: 0n, after: r };
  const fee = (gross * feeBps) / BPS;
  return { out: gross - fee, after: { yes: a - gross, no: b - gross } };
}

/** A holding's cash-out value now: sell the Up shares, then the Down shares, on
 *  the live pool (what two sells in a row would pay). */
export function cashOutValue(r: Reserves, hold: { yes: bigint; no: bigint }, feeBps: bigint): bigint {
  const s1 = sellQuote(r, 0, hold.yes, feeBps);
  const s2 = sellQuote(s1.after, 1, hold.no, feeBps);
  return s1.out + s2.out;
}

/** Profit and loss of a value against a cost basis, in collateral units and percent. */
export function pnl(value: bigint, cost: bigint): { diff: bigint; pct: number } {
  const diff = value - cost;
  return { diff, pct: cost === 0n ? 0 : (Number(diff) / Number(cost)) * 100 };
}

// ───────────────────────────── drawing ─────────────────────────────

export interface Pt {
  x: number;
  y: number;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * A smooth SVG path through the points: monotone cubic interpolation
 * (Fritsch–Carlson), so the curve never overshoots the data (a price line that
 * dips below its real low would lie). Points must be sorted by x.
 */
export function smoothPath(pts: readonly Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    m[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = a * a + b * b;
    if (h > 9) {
      const s = 3 / Math.sqrt(h);
      t[i] = s * a * m[i];
      t[i + 1] = s * b * m[i];
    }
  }
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(pts[i].x + h)},${f(pts[i].y + t[i] * h)},${f(pts[i + 1].x - h)},${f(pts[i + 1].y - t[i + 1] * h)},${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

/** A step path (each value holds until the next point): how pool odds move. */
export function stepPath(pts: readonly Pt[]): string {
  if (pts.length === 0) return "";
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) d += `H${f(pts[i].x)}V${f(pts[i].y)}`;
  return d;
}

/** About `count` round tick values spanning [min, max]. */
export function niceTicks(min: number, max: number, count = 3): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Average a price series into `bucketSecs` buckets (one point per bucket that
 *  has ticks, at the bucket's mean time): raw ticker prints come in flat runs
 *  and jumps, which a smooth curve would draw as stairs. */
export function resample(s: readonly { t: number; p: number }[], bucketSecs: number): Array<{ t: number; p: number }> {
  const out: Array<{ t: number; p: number }> = [];
  let key = NaN;
  let n = 0;
  let st = 0;
  let sp = 0;
  const flush = () => {
    if (n) out.push({ t: st / n, p: sp / n });
  };
  for (const q of s) {
    const k = Math.floor(q.t / bucketSecs);
    if (k !== key) {
      flush();
      key = k;
      n = 0;
      st = 0;
      sp = 0;
    }
    n++;
    st += q.t;
    sp += q.p;
  }
  flush();
  return out;
}

/** Keep the last `keepSecs` of a time series (and at least its last point). */
export function trimSeries<T extends { t: number }>(s: readonly T[], now: number, keepSecs: number): T[] {
  const from = now - keepSecs;
  const i = s.findIndex((p) => p.t >= from);
  if (i === -1) return s.length ? [s[s.length - 1]] : [];
  return s.slice(Math.max(0, i - 1));
}
