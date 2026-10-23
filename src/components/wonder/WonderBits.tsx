"use client";

import { createContext, useContext, type ReactNode } from "react";
import useSWR from "swr";
import type { PublicClient } from "viem";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { WONDER_ON_BUILDERS, type WonderStatus } from "@/lib/wonder";
import { readExpiry, readWonderStatus, type WonderReader } from "@/lib/wonder-chain";

export interface WonderStatusState {
  status: Record<string, WonderStatus>;
  expiry: number | null;
  refresh: () => void;
}

const EMPTY: WonderStatusState = { status: {}, expiry: null, refresh: () => {} };

/** Wonder escrow of `sources` on the builders network; empty while wonder markets are off. */
export function useWonderStatus(sources: string[]): WonderStatusState {
  const w = WONDER_ON_BUILDERS;
  const key = w && sources.length ? ["wonder-status", w.escrow, [...sources].sort().join("|")] : null;
  const { data, mutate } = useSWR(key, async () => {
    const c = buildersClient() as PublicClient as unknown as WonderReader;
    const [status, expiry] = await Promise.all([readWonderStatus(c, w!, sources), readExpiry(c, w!)]);
    return { status, expiry };
  }, { revalidateOnFocus: false });
  return data ? { ...data, refresh: () => void mutate() } : { ...EMPTY, refresh: () => void mutate() };
}

/** The escrow's EXPIRY (seconds) on the builders network, or null. */
export function useWonderExpiry(): number | null {
  const w = WONDER_ON_BUILDERS;
  const { data } = useSWR(w ? ["wonder-expiry", w.escrow] : null, () =>
    readExpiry(buildersClient() as PublicClient as unknown as WonderReader, w!), { revalidateOnFocus: false });
  return data ?? null;
}

const Ctx = createContext<WonderStatusState>(EMPTY);

/** One read of every source a page shows (e.g. /admin's invites), shared by its rows. */
export function WonderStatusProvider({ sources, children }: { sources: string[]; children: ReactNode }) {
  return <Ctx.Provider value={useWonderStatus(sources)}>{children}</Ctx.Provider>;
}

export const useWonderContext = () => useContext(Ctx);
