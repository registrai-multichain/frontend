interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  showFill?: boolean;
}

export function Sparkline({
  values: input,
  width = 880,
  height = 140,
  className,
  showFill = true,
}: SparklineProps) {
  if (input.length === 0) return null;
  // Single-value mode: duplicate the value so the line component renders a
  // clean flat baseline + a dot at the right edge. Used on day-zero of a
  // freshly-deployed feed.
  const values = input.length === 1 ? [input[0]!, input[0]!] : input;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padY = 12;
  const usableH = height - padY * 2;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = padY + (1 - (v - min) / range) * usableH;
    return [x, y] as const;
  });

  const pathD = points
    .map(([x, y], i) => (i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`))
    .join(" ");

  const fillD = `${pathD} L${width},${height} L0,${height} Z`;

  const last = points[points.length - 1]!;
  const first = points[0]!;
  const trendUp = values[values.length - 1]! >= values[0]!;
  const stroke = trendUp ? "var(--up)" : "var(--down)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height }}
      aria-hidden
    >
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
        <pattern id="sparkGrid" width="48" height="28" patternUnits="userSpaceOnUse">
          <path
            d="M48 0 L0 0 0 28"
            fill="none"
            stroke="var(--line)"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>

      <rect width={width} height={height} fill="url(#sparkGrid)" />

      {/* Faint mid-line */}
      <line
        x1={0}
        x2={width}
        y1={padY + usableH / 2}
        y2={padY + usableH / 2}
        stroke="var(--line-strong)"
        strokeDasharray="2 4"
        strokeWidth="0.5"
      />

      {showFill && <path d={fillD} fill="url(#sparkFill)" />}
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="spark-path"
      />

      {/* First and last markers */}
      <circle cx={first[0]} cy={first[1]} r={1.75} fill="var(--fg-dim)" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={stroke} />
      <circle
        cx={last[0]}
        cy={last[1]}
        r={6}
        fill={stroke}
        opacity="0.18"
        className="dot-pulse"
      />
    </svg>
  );
}
