"use client";

import type { ReactNode } from "react";
import { donutArcs } from "@/lib/transparency";

/** Shared pieces of the dashboard (Transparency and BuybackPanel). */
export const BIG = { fontSize: "clamp(24px, 6vw, 34px)", lineHeight: 1.05, fontWeight: 400 } as const;

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="pa-card flex flex-col gap-1">
      <span className="pa-muted pa-small">{label}</span>
      <b className={`pa-serif tnum ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`} style={BIG}>{value}</b>
      {sub && <span className="pa-muted pa-small">{sub}</span>}
    </div>
  );
}

/** A ring split into parts by share; a sliver stays visible however small. Children sit in the hole. */
export function Donut({ parts, label, size = 168, stroke = 22, children }: {
  parts: { key: string; share: number; color: string }[]; label: string; size?: number; stroke?: number; children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = parts.filter((p) => p.share > 0).length;
  const gap = shown > 1 ? 3 : 0;
  const arcs = donutArcs(parts.map((p) => p.share), c, gap + 4);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {arcs.map((a, i) => a.length > 0 && (
          <circle
            key={parts[i].key}
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={parts[i].color} strokeWidth={stroke}
            strokeDasharray={`${Math.max(a.length - gap, 1)} ${c}`} strokeDashoffset={-a.offset}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export const Swatch = ({ color }: { color: string }) => <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
