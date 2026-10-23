/** The Arc question pages (spec docs/superpowers/specs/2026-10-22-arc-question-pages-design.md). Pure: data in, HTML out. */
import { STATUS_LABEL, categoryOf, entityHref, sortByName, type ArcEntity, type EntityStatus } from "../../src/lib/arc-ecosystem";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { esc, page } from "./apps-pages";
import { WINDOW_H, type ArcWeek, type WeekApp } from "./arc-week";
import { CHAIN_FACTS } from "../../src/lib/arc-chain-facts";
import { ARC_ERC20_GAS, ARC_NATIVE_GAS, ETH_NEW_HOLDER_GAS, ETH_TRANSFER_GAS, SOL_BASE_FEE_LAMPORTS, type Compare } from "./chain-compare";

const SITE = "https://builder.registrai.cc";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const atHour = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };
const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (x: number) => x.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const lastReviewed = () => ECOSYSTEM.entities.map((e) => e.last_reviewed).sort().pop() ?? "";
const DIR_SOURCE = () => `<p class="muted">Source: Registrai Arc ecosystem directory; each status links its evidence. Last reviewed ${esc(lastReviewed())}.</p>`;
const NA = `<p class="muted">Not available right now (source: Registrai index database).</p>`;
const METHOD = "Payments into each app's contracts in USDC and other registered stablecoins, converted to USD, as attributed by the Arc Ecosystem Index. New paying wallets: wallets that have not paid the app in the last 30 days.";
const catName = (id: string | null) => (id ? categoryOf(id)?.name ?? id : "–");
const appLink = (a: WeekApp) => `<a href="${esc(a.href)}">${esc(a.name)}</a>`;
const entLink = (e: ArcEntity) => `<a href="${entityHref(e.slug)}">${esc(e.name)}</a>`;
const evidence = (e: ArcEntity) => (e.status_evidence[0] ? `<a href="${esc(e.status_evidence[0].url)}" rel="noreferrer">Evidence</a>` : "–");
const source = (w: ArcWeek) => `<p class="muted">Source: Arc Ecosystem Index (Registrai), hourly, 7 days to ${esc(atHour(w.until))}. <details><summary>i</summary> ${esc(METHOD)} <a href="/methodology/#received-usd">Method</a></details></p>`;
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
  { path: "/arc/arc-vs-ethereum-vs-solana/", title: "Arc vs Ethereum vs Solana for stablecoin payments" },
] as const;

function shell(path: string, title: string, first: string, body: string, items: string[]): string {
  return page({ markdown: true, title: `${title} · Registrai`, canonical: `${SITE}${path}`, description: first,
    body: `<h1>${esc(title)}</h1>\n<p>${esc(first)}</p>\n${body}\n<p class="muted"><a href="/arc/">Arc in numbers</a> · <a href="/ecosystem/">Arc ecosystem</a></p>`, ld: itemList(path, title, items) });
}

export function renderMostUsed(w: ArcWeek | null): string {
  const [path, title] = [QUESTION_PAGES[0].path, QUESTION_PAGES[0].title];
  if (!w) return shell(path, title, "Data not available right now.", NA, []);
  const paid = w.apps.filter((a) => a.payments > 0);
  const first = paid.length && paid[0].usd > 0
    ? `In the 7 days to ${atHour(w.until)}, ${paid[0].name} received the most in stablecoin payments of the ${plural(paid.length, "app", "apps")} with payments in Registrai's Arc index: ${usd(paid[0].usd)}.`
    : `No measured app received payments in the 7 days to ${atHour(w.until)}.`;
  const rows = paid.map((a, i) => [String(i + 1), appLink(a), esc(catName(a.category)), usd(a.usd), int(a.payments), int(a.new_payers)]);
  return shell(path, title, first, `${paid.length ? table(["#", "App", "Category", "Received (USD)", "Payments", "New paying wallets"], rows) : ""}\n${source(w)}`, paid.map((a) => a.name));
}

export function renderAcceptsUsdc(w: ArcWeek | null): string {
  const [path, title] = [QUESTION_PAGES[1].path, QUESTION_PAGES[1].title];
  const measuredIds = new Set((w?.apps ?? []).map((a) => a.id));   // every index member in the window, paid or not (review #3)
  const listed = ECOSYSTEM.entities.filter((e) => inCat(e, "payments") && !(e.index_ids ?? []).some((id) => measuredIds.has(id)))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.name < b.name ? -1 : 1));
  const listedHtml = `<h2>Listed, not measured</h2>\n${listed.length ? table(["Project", "Status", "Evidence"], listed.map((e) => [entLink(e), esc(STATUS_LABEL[e.status]), evidence(e)])) : "<p>None.</p>"}\n${DIR_SOURCE()}`;
  const by = (st: EntityStatus) => listed.filter((e) => e.status === st).length;
  if (!w) return shell(path, title, "Data not available right now.", `<h2>Measured</h2>\n${NA}\n${listedHtml}`, listed.map((e) => e.name));
  const paid = w.apps.filter((a) => a.payments > 0);
  const first = `${plural(paid.length, "app", "apps")} on Arc received stablecoin payments in the 7 days to ${atHour(w.until)}. ${listed.length} more payment ${listed.length === 1 ? "project is" : "projects are"} listed in Registrai's Arc directory (${by("live")} live, ${by("deployed")} deployed, ${by("announced")} announced) but not measured by Registrai.`;
  const measured = paid.length ? table(["App", "Category", "Payments (7 d)", "Received (USD, 7 d)"], paid.map((a) => [appLink(a), esc(catName(a.category)), int(a.payments), usd(a.usd)])) : "<p>None this week.</p>";
  return shell(path, title, first, `<h2>Measured</h2>\n${measured}\n${source(w)}\n${listedHtml}`, [...paid.map((a) => a.name), ...listed.map((e) => e.name)]);
}

const minusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);

export function renderNew(w: ArcWeek | null, today: string): string {
  const [path, title] = [QUESTION_PAGES[2].path, QUESTION_PAGES[2].title];
  const end = w ? w.until.slice(0, 10) : today, start = minusDays(end, 7);
  const live = sortByName(ECOSYSTEM.entities.filter((e) => e.first_live && e.first_live > start && e.first_live <= end));
  const liveHtml = `<h2>Went live</h2>\n${live.length ? table(["Project", "Category", "Live since"], live.map((e) => [entLink(e), esc(catName(e.category)), esc(e.first_live!)])) : "<p>None this week.</p>"}\n${DIR_SOURCE()}`;
  if (!w) return shell(path, title, "Data not available right now.", `${liveHtml}\n<h2>${esc("Added to Registrai's index")}</h2>\n${NA}`, live.map((e) => e.name));
  const fresh = w.apps.filter((a) => a.first_hour !== null && a.first_hour > w.until_hour - WINDOW_H && a.first_hour <= w.until_hour);
  const first = `In the 7 days to ${atHour(w.until)}, ${plural(live.length, "project", "projects")} in the directory went live on Arc and ${plural(fresh.length, "app was", "apps were")} added to Registrai's index.`;
  const freshHtml = `<h2>${esc("Added to Registrai's index")}</h2>\n${fresh.length ? table(["App", "First seen", "Payments (7 d)"], fresh.map((a) => [appLink(a), esc(atHour(new Date(a.first_hour! * 3600e3).toISOString())), int(a.payments)])) : "<p>None this week.</p>"}\n${source(w)}`;
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

/** Arc vs Ethereum vs Solana for stablecoin payments (spec 2026-10-23-replace-competitor-citations §3). Every figure is
 *  measured or estimated with its formula behind an "i"; static facts come from arc-chain-facts.json with their sources. */
export function renderCompare(c: Compare | null): string {
  const [path, title] = [QUESTION_PAGES[4].path, QUESTION_PAGES[4].title];
  const NA_CELL = "Not available right now";
  const fact = (id: string) => CHAIN_FACTS.comparison?.find((f) => f.id === id);
  const src = (id: string) => { const f = fact(id); return f ? `<a href="${esc(f.source)}" rel="noreferrer">source</a>` : ""; };
  const note = (t: string) => ` <details><summary>i</summary> ${esc(t)}</details>`;
  const secs = (x: number | null | undefined) => (x == null ? NA_CELL : x < 1 ? `${x.toFixed(2)} s` : `${x.toFixed(1)} s`);
  const fee = (x: number | null | undefined) => (x == null ? NA_CELL : x < 0.01 ? `$${x.toPrecision(2)}` : `$${x.toFixed(3)}`);
  const big = (x: number | null | undefined) => (x == null ? NA_CELL : `$${Math.round(x).toLocaleString("en-US")}`);
  const g = c?.gas_price_gwei, p = c?.prices;
  const rows: [string, string, string, string, string][] = [
    ["Fee currency", `USDC ${src("fee-currency-arc")}`, `ETH ${src("fee-currency-ethereum")}`, `SOL ${src("fee-currency-solana")}`, "Chain documentation"],
    ["Block time", esc(secs(c?.arc.block_time_s)), esc(secs(c?.ethereum.block_time_s)), esc(secs(c?.solana.block_time_s)),
      `Measured: Arc and Ethereum over the last 10,000 blocks, Solana per slot from recent performance samples (RPC)`],
    ["Finality", `${esc(fact("finality-arc")?.text ?? "")} ${src("finality-arc")}`, `${esc(fact("finality-ethereum")?.text ?? "")} ${src("finality-ethereum")}`,
      `${esc(fact("finality-solana")?.text ?? "")} ${src("finality-solana")}`, "Chain documentation"],
    ["Fee for a USDC transfer (estimate)",
      esc(fee(c?.arc.fee_usd)) + note(`Gas price ${g?.arc == null ? "n/a" : `${g.arc.toFixed(2)} gwei`} × ${ARC_ERC20_GAS.toLocaleString("en-US")} gas for an ERC-20 transfer through the USDC contract, paid in USDC. A native USDC transfer uses ${ARC_NATIVE_GAS.toLocaleString("en-US")} gas (${fee(c?.arc.fee_native_usd)}).`),
      esc(fee(c?.ethereum.fee_usd)) + note(`Gas price ${g?.ethereum == null ? "n/a" : `${g.ethereum.toFixed(2)} gwei`} × ${ETH_TRANSFER_GAS.toLocaleString("en-US")} gas for a USDC transfer to an address that already holds USDC × ETH price ${p?.eth == null ? "n/a" : `$${Math.round(p.eth).toLocaleString("en-US")}`}. To a new holder: ${ETH_NEW_HOLDER_GAS.toLocaleString("en-US")} gas (${fee(c?.ethereum.fee_new_holder_usd)}).`),
      esc(fee(c?.solana.fee_usd)) + note(`Base fee ${SOL_BASE_FEE_LAMPORTS.toLocaleString("en-US")} lamports per signature × SOL price ${p?.sol == null ? "n/a" : `$${p.sol.toFixed(2)}`}; no priority fee, and no token account creation for a recipient without one.`),
      "RPC gas prices; prices from DefiLlama"],
    ["USDC in circulation", esc(big(c?.arc.usdc_supply)), esc(big(c?.ethereum.usdc_supply)), esc(big(c?.solana.usdc_supply)), `DefiLlama stablecoins by chain${c ? `, ${esc(c.usdc_date)}` : ""}`],
    ["Apps measured receiving USDC, 24 h", c?.arc.apps_paying == null ? NA_CELL : String(c.arc.apps_paying), "Not measured by Registrai", "Not measured by Registrai", "Arc Ecosystem Index (Registrai)"],
  ];
  const parts = [
    "Arc, Circle's layer-1, uses USDC as its gas token, so a USDC payment pays its fee in USDC",
    c?.arc.block_time_s != null ? `; blocks come every ${secs(c.arc.block_time_s)}` : "",
    c?.ethereum.block_time_s != null && c?.solana.block_time_s != null ? ` (Ethereum ${secs(c.ethereum.block_time_s)}, Solana ${secs(c.solana.block_time_s)} per slot)` : "",
    ". Ethereum charges fees in ETH and Solana in SOL.",
  ];
  const first = parts.join("");
  const body = `<div class="wrap"><table><thead><tr><th>Measure</th><th>Arc</th><th>Ethereum</th><th>Solana</th><th>Source</th></tr></thead><tbody>
${rows.map((r) => `<tr><th>${esc(r[0])}</th><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td class="muted">${r[4]}</td></tr>`).join("\n")}
</tbody></table></div>
<p class="muted">${c ? `Measured ${esc(atHour(c.generated_at))}. ` : ""}Fees are estimates for one USDC transfer, excluding the amount sent: Arc and Ethereum at the RPC's current gas price (base fee plus suggested tip), Solana at the base fee only. <a href="/arc/">Arc in numbers</a></p>`;
  return page({ markdown: true, title: `${title} · Registrai`, canonical: `${SITE}${path}`, description: first,
    body: `<h1>${esc(title)}</h1>\n<p>${esc(first)}</p>\n${body}\n<p class="muted"><a href="/arc/">Arc in numbers</a> · <a href="/ecosystem/">Arc ecosystem</a></p>`,
    ld: { "@context": "https://schema.org", "@type": "Dataset", name: title, url: `${SITE}${path}`, description: first, license: "https://creativecommons.org/licenses/by/4.0/",
      creator: { "@type": "Organization", name: "Registrai", url: "https://registrai.cc/" }, ...(c ? { dateModified: c.generated_at } : {}) } });
}

