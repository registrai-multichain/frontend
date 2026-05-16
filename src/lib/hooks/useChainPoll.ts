"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Generic polling hook. Re-runs `fetcher` on a `intervalMs` cadence while
 * the tab is visible; pauses on hidden so we don't burn RPC quota on
 * background tabs. Resumes (and immediately refreshes) on visibility.
 *
 * Returns the latest value plus a `freshAt` timestamp the UI can use to
 * render a "live" indicator.
 */
export function useChainPoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): { data: T | undefined; freshAt: number | undefined; error: Error | undefined } {
  const [data, setData] = useState<T | undefined>();
  const [freshAt, setFreshAt] = useState<number | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const v = await fetcher();
        if (!mounted.current) return;
        setData(v);
        setFreshAt(Date.now());
        setError(undefined);
      } catch (e) {
        if (!mounted.current) return;
        setError(e as Error);
      }
      if (mounted.current) timer = setTimeout(tick, intervalMs);
    };

    tick();
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        if (timer) clearTimeout(timer);
        tick();
      }
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);

    return () => {
      mounted.current = false;
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, freshAt, error };
}
