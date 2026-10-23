/**
 * Server-rendered Arc ecosystem pages (spec 2026-10-19-arc-ecosystem-directory-design.md): one page per project, the
 * directory and the category pages. Pure: data in, HTML out; every value goes through esc(); JSON-LD escapes "<" (page()).
 */
import { CATEGORIES, STATUS_LABEL, STATUS_RULES, categoryHref, categoryOf, entityHref, sortByName, whatItDoes, type ArcEntity, type Category, type EntityStatus } from "../../src/lib/arc-ecosystem";
import { CORRECTIONS } from "../../src/lib/arc-ecosystem-data";
import { evidenceHref } from "../../src/lib/facts";
import { activityHtml, contractList, esc, page, when } from "./apps-pages";
import { factsHtml, type Ready } from "./project-ssr";
import type { AppDetail } from "./apps-data";
import type { ArcWeek } from "./arc-week";

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
  return page({ markdown: true, title: `${e.name} ${ON_ARC} · Registrai`, canonical: url, description: e.summary, body, ld: { "@context": "https://schema.org", "@graph": graph } });
}

const inCategory = (c: Category, e: ArcEntity) => e.category === c.id || (e.tags ?? []).includes(c.id);

/** The plural noun of each category for the one-line answer ("25 DEXs listed on Arc …"). */
const NOUN: Record<string, string> = {
  payments: "payment apps", wallets: "wallets", exchanges: "exchanges", banks: "banks", "stablecoin-issuers": "stablecoin issuers",
  infrastructure: "infrastructure providers", "developer-tools": "developer tools", dexs: "DEXs", lending: "lending protocols", trading: "trading platforms",
  "market-makers": "market makers", custody: "custodians", rwa: "tokenization and RWA projects", bridges: "bridges and cross-chain protocols",
  "ai-agents": "AI agent projects", ramps: "on/off-ramps", consumer: "games and consumer apps", launchpads: "launchpads", validators: "validators", "asset-managers": "asset managers",
};
const ON_ARC = "on Arc, Circle's blockchain";
const counts = (l: ArcEntity[]) => ({ live: l.filter((e) => e.status === "live").length, deployed: l.filter((e) => e.status === "deployed").length, announced: l.filter((e) => e.status === "announced").length });
const joinAnd = (l: string[]) => (l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`);

/** Up to 3 entities of `l` with the most stablecoin payments received over the 7-day window, matched through index_ids. */
function topUsed(l: ArcEntity[], week: ArcWeek | null): ArcEntity[] {
  const seen = new Set<string>(), top: ArcEntity[] = [];
  for (const a of [...(week?.apps ?? [])].filter((x) => x.usd > 0).sort((x, y) => y.usd - x.usd)) {
    const e = l.find((x) => x.index_ids?.includes(a.id));
    if (e && !seen.has(e.slug)) { seen.add(e.slug); top.push(e); }
    if (top.length === 3) break;
  }
  return top;
}

/** The category page's answer (spec 2026-10-23-ai-search-gaps §3): the counts, then up to 3 most used projects of the category over 7 days. */
export function categoryAnswer(cat: Category, all: ArcEntity[], week: ArcWeek | null): string {
  const l = all.filter((e) => inCategory(cat, e)), n = counts(l);
  const first = `${l.length} ${l.length === 1 ? "project" : NOUN[cat.id] ?? cat.name} listed ${ON_ARC}: ${n.live} live on mainnet, ${n.deployed} deployed, ${n.announced} announced.`;
  const top = topUsed(l, week);
  const second = top.length ? ` Most used over the last 7 days, by stablecoin payments received: ${joinAnd(top.map((e) => `<a href="${entityHref(e.slug)}">${esc(e.name)}</a>`))}.` : "";
  return `${esc(first)}${second}`;
}
function table(l: ArcEntity[], { category = true }: { category?: boolean } = {}): string {
  if (!l.length) return "<p>No projects in this category yet.</p>";
  return `<div class="wrap"><table><thead><tr><th>Project</th><th>What it does on Arc</th><th>Status</th><th>Live since</th></tr></thead><tbody>
${sortByName(l).map((e) => `<tr><td><a href="${entityHref(e.slug)}">${esc(e.name)}</a>${category ? `<br><span class="muted">${esc(catName(e.category))}</span>` : ""}</td><td>${esc(whatItDoes(e))}</td><td>${esc(STATUS_LABEL[e.status])}</td><td>${esc(e.first_live ?? "–")}</td></tr>`).join("\n")}
</tbody></table></div>`;
}
const latest = (l: ArcEntity[]) => l.map((e) => e.last_reviewed).sort().pop() ?? "";

/** The directory's "Questions" (spec 2026-10-23-replace-competitor-citations §1): plain text, shown on the page and in FAQPage JSON-LD. */
export function directoryFaq(all: ArcEntity[], week: ArcWeek | null): { q: string; a: string }[] {
  const n = counts(all), top = topUsed(all, week);
  return [
    { q: "How many projects are building on Arc?", a: `${all.length} projects: ${n.live} live on mainnet, ${n.deployed} deployed, ${n.announced} announced (reviewed ${latest(all)}).` },
    ...(top.length ? [{ q: "Which apps on Arc are used the most?", a: `By stablecoin payments received over the last 7 days: ${joinAnd(top.map((e) => e.name))}. The full ranking is at ${ECO_SITE}/arc/most-used-apps/.` }] : []),
    { q: "Is the data free to use?", a: `Yes. The directory is CC BY 4.0: JSON at ${ECO_SITE}/api/v1/ecosystem, an MCP server at ${ECO_SITE}/api/mcp and a daily dataset at https://github.com/registrai-multichain/arc-ecosystem.` },
    { q: "How do I add or correct a project?", a: `Each project page has a correction form; accepted changes are listed with their sources at ${ECO_SITE}/ecosystem/corrections/.` },
  ];
}

export function renderDirectory(all: ArcEntity[], status: EntityStatus | null, week: ArcWeek | null = null): string {
  const n = (s: EntityStatus) => all.filter((e) => e.status === s).length;
  const shown = status ? all.filter((e) => e.status === status) : all;
  const filters = [`<a href="/ecosystem/">All</a>`, ...(["live", "deployed", "announced"] as const).map((s) => `<a href="/ecosystem/?status=${s}">${esc(STATUS_LABEL[s])}</a>`)].join(" · ");
  const cats = CATEGORIES.map((c) => `<li><a href="${categoryHref(c.id)}">${esc(c.label)}</a> (${all.filter((e) => inCategory(c, e)).length})</li>`).join("");
  const top = topUsed(all, week), measured = all.filter((e) => e.index_ids?.length).length, faq = directoryFaq(all, week);
  const body = `<h1>Every project building on Arc</h1>
<p>Registrai's Arc ecosystem directory lists ${all.length} projects on Circle's Arc blockchain with their status and evidence: ${n("live")} live on mainnet, ${n("deployed")} deployed, ${n("announced")} announced. Last reviewed ${esc(latest(all))}.</p>
<h2>What counts as on Arc</h2>
<p>Every project with a public Arc link: contracts on Arc mainnet, a live integration, or an official announcement. Each status links to its evidence on the project page.</p>
<h2>How a status is decided</h2>
<ul>${(["live", "deployed", "announced"] as const).map((k) => `<li>${esc(STATUS_RULES[k])}</li>`).join("")}</ul>
<p>Launch dates come only from a source dated that day. <a href="/methodology/">Method</a></p>
${top.length ? `<h2>Measured activity</h2>
<p>${measured} of these projects are measured in Registrai's hourly index; the most used over the last 7 days, by stablecoin payments received, are ${joinAnd(top.map((e) => `<a href="${entityHref(e.slug)}">${esc(e.name)}</a>`))}. <a href="/arc/most-used-apps/">Full ranking</a></p>` : ""}
<h2>By category</h2><ul>${cats}</ul>
<h2>${status ? esc(STATUS_LABEL[status]) : "All projects"}</h2><p class="muted">Show: ${filters}</p>
${table(shown)}
<h2>Questions</h2>
<dl>${faq.map((f) => `<dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd>`).join("")}</dl>
<p class="muted">The same data as JSON: <a href="/api/v1/ecosystem">/api/v1/ecosystem</a>. Chain-level figures: <a href="/arc/">Arc in numbers</a>.</p>`;
  const catalog = { "@type": "DataCatalog", name: "Arc ecosystem", url: `${ECO_SITE}/ecosystem/`, dateModified: latest(all), license: LICENSE, creator: CREATOR,
    mainEntity: { "@type": "ItemList", numberOfItems: all.length, itemListElement: sortByName(all).map((e, k) => ({ "@type": "ListItem", position: k + 1, name: e.name, url: `${ECO_SITE}${entityHref(e.slug)}` })) } };
  const faqLd = { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  return page({ markdown: true, title: "Every project building on Arc, Circle's blockchain · Registrai", canonical: `${ECO_SITE}/ecosystem/`,
    description: `Every project on Arc, the blockchain by Circle, with its category and status: ${n("live")} live on mainnet, ${n("deployed")} deployed, ${n("announced")} announced.`, body, ld: { "@context": "https://schema.org", "@graph": [catalog, faqLd] } });
}

export function renderCategory(cat: Category, all: ArcEntity[], week: ArcWeek | null = null): string {
  const l = all.filter((e) => inCategory(cat, e)), n = counts(l);
  const body = `<h1>${esc(cat.label)}</h1>
<p>${categoryAnswer(cat, all, week)}</p>
<p class="muted"><a href="/ecosystem/">All categories</a></p>
${table(l, { category: false })}`;
  const ld = { "@context": "https://schema.org", "@type": "ItemList", name: cat.label, url: `${ECO_SITE}${categoryHref(cat.id)}`, numberOfItems: l.length,
    itemListElement: sortByName(l).map((e, k) => ({ "@type": "ListItem", position: k + 1, name: e.name, url: `${ECO_SITE}${entityHref(e.slug)}` })) };
  return page({ markdown: true, title: `${cat.label}, Circle's blockchain · Registrai`, canonical: `${ECO_SITE}${categoryHref(cat.id)}`,
    description: `${cat.label}, the blockchain by Circle: ${l.length} listed, ${n.live} live on mainnet, with status and sources.`, body, ld, noindex: l.length === 0 });
}

export const renderEcosystemNotFound = () =>
  page({ title: "Not found · Registrai", canonical: `${ECO_SITE}/ecosystem/`, description: "No project or category with this id in the Arc ecosystem directory.",
    body: `<h1>Not in the Arc ecosystem directory</h1><p>No project or category with this id. See the <a href="/ecosystem/">Arc ecosystem</a>.</p>` });
