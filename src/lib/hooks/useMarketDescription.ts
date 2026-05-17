"use client";

import { useEffect, useState } from "react";

const WORKER_URL =
  process.env.NEXT_PUBLIC_DESCRIPTION_URL ??
  "https://registrai-agents.guanyidu98.workers.dev/market-description";

export interface MarketDescription {
  description: string;
  creator: `0x${string}`;
  updatedAt: number;
}

/**
 * Fetch a creator-supplied market description from the Cloudflare Worker
 * KV. Returns undefined while loading or null if none set. Cached
 * trivially via React state — call sites that need fresh data on every
 * mount should remount.
 */
export function useMarketDescription(marketId: string | undefined): {
  data: MarketDescription | undefined;
  loading: boolean;
} {
  const [data, setData] = useState<MarketDescription | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!marketId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`${WORKER_URL}?marketId=${marketId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setData(j?.description ? (j as MarketDescription) : undefined);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  return { data, loading };
}

/**
 * Sign + POST a description to the Worker. The signature must come from
 * the market's creator; the Worker checks this against chain state.
 */
export async function postMarketDescription(args: {
  marketId: string;
  description: string;
  signMessage: (message: string) => Promise<`0x${string}`>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = `registrai-market-description:${args.marketId.toLowerCase()}:${args.description}`;
  let signature: `0x${string}`;
  try {
    signature = await args.signMessage(message);
  } catch (e) {
    return { ok: false, error: (e as Error).message || "signing rejected" };
  }
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: args.marketId, description: args.description, signature }),
    });
    const j = (await res.json()) as { ok?: boolean; error?: string };
    if (j.ok) return { ok: true };
    return { ok: false, error: j.error ?? `http ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
