"use client";

/**
 * Live charts for the common markets: a streaming price chart per asset (with
 * the in-play round's price to beat) and the betting round's pool odds.
 *
 * Prices stream from Coinbase Exchange's public WebSocket ticker (one socket for
 * every asset), seeded with the last minutes of 1-minute candles and falling
 * back to polling the REST ticker if the socket is down. They are for reference:
 * a round settles on the agent's on-chain reading.
 *
 * Charts repaint on animation frames: the time axis scrolls continuously, the
 * head eases to each new tick and the value range glides instead of jumping.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { formatPrice } from "@/lib/rounds";
import { niceTicks, resample, smoothPath, stepPath, trimSeries, type Pt } from "@/lib/rounds-chart";

export type Tick = { t: number; p: number };
export type PriceStream = {
  /** Per product: one point per second, the last KEEP_SECS. */
  series: Record<string, Tick[]>;
  /** Per product: the latest price and which way it last moved. */
  last: Record<string, { price: number; dir: "up" | "down" | "flat" }>;
  live: boolean;
};

const KEEP_SECS = 15 * 60;
const WS_URL = "wss://ws-feed.exchange.coinbase.com";
const REST = "https://api.exchange.coinbase.com";

// ───────────────────────────── the stream ─────────────────────────────

export function usePriceStream(products: readonly string[]): PriceStream {
  const series = useRef<Record<string, Tick[]>>({});
  const last = useRef<PriceStream["last"]>({});
  const [snap, setSnap] = useState<PriceStream>({ series: {}, last: {}, live: false });
  const live = useRef(false);
  const key = products.join(",");

  useEffect(() => {
    let alive = true;
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;

    const push = (product: string, p: number, t: number) => {
      if (!(p > 0)) return;
      const s = (series.current[product] ??= []);
      const sec = Math.floor(t);
      if (s.length && Math.floor(s[s.length - 1].t) === sec) s[s.length - 1] = { t, p };
      else if (!s.length || t > s[s.length - 1].t) s.push({ t, p });
      if (s.length > KEEP_SECS + 120) series.current[product] = trimSeries(s, t, KEEP_SECS);
      const prev = last.current[product];
      last.current[product] = {
        price: p,
        dir: !prev || prev.price === p ? prev?.dir ?? "flat" : p > prev.price ? "up" : "down",
      };
      dirty = true;
    };

    // Seed: the last 15 one-minute closes, so the chart is never empty.
    void Promise.all(
      products.map(async (product) => {
        try {
          const r = await fetch(`${REST}/products/${product}/candles?granularity=60`, { cache: "no-store" });
          const rows = (await r.json()) as unknown;
          if (!Array.isArray(rows) || !alive) return;
          const now = Date.now() / 1000;
          const pts = rows
            .filter((x): x is number[] => Array.isArray(x) && x.length >= 5 && Number(x[0]) + 60 >= now - KEEP_SECS)
            .map((x) => ({ t: Math.min(Number(x[0]) + 60, now - 1), p: Number(x[4]) }))
            .sort((a, b) => a.t - b.t);
          const have = series.current[product] ?? [];
          const first = have[0]?.t ?? Infinity;
          series.current[product] = [...pts.filter((q) => q.t < first), ...have];
          if (!last.current[product] && pts.length) last.current[product] = { price: pts[pts.length - 1].p, dir: "flat" };
          dirty = true;
        } catch {
          /* the socket or the poll fills in */
        }
      }),
    );

    const connect = () => {
      if (!alive) return;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        retry = setTimeout(connect, 5_000);
        return;
      }
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: "subscribe", product_ids: products, channels: ["ticker"] }));
        live.current = true;
        dirty = true;
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type?: string; product_id?: string; price?: string; time?: string };
          if (m.type !== "ticker" || !m.product_id) return;
          const t = m.time ? Date.parse(m.time) / 1000 : Date.now() / 1000;
          push(m.product_id, Number(m.price), Math.min(t, Date.now() / 1000));
        } catch {
          /* ignore a malformed frame */
        }
      };
      ws.onclose = () => {
        live.current = false;
        dirty = true;
        if (alive) retry = setTimeout(connect, 3_000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    // Fallback while the socket is down: poll the REST ticker every 2 s.
    const poll = setInterval(async () => {
      if (live.current || document.hidden) return;
      await Promise.all(
        products.map(async (product) => {
          try {
            const r = await fetch(`${REST}/products/${product}/ticker`, { cache: "no-store" });
            const j = (await r.json()) as { price?: string };
            push(product, Number(j.price), Date.now() / 1000);
          } catch {
            /* next poll */
          }
        }),
      );
    }, 2_000);

    // Publish at most 5 times a second (the charts animate between publishes).
    const pub = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      setSnap({ series: { ...series.current }, last: { ...last.current }, live: live.current });
    }, 200);

    return () => {
      alive = false;
      clearTimeout(retry);
      clearInterval(poll);
      clearInterval(pub);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return snap;
}

// ───────────────────────────── animation ─────────────────────────────

type Targets = Record<string, number | undefined>;

/**
 * One animation loop (~30 fps): chain-time `now` (wall clock + `skew`) and each
 * value of `targetsAt(now)` eased toward its target, so the axis scrolls, the
 * head glides to a new tick and the range grows or shrinks smoothly.
 */
function useAnimation(skew: number, targetsAt: (now: number) => Targets, rates: Record<string, number>) {
  const [frame, setFrame] = useState(() => {
    const now = Date.now() / 1000 + skew;
    return { now, v: targetsAt(now) };
  });
  const inputs = useRef({ skew, targetsAt, rates });
  useEffect(() => {
    inputs.current = { skew, targetsAt, rates };
  });
  useEffect(() => {
    let id = 0;
    let lastPaint = 0;
    const cur: Targets = {};
    const loop = (ts: number) => {
      if (ts - lastPaint >= 33) {
        const { skew: sk, targetsAt: at, rates: rs } = inputs.current;
        const now = Date.now() / 1000 + sk;
        const frames = lastPaint ? Math.min(10, (ts - lastPaint) / 33.3) : 1;
        const want = at(now);
        for (const k of Object.keys(want)) {
          const t = want[k];
          const c = cur[k];
          if (t === undefined || !Number.isFinite(t) || c === undefined || !Number.isFinite(c)) {
            cur[k] = t;
          } else {
            const next = t + (c - t) * Math.pow(1 - (rs[k] ?? 0.18), frames);
            cur[k] = Math.abs(next - t) <= Math.abs(t) * 1e-9 ? t : next;
          }
        }
        lastPaint = ts;
        setFrame({ now, v: { ...cur } });
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
  return frame;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (t: number) => {
  const d = new Date(t * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
};

// ───────────────────────────── price chart ─────────────────────────────

const PRICE_RATES = { head: 0.25, lo: 0.12, hi: 0.12 };
const ODDS_RATES = { head: 0.2 };

export function PriceChart({
  series,
  decimals,
  skew = 0,
  startPrice,
  roundStart,
  roundEnd,
  height = 150,
  windowSecs = 9 * 60,
}: {
  series: Tick[] | undefined;
  decimals: number;
  /** Chain time minus wall time, so the boundaries line up with the chain. */
  skew?: number;
  /** The in-play round's price to beat. */
  startPrice?: number;
  roundStart?: number;
  roundEnd?: number;
  height?: number;
  windowSecs?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const [box, width] = useWidth<HTMLDivElement>();
  const tail = 40; // seconds of air to the right of the head

  // What the eased values aim at, for a given now: the latest price, and the
  // visible range (with the price to beat), padded.
  const targetsAt = useCallback(
    (at: number): Targets => {
      const vis = trimSeries(series ?? [], at, windowSecs + 5);
      let lo = Infinity;
      let hi = -Infinity;
      for (const q of vis) {
        if (q.t < at - windowSecs) continue;
        lo = Math.min(lo, q.p);
        hi = Math.max(hi, q.p);
      }
      const last = vis.length ? vis[vis.length - 1].p : undefined;
      if (last !== undefined) {
        lo = Math.min(lo, last);
        hi = Math.max(hi, last);
      }
      if (startPrice !== undefined) {
        lo = Math.min(lo, startPrice);
        hi = Math.max(hi, startPrice);
      }
      if (!Number.isFinite(lo)) return { head: undefined, lo: undefined, hi: undefined };
      const span = Math.max(hi - lo, (hi || 1) * 0.0004);
      return { head: last, lo: lo - span * 0.18, hi: hi + span * 0.18 };
    },
    [series, startPrice, windowSecs],
  );
  const { now, v } = useAnimation(skew, targetsAt, PRICE_RATES);
  const x0 = now - windowSecs;
  const x1 = now + tail;
  // Drawn from 4-second averages (the head eases to the latest print).
  const smoothSeries = useMemo(() => resample(series ?? [], 4), [series]);
  const pts = useMemo(() => trimSeries(smoothSeries, now, windowSecs + 5), [smoothSeries, now, windowSecs]);
  const head = v.head;
  const yLo = v.lo ?? 0;
  const yHi = v.hi ?? 1;

  const padR = 76; // right axis labels
  const padB = 18;
  const W = Math.max(0, width - padR);
  const H = height - padB;
  const X = (t: number) => ((t - x0) / (x1 - x0)) * W;
  const Y = (p: number) => H - ((p - yLo) / (yHi - yLo || 1)) * H;

  const line: Pt[] = [];
  for (const q of pts) if (q.t <= now) line.push({ x: X(q.t), y: Y(q.p) });
  if (head !== undefined) line.push({ x: X(now), y: Y(head) });
  const d = smoothPath(line);
  const area = line.length > 1 ? `${d}L${line[line.length - 1].x},${H}L${line[0].x},${H}Z` : "";

  const above = head !== undefined && startPrice !== undefined ? head > startPrice : undefined;
  const tone = above === undefined ? "var(--accent)" : above ? "var(--up)" : "var(--down)";
  // Axis labels, minus any the live price tag would cover.
  const ticks = niceTicks(yLo, yHi, 3).filter((v) => Y(v) > 8 && Y(v) < H - 4 && (head === undefined || Math.abs(Y(v) - Y(head)) > 16));
  const minutes: number[] = [];
  for (let t = Math.ceil(x0 / 120) * 120; t <= x1; t += 120) minutes.push(t);
  const inPlay = roundStart !== undefined && roundEnd !== undefined;

  return (
    <div ref={box} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="Live price chart">
          <defs>
            <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.22" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
            <clipPath id={`clip-${gid}`}>
              <rect x="0" y="0" width={W} height={H} />
            </clipPath>
          </defs>

          {/* the round in play */}
          {inPlay && (
            <g>
              <rect x={X(roundStart!)} y={0} width={Math.max(0, X(roundEnd!) - X(roundStart!))} height={H} fill="var(--fg)" opacity="0.035" />
              <line x1={X(roundEnd!)} x2={X(roundEnd!)} y1={0} y2={H} stroke="var(--line-strong)" strokeDasharray="2 3" />
              <text x={X(roundStart!) + 4} y={13} className="fill-fg-dim" fontSize="12">
                in play
              </text>
              <text x={X(roundEnd!) + 4} y={13} className="fill-fg-dim" fontSize="12">
                next round
              </text>
            </g>
          )}

          {/* grid */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={0} x2={W} y1={Y(v)} y2={Y(v)} stroke="var(--line)" strokeWidth="1" />
              <text x={W + 6} y={Y(v) + 4} className="tnum fill-fg-dim" fontSize="12">
                {formatPrice(v, decimals)}
              </text>
            </g>
          ))}
          {minutes.map((t) => (
            <text key={t} x={X(t)} y={height - 3} textAnchor="middle" className="tnum fill-fg-dim" fontSize="12">
              {hhmm(t)}
            </text>
          ))}

          <g clipPath={`url(#clip-${gid})`}>
            {area && <path d={area} fill={`url(#fill-${gid})`} />}
            {d && <path d={d} fill="none" stroke={tone} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />}
          </g>

          {/* price to beat */}
          {startPrice !== undefined && (
            <g>
              <line x1={0} x2={W} y1={Y(startPrice)} y2={Y(startPrice)} stroke="var(--fg-mute)" strokeDasharray="4 4" strokeWidth="1" />
              <text x={4} y={Y(startPrice) - 4} className="tnum fill-fg-mute" fontSize="12">
                price to beat {formatPrice(startPrice, decimals)}
              </text>
            </g>
          )}

          {/* the head */}
          {head !== undefined && (
            <g>
              <circle cx={X(now)} cy={Y(head)} r="3.5" fill={tone} />
              <circle cx={X(now)} cy={Y(head)} r="3.5" fill="none" stroke={tone} strokeWidth="1.5">
                <animate attributeName="r" from="3.5" to="11" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.7" to="0" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <rect x={W + 2} y={Y(head) - 9} width={padR - 4} height={18} fill={tone} rx="3" />
              <text x={W + 6} y={Y(head) + 4} className="tnum" fontSize="12" fill="var(--bg-elev)">
                {formatPrice(head, decimals)}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

// ───────────────────────────── odds chart ─────────────────────────────

/** The betting round's Up odds since it opened: a step line (odds move only on
 *  trades), easing to each new value, ending at now. */
export function OddsChart({
  points,
  open,
  close,
  skew = 0,
  height = 64,
}: {
  /** { t (chain seconds), up (0..1) }, oldest first; the first is the open. */
  points: Array<{ t: number; up: number }>;
  open: number;
  close: number;
  skew?: number;
  height?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const [box, width] = useWidth<HTMLDivElement>();
  const lastUp = points.length ? points[points.length - 1].up : 0.5;
  const targetsAt = useCallback((): Targets => ({ head: lastUp }), [lastUp]);
  const { now, v } = useAnimation(skew, targetsAt, ODDS_RATES);
  const head = v.head ?? lastUp;
  const padR = 44;
  const W = Math.max(0, width - padR);
  const H = height - 4;
  const X = (t: number) => ((Math.min(Math.max(t, open), close) - open) / (close - open || 1)) * W;
  const Y = (u: number) => 2 + (1 - u) * (H - 4);
  const pts: Pt[] = points.map((p) => ({ x: X(p.t), y: Y(p.up) }));
  const tNow = Math.min(now, close);
  pts.push({ x: X(tNow), y: Y(head) });
  const d = stepPath(pts);
  const area = pts.length > 1 ? `${d}V${H}H${pts[0].x}Z` : "";
  const tone = head >= 0.5 ? "var(--up)" : "var(--down)";

  return (
    <div ref={box} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="Up odds since the round opened">
          <defs>
            <linearGradient id={`odds-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.2" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1={0} x2={W} y1={Y(0.5)} y2={Y(0.5)} stroke="var(--line-strong)" strokeDasharray="3 4" />
          {Math.abs(head - 0.5) > 0.08 && (
            <text x={W + 6} y={Y(0.5) + 3} className="tnum fill-fg-dim" fontSize="12">
              50%
            </text>
          )}
          {area && <path d={area} fill={`url(#odds-${gid})`} />}
          <path d={d} fill="none" stroke={tone} strokeWidth="1.75" strokeLinejoin="round" />
          <circle cx={X(tNow)} cy={Y(head)} r="3" fill={tone} />
          <text x={W + 6} y={Math.min(H, Math.max(10, Y(head) + 3))} className="tnum" fontSize="12" fill={tone}>
            {Math.round(head * 100)}%
          </text>
        </svg>
      )}
    </div>
  );
}
