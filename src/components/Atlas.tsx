"use client";

import { useState } from "react";
import live from "@/lib/live-data.json";
import meta from "@/lib/builder-meta.json";
import { WorldMap } from "@/components/WorldMap";
import { CityView } from "@/components/CityView";
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
  const [focusedBuilder, setFocusedBuilder] = useState<number | null>(null);

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

      <WorldMap
        cells={mapped}
        selected={selected}
        onSelect={(c) => {
          setSelected(c);
          setFocusedBuilder(null);
        }}
        max={max}
      />

      {/* Builders with no declared country, plus everyone folded in by the
          small-n floor. They have no geography by definition, so they sit
          beside the map rather than on it. */}
      {totalBuilders === 0 && (
        <p className="city-empty">
          No builders registered yet. The map and the city fill in as builders opt in.
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
            setFocusedBuilder(null);
          }}
        >
          <span className="atlas-unattributed-label">unattributed</span>
          <span className="tnum">{unattributed.builders}</span>
          <span className="atlas-unattributed-note">
            no declared country, or below the {MIN_BUILDERS_PER_CELL}-builder floor
          </span>
        </button>
      )}

      {selected && (
        <div className="atlas-panel">
          <div className="atlas-panel-head">
            <span className="caption">
              {selected === UNATTRIBUTED ? "unattributed" : selected} · {inCell.length} builder
              {inCell.length === 1 ? "" : "s"}
            </span>
            <button type="button" className="atlas-close" onClick={() => setSelected(null)}>
              close ×
            </button>
          </div>

          <div className="atlas-city">
            <CityView
              builders={inCell.map((b) => ({
                builderId: b.builderId,
                address: b.address,
                lifetimeProgress: b.lifetimeProgress,
                volume: b.volume,
              }))}
              selectedId={focusedBuilder}
              onSelect={setFocusedBuilder}
            />
          </div>

          {inCell.map((b) => {
            const mine = marketsForBuilders(cellMarkets, [b.builderId]);
            return (
              <div
                key={b.builderId}
                className="atlas-builder"
                data-dim={focusedBuilder !== null && focusedBuilder !== b.builderId ? "true" : undefined}
              >
                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                  <span className="text-[13px]">builder #{b.builderId}</span>
                  <span className="text-2xs text-fg-dim tnum">
                    {b.lifetimeProgress} progress · {usdc(b.volume)} USDC volume
                  </span>
                </div>
                <div className="text-2xs text-fg-dim tnum mt-1">{b.address}</div>

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
                          <span className={m.phase === "resolved" ? "text-fg-dim" : "text-commons"}>
                            {m.phase === "resolved" ? `settled ${m.yesWon ? "yes" : "no"}` : "trading"}
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
