"use client";

import { useEffect, useState } from "react";
import { useWallet } from "./WalletProvider";
import {
  methodologyLocalKey,
  postFeedMethodology,
  useFeedMethodology,
} from "@/lib/hooks/useFeedMethodology";

/**
 * Renders a feed's creator-supplied methodology prose.
 *
 * Resolution order:
 *   1. If the worker has the text → render it.
 *   2. Else, if the connected wallet is the feed's creator AND localStorage
 *      has an unsaved methodology for this feed → show a "publish" retry
 *      button (sign + POST to worker). Cleans up localStorage on success.
 *   3. Else, if a `fallbackUrl` is provided (legacy v1.0/v1.1 feeds with
 *      GitHub-hosted methodology docs) → render a link.
 *   4. Otherwise → render nothing.
 */
export function MethodologyLive({
  feedId,
  creator,
  fallbackUrl,
}: {
  feedId: string;
  creator?: string;
  fallbackUrl?: string;
}) {
  const { data, loading, refetch } = useFeedMethodology(feedId);
  const { address, walletClient } = useWallet();

  const [pendingText, setPendingText] = useState<string | undefined>();
  const [retryState, setRetryState] = useState<
    "idle" | "signing" | "error" | "done"
  >("idle");
  const [retryError, setRetryError] = useState<string | undefined>();

  // Probe localStorage on mount + whenever the worker response changes (so
  // a successful save clears any stale local copy).
  useEffect(() => {
    if (!feedId) return;
    try {
      const t = localStorage.getItem(methodologyLocalKey(feedId));
      if (t && !data?.methodology) {
        setPendingText(t);
      } else if (data?.methodology) {
        // Worker has it now — clean up any stale local copy.
        localStorage.removeItem(methodologyLocalKey(feedId));
        setPendingText(undefined);
      }
    } catch {
      /* ignore (private mode etc.) */
    }
  }, [feedId, data]);

  if (loading && !pendingText && !fallbackUrl) return null;

  const isCreator =
    !!address && !!creator && address.toLowerCase() === creator.toLowerCase();

  async function publishNow() {
    if (!pendingText || !walletClient?.account) return;
    setRetryState("signing");
    setRetryError(undefined);
    try {
      const account = walletClient.account;
      const r = await postFeedMethodology({
        feedId,
        methodology: pendingText,
        signMessage: (m) => walletClient.signMessage({ account, message: m }),
      });
      if (!r.ok) {
        setRetryState("error");
        setRetryError(r.error);
        return;
      }
      try {
        localStorage.removeItem(methodologyLocalKey(feedId));
      } catch {
        /* ignore */
      }
      setPendingText(undefined);
      setRetryState("done");
      refetch();
    } catch (e) {
      setRetryState("error");
      setRetryError((e as Error).message || "signing rejected");
    }
  }

  // 1. Worker has the text — primary render path.
  if (data?.methodology) {
    return (
      <div className="border border-line bg-bg-elev/30 p-4">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="caption text-accent">creator-supplied</span>
          <span className="caption text-fg-dim text-[10px]">
            · onchain hash · signed by feed creator
          </span>
        </div>
        <pre className="text-[12.5px] leading-relaxed text-fg whitespace-pre-wrap font-mono">
          {data.methodology}
        </pre>
      </div>
    );
  }

  // 2. Pending unsaved methodology — offer retry if the viewer is the creator.
  if (isCreator && pendingText) {
    return (
      <div className="border border-down/40 bg-bg-elev/30 p-4 space-y-2">
        <div className="caption text-down">methodology not yet published</div>
        <p className="text-[12.5px] text-fg-mute leading-relaxed">
          Your methodology was hashed onchain but the signature to publish the
          full text to registrai.cc was skipped. Anyone visiting this feed
          can&apos;t read it yet — sign once to publish.
        </p>
        <button
          onClick={publishNow}
          disabled={retryState === "signing"}
          className="px-3 py-1.5 border border-accent/60 text-accent text-2xs hover:bg-accent hover:text-bg transition-colors disabled:opacity-40"
        >
          {retryState === "signing"
            ? "signing…"
            : retryState === "done"
              ? "✓ published"
              : "publish methodology"}
        </button>
        {retryError && (
          <p className="text-2xs text-down break-all">⚠ {retryError}</p>
        )}
      </div>
    );
  }

  // 3. Legacy fallback URL (GitHub-hosted methodology for the seeded feeds).
  if (fallbackUrl) {
    return (
      <a
        href={fallbackUrl}
        target="_blank"
        rel="noreferrer"
        className="hover:text-accent underline decoration-fg-dim underline-offset-4 text-2xs"
      >
        view spec ↗
      </a>
    );
  }

  // 4. Nothing to show.
  return null;
}
