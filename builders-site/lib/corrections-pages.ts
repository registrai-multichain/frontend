/** /ecosystem/<slug>/correct/ (the form), /ecosystem/corrections/ and the 410 page of a removed entry (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md). */
import type { ArcEntity } from "../../src/lib/arc-ecosystem";
import { CORRECTION_FIELDS, FIELD_LABEL, type CorrectionEntry } from "../../src/lib/arc-ecosystem-corrections";
import { esc, page } from "./apps-pages";
import { ERROR_TEXT, type ErrorCode } from "./corrections";

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

const DISCLOSURE = "We use your email only to reply about this correction. Approved corrections are published without your name or email.";
const mailto = (slug: string) => `mailto:contact@registrai.cc?subject=${encodeURIComponent(`Registrai ecosystem: ${slug}`)}`;

/** The form (Turnstile keys set), the email fallback (not set), or "Received" after a post. */
export function renderCorrectionForm(e: ArcEntity, o: { siteKey: string | null; sent: boolean; error: ErrorCode | null }): string {
  const back = `/ecosystem/${esc(e.slug)}/`, canonical = `${SITE}/ecosystem/${e.slug}/correct/`;
  const title = `Suggest a correction: ${e.name} · Registrai`;
  if (o.sent) return page({ title, canonical, description: `Correction received for ${e.name}.`, noindex: true,
    body: `<h1>Received</h1><p>We review corrections within 7 days.</p><p><a href="${back}">Back to ${esc(e.name)}</a></p>` });
  if (!o.siteKey) return page({ title, canonical, description: `Suggest a correction to ${e.name}.`, noindex: true,
    body: `<h1>Suggest a correction</h1><p>Email <a href="${esc(mailto(e.slug))}">contact@registrai.cc</a> with what is wrong on <a href="${back}">${esc(e.name)}</a> and a source.</p>` });
  const options = CORRECTION_FIELDS.map((f) => `<option value="${f}">${esc(FIELD_LABEL[f])}</option>`).join("");
  const body = `<h1>Suggest a correction</h1>
<p class="muted">For <a href="${back}">${esc(e.name)}</a>. Nothing changes until we review it.</p>
${o.error ? `<p class="error" role="alert">${esc(ERROR_TEXT[o.error])}</p>` : ""}
<form method="post" action="/api/ecosystem/corrections">
<input type="hidden" name="slug" value="${esc(e.slug)}">
<p><label>What is wrong<br><select name="field" required><option value="">Choose…</option>${options}</select></label></p>
<p><label>Correction<br><textarea name="text" required minlength="10" maxlength="1000" rows="6"></textarea></label></p>
<p><label>Source link (required for status, contracts and dates)<br><input type="url" name="source_url" maxlength="500" placeholder="https://"></label></p>
<p><label>Email<br><input type="email" name="email" required maxlength="254"></label></p>
<p><label>Name and role (optional)<br><input type="text" name="name" maxlength="100"></label></p>
<div class="cf-turnstile" data-sitekey="${esc(o.siteKey)}"></div>
<p class="muted">${DISCLOSURE}</p>
<p><button type="submit">Send correction</button></p>
</form>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
  return page({ title, canonical, description: `Suggest a correction to ${e.name}.`, noindex: true, body });
}
