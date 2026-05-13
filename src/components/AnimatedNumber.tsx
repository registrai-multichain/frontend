"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Target value. */
  value: number;
  /** ms to animate from 0 to target on mount; subsequent updates ease over half this. */
  duration?: number;
  /** Decimals for display. */
  decimals?: number;
  /** Optional formatter that overrides the default. Receives the current animated value. */
  format?: (v: number) => string;
  className?: string;
}

/**
 * Ticks a number from its prior value to the target on update, using an
 * ease-out curve. Mount animation runs from 0 so big hero values feel like
 * they're loading from the chain rather than appearing instantly.
 */
export function AnimatedNumber({
  value,
  duration = 900,
  decimals = 0,
  format,
  className,
}: Props) {
  const [display, setDisplay] = useState<number>(0);
  const previousRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const from = previousRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    startRef.current = performance.now();
    let raf = 0;
    const totalMs = previousRef.current === 0 ? duration : duration / 2;
    const tick = (t: number) => {
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / totalMs);
      const eased = 1 - Math.pow(1 - p, 3); // cubic ease-out
      const v = from + (to - from) * eased;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else previousRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const text = format
    ? format(display)
    : display.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });

  return <span className={`tnum ${className ?? ""}`}>{text}</span>;
}
