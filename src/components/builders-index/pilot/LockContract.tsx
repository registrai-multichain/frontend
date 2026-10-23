"use client";

import { useEffect, useState } from "react";
import { PILOT_PATHS, type PilotAccountView } from "@/lib/abi-pilot-api";

/** Server text before the API answers, and where it isn't deployed. */
export const LOCK_CONTRACT_PENDING = "The lock contract's address shows here once it is live; until then, leverage above 1× is closed.";

/**
 * The lock contract's address on the Pilot rules page (review N3): read from the server's PILOT_LOCK_FACTORY through
 * the public account view (a visitor read: no cookie sent), so the page and the server never disagree.
 */
export function LockContract({ initial = null }: { initial?: string | null }) {
  const [factory, setFactory] = useState<string | null>(initial);
  useEffect(() => {
    let live = true;
    fetch(PILOT_PATHS.account, { cache: "no-store", credentials: "omit" })
      .then((r) => (r.ok ? (r.json() as Promise<PilotAccountView>) : null))
      .then((v) => { if (live && v && typeof v.lockFactory === "string") setFactory(v.lockFactory); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return factory
    ? <>Lock contract on Arc: <code>{factory}</code>. Lock, withdraw and claim transactions are public on Arc.</>
    : <>{LOCK_CONTRACT_PENDING} Lock, withdraw and claim transactions are public on Arc.</>;
}
