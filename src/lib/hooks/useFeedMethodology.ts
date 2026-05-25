"use client";

import { useEffect, useState } from "react";

const WORKER_URL =
  process.env.NEXT_PUBLIC_METHODOLOGY_URL ??
  "https://registrai-agents.guanyidu98.workers.dev/feed-methodology";

export interface FeedMethodology {
  methodology: string;
  creator: `0x${string}`;
  updatedAt: number;
}

/**
 * Fetch a creator-supplied feed methodology from the Cloudflare Worker KV.
 * Mirrors the `/market-description` pattern: signature-gated write, public
 * read. Returns undefined while loading; null-equivalent when none set.
 */
export function useFeedMethodology(feedId: string | undefined): {
  data: FeedMethodology | undefined;
  loading: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<FeedMethodology | undefined>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!feedId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${WORKER_URL}?feedId=${feedId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setData(j?.methodology ? (j as FeedMethodology) : undefined);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [feedId, version]);

  return { data, loading, refetch: () => setVersion((v) => v + 1) };
}

/** localStorage key for unsaved methodology text (for retry-on-failure UX). */
export function methodologyLocalKey(feedId: string): string {
  return `registrai:methodology:${feedId.toLowerCase()}`;
}

/**
 * Sign + POST a methodology to the Worker. The signature must come from the
 * feed's creator; the Worker reads `Registry.getFeed(feedId).creator` to
 * verify. The text is also hashed and compared to the on-chain
 * methodologyHash so KV can never drift from chain.
 */
export async function postFeedMethodology(args: {
  feedId: string;
  methodology: string;
  signMessage: (message: string) => Promise<`0x${string}`>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = `registrai-feed-methodology:${args.feedId.toLowerCase()}:${args.methodology}`;
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
      body: JSON.stringify({
        feedId: args.feedId,
        methodology: args.methodology,
        signature,
      }),
    });
    const j = (await res.json()) as { ok?: boolean; error?: string };
    if (j.ok) return { ok: true };
    return { ok: false, error: j.error ?? `http ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
