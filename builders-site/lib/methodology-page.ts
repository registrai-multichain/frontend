/** /methodology/ (spec docs/superpowers/specs/2026-10-22-methodology-page-design.md): definitions, sources, the attributed
 *  share, limits and changelog. Parameter values come from the AEI file's published params at render time. */
import { esc, page } from "./apps-pages";
import { shareText, type Share7d } from "./arc-share";

export const METHODOLOGY_VERSION = "1";
export const METHODOLOGY_DATE = "2026-10-22";
const SITE = "https://builder.registrai.cc";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const at = (iso: string) => { const d = new Date(iso); return `${dayOf(iso)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };
const N = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

type Input = { params: Record<string, number> | null; share: Share7d | null; until: string | null };
type Term = { id: string; name: string; text: (p: (k: string) => number | null) => string };
const money = (x: number) => `$${N.format(x)}`;

const TERMS: Term[] = [
  { id: "payment", name: "Payment", text: () => "A transfer of USDC or another registered stablecoin into one of an app's attributed contracts on Arc mainnet, counted by the index method." },
  { id: "paying-wallet", name: "Paying wallet", text: () => "A distinct wallet that made at least one payment to the app within the period." },
  { id: "new-paying-wallet", name: "New paying wallet", text: (p) => {
    const min = p("new_payer_min_usdc"), max = p("new_payer_max_per_hour");
    return `A wallet paying the app for the first time${min !== null ? `, with at least ${money(min)}` : ""}${max !== null ? `; at most ${N.format(max)} count per app per hour` : ""}.`; } },
  { id: "received-usd", name: "Received (USD)", text: (p) => {
    const cap = p("cap_per_wallet_hour_usdc");
    return `The USD value of payments; other stablecoins are converted at the ECB reference rate for their currency. Each wallet counts ${cap !== null ? `up to ${money(cap)} per hour` : "up to a per-wallet hourly cap"}.`; } },
  { id: "attributed-contract", name: "Attributed contract", text: () => "A contract Registrai assigns to an app: its own deployments, pools created by its factories, or a reviewed integration list." },
  { id: "index-member", name: "Index member", text: () => "An app included in an index: the Arc Builders Index (verified builders), the Arc Integrations Index (integrations) or the Arc Ecosystem Index (all)." },
  { id: "index-points", name: "Index points", text: (p) => {
    const hl = p("half_life_days"), dh = p("decay_per_hour_pct"), per = p("volume_usdc_per_point"), np = p("new_payer_points");
    return `Activity points that decay${hl !== null ? ` with a half-life of ${N.format(hl)} days` : ""}${dh !== null ? ` (about ${N.format(dh)}% an hour)` : ""}: ${per !== null ? `one point per ${money(per)} received` : "points for USD received"}${np !== null ? `, plus ${N.format(np)} per new paying wallet` : ", plus points per new paying wallet"}.`; } },
  { id: "data-until", name: "Closed hour, data until", text: () => "Figures cover hours that have ended; \"data until\" is the end of the last closed hour (UTC)." },
  { id: "window", name: "7-day window", text: () => "The 168 closed hours ending at \"data until\"." },
  { id: "statuses", name: "Directory statuses", text: () => "Live: evidence of use on Arc mainnet (contracts, an index id, an explorer link or the project's own mainnet support page). Deployed: contracts on Arc without evidence of use. Announced: an announcement only." },
  { id: "attributed-share-term", name: "Attributed share", text: () => "See the attributed share section below." },
];
export const GLOSSARY_IDS = TERMS.map((t) => t.id);

export function renderMethodology(m: Input): string {
  const p = (k: string) => (m.params && typeof m.params[k] === "number" && Number.isFinite(m.params[k]) ? m.params[k] : null);
  const bw = p("base_window"), bs = p("base_scale");
  const asOf = m.until ? ` Values as of ${esc(at(m.until))}.` : "";
  const glossary = `<h2 id="glossary">Glossary</h2>\n<p class="muted">Parameter values are read from the method parameters the indices publish.${asOf}</p>\n<dl>${TERMS.map((t) => `<dt id="${t.id}">${esc(t.name)}</dt><dd>${esc(t.text(p))}</dd>`).join("")}</dl>`;
  const sources = `<h2 id="sources">Sources</h2>
<p>Where each figure comes from, and how often it is refreshed.</p>
<div class="wrap"><table><thead><tr><th>Source</th><th>What we take</th><th>How often</th></tr></thead><tbody>
<tr><td>Arc RPC (Blockdaemon, then rpc.mainnet.arc.io)</td><td>Blocks, token supplies, transfer logs</td><td>Live (Arc in numbers); hourly (indices)</td></tr>
<tr><td>Registrai indices (ABI, AII, AEI)</td><td>Per-app payments, wallets, USD</td><td>Hourly</td></tr>
<tr><td>DefiLlama</td><td>Arc TVL and stablecoins, always labelled "Source: DefiLlama"</td><td>Live, cached 10 min</td></tr>
<tr><td>Arc ecosystem directory</td><td>Project facts, each with its sources and evidence</td><td>Reviewed by hand; the review date is on each page</td></tr>
</tbody></table></div>`;
  const sample = bw !== null && bs !== null ? `the first ${N.format(bw)} blocks of each hour, scaled ×${N.format(bs)}` : "a sample of blocks in each hour, scaled up";
  const share = `<h2 id="attributed-share">The attributed share</h2>
<p>The share of USDC moved on Arc that went into apps the index attributes contracts to: received (USD) by all index members ÷ the estimated USD value of all USDC transfers on Arc, over the same period.</p>
<p>The all-USDC total is estimated from ${esc(sample)}, so one large transfer moves a one-day figure a lot; over 7 days it is steadier.</p>
<p><b>Now:</b> ${esc(shareText(m.share))}.</p>`;
  const limits = `<h2 id="limits">Known limits</h2>
<ul><li>The all-USDC total is an estimate from sampled blocks.</li>
<li>Payments to contracts we have not attributed are not counted for any app.</li>
<li>An hour the keeper misses is filled from the chain at the next close; if it cannot be, totals for that window are lower.</li>
<li>Directory facts are as current as their review date; corrections are public at <a href="/ecosystem/corrections/">/ecosystem/corrections/</a>.</li>
<li>Other stablecoins are converted to USD, so "Received (USD)" is not USDC only.</li></ul>`;
  const changelog = `<h2 id="changelog">Changelog</h2>\n<ul><li>v1 (${esc(dayOf(`${METHODOLOGY_DATE}T00:00:00Z`))}): first published version.</li></ul>`;
  const body = `<h1>Methodology</h1>
<p class="muted">Version ${METHODOLOGY_VERSION} · ${esc(dayOf(`${METHODOLOGY_DATE}T00:00:00Z`))}${m.until ? ` · Data until ${esc(at(m.until))}` : ""}</p>
<p>How Registrai defines and measures the figures on this site. Publishing principles: <a href="/how-we-publish/">How we publish</a>. The indices: <a href="/builders-index/">Indices</a>. API fields: <a href="/data-api/">Data API</a>.</p>
${glossary}\n${sources}\n${share}\n${limits}\n${changelog}`;
  const url = `${SITE}/methodology/`;
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "DefinedTermSet", name: "Registrai Arc data glossary", url, hasDefinedTerm: TERMS.map((t) => ({ "@type": "DefinedTerm", name: t.name, description: t.text(p), url: `${url}#${t.id}` })) },
    { "@type": "Article", headline: "Methodology", url, dateModified: METHODOLOGY_DATE, version: METHODOLOGY_VERSION } ] };
  return page({ title: "Methodology · Registrai", canonical: url, description: "How Registrai defines and measures the Arc figures on this site: glossary, sources, the attributed share, limits and changelog.", body, ld });
}
