/**
 * Server-rendered Arc ecosystem pages (spec 2026-10-19-arc-ecosystem-directory-design.md): one page per project, the
 * directory and the category pages. Pure: data in, HTML out; every value goes through esc(); JSON-LD escapes "<" (page()).
 */
import { CATEGORIES, STATUS_LABEL, categoryHref, categoryOf, entityHref, sortByName, type ArcEntity, type Category, type EntityStatus } from "../../src/lib/arc-ecosystem";
import { CORRECTIONS } from "../../src/lib/arc-ecosystem-data";
import { evidenceHref } from "../../src/lib/facts";
import { activityHtml, contractList, esc, page, when } from "./apps-pages";
import { factsHtml, type Ready } from "./project-ssr";
import type { AppDetail } from "./apps-data";

export const ECO_SITE = "https://builder.registrai.cc";
export type EntityView = { entity: ArcEntity; app: AppDetail | null; facts: Ready | null; correctionsOpen?: boolean };
const LICENSE = "https://creativecommons.org/licenses/by/4.0/";
const CREATOR = { "@type": "Organization", name: "Registrai", url: "https://registrai.cc/" };
const mail = (subject: string) => `mailto:contact@registrai.cc?subject=${encodeURIComponent(subject)}`;
/** "Corrected N times · latest DATE", linked to the log; empty when the entry has none. */
export function correctionsLine(slug: string): string {
  const l = CORRECTIONS.bySlug.get(slug);
  if (!l?.length) return "";
  return `<p class="muted"><a href="/ecosystem/corrections/#${esc(slug)}">Corrected ${l.length} time${l.length === 1 ? "" : "s"} · latest ${esc(l[0].date)}</a></p>`;
}
const a = (href: string, text: string) => `<a href="${esc(href)}" rel="noreferrer">${esc(text)}</a>`;
const catName = (id: string) => categoryOf(id)?.name ?? id;

function links(e: ArcEntity): string {
  const l: string[] = [];
  if (e.website) l.push(a(e.website, "Website"));
  if (e.x) l.push(a(`https://x.com/${e.x}`, `X @${e.x}`));
  if (e.github) l.push(a(e.github, "GitHub"));
  if (e.docs) l.push(a(e.docs, "Docs"));
  return l.length ? `<p>${l.join(" · ")}</p>` : "";
}

function contractsHtml(e: ArcEntity, app: AppDetail | null): string {
  const own = e.contracts ?? [];
  const listed = new Set(own.map((c) => c.address));
  const extra = app ? { ...app, contracts_sample: (app.contracts_sample ?? []).filter((x) => !listed.has(x)), contracts: Math.max(0, app.contracts - listed.size) } : null;
  if (!own.length && !extra?.contracts_sample?.length) return "";
  const ownHtml = own.length ? `<ul>${own.map((c) => `<li>${esc(c.role)}: <a href="${esc(evidenceHref(c.address))}" rel="noreferrer"><code>${esc(c.address)}</code></a> (${a(c.source, "source")})</li>`).join("")}</ul>` : "";
  return `<h2>Contracts on Arc</h2>${ownHtml}${extra ? `${own.length ? "<p class=\"muted\">Also attributed by the Arc indices:</p>" : ""}${contractList(extra)}` : ""}`;
}

/** Index members: the index's own evidence (a contract on the explorer, the hourly data), so a "live" badge never rests on a homepage alone. */
function indexEvidence(e: ArcEntity, app: AppDetail | null): string[] {
  const id = e.index_ids?.[0];
  if (!id) return [];
  const hourly = `/api/v1/members/${encodeURIComponent(id)}/hourly?index=aei`;
  if (!app) return [a(hourly, "Listed in the Arc indices (hourly data)")];
  const contract = e.contracts?.[0]?.address ?? app.contracts_sample?.[0];
  return [...(contract ? [a(evidenceHref(contract), "Contract on the Arc explorer")] : []), a(hourly, "Hourly activity in the Arc indices")];
}

export function renderEntity(v: EntityView): string {
  const e = v.entity, url = `${ECO_SITE}${entityHref(e.slug)}`;
  const tags = (e.tags ?? []).map((t) => `<a href="${categoryHref(t)}">${esc(catName(t))}</a>`).join(", ");
  const dates = [e.first_announced ? `<li>First announced ${esc(e.first_announced)}</li>` : "", e.first_live ? `<li>Live on Arc mainnet since ${esc(e.first_live)}</li>` : ""].join("");
  const errorLinks = v.correctionsOpen
    ? `<a href="/ecosystem/${esc(e.slug)}/correct/">Suggest a correction</a>`
    : `<a href="${esc(mail(`Registrai ecosystem: ${e.slug}`))}">Report an error</a> · <a href="${esc(mail(`Removal: ${e.slug}`))}">Ask for removal</a>`;
  const body = `<h1>${esc(e.name)}</h1>
<p class="muted">${esc(STATUS_LABEL[e.status])} · <a href="${categoryHref(e.category)}">${esc(catName(e.category))}</a>${tags ? ` · also ${tags}` : ""} · Last reviewed ${esc(e.last_reviewed)}</p>
<p>${esc(e.summary)}</p>
${links(e)}
<h2>Status</h2>
${dates ? `<ul>${dates}</ul>` : ""}<p>Evidence: ${[...e.status_evidence.map((s) => a(s.url, s.title ?? s.url)), ...indexEvidence(e, v.app)].join(" · ")}</p>
${contractsHtml(e, v.app)}
${v.app ? `<h2>Activity</h2><p class="muted">Data until ${esc(when(v.app.data_until))} · ${v.app.verified ? "verified builder (registry)" : "not verified"} · indices: ${v.app.indices.map((i) => i.toUpperCase()).join(", ")}</p>${activityHtml(v.app)}<p class="muted">Hourly data: <a href="/api/v1/members/${esc(encodeURIComponent(v.app.id))}/hourly?index=aei">JSON</a></p>` : ""}
${v.facts ? `<h2>Project facts</h2>${factsHtml(v.facts)}` : ""}
<h2>Sources</h2>
<ol>${e.sources.map((s) => `<li>${a(s.url, s.title ?? s.url)}${s.date ? ` (${esc(s.date)})` : ""}</li>`).join("")}</ol>
${correctionsLine(e.slug)}
<p class="muted">${errorLinks} · <a href="/how-we-publish/">How we publish</a> · <a href="/ecosystem/">Arc ecosystem</a></p>`;
  const sameAs = [e.website, e.x ? `https://x.com/${e.x}` : undefined, e.github].filter((x): x is string => !!x);
  const graph: unknown[] = [{ "@type": "Organization", name: e.name, ...(e.aliases?.length ? { alternateName: e.aliases } : {}), url: e.website ?? url, ...(sameAs.length ? { sameAs } : {}), description: e.summary, mainEntityOfPage: url }];
  if (v.app) graph.push({ "@type": "Dataset", name: `${e.name} hourly activity on Arc`, url, description: `Hourly stablecoin payments, paying wallets, volume and index points for ${e.name} on Arc mainnet, from Registrai.`,
    license: LICENSE, creator: CREATOR, isAccessibleForFree: true, dateModified: v.app.data_until,
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${ECO_SITE}/api/v1/members/${encodeURIComponent(v.app.id)}/hourly?index=aei` }] });
  return page({ markdown: true, title: `${e.name} on Arc · Registrai`, canonical: url, description: e.summary, body, ld: { "@context": "https://schema.org", "@graph": graph } });
}

const inCategory = (c: Category, e: ArcEntity) => e.category === c.id || (e.tags ?? []).includes(c.id);
function table(l: ArcEntity[]): string {
  if (!l.length) return "<p>No projects in this category yet.</p>";
  return `<div class="wrap"><table><thead><tr><th>Project</th><th>Category</th><th>Status</th><th>Live since</th></tr></thead><tbody>
${sortByName(l).map((e) => `<tr><td><a href="${entityHref(e.slug)}">${esc(e.name)}</a></td><td>${esc(catName(e.category))}</td><td>${esc(STATUS_LABEL[e.status])}</td><td>${esc(e.first_live ?? "–")}</td></tr>`).join("\n")}
</tbody></table></div>`;
}
const latest = (l: ArcEntity[]) => l.map((e) => e.last_reviewed).sort().pop() ?? "";

export function renderDirectory(all: ArcEntity[], status: EntityStatus | null): string {
  const n = (s: EntityStatus) => all.filter((e) => e.status === s).length;
  const shown = status ? all.filter((e) => e.status === status) : all;
  const filters = [`<a href="/ecosystem/">All</a>`, ...(["live", "deployed", "announced"] as const).map((s) => `<a href="/ecosystem/?status=${s}">${esc(STATUS_LABEL[s])}</a>`)].join(" · ");
  const cats = CATEGORIES.map((c) => `<li><a href="${categoryHref(c.id)}">${esc(c.label)}</a> (${all.filter((e) => inCategory(c, e)).length})</li>`).join("");
  const body = `<h1>Arc ecosystem</h1>
<p class="muted">${all.length} projects · ${n("live")} live on mainnet · ${n("deployed")} deployed · ${n("announced")} announced. Last reviewed ${esc(latest(all))}.
<details><summary>i</summary> Every project with a public Arc link: contracts on Arc mainnet, a live integration, or an official announcement. Each status links to its evidence on the project page.</details></p>
<h2>By category</h2><ul>${cats}</ul>
<h2>${status ? esc(STATUS_LABEL[status]) : "All projects"}</h2><p class="muted">Show: ${filters}</p>
${table(shown)}
<p class="muted">The same data as JSON: <a href="/api/v1/ecosystem">/api/v1/ecosystem</a>. Chain-level figures: <a href="/arc/">Arc in numbers</a>.</p>`;
  const ld = { "@context": "https://schema.org", "@type": "DataCatalog", name: "Arc ecosystem", url: `${ECO_SITE}/ecosystem/`, dateModified: latest(all), license: LICENSE, creator: CREATOR,
    mainEntity: { "@type": "ItemList", numberOfItems: all.length, itemListElement: sortByName(all).map((e, k) => ({ "@type": "ListItem", position: k + 1, name: e.name, url: `${ECO_SITE}${entityHref(e.slug)}` })) } };
  return page({ markdown: true, title: "Arc ecosystem · Registrai", canonical: `${ECO_SITE}/ecosystem/`, description: `Every project on Arc with its category and status: ${n("live")} live on mainnet, ${n("deployed")} deployed, ${n("announced")} announced.`, body, ld });
}

export function renderCategory(cat: Category, all: ArcEntity[]): string {
  const l = all.filter((e) => inCategory(cat, e));
  const body = `<h1>${esc(cat.label)}</h1>
<p class="muted">${l.length} projects. <a href="/ecosystem/">All categories</a></p>
${table(l)}`;
  const ld = { "@context": "https://schema.org", "@type": "ItemList", name: cat.label, url: `${ECO_SITE}${categoryHref(cat.id)}`, numberOfItems: l.length,
    itemListElement: sortByName(l).map((e, k) => ({ "@type": "ListItem", position: k + 1, name: e.name, url: `${ECO_SITE}${entityHref(e.slug)}` })) };
  return page({ markdown: true, title: `${cat.label} · Registrai`, canonical: `${ECO_SITE}${categoryHref(cat.id)}`, description: `${cat.label}: ${l.length} projects with their status and sources.`, body, ld, noindex: l.length === 0 });
}

export const renderEcosystemNotFound = () =>
  page({ title: "Not found · Registrai", canonical: `${ECO_SITE}/ecosystem/`, description: "No project or category with this id in the Arc ecosystem directory.",
    body: `<h1>Not in the Arc ecosystem directory</h1><p>No project or category with this id. See the <a href="/ecosystem/">Arc ecosystem</a>.</p>` });
