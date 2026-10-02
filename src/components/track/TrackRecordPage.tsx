"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { evidenceHref } from "@/lib/facts";
import { evidenceLabel, parseSourceParam, projectHref } from "@/lib/project-page";
import { filterBySource, formatMedian, trackPath, trackState, type TrackState } from "@/lib/track-page";
import type { StoredItem } from "@/lib/track";

const day = (iso: string) => (iso || "").slice(0, 10);

async function load(): Promise<{ status: number; body: unknown }> {
  try {
    const r = await fetch(trackPath, { cache: "no-store" });
    let body: unknown = {};
    try { body = await r.json(); } catch { /* empty body */ }
    return { status: r.status, body };
  } catch {
    return { status: 0, body: {} };
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pa-card" style={{ flex: "1 1 160px" }}>
      <div style={{ fontSize: 24 }}>{value}</div>
      <div className="pa-muted pa-small">{label}</div>
    </div>
  );
}

function Row({ item }: { item: StoredItem }) {
  const r = item.retracted;
  return (
    <li style={{ marginBottom: 16 }}>
      <div>
        <span className="pa-muted">{day(item.alertTime)} UTC</span> ·{" "}
        <Link className="pa-link" href={projectHref(item.source)}>{item.source}</Link>
      </div>
      <div>{r ? <s>{item.text}</s> : item.text}</div>
      {r && <div className="pa-small">Retracted: {r.reason}</div>}
      <div>
        {item.evidence.map((e) => (
          <a key={e} className="pa-link pa-small" href={evidenceHref(e)} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>
            {evidenceLabel(e)} ↗
          </a>
        ))}
      </div>
    </li>
  );
}

export function View({ state, source }: { state: Extract<TrackState, { kind: "ready" }>; source: string | null }) {
  const items = filterBySource(state.items, source);
  return (
    <div>
      {source && <p className="pa-muted pa-small">All projects</p>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }} className="mb-7">
        <Stat
          label={state.updatedAt ? `Projects watched as of ${day(state.updatedAt)}` : "Projects watched"}
          value={state.updatedAt ? String(state.watching) : "—"}
        />
        <Stat label="Alerts published (30 days)" value={String(state.stats.published30)} />
        <Stat label="Retracted (30 days)" value={String(state.stats.retracted30)} />
        <Stat label="Median time from block to alert" value={formatMedian(state.stats.medianSeconds30)} />
      </div>
      {source && (
        <p className="pa-small">
          Showing {source} only. <Link className="pa-link" href="/track-record/">All projects</Link>
        </p>
      )}
      {items.length === 0 ? (
        <p className="pa-muted">{source ? "Nothing published for this project yet." : "Nothing published yet."}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {items.map((i) => <Row key={i.id} item={i} />)}
        </ul>
      )}
    </div>
  );
}

function Inner() {
  const source = parseSourceParam(useSearchParams()?.get("source") ?? null);
  const [state, setState] = useState<TrackState>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    load().then((r) => { if (live) setState(trackState(r)); });
    return () => { live = false; };
  }, []);
  if (state.kind === "loading") return <p className="pa-muted">Loading…</p>;
  if (state.kind === "error") {
    return (
      <div className="pa-card">
        <p>Couldn&apos;t load the track record. Try again.</p>
      </div>
    );
  }
  return <View state={state} source={source} />;
}

export function TrackRecordPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="pa-h1">Track record</h1>
        <p className="pa-lede">
          Radar alerts that pass our publication rules appear here at least 24 hours after the alert, with evidence. Security findings and alerts we hold are not published here. Retracted entries stay listed with the reason.
        </p>
      </header>
      <Suspense fallback={<p className="pa-muted">Loading…</p>}>
        <Inner />
      </Suspense>
      <p className="pa-small">
        <Link className="pa-link" href="/how-we-publish/">How we publish</Link>
      </p>
    </>
  );
}
