"use client";

import { useEffect, useState } from "react";
import { InfoBubble } from "@/components/InfoBubble";
import { recordPath, recordState, RECORD_COPY, shortDigest, type RecordState } from "@/lib/record-page";

async function load(): Promise<{ status: number; body: unknown }> {
  try {
    const r = await fetch(recordPath, { cache: "no-store" });
    let body: unknown = {};
    try { body = await r.json(); } catch { /* empty body */ }
    return { status: r.status, body };
  } catch {
    return { status: 0, body: {} };
  }
}

function CopyDigest({ digest }: { digest: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pa-link pa-small"
      style={{ marginLeft: 8, background: "none", border: 0, padding: 0, cursor: "pointer" }}
      onClick={() => { void navigator.clipboard?.writeText(digest).then(() => setDone(true), () => undefined); }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function View({ state }: { state: Extract<RecordState, { kind: "ready" }> }) {
  if (state.rows.length === 0) return <p className="pa-muted">No days recorded yet.</p>;
  return (
    <div className="pa-table-wrap">
    <table className="pa-table">
      <thead>
        <tr><th>Day</th><th>Digest</th><th>Arc tx</th><th>JSON</th></tr>
      </thead>
      <tbody>
        {state.rows.map((r) => (
          <tr key={r.day}>
            <td className="pa-num">{r.day}</td>
            <td><code title={r.digest}>{shortDigest(r.digest)}</code><CopyDigest digest={r.digest} /></td>
            <td>
              {r.txUrl ? <a className="pa-link" href={r.txUrl} target="_blank" rel="noreferrer">Arc tx ↗</a> : <span className="pa-muted">pending</span>}
            </td>
            <td><a className="pa-link" href={r.jsonUrl}>JSON</a></td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export function RecordPage() {
  const [state, setState] = useState<RecordState>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    load().then((r) => { if (live) setState(recordState(r)); });
    return () => { live = false; };
  }, []);
  return (
    <>
      <header className="mb-6">
        <h1 className="pa-h1">
          {RECORD_COPY.heading} <InfoBubble label="How to check a day">{RECORD_COPY.howTo}</InfoBubble>
        </h1>
      </header>
      {state.kind === "loading" && <p className="pa-muted">Loading…</p>}
      {state.kind === "error" && <div className="pa-card"><p>Couldn&apos;t load the record. Try again.</p></div>}
      {state.kind === "ready" && <View state={state} />}
    </>
  );
}
