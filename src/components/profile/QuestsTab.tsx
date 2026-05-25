"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useWallet } from "../WalletProvider";
import { txUrl } from "@/lib/chain";

const WORKER_URL = "https://registrai-agents.guanyidu98.workers.dev";

// Hard cap so the "verifying…" state can never hang past the user's patience.
// Cloudflare workers cap server-side at ~30s anyway; this matches.
const FETCH_TIMEOUT_MS = 30_000;
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new Error("verification timed out — please retry");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

interface TwitterClaim {
  handle: string;
  txHash: string;
  points: number;
  timestamp: number;
}

interface ShareAgentClaim {
  handle: string;
  tweetUrl: string;
  txHash: string;
  points: number;
  timestamp: number;
}

interface QuestStatus {
  twitter_connect: TwitterClaim | null;
  share_agent: ShareAgentClaim | null;
}

interface StartResponse {
  tweet: string;
  /** Optional array of variant templates (share-agent quest returns 3). */
  variants?: string[];
  nonce: string;
  points: number;
}

type FlowState =
  | { kind: "idle" }
  | { kind: "starting" }
  | {
      kind: "awaiting-tweet";
      variants: string[];
      variantIdx: number;
      nonce: string;
    }
  | { kind: "verifying" }
  | { kind: "done"; claim: TwitterClaim }
  | { kind: "error"; message: string };

/**
 * Social quests tab. Each quest verifies an off-chain action via the social
 * signal oracle (a bonded Registrai agent) and mints soulbound credit pts.
 *
 * Today: "Connect Twitter" — prove ownership by tweeting a wallet-bound
 * challenge string. Future: retweet, follow, referrals.
 */
export function QuestsTab({ address }: { address: Address }) {
  const { address: connected } = useWallet();
  const isSelf =
    !!connected && connected.toLowerCase() === address.toLowerCase();

  const [status, setStatus] = useState<QuestStatus | undefined>();
  // Connect-twitter flow state.
  const [tweetUrl, setTweetUrl] = useState("");
  const [flow, setFlow] = useState<FlowState>({ kind: "idle" });
  // Share-agent flow state.
  const [shareUrl, setShareUrl] = useState("");
  const [shareFlow, setShareFlow] = useState<FlowState>({ kind: "idle" });

  // Load quest status once on mount + after each successful claim. Only
  // re-fetch when a flow transitions to "done" — intermediate states don't
  // change server-side quest status, so don't waste round-trips.
  const flowDone = flow.kind === "done";
  const shareDoneEv = shareFlow.kind === "done";
  useEffect(() => {
    let cancelled = false;
    fetch(`${WORKER_URL}/quest/status?wallet=${address}`)
      .then((r) => r.json())
      .then((data: QuestStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [address, flowDone, shareDoneEv]);

  const twitterClaim = status?.twitter_connect ?? null;
  const twitterDone = !!twitterClaim;
  const shareClaim = status?.share_agent ?? null;
  const shareDone = !!shareClaim;

  // If the connected wallet changes (user switches account in MetaMask), wipe
  // quest state — the previous wallet's nonces + templates don't apply.
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (prevConnected.current && connected && prevConnected.current !== connected) {
      setFlow({ kind: "idle" });
      setShareFlow({ kind: "idle" });
      setTweetUrl("");
      setShareUrl("");
      setStatus(undefined);
    }
    prevConnected.current = connected;
  }, [connected]);

  // Auto-fetch templates as soon as the quest panel is visible — no extra
  // button click. Users see the paste field + suggested template immediately.
  useEffect(() => {
    if (isSelf && !twitterDone && flow.kind === "idle") {
      startTwitter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelf, twitterDone]);
  useEffect(() => {
    if (isSelf && twitterDone && !shareDone && shareFlow.kind === "idle") {
      startShareAgent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelf, twitterDone, shareDone]);

  async function startTwitter() {
    setFlow({ kind: "starting" });
    try {
      const res = await fetch(`${WORKER_URL}/quest/twitter/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      });
      const data = (await res.json()) as
        | StartResponse
        | { error: string };
      if (!res.ok || "error" in data) {
        setFlow({
          kind: "error",
          message: (data as { error: string }).error ?? "failed to start",
        });
        return;
      }
      setFlow({
        kind: "awaiting-tweet",
        variants: data.variants ?? [data.tweet],
        variantIdx: 0,
        nonce: data.nonce,
      });
    } catch (e) {
      setFlow({ kind: "error", message: (e as Error).message });
    }
  }

  async function verifyTwitter() {
    if (!tweetUrl.trim()) return;
    const nonce = flow.kind === "awaiting-tweet" ? flow.nonce : undefined;
    if (!nonce) {
      setFlow({ kind: "error", message: "missing nonce — refresh and try again" });
      return;
    }
    setFlow({ kind: "verifying" });
    try {
      const res = await fetchWithTimeout(`${WORKER_URL}/quest/twitter/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          tweetUrl: tweetUrl.trim(),
          nonce,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setFlow({ kind: "error", message: data.error ?? "verification failed" });
        return;
      }
      setFlow({ kind: "done", claim: data });
      setTweetUrl("");
    } catch (e) {
      setFlow({ kind: "error", message: (e as Error).message });
    }
  }

  async function startShareAgent() {
    setShareFlow({ kind: "starting" });
    try {
      const res = await fetch(`${WORKER_URL}/quest/twitter/share-agent/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      });
      const data = (await res.json()) as
        | StartResponse
        | { error: string };
      if (!res.ok || "error" in data) {
        setShareFlow({
          kind: "error",
          message: (data as { error: string }).error ?? "failed to start",
        });
        return;
      }
      setShareFlow({
        kind: "awaiting-tweet",
        variants: data.variants ?? [data.tweet],
        variantIdx: 0,
        nonce: data.nonce,
      });
    } catch (e) {
      setShareFlow({ kind: "error", message: (e as Error).message });
    }
  }

  async function verifyShareAgent() {
    if (!shareUrl.trim()) return;
    const nonce =
      shareFlow.kind === "awaiting-tweet" ? shareFlow.nonce : undefined;
    if (!nonce) {
      setShareFlow({
        kind: "error",
        message: "missing nonce — refresh and try again",
      });
      return;
    }
    setShareFlow({ kind: "verifying" });
    try {
      const res = await fetchWithTimeout(`${WORKER_URL}/quest/twitter/share-agent/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: address,
          tweetUrl: shareUrl.trim(),
          nonce,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setShareFlow({ kind: "error", message: data.error ?? "verification failed" });
        return;
      }
      setShareFlow({ kind: "done", claim: data });
      setShareUrl("");
    } catch (e) {
      setShareFlow({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <div className="space-y-6">
      <div className="border border-line bg-bg-elev/30 p-5">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <div className="caption text-accent mb-2">connect twitter</div>
            <p className="text-[13px] text-fg-mute leading-relaxed max-w-[58ch]">
              Prove ownership of a Twitter handle by posting a wallet-bound
              challenge tweet. Free — no Twitter API key required. Bound 1:1
              between wallet and handle.
            </p>
          </div>
          <div className="caption text-fg tnum">+50 pts</div>
        </div>

        <div className="mt-5">
          {twitterDone ? (
            <ClaimedPanel claim={twitterClaim!} />
          ) : !isSelf ? (
            <p className="text-2xs text-fg-dim">
              connect your own wallet to claim
            </p>
          ) : (
            <TwitterQuestFlow
              flow={flow}
              tweetUrl={tweetUrl}
              setTweetUrl={setTweetUrl}
              onVerify={verifyTwitter}
              onRetry={startTwitter}
              onCycleVariant={() =>
                setFlow((f) =>
                  f.kind === "awaiting-tweet"
                    ? { ...f, variantIdx: (f.variantIdx + 1) % f.variants.length }
                    : f,
                )
              }
            />
          )}
        </div>
      </div>

      {/* Quest 2 — tweet about your bonded agent */}
      <div
        className={`border p-5 transition-colors ${
          twitterDone
            ? "border-line bg-bg-elev/30"
            : "border-line/40 bg-bg-elev/10 opacity-60"
        }`}
      >
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <div className="caption text-accent mb-2">tweet about your agent</div>
            <p className="text-[13px] text-fg-mute leading-relaxed max-w-[58ch]">
              Once your wallet has a bonded oracle agent on chain AND your
              Twitter is connected, post a tweet mentioning @registraidotcc
              (or registrai.cc) with the wallet + proof nonce. Verified via
              oEmbed.
            </p>
          </div>
          <div className="caption text-fg tnum">+150 pts</div>
        </div>

        <div className="mt-5">
          {!twitterDone ? (
            <p className="text-2xs text-fg-dim">
              complete Connect Twitter first to unlock
            </p>
          ) : shareDone ? (
            <ShareClaimedPanel claim={shareClaim!} />
          ) : !isSelf ? (
            <p className="text-2xs text-fg-dim">connect your own wallet to claim</p>
          ) : (
            <TwitterQuestFlow
              flow={shareFlow}
              tweetUrl={shareUrl}
              setTweetUrl={setShareUrl}
              onVerify={verifyShareAgent}
              onRetry={startShareAgent}
              onCycleVariant={() =>
                setShareFlow((f) =>
                  f.kind === "awaiting-tweet"
                    ? { ...f, variantIdx: (f.variantIdx + 1) % f.variants.length }
                    : f,
                )
              }
              verifyLabel="verify + claim 150 pts →"
            />
          )}
        </div>
      </div>

      {/* Locked future quests — visible so users know more is coming */}
      <LockedQuest
        label="refer a friend who registers"
        points={200}
        copy="Up to 5 referrals per wallet. Onchain proof of registration tied to your handle. (coming)"
      />
      <LockedQuest
        label="quote-tweet a market"
        points={100}
        copy="Quote-tweet any registrai market URL. Free oEmbed verification. (coming)"
      />

      <p className="text-2xs text-fg-dim leading-relaxed pt-2 max-w-[60ch]">
        All quest credits are minted by the{" "}
        <a
          href="https://testnet.arcscan.app/address/0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263"
          target="_blank"
          rel="noreferrer"
          className="underline decoration-fg-dim underline-offset-4 hover:text-accent"
        >
          Registrai Social Signals oracle
        </a>{" "}
        — a bonded agent on Arc with 10 USDC slashable bond. Same trust model
        as every other Registrai data feed.
      </p>
    </div>
  );
}

function TwitterQuestFlow({
  flow,
  tweetUrl,
  setTweetUrl,
  onVerify,
  onRetry,
  onCycleVariant,
  verifyLabel = "verify + claim 50 pts →",
}: {
  flow: FlowState;
  tweetUrl: string;
  setTweetUrl: (s: string) => void;
  onVerify: () => void;
  /** Re-fetch templates from scratch — used by the try-again button after
   *  an error AND by the initial auto-start on mount. */
  onRetry: () => void;
  onCycleVariant: () => void;
  verifyLabel?: string;
}) {
  if (flow.kind === "idle" || flow.kind === "starting") {
    // Auto-start runs on mount; show a one-line loader while the template
    // generates. Users almost never see this state because the request is
    // sub-second.
    return <p className="text-2xs text-fg-dim">loading…</p>;
  }
  if (flow.kind === "awaiting-tweet") {
    const tweet = flow.variants[flow.variantIdx] ?? flow.variants[0] ?? "";
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`;
    const multipleVariants = flow.variants.length > 1;
    return (
      <div className="space-y-4">
        {/* PRIMARY: paste field + verify */}
        <div>
          <input
            type="text"
            value={tweetUrl}
            onChange={(e) => setTweetUrl(e.target.value)}
            placeholder="paste your tweet URL · https://x.com/…/status/…"
            className="w-full bg-bg border border-line px-3 py-2.5 text-[13px] focus:outline-none focus:border-accent"
          />
          <button
            onClick={onVerify}
            disabled={!tweetUrl.trim()}
            className="mt-3 w-full sm:w-auto px-4 py-2 border border-accent/60 text-accent text-[12.5px] hover:bg-accent hover:text-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {verifyLabel}
          </button>
        </div>

        {/* SECONDARY: collapsible template hint */}
        <details className="border-t border-line/60 pt-3 group">
          <summary className="text-2xs text-fg-dim cursor-pointer hover:text-fg-mute select-none">
            need a tweet? show me a suggestion ↓
          </summary>
          <div className="mt-3 space-y-3">
            <pre className="text-[12px] leading-relaxed text-fg-mute bg-bg-elev/60 border border-line p-3 overflow-x-auto whitespace-pre-wrap">
              {tweet}
            </pre>
            <div className="flex gap-3 flex-wrap items-center">
              <a
                href={intentUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 border border-accent/60 text-accent text-2xs hover:bg-accent hover:text-bg transition-colors"
              >
                open in twitter →
              </a>
              <button
                onClick={() => navigator.clipboard?.writeText(tweet)}
                className="px-3 py-1.5 border border-line text-fg-mute text-2xs hover:text-fg hover:border-line-strong transition-colors"
              >
                copy text
              </button>
              {multipleVariants && (
                <button
                  onClick={onCycleVariant}
                  className="text-2xs text-fg-dim hover:text-accent transition-colors ml-auto"
                >
                  ↻ template {flow.variantIdx + 1}/{flow.variants.length}
                </button>
              )}
            </div>
            <p className="text-2xs text-fg-dim leading-relaxed">
              Any tweet works as long as it contains your wallet address and a
              mention of @registraidotcc or registrai.cc.
            </p>
          </div>
        </details>
      </div>
    );
  }
  if (flow.kind === "verifying") {
    return (
      <p className="text-2xs text-fg-dim">
        verifying tweet via oEmbed + minting onchain… (takes ~5 seconds)
      </p>
    );
  }
  if (flow.kind === "done") {
    return <ClaimedPanel claim={flow.claim} />;
  }
  // error
  return (
    <div className="space-y-2">
      <p className="text-2xs text-down break-all">⚠ {flow.message}</p>
      <button
        onClick={onRetry}
        className="text-2xs text-fg-dim hover:text-fg transition-colors underline decoration-fg-dim underline-offset-4"
      >
        try again
      </button>
    </div>
  );
}

function ClaimedPanel({ claim }: { claim: TwitterClaim }) {
  return (
    <div className="border border-accent/40 bg-bg-elev/40 p-4 space-y-2">
      <div className="caption text-accent">✓ claimed</div>
      <div className="text-2xs text-fg-mute">
        bound to{" "}
        <a
          href={`https://x.com/${claim.handle}`}
          target="_blank"
          rel="noreferrer"
          className="text-fg underline decoration-fg-dim underline-offset-4 hover:text-accent"
        >
          @{claim.handle}
        </a>{" "}
        · +{claim.points} pts ·{" "}
        <a
          href={txUrl(claim.txHash)}
          target="_blank"
          rel="noreferrer"
          className="hover:text-accent transition-colors tnum"
        >
          mint tx ↗
        </a>
      </div>
    </div>
  );
}

function ShareClaimedPanel({ claim }: { claim: ShareAgentClaim }) {
  return (
    <div className="border border-accent/40 bg-bg-elev/40 p-4 space-y-2">
      <div className="caption text-accent">✓ claimed</div>
      <div className="text-2xs text-fg-mute">
        +{claim.points} pts ·{" "}
        <a
          href={claim.tweetUrl}
          target="_blank"
          rel="noreferrer"
          className="text-fg underline decoration-fg-dim underline-offset-4 hover:text-accent"
        >
          your tweet ↗
        </a>{" "}
        ·{" "}
        <a
          href={txUrl(claim.txHash)}
          target="_blank"
          rel="noreferrer"
          className="hover:text-accent transition-colors tnum"
        >
          mint tx ↗
        </a>
      </div>
    </div>
  );
}

function LockedQuest({
  label,
  points,
  copy,
}: {
  label: string;
  points: number;
  copy: string;
}) {
  return (
    <div className="border border-line/40 bg-bg-elev/10 p-5 opacity-60">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <div className="caption text-fg-dim mb-2">
            {label} <span className="text-2xs">· coming next</span>
          </div>
          <p className="text-2xs text-fg-dim leading-relaxed max-w-[58ch]">
            {copy}
          </p>
        </div>
        <div className="caption text-fg-dim tnum">+{points} pts</div>
      </div>
    </div>
  );
}
