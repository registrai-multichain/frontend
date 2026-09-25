"use client";

import useSWR from "swr";
import type { PublicClient } from "viem";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { marketLabels, WONDER_ON_BUILDERS, type MarketSubject, type WonderStatus } from "@/lib/wonder";
import { readExpiry, readWonderStatus, type WonderReader } from "@/lib/wonder-chain";

const EMPTY: { status: Record<string, WonderStatus>; expiry: number | null } = { status: {}, expiry: null };

/** Wonder escrow of `sources` on the builders network; empty while wonder markets are off. */
export function useWonderStatus(sources: string[]) {
  const w = WONDER_ON_BUILDERS;
  const key = w && sources.length ? ["wonder-status", w.escrow, [...sources].sort().join("|")] : null;
  const { data } = useSWR(key, async () => {
    const c = buildersClient() as PublicClient as unknown as WonderReader;
    const [status, expiry] = await Promise.all([readWonderStatus(c, w!, sources), readExpiry(c, w!)]);
    return { status, expiry };
  }, { revalidateOnFocus: false });
  return data ?? EMPTY;
}

/** A market's unclaimed / community labels (spec "Site"). */
export function MarketLabels({ subject }: { subject?: MarketSubject }) {
  const labels = marketLabels(subject);
  if (!labels.length) return null;
  return (
    <div className="wonder-labels">
      {labels.map((l) => (
        <span key={l} className="wonder-label">{l}</span>
      ))}
    </div>
  );
}
