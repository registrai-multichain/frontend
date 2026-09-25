"use client";

import { useState } from "react";
import { sourceLabel } from "@/lib/verified-builders";

type State = { kind: "idle" | "sending" } | { kind: "done"; at: string } | { kind: "error"; message: string } | { kind: "unavailable" };

/**
 * "We register it for you": asks builder.registrai.cc (POST /api/register-requests)
 * to queue this claim for the Registrai Safe's next batch. The server stores the
 * request only when the published proof checks out. Where that API does not
 * exist (registrai.cc serves the same page), it falls back to "send us the source".
 */
export function GaslessRequest({ source, proofLive }: { source: string; proofLive: boolean }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function request() {
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/register-requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!(res.headers.get("content-type") ?? "").includes("application/json")) return setState({ kind: "unavailable" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; requestedAt?: string; error?: string };
      if (res.ok && body.ok) return setState({ kind: "done", at: body.requestedAt ?? new Date().toISOString() });
      setState({ kind: "error", message: body.error ?? `request failed (${res.status})` });
    } catch {
      setState({ kind: "unavailable" });
    }
  }

  if (state.kind === "done") {
    return (
      <p className="vf-ok">
        Requested. The Registrai Safe registers {sourceLabel(source)} in its next batch, usually within a day. Keep the proof
        file published; your card appears in the gallery once it&apos;s on-chain.
      </p>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <p className="vf-note">
        Requests aren&apos;t taken on this site. Send <code>{source}</code> to whoever invited you, or email
        contact@registrai.cc, and we register it from the Safe.
      </p>
    );
  }
  return (
    <>
      <button type="button" className="vf-secondary" onClick={request} disabled={!proofLive || state.kind === "sending"}>
        {state.kind === "sending" ? "requesting…" : "register it for me"}
      </button>
      {!proofLive && <p className="vf-hint">Publish the proof first (step 4): the request is checked against it.</p>}
      {state.kind === "error" && <p className="vf-error">{state.message}</p>}
    </>
  );
}
