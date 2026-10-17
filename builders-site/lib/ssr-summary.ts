/**
 * Server-rendered summaries for builder pages whose numbers load in the browser (/builders-index/, /track-record/):
 * the static page from `next build` says "Loading…" until its script runs, so crawlers and agents that read HTML saw no
 * numbers. The summary goes right after <body> (React skips unknown elements there when hydrating) and an inline script
 * hides it at once, so visitors with scripts see only the live page. Pure: data in, HTML string out; every value is escaped.
 */
import { esc, when } from "./apps-pages";
import { idToPath, type AppList } from "./apps-data";

type IndicesJson = { data_until: string; indices: Record<string, { name: string; close: number; close_24h_ago: number | null; members: number }> };
type TrackJson = { watching: number; updatedAt: string | null; stats: { published30: number; retracted30: number; medianSeconds30: number | null }; items: { alertTime: string; source: string; text?: string }[] };

const NUM = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), INT = new Intl.NumberFormat("en-US");
const USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const pct = (now: number, then: number | null) => {
  if (!then) return "–";
  const p = ((now / then) - 1) * 100;
  return `${p > 0 ? "+" : ""}${p.toFixed(2)}%`;
};
const STYLE = "max-width:960px;margin:0 auto;padding:16px;font:15px/1.5 system-ui,sans-serif";

export function renderIndexSummary(ix: IndicesJson, apps: AppList | null): string {
  const rows = Object.entries(ix.indices).map(([id, i]) =>
    `<tr><td>${esc(i.name)} (${esc(id.toUpperCase())})</td><td>${NUM.format(i.close)}</td><td>${esc(pct(i.close, i.close_24h_ago))}</td><td>${INT.format(i.members)}</td></tr>`).join("");
  const top = apps ? [...apps.rows].sort((a, b) => b.last_24h.payments - a.last_24h.payments).slice(0, 10) : [];
  const appRows = top.map((r) => `<tr><td><a href="${esc(idToPath(r.id) ?? "/apps/")}">${esc(r.name)}</a></td><td>${INT.format(r.last_24h.payments)}</td><td>$${USD.format(r.last_24h.usdc)}</td></tr>`).join("");
  return `<h1>Arc indices</h1><p>Data until ${esc(when(ix.data_until))}. Hourly, from Arc mainnet. Base 1000.</p>
<table><thead><tr><th>Index</th><th>Close</th><th>24 h change</th><th>Members</th></tr></thead><tbody>${rows}</tbody></table>
${appRows ? `<h2>Most used apps, last 24 h</h2><table><thead><tr><th>App</th><th>Stablecoin payments</th><th>USD</th></tr></thead><tbody>${appRows}</tbody></table><p><a href="/apps/">All stablecoin apps on Arc</a></p>` : ""}
<p>JSON: <a href="/api/v1/indices">/api/v1/indices</a> · <a href="/data-api/">Data API</a> · <a href="/how-we-publish/">How we publish</a></p>`;
}

export function renderTrackSummary(t: TrackJson): string {
  const items = t.items.slice(0, 50).map((i) => `<li>${esc(i.alertTime.slice(0, 10))} UTC · <a href="/apps/">${esc(i.source)}</a>${i.text ? ` · ${esc(i.text)}` : ""}</li>`).join("");
  return `<h1>Track record</h1><p>Watching ${INT.format(t.watching)} projects. ${INT.format(t.stats.published30)} alerts published in the last 30 days, ${INT.format(t.stats.retracted30)} retracted.</p>
${items ? `<ul>${items}</ul>` : "<p>No alerts published yet.</p>"}
<p><a href="/how-we-publish/">How we publish</a></p>`;
}

const HIDE = "<script>document.currentScript.nextElementSibling.hidden=true</script>";

/** The static page with the summary right after <body>; unchanged when the page has no <body>. */
export function injectSummary(page: string, summary: string): string {
  const m = page.match(/<body[^>]*>/);
  if (!m || m.index === undefined) return page;
  const at = m.index + m[0].length;
  return `${page.slice(0, at)}${HIDE}<section id="ssr-summary" style="${STYLE}">${summary}</section>${page.slice(at)}`;
}

/** Fetch the static page (ctx.next()), add the summary when there is data; any failure serves the static page as is. */
export async function withSummary(next: () => Promise<Response>, summary: () => Promise<string | null>): Promise<Response> {
  const res = await next();
  if (res.status !== 200 || !(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const page = await res.text();
  let s: string | null = null;
  try { s = await summary(); } catch { s = null; }
  const headers = new Headers(res.headers);
  headers.delete("content-length"); headers.delete("etag");
  return new Response(s ? injectSummary(page, s) : page, { status: 200, headers });
}
