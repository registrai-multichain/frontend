/**
 * Server-rendered project facts pages at /project/<kind>/<rest>/ (functions/project/[[path]].ts). The static /project/ page
 * from `next build` loads facts in the browser, so every project shared one URL, one canonical and "Loading…" in its HTML.
 * Here each project gets its own head (title, description, canonical, share tags) and its facts in plain HTML, mirroring
 * src/components/project/ProjectFactsPage.tsx. Pure: data in, HTML string out; every value is escaped.
 */
import { esc } from "./apps-pages";
import { evidenceHref, PUBLIC_REVIEWER, type Fact } from "../../src/lib/facts";
import { evidenceLabel, groupFacts, safeHttpsHref, type PageState } from "../../src/lib/project-page";
import { recheckedLine } from "../../src/lib/record-page";

type Ready = Extract<PageState, { kind: "ready" }>;
const day = (iso: string) => (iso || "").slice(0, 10);
const link = (e: string) => `<a href="${esc(evidenceHref(e))}" rel="noreferrer">${esc(evidenceLabel(e))}</a>`;

function factItem(f: Fact, struck = false): string {
  const text = struck ? `<s>${esc(f.text)}</s>` : esc(f.text);
  const re = recheckedLine(f.verifiedAt);
  return `<li><div>${text}</div><div>${f.evidence.map(link).join(" ")} · observed ${esc(day(f.observedAt))}</div>${re ? `<div>${esc(re)}</div>` : ""}${f.projectNote ? `<blockquote>Note from the project (${esc(day(f.projectNote.at))}): ${esc(f.projectNote.text)}</blockquote>` : ""}</li>`;
}

export const projectName = (source: string, s: Ready) => s.profile?.name ?? source;

export function renderProjectSummary(source: string, s: Ready): string {
  const { profile, facts } = s;
  const website = safeHttpsHref(profile?.website);
  const parts = [`<h1>${esc(projectName(source, s))}</h1>`, `<p><code>${esc(source)}</code>${website ? ` · <a href="${esc(website)}" rel="noreferrer">${esc(website)}</a>` : ""}</p>`];
  if (facts?.summary) parts.push(`<p>${esc(facts.summary)}</p>`);
  if (facts?.lastReviewedAt) parts.push(`<p>Last reviewed ${esc(day(facts.lastReviewedAt))} by ${esc(PUBLIC_REVIEWER)}</p>`);
  if (profile && (profile.contracts.length || profile.deployers.length || profile.token)) {
    parts.push(`<h2>On-chain footprint</h2>`);
    if (profile.deployers.length) parts.push(`<p>Deployers: ${profile.deployers.map((d) => link(d.address)).join(" ")}</p>`);
    if (profile.contracts.length) parts.push(`<ul>${profile.contracts.map((c) => `<li>${esc(c.label)}: ${link(c.address)}</li>`).join("")}</ul>`);
    if (profile.token) parts.push(`<p>Token: ${link(profile.token.address)}</p>`);
  }
  if (facts?.offArc?.length) parts.push(`<p>Also runs on: ${esc(facts.offArc.join(", "))}</p>`);
  for (const g of facts ? groupFacts(facts.facts) : []) {
    parts.push(`<h2>${esc(g.title)}</h2>`);
    if (g.current.length) parts.push(`<ul>${g.current.map((f) => factItem(f)).join("")}</ul>`);
    if (g.superseded.length) parts.push(`<details><summary>Earlier facts</summary><ul>${g.superseded.map((f) => factItem(f, true)).join("")}</ul></details>`);
  }
  parts.push(`<p><a href="/how-we-publish/">How we publish</a></p>`);
  return parts.join("\n");
}

/** Replace a tag's attribute value in the static head; no-op when the tag is absent. Function replacers: a value with "$&" stays literal. */
function setAttr(page: string, tag: RegExp, value: string): string {
  return page.replace(tag, (m) => m.replace(/(content|href)="[^"]*"/, (_a, k: string) => `${k}="${esc(value)}"`));
}
/** Set the tag when present, else add it before </head>. */
function upsert(page: string, tag: RegExp, value: string, make: (v: string) => string): string {
  return tag.test(page) ? setAttr(page, tag, value) : page.replace(/<\/head>/, () => `${make(esc(value))}</head>`);
}

/**
 * The project's own head for crawlers that read HTML. The Next page declares no canonical and no og:url (React would re-add
 * a declared one on hydration), so both are added here; the title is replaced (ProjectFactsPage sets document.title too).
 */
export function setHead(page: string, h: { title: string; description: string; canonical: string; noindex?: boolean }): string {
  let out = page.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(h.title)}</title>`);
  out = setAttr(out, /<meta name="description" content="[^"]*"\/?>/, h.description);
  out = upsert(out, /<link rel="canonical" href="[^"]*"\/?>/, h.canonical, (v) => `<link rel="canonical" href="${v}"/>`);
  out = upsert(out, /<meta property="og:url" content="[^"]*"\/?>/, h.canonical, (v) => `<meta property="og:url" content="${v}"/>`);
  for (const [k, v] of [["og:title", h.title], ["og:description", h.description]] as const) out = setAttr(out, new RegExp(`<meta property="${k}" content="[^"]*"\\/?>`), v);
  for (const [k, v] of [["twitter:title", h.title], ["twitter:description", h.description]] as const) out = setAttr(out, new RegExp(`<meta name="${k}" content="[^"]*"\\/?>`), v);
  if (h.noindex) out = out.replace(/<\/head>/, () => '<meta name="robots" content="noindex"/></head>');
  return out;
}
