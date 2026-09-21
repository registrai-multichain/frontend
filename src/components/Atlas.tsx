"use client";

import { useState } from "react";
import live from "@/lib/live-data.json";
import meta from "@/lib/builder-meta.json";
import { Globe } from "@/components/Globe";
import {
  aggregateByCountry,
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

const usdc = (base: bigint | number) => (Number(base) / 1e6).toFixed(2);

export function Atlas() {
  const [selected, setSelected] = useState<string | null>(null);
  // Second level of the drill-down: country -> builder -> that builder's markets.
  const [openBuilder, setOpenBuilder] = useState<number | null>(null);

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

  const markets = (live as { perennialMarkets?: PerennialMarket[] }).perennialMarkets ?? [];
  const cells = aggregateByCountry(builders);
  const mapped = cells.filter((c) => c.code !== UNATTRIBUTED);
  const unattributed = cells.find((c) => c.code === UNATTRIBUTED);

  // Density scales against the busiest MAPPED country. Including the
  // unattributed bucket would let it flatten every real country to the floor.
  const max = mapped.reduce((m, c) => Math.max(m, c.builders), 0);

  const totalBuilders = cells.reduce((s, c) => s + c.builders, 0);
  const totalProgress = cells.reduce((s, c) => s + c.progress, 0);
  const totalVolume = cells.reduce((s, c) => s + c.volume, 0n);

  const inCell = selected
    ? builders.filter((b) => {
        const shown = mapped.some((c) => c.code === b.country);
        return selected === UNATTRIBUTED ? !shown : b.country === selected;
      })
    : [];
  const cellMarkets = marketsForBuilders(
    markets,
    inCell.map((b) => b.builderId),
  );
  const cellLabel = selected === UNATTRIBUTED ? "unattributed" : selected;

  return (
    <section className="atlas-root">
      <header className="atlas-head">
        <div>
          <p className="caption text-fg-dim">builder atlas</p>
          <h1 className="font-serif text-[32px] sm:text-[44px] leading-[1.02] tracking-tightest mt-1">
            Where the <span className="italic text-commons">grind</span> is.
          </h1>
        </div>
        <dl className="atlas-stats">
          <Stat label="builders" value={String(totalBuilders)} />
          <Stat label="progress" value={String(totalProgress)} />
          <Stat label="volume" value={`${usdc(totalVolume)} USDC`} />
        </dl>
      </header>

      {/* One grid: the globe alone at full width, or docked small to the left
          with the country's detail beside it. The globe stays live either way —
          it is also the way back out. */}
      <div className="atlas-stage" data-docked={selected ? "true" : undefined}>
        <div className="atlas-stage-globe">
          <Globe
            cells={mapped}
            selected={selected}
            onSelect={(c) => {
              setSelected(c);
              setOpenBuilder(null);
            }}
            max={max}
          />
        </div>
        {selected && (
          <div className="atlas-panel">
            {/* Breadcrumb doubles as the control: the country step is a button
                once you are a level deeper, so back is where you looked. */}
            <div className="atlas-panel-head">
              <span className="atlas-crumbs">
                {openBuilder === null ? (
                  <span className="caption">
                    {cellLabel} · {inCell.length} builder{inCell.length === 1 ? "" : "s"}
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="atlas-crumb"
                      onClick={() => setOpenBuilder(null)}
                    >
                      ← {cellLabel}
                    </button>
                    <span className="caption">builder #{openBuilder}</span>
                  </>
                )}
              </span>
              <button
                type="button"
                className="atlas-close"
                onClick={() => {
                  setSelected(null);
                  setOpenBuilder(null);
                }}
              >
                close ×
              </button>
            </div>

            {inCell.length === 0 && (
              <div className="atlas-builder text-2xs text-fg-dim">No builders in this cell.</div>
            )}

            {openBuilder === null
              ? inCell.map((b) => {
                  const n = marketsForBuilders(cellMarkets, [b.builderId]).length;
                  return (
                    <button
                      key={b.builderId}
                      type="button"
                      className="atlas-builder-row"
                      onClick={() => setOpenBuilder(b.builderId)}
                    >
                      <span className="atlas-builder-id">builder #{b.builderId}</span>
                      <span className="atlas-builder-addr tnum">{b.address}</span>
                      <span className="atlas-builder-stats tnum">
                        <b>{b.lifetimeProgress}</b> progress · {usdc(b.volume)} USDC
                      </span>
                      <span className="atlas-builder-go tnum">
                        {n} market{n === 1 ? "" : "s"} →
                      </span>
                    </button>
                  );
                })
              : (() => {
                  const b = inCell.find((x) => x.builderId === openBuilder);
                  if (!b) return null;
                  const mine = marketsForBuilders(cellMarkets, [b.builderId]);
                  return (
                    <div className="atlas-builder">
                      <div className="flex items-baseline justify-between gap-4 flex-wrap">
                        <span className="text-2xs text-fg-dim tnum">{b.address}</span>
                        <span className="text-2xs text-fg-dim tnum">
                          {b.lifetimeProgress} progress · {usdc(b.volume)} USDC volume
                        </span>
                      </div>

                      {mine.length === 0 ? (
                        <div className="text-2xs text-fg-dim mt-3">No markets yet.</div>
                      ) : (
                        <ul className="atlas-markets">
                          {mine.map((m) => {
                            const p = impliedYes(BigInt(m.yesReserve), BigInt(m.noReserve));
                            return (
                              <li key={m.marketId}>
                                <span className="tnum text-fg-mute">{m.marketId.slice(0, 14)}…</span>
                                <span className="atlas-odds" style={{ ["--p" as string]: p }}>
                                  <i />
                                </span>
                                <span className="tnum">{(p * 100).toFixed(0)}%</span>
                                <span
                                  className={m.phase === "resolved" ? "text-fg-dim" : "text-commons"}
                                >
                                  {m.phase === "resolved"
                                    ? `settled ${m.yesWon ? "yes" : "no"}`
                                    : "trading"}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })()}
          </div>
        )}
      </div>

      {/* Builders with no declared country, plus everyone folded in by the
          small-n floor. They have no geography by definition, so they sit
          beside the globe rather than on it. */}
      {totalBuilders === 0 && (
        <p className="atlas-empty">
          No builders registered yet. Countries light up as builders opt in.
        </p>
      )}

      {unattributed && (
        <button
          type="button"
          className="atlas-unattributed"
          data-selected={selected === UNATTRIBUTED ? "true" : undefined}
          aria-pressed={selected === UNATTRIBUTED}
          onClick={() => {
            setSelected(selected === UNATTRIBUTED ? null : UNATTRIBUTED);
            setOpenBuilder(null);
          }}
        >
          <span className="atlas-unattributed-label">unattributed</span>
          <span className="tnum">{unattributed.builders}</span>
          <span className="atlas-unattributed-note">
            no declared country, or below the {MIN_BUILDERS_PER_CELL}-builder floor
          </span>
        </button>
      )}

      <p className="atlas-note">
        Country is self-declared, opt-in and unverified — it decides which cell a builder sits
        in and nothing else. Progress and volume are read from chain. Countries with fewer
        than {MIN_BUILDERS_PER_CELL} builders are grouped as unattributed, so the map never
        narrows down to one person.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="atlas-stat">
      <dt className="caption text-fg-dim">{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}
