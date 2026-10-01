import { FACT_TOPICS, type Fact, type FactTopic, type ProjectFacts } from "./facts";
import type { PublicProjectResponse } from "./projects";
import { normalizeSource } from "./verified-builders";

export const TOPIC_TITLE: Record<FactTopic, string> = {
  control: "Who controls it",
  contracts: "Contracts",
  token: "Token",
  treasury: "Treasury",
  activity: "Activity",
  claims: "What it says vs what the chain shows",
  infrastructure: "Where it runs",
};

export function parseSourceParam(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw;
  try { s = decodeURIComponent(raw); } catch { return null; }
  const n = normalizeSource(s);
  return n && n === s ? n : null;
}

export const factsPath = (source: string) => `/api/facts/${encodeURIComponent(source)}`;

export function groupFacts(facts: Fact[]) {
  const by = (a: Fact, b: Fact) => Date.parse(b.observedAt) - Date.parse(a.observedAt);
  return FACT_TOPICS.map((topic) => {
    const all = facts.filter((f) => f.topic === topic);
    return { topic, title: TOPIC_TITLE[topic], current: all.filter((f) => !f.supersededBy).sort(by), superseded: all.filter((f) => f.supersededBy).sort(by) };
  }).filter((g) => g.current.length + g.superseded.length > 0);
}

export function evidenceLabel(e: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(e)) return `${e.slice(0, 6)}…${e.slice(-4)}`;
  if (/^0x[0-9a-fA-F]{64}$/.test(e)) return `tx ${e.slice(0, 6)}…${e.slice(-2)}`;
  try {
    const u = new URL(e);
    const s = `${u.hostname}${u.pathname === "/" ? "" : u.pathname}`;
    return s.length > 40 ? `${s.slice(0, 39)}…` : s;
  } catch {
    return e.slice(0, 40);
  }
}

export type PageState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; profile: PublicProjectResponse["profile"] | null; facts: ProjectFacts | null };

export function pageState(profileRes: { status: number; body: unknown } | null, factsRes: { status: number; body: unknown } | null): PageState {
  if (!profileRes || !factsRes) return { kind: "loading" };
  const profile = profileRes.status === 200 ? ((profileRes.body as PublicProjectResponse).profile ?? null) : null;
  const facts = factsRes.status === 200 ? ((factsRes.body as { facts?: ProjectFacts }).facts ?? null) : null;
  if (!profile && !facts) return { kind: "missing" };
  return { kind: "ready", profile, facts };
}

/** A stored URL is only linked when it is plain https without credentials. */
export function safeHttpsHref(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
export const projectHref = (source: string) => `/project/?source=${encodeURIComponent(source)}`;
