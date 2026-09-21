"use client";

import { useState } from "react";
import live from "@/lib/live-data.json";
import meta from "@/lib/builder-meta.json";
import {
  aggregateByCountry,
  densityBucket,
  impliedYes,
  marketsForBuilders,
  mergeDeclaredMeta,
  MIN_BUILDERS_PER_CELL,
  UNATTRIBUTED,
} from "@/lib/atlas";
import type { BuilderAggregate, DeclaredMeta, PerennialMarket } from "@/lib/atlas";

type RawBuilder = {
  builderId: number;
  address: string;
  lifetimeProgress: number;
  volume: string;
};

/**
 * Builder density by country, with a drill-down into the builders in a cell and
 * the markets written about them.
 *
 * Flat, not a globe: a choropleth is legible at a glance, cheap to render and
 * screenshots well. It also degrades gracefully — a city with one building
 * looks broken, a map with one lit cell looks early.
 *
 * Country is SELF-DECLARED. It decides which cell a builder sits in and nothing
 * else; progress and volume are read from chain. The drill-down deliberately
 * never prints a declared country, because a suppressed cell revealing its
 * members' countries on click would defeat the small-n floor entirely.
 */
export function Atlas() {
  const [selected, setSelected] = useState<string | null>(null);

  const builders = mergeDeclaredMeta(
    ((live as { builders?: RawBuilder[] }).builders ?? []).map(
      (b): BuilderAggregate => ({
        builderId: b.builderId,
        address: b.address,
        lifetimeProgress: b.lifetimeProgress,
        volume: BigInt(b.volume),
        country: null,
      }),
    ),
    meta as DeclaredMeta,
  );

  const markets = ((live as { perennialMarkets?: PerennialMarket[] }).perennialMarkets ?? []);
  const cells = aggregateByCountry(builders);
  const max = cells.reduce((m, c) => Math.max(m, c.builders), 0);
  const totalBuilders = cells.reduce((s, c) => s + c.builders, 0);
  const totalProgress = cells.reduce((s, c) => s + c.progress, 0);
  const totalVolume = cells.reduce((s, c) => s + c.volume, 0n);

  // Which builders sit in the selected cell. A suppressed cell holds both the
  // undeclared and the below-floor builders, which is exactly the set that must
  // stay indistinguishable.
  const inCell = selected
    ? builders.filter((b) => {
        const shown = cells.some((c) => c.code === b.country);
        return selected === UNATTRIBUTED ? !shown : b.country === selected;
      })
    : [];
  const cellMarkets = marketsForBuilders(markets, inCell.map((b) => b.builderId));

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <h1 className="caption">builder atlas</h1>
        <span className="text-2xs text-fg-dim">density by declared country</span>
      </div>
      <p className="font-serif text-[28px] sm:text-[38px] leading-[1.06] tracking-tightest max-w-[20ch] mb-5">
        Where the <span className="italic text-commons">grind</span> is.
      </p>

      <div className="grid grid-cols-3 gap-px bg-line border border-line mb-6">
        <Stat label="builders" value={String(totalBuilders)} />
        <Stat label="verified progress" value={String(totalProgress)} />
        <Stat label="market volume" value={`${(Number(totalVolume) / 1e6).toFixed(2)} USDC`} />
      </div>

      {cells.length === 0 ? (
        <p className="text-[13px] text-fg-mute leading-relaxed max-w-[60ch]">
          No builders registered yet. The map fills in as builders opt in.
        </p>
      ) : (
        <ul className="atlas-cells">
          {cells.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                className="atlas-cell"
                data-density={densityBucket(c.builders, max)}
                data-selected={selected === c.code ? "true" : undefined}
                aria-pressed={selected === c.code}
                onClick={() => setSelected(selected === c.code ? null : c.code)}
              >
                <span className="atlas-code">
                  {c.code === UNATTRIBUTED ? "unattributed" : c.code}
                </span>
                <span className="atlas-count tnum">{c.builders}</span>
                <span className="atlas-progress tnum">{c.progress} prog</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-6 border border-line bg-bg-elev">
          <div className="flex items-baseline justify-between gap-4 border-b border-line px-5 py-3">
            <span className="caption">
              {selected === UNATTRIBUTED ? "unattributed" : selected} ·{" "}
              {inCell.length} builder{inCell.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="text-2xs text-fg-dim hover:text-fg transition-colors"
              onClick={() => setSelected(null)}
            >
              close ×
            </button>
          </div>

          {inCell.map((b) => {
            const mine = marketsForBuilders(cellMarkets, [b.builderId]);
            return (
              <div key={b.builderId} className="border-b border-line px-5 py-4 last:border-b-0">
                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                  <span className="text-[13px]">builder #{b.builderId}</span>
                  <span className="text-2xs text-fg-dim tnum">
                    {b.lifetimeProgress} progress · {(Number(b.volume) / 1e6).toFixed(2)} USDC volume
                  </span>
                </div>
                <div className="text-2xs text-fg-dim tnum mt-1">{b.address}</div>

                {mine.length === 0 ? (
                  <div className="text-2xs text-fg-dim mt-3">No markets yet.</div>
                ) : (
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {mine.map((m) => {
                      const p = impliedYes(BigInt(m.yesReserve), BigInt(m.noReserve));
                      return (
                        <li
                          key={m.marketId}
                          className="flex items-baseline justify-between gap-3 text-2xs"
                        >
                          <span className="tnum text-fg-mute">{m.marketId.slice(0, 14)}…</span>
                          <span className="flex items-baseline gap-3">
                            <span className="tnum">{(p * 100).toFixed(0)}% yes</span>
                            <span className={m.phase === "resolved" ? "text-fg-dim" : "text-commons"}>
                              {m.phase === "resolved"
                                ? `resolved ${m.yesWon ? "yes" : "no"}`
                                : "trading"}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-5 text-[12px] text-fg-dim leading-relaxed max-w-[64ch]">
        Country is self-declared, opt-in and unverified — it decides which cell a builder
        sits in and nothing else. Progress and volume are read from chain. Countries with
        fewer than {MIN_BUILDERS_PER_CELL} builders are grouped as unattributed, so the map
        never narrows down to one person.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elev px-4 py-3">
      <div className="caption text-fg-dim mb-1">{label}</div>
      <div className="tnum text-[18px]">{value}</div>
    </div>
  );
}
