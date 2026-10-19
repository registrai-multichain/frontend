/**
 * Server-rendered /apps pages (spec docs/superpowers/specs/2026-10-15-agent-reference-design.md): plain HTML that works
 * with JavaScript off, so crawlers and agents read the numbers. Pure: data in, HTML string out. Every value from data
 * goes through esc(); JSON-LD escapes "<".
 */
import { idToPath, type AppDetail, type AppList, type AppRow } from "./apps-data";
import { evidenceHref } from "../../src/lib/facts";

const SITE = "https://builder.registrai.cc";
const METHOD_URL = "/builders-index/";
const API_DOCS_URL = "/data-api/";
const LICENSE = "https://creativecommons.org/licenses/by/4.0/";
const CREATOR = { "@type": "Organization", name: "Registrai", url: "https://registrai.cc/" };
const KEYWORDS = ["Arc", "Arc ecosystem", "Arc apps", "USDC", "EURC", "stablecoin payments"];

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// one formatter per module (review M3: a formatter per call costs CPU on the free plan's 10 ms budget)
const NUM = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }), USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const num = (n: number) => NUM.format(n);
const usd = (n: number) => `$${USD.format(n)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const when = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`; };
const day = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const KIND_LABEL: Record<AppRow["kind"], string> = { builder: "Builder app", integration: "Integration", base: "Arc base layer" };
const INDEX_LABEL = { abi: "ABI", aii: "AII", aei: "AEI" } as const;

export type Sort = "payments" | "usdc" | "points" | "first_seen";
const SORTS: Record<Sort, { label: string; key: (r: AppRow) => number }> = {
  payments: { label: "24 h payments", key: (r) => r.last_24h.payments },
  usdc: { label: "24 h stablecoin volume", key: (r) => r.last_24h.usdc },
  points: { label: "points", key: (r) => r.points },
  first_seen: { label: "first seen (newest first)", key: (r) => Date.parse(r.first_hour) },
};
export const parseSort = (v: string | null): Sort => (v && v in SORTS ? (v as Sort) : "payments");
const sorted = (rows: AppRow[], s: Sort) => [...rows].sort((a, b) => SORTS[s].key(b) - SORTS[s].key(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const STYLE = `body{margin:0;background:#f7f4ec;color:#1d1a15;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:28px 16px 56px}a{color:#a33a10}h1{font-size:30px;margin:8px 0 4px}h2{font-size:20px;margin:28px 0 8px}
.muted{color:#5c5345;font-size:14px}table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0}th,td{text-align:left;padding:7px 8px 7px 0;border-bottom:1px solid #d9cfb8;vertical-align:top}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}details{display:inline}summary{display:inline;cursor:pointer;border:1px solid #c3ae82;border-radius:999px;padding:0 7px;font-style:italic;font-size:13px}
footer{margin-top:36px;padding-top:12px;border-top:1px solid #d9cfb8;font-size:13px;color:#5c5345}nav a{margin-right:14px}svg{max-width:100%;height:auto;background:#fffdf7;border:1px solid #d9cfb8}
.wrap{overflow-x:auto}`;

function page(o: { title: string; canonical: string; description: string; body: string; ld?: unknown }): string {
  const ld = o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, "\\u003c")}</script>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title><meta name="description" content="${esc(o.description)}"><link rel="canonical" href="${esc(o.canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Registrai"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}"><meta property="og:url" content="${esc(o.canonical)}"><meta name="twitter:card" content="summary">
<style>${STYLE}</style>${ld}</head><body><main>
<nav class="muted"><a href="/builders/">Registrai builders</a><a href="/apps/">Apps on Arc</a><a href="${METHOD_URL}">Indices</a><a href="${API_DOCS_URL}">Data API</a></nav>
${o.body}
<footer>Data: Registrai, CC BY 4.0 · <a href="/how-we-publish/">How we publish</a> · <a href="${METHOD_URL}">Method</a> · <a href="${API_DOCS_URL}">Data API</a> · Independent. Not affiliated with Circle or Arc.</footer>
</main></body></html>`;
}

export function renderAppList(l: AppList, sort: Sort): string {
  const rows = sorted(l.rows, sort);
  const others = (Object.keys(SORTS) as Sort[]).filter((s) => s !== sort).map((s) => `<a href="/apps/?sort=${s}">${esc(SORTS[s].label)}</a>`).join(" · ");
  const share = l.totals.arc_usdc_24h_est > 0 ? ` That is about ${num((100 * l.totals.usdc_24h) / l.totals.arc_usdc_24h_est)}% of the estimated ${usd(l.totals.arc_usdc_24h_est)} USDC moved on Arc in the same 24 h; the rest is not attributed to an app yet.` : "";
  const body = `<h1>Apps on Arc</h1>
<p class="muted">Data until ${esc(when(l.data_until))}. Updated hourly from Arc mainnet.</p>
<p>${num(l.totals.apps)} apps · ${num(l.totals.payments_24h)} USDC payments · ${usd(l.totals.usdc_24h)} USDC to these apps in the last 24 h
<details><summary>i</summary> Payments into the apps' own contracts, counted by the Arc Ecosystem Index method (per-wallet caps and minimums apply).${esc(share)}</details></p>
<p class="muted">Sorted by ${esc(SORTS[sort].label)}. Sort by ${others}.</p>
<div class="wrap"><table><thead><tr><th>App</th><th>Kind</th><th>Verified</th><th class="n">24 h payments</th><th class="n">24 h USD</th><th class="n">Index share</th><th>First seen</th></tr></thead><tbody>
${rows.map((r) => `<tr><td><a href="${esc(idToPath(r.id) ?? "/apps/")}">${esc(r.name)}</a></td><td>${esc(KIND_LABEL[r.kind])}</td><td>${r.verified ? "✓" : "–"}</td><td class="n">${num(r.last_24h.payments)}</td><td class="n">${esc(usd(r.last_24h.usdc))}</td><td class="n">${num(r.share)}%</td><td>${esc(day(r.first_hour))}</td></tr>`).join("\n")}
</tbody></table></div>
<p class="muted">The same data as JSON: <a href="/api/v1/members?index=aei">/api/v1/members?index=aei</a>. For agents: <a href="/llms.txt">llms.txt</a>, <a href="/api/v1/openapi.json">OpenAPI</a>, MCP at <code>${SITE}/api/mcp</code>.</p>`;
  const ld = { "@context": "https://schema.org", "@type": "DataCatalog", name: "Apps on Arc", url: `${SITE}/apps/`, dateModified: l.data_until,
    description: "Hourly stablecoin payments, paying wallets and volume for every app on Arc mainnet in the Arc indices, from Registrai.",
    license: LICENSE, creator: CREATOR, keywords: KEYWORDS,
    mainEntity: { "@type": "ItemList", numberOfItems: rows.length,
      itemListElement: rows.map((r, k) => ({ "@type": "ListItem", position: k + 1, name: r.name, url: `${SITE}${idToPath(r.id) ?? "/apps/"}` })) } };
  return page({ title: "Apps on Arc · Registrai", canonical: `${SITE}/apps/`, description: `Every app in the Arc indices with its last 24 h of stablecoin payments and volume on Arc mainnet, updated hourly. Data until ${when(l.data_until)}.`, body, ld });
}

function spark(a: AppDetail): string {
  const v = a.hourly.map((h) => h.points);
  if (v.length < 2) return "";
  const w = 600, h = 120, lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, k) => `${((k / (v.length - 1)) * w).toFixed(1)},${(h - 6 - ((y - lo) / span) * (h - 12)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"><title>${esc(a.name)}: points stock, last ${v.length} hours (${num(lo)} to ${num(hi)})</title><polyline fill="none" stroke="#a33a10" stroke-width="2" points="${pts}"/></svg>`;
}

function daily(a: AppDetail): string {
  const byDay = new Map<string, { payments: number; usdc: number; points_earned: number; wallets: number }>();
  for (const r of a.hourly) {
    const d = r.hour_close.slice(0, 10), x = byDay.get(d) ?? { payments: 0, usdc: 0, points_earned: 0, wallets: 0 };
    x.payments += r.payments; x.usdc += r.usdc; x.points_earned += r.points_earned; x.wallets = Math.max(x.wallets, r.wallets);
    byDay.set(d, x);
  }
  return `<div class="wrap"><table><thead><tr><th>Day (UTC)</th><th class="n">Payments</th><th class="n">USD</th><th class="n">Points earned</th><th class="n">Most paying wallets in one hour</th></tr></thead><tbody>
${[...byDay].reverse().map(([d, x]) => `<tr><td>${esc(day(`${d}T00:00:00Z`))}</td><td class="n">${num(x.payments)}</td><td class="n">${esc(usd(x.usdc))}</td><td class="n">${num(x.points_earned)}</td><td class="n">${num(x.wallets)}</td></tr>`).join("\n")}
</tbody></table></div>`;
}

function contractList(a: AppDetail): string {
  const l = a.contracts_sample ?? [];
  if (!l.length) return "";
  const more = a.contracts - l.length;
  return `<ul>${l.map((c) => `<li><a href="${esc(evidenceHref(c))}" rel="noreferrer"><code>${esc(c)}</code></a></li>`).join("")}</ul>${more > 0 ? `<p class="muted">and ${num(more)} more</p>` : ""}`;
}

export function renderApp(a: AppDetail): string {
  const path = idToPath(a.id) ?? "/apps/";
  const api = `/api/v1/members/${encodeURIComponent(a.id)}/hourly?index=aei`;
  const first = a.hourly[0]?.hour_close ?? a.first_hour;
  const last = a.hourly[a.hourly.length - 1];
  const body = `<h1>${esc(a.name)}</h1>
<p class="muted">${esc(KIND_LABEL[a.kind])} · <code>${esc(a.id)}</code> · indices: ${a.indices.map((i) => INDEX_LABEL[i]).join(", ")} · ${a.verified ? "verified builder (registry)" : "not verified"} · first seen ${esc(day(a.first_hour))}</p>
<p class="muted">Data until ${esc(when(a.data_until))}.</p>
<h2>Last 24 h</h2>
<table><tbody>
<tr><th>Stablecoin payments</th><td class="n">${num(a.last_24h.payments)}</td></tr>
<tr><th>Stablecoin volume</th><td class="n">${esc(usd(a.last_24h.usdc))}</td></tr>
<tr><th>Points earned</th><td class="n">${num(a.last_24h.points_earned)}</td></tr>
<tr><th>Points (stock, AEI)</th><td class="n">${num(a.points)}</td></tr>
<tr><th>Share of the Arc Ecosystem Index</th><td class="n">${num(a.share)}%</td></tr>
${last ? `<tr><th>Paying wallets, last hour</th><td class="n">${num(last.wallets)}</td></tr><tr><th>New payers, last hour</th><td class="n">${num(last.new_payers)}</td></tr>` : ""}
</tbody></table>
<h2>Last 7 days</h2>
${a.hourly.length ? `${spark(a)}${daily(a)}` : `<p>There is no hourly history yet for this app.</p>`}
<h2>Contracts and sources</h2>
<p>Contracts: ${num(a.contracts)} attributed to this app.</p>
${contractList(a)}
<p class="muted">All apps' contracts: <a href="/api/index/aei/contracts" rel="nofollow">contract map, JSON</a>.</p>
<ul>${a.facts_url ? `<li><a href="${esc(a.facts_url)}">Project facts page</a></li>` : ""}<li><a href="${esc(api)}">Hourly data as JSON</a></li><li><a href="${METHOD_URL}">How the index counts payments</a></li></ul>`;
  const ld = { "@context": "https://schema.org", "@type": "Dataset", name: `${a.name} hourly activity on Arc`, url: `${SITE}${path}`,
    description: `Hourly stablecoin payments, paying wallets, volume and index points for ${a.name} on Arc mainnet, from Registrai.`,
    license: LICENSE, creator: CREATOR, identifier: a.id, keywords: KEYWORDS, isAccessibleForFree: true, dateModified: a.data_until,
    includedInDataCatalog: { "@type": "DataCatalog", name: "Apps on Arc", url: `${SITE}/apps/` },
    measurementTechnique: "Stablecoin transfers into the app's attributed contracts on Arc mainnet, counted hourly by the Arc Ecosystem Index method (per-wallet caps and minimums).",
    temporalCoverage: `${first}/${a.data_until}`, variableMeasured: ["points", "payments", "paying wallets", "stablecoin volume (USD)"],
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}${api}` }] };
  return page({ title: `${a.name} on Arc · Registrai`, canonical: `${SITE}${path}`, description: `${a.name} on Arc mainnet: ${num(a.last_24h.payments)} stablecoin payments and ${usd(a.last_24h.usdc)} in the last 24 h. Data until ${when(a.data_until)}.`, body, ld });
}

export const renderNotFound = () =>
  page({ title: "App not found · Registrai", canonical: `${SITE}/apps/`, description: "No Arc app with this id in the indices.", body: `<h1>App not found</h1><p>No app with this id is in the Arc indices. See <a href="/apps/">Apps on Arc</a>.</p>` });

export const renderUnavailable = () =>
  page({ title: "Data not available · Registrai", canonical: `${SITE}/apps/`, description: "The data is not available right now.", body: `<h1>Data not available right now</h1><p>Retry in a few minutes. <a href="/apps/">Apps on Arc</a></p>` });
