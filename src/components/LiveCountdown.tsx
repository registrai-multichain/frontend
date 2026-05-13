"use client";

import { useEffect, useState } from "react";

interface Props {
  /** Hour in UTC for the daily event. */
  hourUtc?: number;
  /** Override label prefix. */
  label?: string;
  className?: string;
}

/**
 * Ticking countdown to the next daily attestation slot (default 14:00 UTC).
 * Pure presentational, no chain reads. Drives the "this is live" feeling on
 * the home and feed pages.
 */
export function LiveCountdown({ hourUtc = 14, label = "next attestation", className }: Props) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    // SSR-safe: show a static placeholder until the client clock kicks in.
    return (
      <span className={`inline-flex items-center gap-2 text-2xs tracking-wide text-fg-mute ${className ?? ""}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-up" />
        <span className="caption">{label}</span>
        <span className="tnum text-fg-dim">— : — : —</span>
      </span>
    );
  }

  const next = nextOccurrence(now, hourUtc);
  const remaining = Math.max(0, next - now);
  const hh = Math.floor(remaining / 3_600_000)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((remaining % 3_600_000) / 60_000)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor((remaining % 60_000) / 1000)
    .toString()
    .padStart(2, "0");

  return (
    <span
      className={`inline-flex items-center gap-2 text-2xs tracking-wide text-fg-mute ${className ?? ""}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-up dot-pulse" />
      <span className="caption">{label}</span>
      <span className="tnum text-fg">
        {hh}:{mm}:{ss}
      </span>
    </span>
  );
}

function nextOccurrence(nowMs: number, hourUtc: number): number {
  const d = new Date(nowMs);
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc, 0, 0, 0),
  );
  if (next.getTime() <= nowMs) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime();
}
