"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "./WalletProvider";
import { txUrl } from "@/lib/chain";

const WORKER_URL = "https://registrai-agents.guanyidu98.workers.dev";
const REWARD = 100;

type State = "loading" | "unclaimed" | "claimed" | "claiming" | "error";

interface Claim { points?: number; txHash?: `0x${string}` }

/**
 * Promotes Registrai's soulbound credit system at the point of action: use the
 * borrow pool (borrow against a position OR supply USDC) and claim earned
 * credits. The reward is EARNED reputation/utility — not a purchase and not a
 * promise of future token value.
 */
export function BetCreditsCard() {
  const { address, connect, isOnSupportedChain, switchChain } = useWallet();
  const [state, setState] = useState<State>("loading");
  const [claim, setClaim] = useState<Claim>();
  const [msg, setMsg] = useState<string>();

  const loadStatus = useCallback(async () => {
    if (!address) { setState("unclaimed"); return; }
    try {
      const res = await fetch(`${WORKER_URL}/quest/status?wallet=${address}`, { cache: "no-store" });
      const j = (await res.json()) as { quests?: { bet_use?: Claim | null } };
      if (j.quests?.bet_use) { setClaim(j.quests.bet_use); setState("claimed"); }
      else setState("unclaimed");
    } catch {
      setState("unclaimed");
    }
  }, [address]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  async function doClaim() {
    if (!address) { void connect(); return; }
    if (!isOnSupportedChain) { void switchChain(); return; }
    setState("claiming"); setMsg(undefined);
    try {
      const res = await fetch(`${WORKER_URL}/quest/bet/claim`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      });
      const j = (await res.json()) as { ok?: boolean; points?: number; txHash?: `0x${string}`; error?: string; claim?: Claim };
      if (res.ok && j.ok) { setClaim({ points: j.points, txHash: j.txHash }); setState("claimed"); return; }
      if (res.status === 409) { setClaim(j.claim); setState("claimed"); return; }
      setMsg(j.error ?? "claim failed"); setState("error");
    } catch {
      setMsg("network error — try again"); setState("error");
    }
  }

  return (
    <div className="mt-12 border border-accent/30 bg-accent/[0.04] p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-[46ch]">
          <div className="caption text-2xs text-accent mb-2">earn credits</div>
          <h3 className="font-serif text-[20px] leading-snug mb-2">
            Earn {REWARD} Registrai credits for using the pool.
          </h3>
          <p className="text-[13px] text-fg-mute leading-relaxed">
            Borrow against a position or supply USDC, then claim. Credits are
            soulbound, onchain reputation for early protocol users — earned, not
            bought. Requires the{" "}
            <Link href="/profile" className="text-accent underline">Connect&nbsp;Twitter</Link>{" "}
            quest first (one handle per wallet, keeps the leaderboard honest).
          </p>
        </div>

        <div className="shrink-0">
          {state === "claimed" ? (
            <div className="text-[13px] text-emerald-400">
              ✓ {claim?.points ?? REWARD} credits claimed
              {claim?.txHash && (
                <>
                  {" · "}
                  <a className="underline" href={txUrl(claim.txHash)} target="_blank" rel="noreferrer">tx</a>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={doClaim}
              disabled={state === "claiming" || state === "loading"}
              className="px-4 py-2.5 text-[13px] bg-accent/90 text-bg hover:bg-accent disabled:opacity-40 transition-colors"
            >
              {state === "loading" ? "…"
                : state === "claiming" ? "claiming…"
                : !address ? "Connect to claim"
                : `Claim ${REWARD} credits`}
            </button>
          )}
        </div>
      </div>

      {state === "error" && msg && (
        <p className="mt-3 text-2xs text-amber-300/80" aria-live="polite">{msg}</p>
      )}
    </div>
  );
}
