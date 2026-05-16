"use client";

import { useEffect, useState } from "react";

/**
 * Two-dot indicator showing freshness of a live-polled value.
 *
 *   green pulse  → updated < 10s ago
 *   amber static → 10-45s ago
 *   dim static   → > 45s old or never updated
 */
export function LivePulse({ freshAt }: { freshAt: number | undefined }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2_000);
    return () => clearInterval(t);
  }, []);

  const ageMs = freshAt ? now - freshAt : Infinity;
  let color = "bg-fg-dim";
  let pulse = false;
  let label = "—";

  if (ageMs < 10_000) {
    color = "bg-up";
    pulse = true;
    label = "live";
  } else if (ageMs < 45_000) {
    color = "bg-accent";
    label = `${Math.floor(ageMs / 1000)}s`;
  } else if (freshAt) {
    color = "bg-fg-dim";
    label = `${Math.floor(ageMs / 1000)}s`;
  }

  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${color} ${pulse ? "dot-pulse" : ""}`}
        aria-hidden
      />
      <span className="caption text-fg-dim text-[10px] tnum">{label}</span>
    </span>
  );
}
