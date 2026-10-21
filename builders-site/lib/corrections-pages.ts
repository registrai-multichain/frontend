/** /ecosystem/corrections/ and the 410 page of a removed entry (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md). */
import { FIELD_LABEL, type CorrectionEntry } from "../../src/lib/arc-ecosystem-corrections";
import { esc, page } from "./apps-pages";

const SITE = "https://builder.registrai.cc";
const FROM = { project: "From the project", reader: "From a reader" } as const;

export function renderCorrectionsLog(all: CorrectionEntry[], names: Map<string, string>): string {
  const firstOf = new Set<number>(), seen = new Set<string>();
  for (const c of all) if (!seen.has(c.slug)) { seen.add(c.slug); firstOf.add(c.id); }
  const rows = all.map((c) => {
    const name = names.get(c.slug);
    const who = name ? `<a href="/ecosystem/${esc(c.slug)}/">${esc(name)}</a>` : esc(c.slug);
    return `<tr${firstOf.has(c.id) ? ` id="${esc(c.slug)}"` : ""}><td>${esc(c.date)}</td><td>${who}</td><td>${esc(FIELD_LABEL[c.field])}</td><td>${esc(c.change)}</td><td>${c.source ? `<a href="${esc(c.source)}" rel="noreferrer">Source</a>` : "–"}</td><td>${FROM[c.from]}</td></tr>`;
  }).join("\n");
  const body = `<h1>Corrections</h1>
<p>Corrections to the Arc ecosystem directory, newest first. Suggest one from any project page.</p>
<p class="muted"><a href="/api/v1/ecosystem/corrections">JSON</a> · <a href="/ecosystem/">Arc ecosystem</a></p>
${all.length ? `<div class="wrap"><table><thead><tr><th>Date</th><th>Project</th><th>Field</th><th>Change</th><th>Source</th><th>From</th></tr></thead><tbody>
${rows}
</tbody></table></div>` : "<p>No corrections yet.</p>"}`;
  const ld = { "@context": "https://schema.org", "@type": "ItemList", name: "Arc ecosystem directory corrections", url: `${SITE}/ecosystem/corrections/`,
    itemListElement: all.slice(0, 100).map((c, i) => ({ "@type": "ListItem", position: i + 1, name: `${c.date} ${c.slug}: ${c.change}` })) };
  return page({ title: "Corrections · Arc ecosystem · Registrai", canonical: `${SITE}/ecosystem/corrections/`, description: "Every correction to the Arc ecosystem directory, with its date and source.", body, ld });
}

export function renderRemoved(c: CorrectionEntry): string {
  return page({ title: "Removed · Arc ecosystem · Registrai", canonical: `${SITE}/ecosystem/corrections/`, description: "This listing was removed from the Arc ecosystem directory.", noindex: true,
    body: `<h1>Removed</h1><p>This listing was removed on ${esc(c.date)}: ${esc(c.change)}</p><p><a href="/ecosystem/corrections/#${esc(c.slug)}">Corrections log</a> · <a href="/ecosystem/">Arc ecosystem</a></p>` });
}
