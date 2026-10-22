/** The Arc question pages (spec docs/superpowers/specs/2026-10-22-arc-question-pages-design.md). Pure: data in, HTML out. */
import { STATUS_LABEL, categoryOf, entityHref, sortByName, type ArcEntity, type EntityStatus } from "../../src/lib/arc-ecosystem";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { esc, page } from "./apps-pages";
import { WINDOW_H, type ArcWeek, type WeekApp } from "./arc-week";

const SITE = "https://builder.registrai.cc";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const atHour = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };
const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (x: number) => x.toLocaleString("en-US");
const NA = `<p class="muted">Not available right now (source: Registrai index database).</p>`;
const METHOD = "Payments into each app's contracts in USDC and other registered stablecoins, converted to USD, as attributed by the Arc Ecosystem Index. New paying wallets: wallets paying the app for the first time.";
const catName = (id: string | null) => (id ? categoryOf(id)?.name ?? id : "–");
const appLink = (a: WeekApp) => `<a href="${esc(a.href)}">${esc(a.name)}</a>`;
const entLink = (e: ArcEntity) => `<a href="${entityHref(e.slug)}">${esc(e.name)}</a>`;
const evidence = (e: ArcEntity) => (e.status_evidence[0] ? `<a href="${esc(e.status_evidence[0].url)}" rel="noreferrer">Evidence</a>` : "–");
const source = (w: ArcWeek) => `<p class="muted">Source: Arc Ecosystem Index (Registrai), hourly, 7 days to ${esc(atHour(w.until))}. <details><summary>i</summary> ${esc(METHOD)}</details></p>`;
const table = (head: string[], rows: string[][]) => `<div class="wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></div>`;
const itemList = (path: string, name: string, items: string[]) => ({ "@context": "https://schema.org", "@type": "ItemList", name, url: `${SITE}${path}`,
  itemListElement: items.slice(0, 100).map((n, i) => ({ "@type": "ListItem", position: i + 1, name: n })) });
const STATUS_ORDER: Record<EntityStatus, number> = { live: 0, deployed: 1, announced: 2 };
const inCat = (e: ArcEntity, id: string) => e.category === id || (e.tags ?? []).includes(id as never);

export const QUESTION_PAGES = [
  { path: "/arc/most-used-apps/", title: "Most-used apps on Arc, last 7 days" },
  { path: "/arc/apps-that-accept-usdc/", title: "Apps that accept USDC on Arc" },
  { path: "/arc/new/", title: "New on Arc this week" },
  { path: "/arc/get-usdc/", title: "How to get USDC onto Arc" },
] as const;

function shell(path: string, title: string, first: string, body: string, items: string[]): string {
  return page({ title: `${title} · Registrai`, canonical: `${SITE}${path}`, description: first,
    body: `<h1>${esc(title)}</h1>\n<p>${esc(first)}</p>\n${body}\n<p class="muted"><a href="/arc/">Arc in numbers</a> · <a href="/ecosystem/">Arc ecosystem</a></p>`, ld: itemList(path, title, items) });
}

export function renderMostUsed(w: ArcWeek | null): string {
  const [path, title] = [QUESTION_PAGES[0].path, QUESTION_PAGES[0].title];
  if (!w) return shell(path, title, "Data not available right now.", NA, []);
  const paid = w.apps.filter((a) => a.payments > 0);
  const first = paid.length && paid[0].usd > 0
    ? `In the 7 days to ${atHour(w.until)}, ${paid[0].name} received the most in stablecoin payments of the ${paid.length} apps Registrai measures on Arc: ${usd(paid[0].usd)}.`
    : `No measured app received payments in the 7 days to ${atHour(w.until)}.`;
  const rows = paid.map((a, i) => [String(i + 1), appLink(a), esc(catName(a.category)), usd(a.usd), int(a.payments), int(a.new_payers)]);
  return shell(path, title, first, `${paid.length ? table(["#", "App", "Category", "Received (USD)", "Payments", "New paying wallets"], rows) : ""}\n${source(w)}`, paid.map((a) => a.name));
}

export function renderAcceptsUsdc(w: ArcWeek | null): string {
  const [path, title] = [QUESTION_PAGES[1].path, QUESTION_PAGES[1].title];
  const measuredIds = new Set((w?.apps ?? []).filter((a) => a.payments > 0).map((a) => a.id));
  const listed = ECOSYSTEM.entities.filter((e) => inCat(e, "payments") && !(e.index_ids ?? []).some((id) => measuredIds.has(id)))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.name < b.name ? -1 : 1));
  const listedHtml = `<h2>Listed, not measured</h2>\n${listed.length ? table(["Project", "Status", "Evidence"], listed.map((e) => [entLink(e), esc(STATUS_LABEL[e.status]), evidence(e)])) : "<p>None.</p>"}`;
  if (!w) return shell(path, title, "Data not available right now.", `<h2>Measured</h2>\n${NA}\n${listedHtml}`, listed.map((e) => e.name));
  const paid = w.apps.filter((a) => a.payments > 0);
  const first = `${paid.length} apps on Arc received stablecoin payments in the 7 days to ${atHour(w.until)}. ${listed.length} more payment apps list USDC on Arc but are not measured by Registrai.`;
  const measured = paid.length ? table(["App", "Category", "Payments (7 d)", "Received (USD, 7 d)"], paid.map((a) => [appLink(a), esc(catName(a.category)), int(a.payments), usd(a.usd)])) : "<p>None this week.</p>";
  return shell(path, title, first, `<h2>Measured</h2>\n${measured}\n${source(w)}\n${listedHtml}`, [...paid.map((a) => a.name), ...listed.map((e) => e.name)]);
}

const minusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);

export function renderNew(w: ArcWeek | null, today: string): string {
  const [path, title] = [QUESTION_PAGES[2].path, QUESTION_PAGES[2].title];
  const end = w ? w.until.slice(0, 10) : today, start = minusDays(end, 7);
  const live = sortByName(ECOSYSTEM.entities.filter((e) => e.first_live && e.first_live > start && e.first_live <= end));
  const liveHtml = `<h2>Went live</h2>\n${live.length ? table(["Project", "Category", "Live since"], live.map((e) => [entLink(e), esc(catName(e.category)), esc(e.first_live!)])) : "<p>None this week.</p>"}`;
  if (!w) return shell(path, title, "Data not available right now.", `${liveHtml}\n<h2>Started receiving payments</h2>\n${NA}`, live.map((e) => e.name));
  const fresh = w.apps.filter((a) => a.first_hour !== null && a.first_hour > w.until_hour - WINDOW_H && a.first_hour <= w.until_hour);
  const first = `In the 7 days to ${atHour(w.until)}, ${live.length} projects in the directory went live on Arc and ${fresh.length} apps started receiving payments in Registrai's index.`;
  const freshHtml = `<h2>Started receiving payments</h2>\n${fresh.length ? table(["App", "First payment hour", "Payments (7 d)"], fresh.map((a) => [appLink(a), esc(atHour(new Date(a.first_hour! * 3600e3).toISOString())), int(a.payments)])) : "<p>None this week.</p>"}\n${source(w)}`;
  return shell(path, title, first, `${liveHtml}\n${freshHtml}`, [...live.map((e) => e.name), ...fresh.map((a) => a.name)]);
}

export function renderGetUsdc(): string {
  const [path, title] = [QUESTION_PAGES[3].path, QUESTION_PAGES[3].title];
  const first = "USDC reaches Arc three ways: buy it through an on-ramp, withdraw it from an exchange that supports the Arc network, or bridge it from another chain.";
  const names: string[] = [];
  const section = (id: string, h: string) => {
    const all = sortByName(ECOSYSTEM.entities.filter((e) => inCat(e, id)));
    const main = all.filter((e) => e.status !== "announced"), ann = all.filter((e) => e.status === "announced");
    names.push(...main.map((e) => e.name));
    return `<h2>${h}</h2>\n${main.length ? table(["Project", "Status", "Evidence"], main.map((e) => [entLink(e), esc(STATUS_LABEL[e.status]), evidence(e)])) : "<p>None live yet.</p>"}${ann.length ? `\n<p class="muted">Announced: ${ann.map(entLink).join(", ")}</p>` : ""}`;
  };
  const body = [section("ramps", "On-ramps"), section("exchanges", "Exchanges"), section("bridges", "Bridges"),
    `<p class="muted">Source: Registrai Arc ecosystem directory; each status links its evidence. Last reviewed ${esc(ECOSYSTEM.entities.map((e) => e.last_reviewed).sort().pop() ?? "")}.</p>`].join("\n");
  return shell(path, title, first, body, names);
}
