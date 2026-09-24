"use client";

/**
 * BTC · 5-minute settlement — a CurveMarket front-end.
 *
 * The design idea: the thing you bet on IS the chart. The ladder below is a
 * live histogram of where the pool's money sits, and clicking a rung places
 * your stake there. Price rises upward, bars grow rightward, and a marker
 * tracks spot in real time so you watch it drift across your rung during the
 * round. Hovering a rung shows the accuracy kernel — the neighbours that would
 * still pay out — because "close counts" is the mechanic people miss.
 *
 * Aesthetic follows the rest of registrai.cc: warm paper, tabular mono, one
 * burnt-orange accent, no chrome that isn't data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { createPublicClient, http } from "viem";
import {
  CURVE_DEPLOYMENT,
  bucketForValue,
  bucketPriceRange,
  curveMarketAbi,
  priceToNormalized,
  projectPayout,
  weightOf,
} from "@/lib/curve";

const chainClient = createPublicClient({ transport: http(CURVE_DEPLOYMENT.rpcUrl) });

const BUCKETS = 9;
const BAND = 0.004; // ±0.4% saturates the range
const ROUND_SECONDS = 300;
const ROUND_MS = ROUND_SECONDS * 1000;
const LOCK_SECONDS = 15; // staking stops before settlement
const FEE_BPS = 100;
const JACKPOT_BPS = 2000;

const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsdc = (v: bigint) =>
  (Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Tick = { price: number; dir: "up" | "down" | "flat" };

async function fetchBtc(): Promise<number> {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", { cache: "no-store" });
    const j = await r.json();
    return Number(j.data.amount);
  } catch {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
      cache: "no-store",
    });
    const j = await r.json();
    return Number(j.price);
  }
}

export default function Btc5mPage() {
  const [tick, setTick] = useState<Tick>();
  const [strike, setStrike] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const [mounted, setMounted] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [hover, setHover] = useState<number>();
  const [amount, setAmount] = useState("25");
  const [pool, setPool] = useState<bigint[]>(() => Array(BUCKETS).fill(0n));
  const [mine, setMine] = useState<Record<number, bigint>>({});
  const [onChain, setOnChain] = useState<{ closesAt: number; opensAt: number; total: bigint } | null>(null);
  const prev = useRef<number | undefined>(undefined);

  /* ------------------------------------------------------- live chain state */

  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const [market, stakes] = await Promise.all([
          chainClient.readContract({
            address: CURVE_DEPLOYMENT.address,
            abi: curveMarketAbi,
            functionName: "getMarket",
            args: [CURVE_DEPLOYMENT.marketId],
          }),
          chainClient.readContract({
            address: CURVE_DEPLOYMENT.address,
            abi: curveMarketAbi,
            functionName: "bucketStakes",
            args: [CURVE_DEPLOYMENT.marketId],
          }),
        ]);
        if (!alive) return;
        setOnChain({
          opensAt: Number(market[5]) * 1000,
          closesAt: Number(market[6]) * 1000,
          total: market[3],
        });
        setPool((stakes as readonly bigint[]).slice(0, BUCKETS));
      } catch {
        // Contract unreachable — stay in preview mode rather than showing zeros.
        if (alive) setOnChain(null);
      }
    };
    read();
    const id = setInterval(read, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /* ------------------------------------------------------------- live price */

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const p = await fetchBtc();
        if (!alive) return;
        const last = prev.current;
        prev.current = p;
        setTick({ price: p, dir: last === undefined || p === last ? "flat" : p > last ? "up" : "down" });
        setStrike((s) => s ?? p);
      } catch {
        /* keep the last good tick */
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /* ------------------------------------------------------- round + ticking */

  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  // Rounds sit on wall-clock 5-minute boundaries, so every participant is in
  // the same round and the server and client agree without coordination.
  // A live market settles on its own committed schedule; the wall-clock grid is
  // only the preview fallback.
  const roundEnd = onChain ? onChain.closesAt : Math.ceil(now / ROUND_MS) * ROUND_MS;
  const secondsLeft = Math.max(0, Math.round((roundEnd - now) / 1000));
  const windowSeconds = onChain
    ? Math.max(1, (onChain.closesAt - onChain.opensAt) / 1000)
    : ROUND_SECONDS;
  const progress = 1 - secondsLeft / windowSeconds;
  const closing = secondsLeft <= 30;
  const locked = secondsLeft <= LOCK_SECONDS;

  /* --------------------------------------------- seed a demonstrable pool */

  useEffect(() => {
    if (!strike || onChain) return;
    // Preview liquidity so the ladder is legible before the contract is live:
    // a plausible bell around the centre rung.
    setPool(
      Array.from({ length: BUCKETS }, (_, b) => {
        const d = Math.abs(b - (BUCKETS - 1) / 2);
        const w = Math.exp(-(d * d) / 3.2);
        return BigInt(Math.round(w * 1400e6 + 40e6));
      }),
    );
  }, [strike, onChain]);

  const roundId = Math.floor(now / ROUND_MS);
  const lastRound = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (lastRound.current === undefined) {
      lastRound.current = roundId;
      return;
    }
    if (roundId !== lastRound.current) {
      lastRound.current = roundId;
      if (onChain) return; // a live market keeps its own strike and stakes
      // New round: restrike at spot, clear the previous round's selection.
      if (prev.current) setStrike(prev.current);
      setSelected(undefined);
      setMine({});
    }
  }, [roundId, onChain]);

  const spotBucket = useMemo(
    () => (tick && strike ? bucketForValue(priceToNormalized(tick.price, strike, BAND), BUCKETS) : undefined),
    [tick, strike],
  );

  /** Continuous vertical position of spot within the ladder, for the marker. */
  const spotOffset = useMemo(() => {
    if (!tick || !strike) return 0.5;
    const n = priceToNormalized(tick.price, strike, BAND);
    return 1 - (n + 1_000_000) / 2_000_000;
  }, [tick, strike]);

  const totalPool = pool.reduce((a, b) => a + b, 0n);
  const maxPool = pool.reduce((a, b) => (b > a ? b : a), 1n);

  const stakeUnits = useMemo(() => {
    const n = Number(amount || "0");
    return BigInt(Math.max(0, Math.round(n * 1e6)));
  }, [amount]);

  const projected = useMemo(() => {
    if (selected === undefined || stakeUnits === 0n) return 0n;
    return projectPayout({
      bucketStakes: pool,
      bucketCount: BUCKETS,
      myBucket: selected,
      myStake: stakeUnits,
      winner: selected,
      feeBps: FEE_BPS,
      jackpotBps: JACKPOT_BPS,
    });
  }, [pool, selected, stakeUnits]);

  const place = useCallback(() => {
    if (selected === undefined || stakeUnits === 0n) return;
    setPool((p) => p.map((v, i) => (i === selected ? v + stakeUnits : v)));
    setMine((m) => ({ ...m, [selected]: (m[selected] ?? 0n) + stakeUnits }));
  }, [selected, stakeUnits]);

  const focus = hover ?? selected;

  return (
    <Shell>
      <div className="pt-10 sm:pt-14 fade-up">
      {/* ------------------------------------------------------------ header */}
      <header className="mb-7 flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div>
          <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-[0.18em] text-fg-dim">
            <span className="dot-pulse inline-block h-1.5 w-1.5 rounded-full bg-up" />
            {onChain ? `live contract · ${CURVE_DEPLOYMENT.network}` : "preview · curve market"}
          </div>
          <h1 className="font-serif text-4xl leading-none tracking-tightest">
            BTC <span className="text-fg-dim">/</span> USD
          </h1>
          <p className="mt-1.5 text-xs text-fg-mute">
            Where does it settle in five minutes? Stake a price band — close still pays.
          </p>
        </div>

        <div className="text-right">
          <div
            className={`tnum font-serif text-5xl leading-none tracking-tightest transition-colors duration-300 ${
              tick?.dir === "up" ? "text-up" : tick?.dir === "down" ? "text-down" : "text-fg"
            }`}
          >
            {tick ? fmtUsd(tick.price) : "—"}
          </div>
          <div className="mt-1.5 text-2xs uppercase tracking-[0.14em] text-fg-dim">
            strike {strike ? fmtUsd(strike) : "—"} · band ±{(BAND * 100).toFixed(1)}%
          </div>
        </div>
      </header>

      {/* ----------------------------------------------------------- countdown */}
      <section className="mb-8">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-2xs uppercase tracking-[0.16em] text-fg-dim">
            {!mounted ? "round" : locked ? "locked · settling" : "closes in"}
          </span>
          <span
            className={`tnum font-serif text-2xl leading-none ${closing ? "text-down dot-pulse" : "text-fg"}`}
          >
            {mounted
              ? `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(
                  secondsLeft % 60,
                ).padStart(2, "0")}`
              : "05:00"}
          </span>
        </div>
        <div className="h-[3px] w-full overflow-hidden bg-line/50">
          <div
            className={`h-full transition-[width] duration-300 ease-linear ${closing ? "bg-down" : "bg-accent"}`}
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      </section>

      {/* -------------------------------------------------------- the ladder */}
      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xs uppercase tracking-[0.16em] text-fg-dim">
            settlement ladder · {BUCKETS} bands
          </h2>
          <span className="tnum text-2xs text-fg-dim">
            pool {fmtUsdc(totalPool)} USDC
          </span>
        </div>

        <div className="relative border border-line bg-bg-elev">
          {/* live spot marker drifting across the rungs */}
          {tick && (
            <div
              className="pointer-events-none absolute inset-x-0 z-20 transition-[top] duration-700 ease-out"
              style={{ top: `calc(${(spotOffset * 100).toFixed(3)}% - 1px)` }}
            >
              <div className="relative h-px w-full bg-accent/70">
                <span className="absolute -top-[7px] right-1 bg-accent px-1 py-[1px] text-[9px] uppercase tracking-wider text-bg-elev">
                  spot
                </span>
              </div>
            </div>
          )}

          {Array.from({ length: BUCKETS }, (_, i) => BUCKETS - 1 - i).map((b) => {
            const range = strike ? bucketPriceRange(b, BUCKETS, strike, BAND) : undefined;
            const share = Number(pool[b]) / Number(maxPool);
            const isSel = selected === b;
            const isSpot = spotBucket === b;
            const w = focus !== undefined ? weightOf(b, focus, BUCKETS) : 0;
            const kernel = focus !== undefined ? w / BUCKETS : 0;
            const myStake = mine[b] ?? 0n;

            return (
              <button
                key={b}
                type="button"
                disabled={locked}
                onClick={() => setSelected(b)}
                onMouseEnter={() => setHover(b)}
                onMouseLeave={() => setHover(undefined)}
                className={`group relative flex w-full items-center gap-3 border-b border-line/60 px-3 py-2 text-left last:border-b-0 transition-colors disabled:cursor-not-allowed ${
                  isSel ? "bg-accent/[0.09]" : "hover:bg-accent/[0.04]"
                }`}
              >
                {/* accuracy kernel: how much this rung earns if `focus` wins */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-0 w-[3px] transition-opacity duration-200"
                  style={{
                    background: "var(--accent)",
                    opacity: focus === undefined ? 0 : kernel * 0.9,
                  }}
                />

                <span
                  className={`tnum w-[78px] shrink-0 text-xs ${
                    isSel ? "text-fg" : isSpot ? "text-accent" : "text-fg-mute"
                  }`}
                >
                  {range ? fmtUsd(range.mid) : "—"}
                </span>

                {/* pool bar */}
                <span className="relative h-[18px] flex-1 overflow-hidden bg-bg">
                  <span
                    className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out ${
                      isSel ? "bg-accent/70" : "bg-line-strong/55 group-hover:bg-line-strong/75"
                    }`}
                    style={{ width: `${Math.max(1.5, share * 100)}%` }}
                  />
                  {myStake > 0n && (
                    <span className="absolute inset-y-0 left-0 border-r-2 border-fg" style={{ width: "0" }} />
                  )}
                </span>

                <span className="tnum w-[86px] shrink-0 text-right text-2xs text-fg-dim">
                  {fmtUsdc(pool[b])}
                </span>

                <span
                  className={`tnum w-[46px] shrink-0 text-right text-2xs ${
                    focus !== undefined && w === BUCKETS ? "text-accent" : "text-fg-dim"
                  }`}
                  title="accuracy weight if this band wins"
                >
                  ×{w || "—"}
                </span>

                <span className="tnum w-[74px] shrink-0 text-right text-2xs">
                  {myStake > 0n ? <span className="text-fg">{fmtUsdc(myStake)}</span> : <span className="text-fg-dim/50">·</span>}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-2xs leading-relaxed text-fg-dim">
          Bars show where the pool sits. The left edge shades by <em className="not-italic text-fg-mute">accuracy
          weight</em> — every band pays something, nearer bands pay more, and the exact band takes a
          capped jackpot on top.
        </p>
      </section>

      {/* --------------------------------------------------------- stake pad */}
      <section className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="border border-line bg-bg-elev p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-2xs uppercase tracking-[0.16em] text-fg-dim">your stake</span>
            <span className="text-2xs text-fg-dim">
              {selected !== undefined && strike
                ? `band ${fmtUsd(bucketPriceRange(selected, BUCKETS, strike, BAND).lo)} – ${fmtUsd(
                    bucketPriceRange(selected, BUCKETS, strike, BAND).hi,
                  )}`
                : "select a band above"}
            </span>
          </div>

          <div className="flex items-stretch gap-2">
            <div className="flex flex-1 items-center border border-line bg-bg px-3">
              <input
                inputMode="decimal"
                value={amount}
                disabled={locked}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                className="tnum w-full bg-transparent py-2.5 font-serif text-2xl outline-none"
              />
              <span className="text-2xs uppercase tracking-wider text-fg-dim">usdc</span>
            </div>
            {["10", "25", "100"].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className="tnum border border-line px-3 text-xs text-fg-mute transition-colors hover:border-line-strong hover:text-fg"
              >
                {v}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={place}
            disabled={locked || selected === undefined || stakeUnits === 0n}
            className="mt-3 w-full bg-fg py-2.5 text-xs uppercase tracking-[0.16em] text-bg transition-opacity disabled:opacity-30"
          >
            {locked ? "locked" : selected === undefined ? "pick a band" : "place stake"}
          </button>
        </div>

        <div className="border border-line bg-bg-elev p-4 md:w-[230px]">
          <span className="text-2xs uppercase tracking-[0.16em] text-fg-dim">if it lands here</span>
          <div className="tnum mt-2 font-serif text-3xl leading-none">
            {selected === undefined ? "—" : fmtUsdc(projected)}
          </div>
          <div className="mt-1 text-2xs text-fg-dim">
            {selected !== undefined && stakeUnits > 0n
              ? `${(Number(projected) / Number(stakeUnits)).toFixed(2)}× on ${fmtUsdc(stakeUnits)}`
              : "exact-band payout"}
          </div>
          <div className="hr my-3" />
          <dl className="space-y-1 text-2xs text-fg-dim">
            <div className="flex justify-between">
              <dt>fee</dt>
              <dd className="tnum">{FEE_BPS / 100}%</dd>
            </div>
            <div className="flex justify-between">
              <dt>jackpot share</dt>
              <dd className="tnum">{JACKPOT_BPS / 100}%</dd>
            </div>
            <div className="flex justify-between">
              <dt>exit</dt>
              <dd className="text-fg-mute">free until close</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------------ your position */}
      {Object.keys(mine).length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-2xs uppercase tracking-[0.16em] text-fg-dim">your position</h2>
          <div className="border border-line bg-bg-elev">
            {Object.entries(mine).map(([b, v]) => {
              const bn = Number(b);
              const range = strike ? bucketPriceRange(bn, BUCKETS, strike, BAND) : undefined;
              return (
                <div
                  key={b}
                  className="flex items-center justify-between gap-3 border-b border-line/60 px-3 py-2.5 last:border-b-0"
                >
                  <div>
                    <div className="tnum text-xs">{range ? fmtUsd(range.mid) : "—"}</div>
                    <div className="text-2xs text-fg-dim">
                      {range ? `${fmtUsd(range.lo)} – ${fmtUsd(range.hi)}` : ""}
                    </div>
                  </div>
                  <div className="tnum text-xs">{fmtUsdc(v)} USDC</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={locked}
                      className="border border-line px-2.5 py-1 text-2xs uppercase tracking-wider text-fg-mute transition-colors hover:border-line-strong hover:text-fg disabled:opacity-30"
                      title={locked ? "withdrawal closes with the round" : "exit at par"}
                    >
                      withdraw
                    </button>
                    <button
                      type="button"
                      className="border border-accent px-2.5 py-1 text-2xs uppercase tracking-wider text-accent transition-colors hover:bg-accent hover:text-bg-elev"
                      title="list this position for sale — works after close, before settlement"
                    >
                      sell
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-fg-dim">
            Withdrawing is free while the round is open. After it closes you can still{" "}
            <em className="not-italic text-fg-mute">sell</em> the position to someone else right up until
            settlement — the only exit once the outcome is in play.
          </p>
        </section>
      )}

      <p className="mt-10 border-t border-line pt-4 text-2xs leading-relaxed text-fg-dim">
        {onChain ? (
          <>
            Pool depth is read live from{" "}
            <a
              className="text-fg-mute underline"
              href={`${CURVE_DEPLOYMENT.explorer}/address/${CURVE_DEPLOYMENT.address}`}
              target="_blank"
              rel="noreferrer"
            >
              CurveMarket on {CURVE_DEPLOYMENT.network}
            </a>
            . Spot is live from Coinbase. Bucketing in this UI is the same kernel the contract settles
            on, verified against it case by case. Legacy testnet market: the fee and jackpot share
            shown are this curve contract&apos;s own, not Registrai&apos;s 1% resolution fee.
          </>
        ) : (
          <>
            Preview: spot is live from Coinbase, pool depth is illustrative while the contract is
            unreachable. Bucketing is the same kernel the contract settles on. Legacy testnet market:
            the fee and jackpot share shown are this curve contract&apos;s own, not Registrai&apos;s 1%
            resolution fee.
          </>
        )}
      </p>
      </div>
    </Shell>
  );
}
