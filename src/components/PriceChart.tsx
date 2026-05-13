"use client";

import type { MarketTrade } from "@/lib/types";

interface Props {
  trades: MarketTrade[];
  height?: number;
}

export function PriceChart({ trades, height = 220 }: Props) {
  if (trades.length < 2) return null;
  const width = 880;
  const padX = 8;
  const padY = 14;

  const points = trades.map((t, i) => {
    const x = padX + (i / (trades.length - 1)) * (width - 2 * padX);
    const y = padY + (1 - t.yesPrice) * (height - 2 * padY);
    return [x, y] as const;
  });

  const path = points
    .map(([x, y], i) => (i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`))
    .join(" ");

  const last = points[points.length - 1]!;
  const first = points[0]!;
  const trendUp = trades[trades.length - 1]!.yesPrice >= trades[0]!.yesPrice;
  const stroke = trendUp ? "var(--up)" : "var(--down)";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height }}
        aria-hidden
      >
        <defs>
          <pattern id="chartGrid" width="44" height={(height - 2 * padY) / 4} patternUnits="userSpaceOnUse">
            <path
              d={`M44 0 L0 0 0 ${(height - 2 * padY) / 4}`}
              fill="none"
              stroke="var(--line)"
              strokeWidth="0.5"
            />
          </pattern>
          <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width={width} height={height} fill="url(#chartGrid)" />

        {/* 50¢ midline */}
        <line
          x1={0}
          x2={width}
          y1={padY + (height - 2 * padY) / 2}
          y2={padY + (height - 2 * padY) / 2}
          stroke="var(--line-strong)"
          strokeDasharray="2 4"
          strokeWidth="0.5"
        />

        <path d={`${path} L${last[0]},${height} L${first[0]},${height} Z`} fill="url(#chartFill)" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

        <circle cx={last[0]} cy={last[1]} r={3} fill={stroke} />
        <circle cx={last[0]} cy={last[1]} r={7} fill={stroke} opacity="0.2" className="dot-pulse" />
      </svg>

      {/* Y-axis labels */}
      <div className="absolute inset-y-0 right-0 flex flex-col justify-between text-2xs text-fg-dim pointer-events-none py-3">
        <span>100¢</span>
        <span>50¢</span>
        <span>0¢</span>
      </div>
    </div>
  );
}
