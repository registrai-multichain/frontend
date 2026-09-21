"use client";

import { useEffect, useState } from "react";

import { builderBoard, countryBoard, seasonElapsed, traderBoard } from "@/lib/seasons";
import type { BoardRow, Season, SeasonProgress } from "@/lib/seasons";

const usdc = (base: bigint) => {
  const n = Number(base) / 1e6;
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Board({
  title,
  note,
  rows,
  format,
}: {
  title: string;
  note: string;
  rows: BoardRow[];
  format: (v: bigint) => string;
}) {
  return (
    <section className="board">
      <header className="board-head">
        <h3>{title}</h3>
        <p>{note}</p>
      </header>
      {rows.length === 0 ? (
        <p className="board-empty">Nothing scored yet this season.</p>
      ) : (
        <ol className="board-rows">
          {rows.map((r, i) => (
            <li key={r.key} className="board-row">
              <span className="board-rank tnum">{i + 1}</span>
              <span className="board-label">
                {r.label.startsWith("0x") ? short(r.label) : r.label}
                {r.detail && <small>{r.detail.startsWith("0x") ? short(r.detail) : r.detail}</small>}
              </span>
              <span className="board-value tnum" data-negative={r.value < 0n ? "true" : undefined}>
                {format(r.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function SeasonBoards({
  season,
  progress,
  traderPnl,
  syncedAt,
}: {
  season: Season;
  progress: SeasonProgress[];
  traderPnl: Map<string, bigint>;
  /** Build-time clock, in seconds. */
  syncedAt: number;
}) {
  // The page is statically exported, so `Date.now()` during render differs
  // between the build and the browser and breaks hydration. Both sides agree on
  // the sync timestamp; the real clock arrives after mount.
  const [now, setNow] = useState(syncedAt);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(t);
  }, []);

  const pct = Math.round(seasonElapsed(season, now) * 100);
  const daysLeft = Math.max(0, Math.ceil((season.endsAt - now) / 86_400));
  const fmtDate = (t: number) =>
    new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <div className="season">
      <header className="season-head">
        <div className="season-title">
          <span className="caption">{season.label}</span>
          <strong>
            {fmtDate(season.startedAt)} – {fmtDate(season.endsAt)}
          </strong>
        </div>
        <div className="season-meter" role="img" aria-label={`${pct}% of the season elapsed`}>
          <i style={{ ["--pct" as string]: `${pct}%` }} />
        </div>
        <span className="season-left tnum">
          {daysLeft} day{daysLeft === 1 ? "" : "s"} left
        </span>
      </header>

      <div className="season-boards">
        <Board
          title="Countries"
          note="verified progress this season"
          rows={countryBoard(progress, 10)}
          format={(v) => String(v)}
        />
        <Board
          title="Builders"
          note="verified progress this season"
          rows={builderBoard(progress, 10)}
          format={(v) => String(v)}
        />
        <Board
          title="Traders"
          note="realised P&L this season, USDC"
          rows={traderBoard(traderPnl, 10)}
          format={usdc}
        />
      </div>

      <p className="season-note">
        Seasons are a scoreboard, not a purse — nothing here pays out. Every number is a replay of
        on-chain events over the season&rsquo;s block range ({season.startBlock.toLocaleString()} –{" "}
        {season.endBlock === null ? "now" : season.endBlock.toLocaleString()}), so anyone can
        recompute it. Trader P&amp;L books a result when a position is sold or its market resolves,
        at average cost, fees included. Country is self-declared and unverified, so it can never
        decide a reward.
      </p>
    </div>
  );
}
