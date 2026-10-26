/**
 * The /arc/ page (spec docs/superpowers/specs/2026-10-20-arc-in-numbers-design.md): Arc in numbers, every section with
 * its source and date, a missing source shown as "Not available right now", the daily history newest first. Pure.
 */
import { categoryHref, type CategoryId } from "../../src/lib/arc-ecosystem";
import { day, esc, page, when } from "./apps-pages";
import { EURC_ARC, USDC_ARC, type ArcNumbers } from "./arc-numbers";
import { CHAIN_FACTS } from "../../src/lib/arc-chain-facts";
import { share7d, shareText } from "./arc-share";
import { QUESTION_PAGES } from "./arc-question-pages";

const SITE = "https://builder.registrai.cc";
const N0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }), N2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const NA = "Not available right now";
const usd = (x: number | null) => (x === null ? NA : `$${N0.format(x)}`);
const amt = (x: number | null, unit: string) => (x === null ? NA : `${N0.format(x)} ${unit}`);
const int = (x: number | null) => (x === null ? NA : N0.format(x));
const row = (label: string, value: string, source = "") => `<tr><th>${esc(label)}</th><td class="n">${esc(value)}</td><td class="muted">${esc(source)}</td></tr>`;
/** A row whose value is trusted HTML (built from escaped parts), e.g. a figure with a link. */
const rowHtml = (label: string, html: string, source = "") => `<tr><th>${esc(label)}</th><td class="n">${html}</td><td class="muted">${esc(source)}</td></tr>`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Live reads to the minute (when() rounds to the index hour). */
const at = (s: string) => { const d = new Date(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };
const LLAMA_NOTE = "DefiLlama counts the circulating supply of every stablecoin on Arc (all pegs, in USD); it can differ from the token contracts' totalSupply shown above.";
const METHOD = "Stablecoin transfers on Arc in the last 24 h, estimated from sampled hours by the Arc Ecosystem Index; tracked apps = transfers into contracts the index attributes to an app.";

const link = (href: string, text: string) => `<a href="${esc(href)}" rel="noreferrer">${esc(text)}</a>`;
const dayOf = (d: string) => day(`${d}T00:00:00Z`);

/** Sourced facts, then the live figures as sentences; a missing figure drops its sentence (spec 2026-10-23-ai-search-gaps §1). */
function factsHtml(n: ArcNumbers): string {
  const a = n.activity_24h, s = n.stablecoins;
  const live = [
    s.usdc_supply !== null && s.as_of ? `Arc held ${esc(N0.format(s.usdc_supply))} USDC on ${esc(at(s.as_of))}. (Arc RPC)` : "",
    s.tvl_usd !== null && s.defillama_date ? `TVL on Arc was ${esc(usd(s.tvl_usd))} on ${esc(dayOf(s.defillama_date))}. (DefiLlama)` : "",
    a.transactions_est != null && a.tx_sample ? `About ${esc(N0.format(a.transactions_est))} transactions in the last 24 h, estimated from ${a.tx_sample.blocks} sampled blocks. (Arc RPC) <details><summary>i</summary> Blocks ${N0.format(a.tx_sample.from_block)} to ${N0.format(a.tx_sample.to_block)}, evenly spaced; the mean count per sampled block times the blocks in 24 h, rounded to the nearest 1,000.</details>` : "",
    a.active_accounts ? `${esc(N0.format(a.active_accounts.count))} accounts sent at least one transaction on Arc on ${esc(dayOf(a.active_accounts.date))} (UTC). (Arc explorer, Blockscout)` : "",
    a.app_usd !== null ? `Apps tracked by Registrai received ${esc(usd(a.app_usd))} in USDC payments in the last 24 h. (Arc Ecosystem Index)` : "",
  ].filter(Boolean);
  return `<h2>Facts</h2>
<ul>${CHAIN_FACTS.facts.map((f) => `<li>${esc(f.text)} (${link(f.source, "source")}, ${esc(dayOf(f.date))})</li>`).join("")}${live.map((x) => `<li>${x}</li>`).join("")}</ul>`;
}

/** Every listed stablecoin with its contract and on-chain supply; older snapshots fall back to USDC and EURC. */
function tokensHtml(n: ArcNumbers, rpcAt: string): string {
  const explorer = n.network.explorer_url ?? CHAIN_FACTS.network.explorer_url;
  const src = new Map(CHAIN_FACTS.stablecoins.map((t) => [t.symbol, t.source]));
  const tokens = n.stablecoins.tokens ?? [
    { symbol: "USDC", issuer: "Circle", address: USDC_ARC, supply: n.stablecoins.usdc_supply },
    { symbol: "EURC", issuer: "Circle", address: EURC_ARC, supply: n.stablecoins.eurc_supply },
  ];
  return `<div class="wrap"><table><thead><tr><th>Token</th><th>Issuer</th><th>Contract</th><th class="n">Supply on Arc</th><th>Source</th></tr></thead><tbody>
${tokens.map((t) => `<tr><td>${esc(t.symbol)}</td><td>${esc(t.issuer)}</td><td>${t.address ? `<a href="${esc(`${explorer}/address/${t.address}`)}" rel="noreferrer"><code>${esc(t.address)}</code></a>` : "Address not published"}</td><td class="n">${t.address ? esc(t.supply === null ? NA : N0.format(t.supply)) : "–"}</td><td class="muted">${src.get(t.symbol) ? link(src.get(t.symbol)!, "address") : ""}${t.address ? ` · ${esc(rpcAt)}` : ""}</td></tr>`).join("\n")}
</tbody></table></div>`;
}

export function renderArc(n: ArcNumbers, history: ArcNumbers[]): string {
  const rpcAt = n.network.as_of ? `Arc RPC, ${at(n.network.as_of)}` : "Arc RPC";
  const llamaAt = n.stablecoins.defillama_date ? `Source: DefiLlama, ${day(`${n.stablecoins.defillama_date}T00:00:00Z`)}` : "Source: DefiLlama";
  const a = n.activity_24h, e = n.ecosystem;
  const share = share7d(history);
  const idx = (k: "abi" | "aii" | "aei") => `${k.toUpperCase()} ${e.index_members[k] === null ? "–" : N0.format(e.index_members[k]!)}`;
  const close = (k: "abi" | "aii" | "aei") => `${k.toUpperCase()} ${e.index_close[k] === null ? "–" : N2.format(e.index_close[k]!)}`;
  const hist = history.length
    ? `<div class="wrap"><table><thead><tr><th>Snapshot</th><th class="n">USDC supply</th><th class="n">All stablecoins</th><th class="n">TVL</th><th class="n">USDC moved, 24 h (est.)</th><th class="n">Attributed to apps, 24 h</th><th class="n">Transactions, 24 h (est.)</th></tr></thead><tbody>
${history.map((h) => `<tr><td>${esc(at(h.generated_at))}</td><td class="n">${esc(amt(h.stablecoins.usdc_supply, "USDC"))}</td><td class="n">${esc(usd(h.stablecoins.all_stablecoins_usd))}</td><td class="n">${esc(usd(h.stablecoins.tvl_usd))}</td><td class="n">${esc(usd(h.activity_24h.usdc_moved_usd_est))}</td><td class="n">${h.activity_24h.attributed_share_pct === null ? NA : `${N2.format(h.activity_24h.attributed_share_pct)}%`}</td><td class="n">${h.activity_24h.transactions_est == null ? "–" : esc(N0.format(h.activity_24h.transactions_est))}</td></tr>`).join("\n")}
</tbody></table></div>`
    : "<p>Daily snapshots start at the next 00:00 UTC close.</p>";
  const body = `<h1>Arc in numbers</h1>
<p class="muted">Arc is the layer-1 blockchain built by Circle. Generated ${esc(at(n.generated_at))}; each figure gives its source and date.</p>
${factsHtml(n)}
<h2>Network</h2>
<table><tbody>
${row("Chain ID", String(n.network.chain_id), "Arc docs")}
${row("Gas token", n.network.gas_token, "Arc docs")}
${row("Mainnet since", day(`${n.network.mainnet_since}T00:00:00Z`), "Circle press release")}
${row("Block height", int(n.network.block_height), rpcAt)}
${row("Average block time", n.network.block_time_s === null ? NA : `${n.network.block_time_s.toFixed(2)} s`, "last 10,000 blocks")}
${row("RPC", n.network.rpc_url ?? CHAIN_FACTS.network.rpc_url, "Arc docs")}
${row("Explorer", n.network.explorer_url ?? CHAIN_FACTS.network.explorer_url, "Arc docs")}
</tbody></table>
<h2>Stablecoins on Arc</h2>
${tokensHtml(n, rpcAt)}
<table><tbody>
${row("All stablecoins, circulating (USD value)", usd(n.stablecoins.all_stablecoins_usd), llamaAt)}
${row("TVL", usd(n.stablecoins.tvl_usd), llamaAt)}
</tbody></table>
<p class="muted"><details><summary>i</summary> ${esc(LLAMA_NOTE)}</details></p>
<h2>Activity, last 24 h</h2>
<p class="muted">${a.data_until ? `Data until ${esc(when(a.data_until))}` : NA} · Source: Arc Ecosystem Index (Registrai) <details><summary>i</summary> ${esc(METHOD)}</details></p>
<table><tbody>
${row("USDC moved on Arc (estimate)", usd(a.usdc_moved_usd_est))}
${row("EURC moved on Arc, in USD (estimate)", usd(a.eurc_moved_usd_est))}
${row("USDC transfers (estimate)", int(a.usdc_transfers_est))}
${row("Transactions (estimate)", int(a.transactions_est ?? null), "Arc RPC, sampled blocks")}
${row(a.active_accounts ? `Active accounts, ${dayOf(a.active_accounts.date)}` : "Active accounts, one UTC day", int(a.active_accounts?.count ?? null), "Arc explorer (Blockscout): accounts that sent a transaction")}
${row("Payments to tracked apps", int(a.app_payments))}
${row("USDC to tracked apps", usd(a.app_usd))}
${rowHtml("Share attributed to apps", `${esc(shareText(share))} <a href="/methodology/#attributed-share">Method</a>`)}
</tbody></table>
<h2>Ecosystem</h2>
<p><a href="/ecosystem/">${N0.format(e.projects)} projects</a> in the Arc ecosystem directory: ${N0.format(e.live)} live on mainnet, ${N0.format(e.deployed)} deployed, ${N0.format(e.announced)} announced.</p>
<ul>${e.top_categories.map((c) => `<li><a href="${categoryHref(c.id as CategoryId)}">${esc(c.label)}</a>: ${N0.format(c.count)}</li>`).join("")}</ul>
<p>Apps in the <a href="/builders-index/">Arc indices</a>: ${idx("abi")} · ${idx("aii")} · ${idx("aei")}. Closes: ${close("abi")} · ${close("aii")} · ${close("aei")}${e.data_until ? ` (${esc(when(e.data_until))})` : ""}.</p>
<h2>Timeline</h2>
<ul>${n.timeline.map((t) => `<li>${esc(day(`${t.date}T00:00:00Z`))}: ${esc(t.text)} (<a href="${esc(t.source)}" rel="noreferrer">source</a>)</li>`).join("")}</ul>
<h2>Questions</h2>
<ul>${QUESTION_PAGES.map((q) => `<li><a href="${q.path}">${esc(q.title)}</a></li>`).join("")}</ul>
<h2>History</h2>
${hist}
<p class="muted">JSON: <a href="/api/v1/arc">/api/v1/arc</a> · <a href="/api/v1/arc/daily">/api/v1/arc/daily</a>. Registrai figures CC BY 4.0; DefiLlama figures as labelled.</p>`;
  const oldest = history.length ? history[history.length - 1].generated_at : n.generated_at;
  const ld = { "@context": "https://schema.org", "@type": "Dataset", name: "Arc in numbers", url: `${SITE}/arc/`,
    description: "Chain-level figures for the Arc blockchain: stablecoin supply, estimated stablecoin volume, apps and projects, index closes and a timeline, with sources and dates.",
    license: "https://creativecommons.org/licenses/by/4.0/", creator: { "@type": "Organization", name: "Registrai", url: "https://registrai.cc/" },
    dateModified: n.generated_at, temporalCoverage: `${oldest}/${n.generated_at}`, isAccessibleForFree: true,
    variableMeasured: ["USDC supply", "EURC supply", "stablecoin volume (estimate)", "projects", "index closes"],
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/api/v1/arc` }, { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/api/v1/arc/daily` }] };
  return page({ markdown: true, title: "Arc in numbers · Registrai", canonical: `${SITE}/arc/`,
    description: `Arc blockchain in numbers: ${amt(n.stablecoins.usdc_supply, "USDC")} on Arc, ${N0.format(e.projects)} projects, estimated stablecoin volume and index closes, with sources.`, body, ld });
}
