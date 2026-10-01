"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { evidenceHref, type ChangeLogEntry, type Fact } from "@/lib/facts";
import { evidenceLabel, factsPath, groupFacts, pageState, parseSourceParam, safeHttpsHref, type PageState } from "@/lib/project-page";
import { projectPath } from "@/lib/projects";

type Res = { status: number; body: unknown };

const day = (iso: string) => (iso || "").slice(0, 10);
const KIND_WORDS: Record<ChangeLogEntry["kind"], string> = {
  added: "Added",
  updated: "Updated",
  superseded: "Replaced by a newer fact",
  removed: "Removed",
  note: "Project note",
};

async function get(path: string): Promise<Res> {
  try {
    const r = await fetch(path, { cache: "no-store" });
    let body: unknown = {};
    try { body = await r.json(); } catch { /* empty body */ }
    return { status: r.status, body };
  } catch {
    return { status: 0, body: {} };
  }
}

function Evidence({ items }: { items: string[] }) {
  return (
    <>
      {items.map((e) => (
        <a key={e} className="pa-link pa-small" href={evidenceHref(e)} target="_blank" rel="noreferrer" style={{ marginRight: 10 }}>
          {evidenceLabel(e)} ↗
        </a>
      ))}
    </>
  );
}

function FactItem({ f, struck }: { f: Fact; struck?: boolean }) {
  return (
    <li style={{ marginBottom: 14 }}>
      <div>{struck ? <s>{f.text}</s> : f.text}</div>
      <div>
        <Evidence items={f.evidence} /> <span className="pa-muted pa-small">observed {day(f.observedAt)}</span>
      </div>
      {f.projectNote && (
        <blockquote className="pa-muted pa-small" style={{ margin: "6px 0 0", paddingLeft: 10, borderLeft: "2px solid currentColor" }}>
          Note from the project ({day(f.projectNote.at)}): {f.projectNote.text}
        </blockquote>
      )}
    </li>
  );
}

function Missing() {
  return (
    <div className="pa-card">
      <p>This project is not in the registry.</p>
      <p>
        <Link className="pa-link" href="/builders/">See the builders</Link>
      </p>
    </div>
  );
}

function View({ source, state }: { source: string; state: Extract<PageState, { kind: "ready" }> }) {
  const { profile, facts } = state;
  const groups = facts ? groupFacts(facts.facts) : [];
  const log = facts ? [...facts.changelog].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [];
  const website = safeHttpsHref(profile?.website);
  const xHandle = profile?.x?.replace(/^@/, "") ?? "";
  const addr = (a: string) => (
    <a className="pa-link" href={evidenceHref(a)} target="_blank" rel="noreferrer">{evidenceLabel(a)} ↗</a>
  );
  return (
    <div>
      <header className="mb-7">
        <h1>{profile?.name ?? source}</h1>
        <p className="pa-small">
          {website && <a className="pa-link" href={website} target="_blank" rel="noreferrer">{website}</a>}
          {profile?.x && /^[A-Za-z0-9_]{1,15}$/.test(xHandle) && <>{website ? " · " : ""}<a className="pa-link" href={`https://x.com/${xHandle}`} target="_blank" rel="noreferrer">@{xHandle}</a></>}
        </p>
        {facts?.summary && <p>{facts.summary}</p>}
        {facts && facts.lastReviewedAt && (
          <p className="pa-muted pa-small">Last reviewed {day(facts.lastReviewedAt)} by {facts.reviewedBy}</p>
        )}
      </header>

      {profile && (profile.deployers.length > 0 || profile.contracts.length > 0 || profile.token || (facts?.offArc?.length ?? 0) > 0) && (
        <section className="pa-card mb-7">
          <h2>On-chain footprint</h2>
          {profile.deployers.length > 0 && (
            <p>Deployers: {profile.deployers.map((d) => <span key={d.address} style={{ marginRight: 10 }}>{addr(d.address)}</span>)}</p>
          )}
          {profile.contracts.length > 0 && (
            <ul>
              {profile.contracts.map((c) => (
                <li key={c.address}>{c.label}: {addr(c.address)}</li>
              ))}
            </ul>
          )}
          {profile.token && <p>Token: {addr(profile.token.address)}</p>}
          {facts?.offArc && facts.offArc.length > 0 && <p>Also runs on: {facts.offArc.join(", ")}</p>}
        </section>
      )}

      {groups.map((g) => (
        <section key={g.topic} className="mb-7">
          <h2>{g.title}</h2>
          {g.current.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {g.current.map((f) => <FactItem key={f.id} f={f} />)}
            </ul>
          )}
          {g.superseded.length > 0 && (
            <details>
              <summary>Earlier facts</summary>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {g.superseded.map((f) => <FactItem key={f.id} f={f} struck />)}
              </ul>
            </details>
          )}
        </section>
      ))}

      {log.length > 0 && (
        <details className="mb-7">
          <summary>Change log</summary>
          <ul>
            {log.map((c, i) => (
              <li key={`${c.at}-${c.factId}-${i}`}>
                <span className="pa-muted">{day(c.at)}</span> · {KIND_WORDS[c.kind]} · {c.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="pa-small">
        <Link className="pa-link" href={`/verify/?source=${encodeURIComponent(source)}`}>Is this your project? Claim it</Link>
        {" · "}
        <a className="pa-link" href={`mailto:contact@registrai.cc?subject=${encodeURIComponent(`Registrai: ${source}`)}`}>Add a note or report an error</a>
        {" · "}
        <Link className="pa-link" href="/how-we-publish/">How we publish</Link>
      </footer>
    </div>
  );
}

function Inner() {
  const raw = useSearchParams()?.get("source") ?? null;
  const source = parseSourceParam(raw);
  const [state, setState] = useState<PageState>({ kind: "loading" });

  useEffect(() => {
    if (!source) return;
    let live = true;
    setState({ kind: "loading" });
    Promise.all([get(projectPath(source, false)), get(factsPath(source))]).then(([p, f]) => {
      if (live) setState(pageState(p, f));
    });
    return () => { live = false; };
  }, [source]);

  if (!source) return <Missing />;
  if (state.kind === "loading") return <p className="pa-muted">Loading…</p>;
  if (state.kind === "missing") return <Missing />;
  return <View source={source} state={state} />;
}

export function ProjectFactsPage() {
  return (
    <Suspense fallback={<p className="pa-muted">Loading…</p>}>
      <Inner />
    </Suspense>
  );
}
