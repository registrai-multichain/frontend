interface Props {
  width?: string | number;
  height?: string | number;
  className?: string;
}

/**
 * Subtle placeholder line that pulses where chain reads are in flight.
 * Width/height accept any CSS length; defaults work for inline text.
 */
export function Skeleton({ width = "100%", height = "0.85em", className }: Props) {
  return (
    <span
      className={`inline-block align-middle bg-line-strong/40 skeleton-pulse rounded-[1px] ${className ?? ""}`}
      style={{ width, height }}
      aria-hidden
    />
  );
}
