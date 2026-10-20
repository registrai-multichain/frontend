/**
 * The /arc/ page (spec docs/superpowers/specs/2026-10-20-arc-in-numbers-design.md): Arc in numbers, every section with
 * its source and date, a missing source shown as "Not available right now", the daily history newest first. Pure.
 */
import { categoryHref, type CategoryId } from "../../src/lib/arc-ecosystem";
import { day, esc, page, when } from "./apps-pages";
import type { ArcNumbers } from "./arc-numbers";

const SITE = "https://builder.registrai.cc";
const N0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }), N2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const NA = "Not available right now";
const usd = (x: number | null) => (x === null ? NA : `$${N0.format(x)}`);
const amt = (x: number | null, unit: string) => (x === null ? NA : `${N0.format(x)} ${unit}`);
const int = (x: number | null) => (x === null ? NA : N0.format(x));
const row = (label: string, value: string, source = "") => `<tr><th>${esc(label)}</th><td class="n">${esc(value)}</td><td class="muted">${esc(source)}</td></tr>`;
const METHOD = "Stablecoin transfers on Arc in the last 24 h, estimated from sampled hours by the Arc Ecosystem Index; tracked apps = transfers into contracts the index attributes to an app.";

export function renderArc(n: ArcNumbers, history: ArcNumbers[]): string {
  const rpcAt = n.network.as_of ? `Arc RPC, ${when(n.network.as_of)}` : "Arc RPC";
  const llamaAt = n.stablecoins.defillama_date ? `Source: DefiLlama, ${day(`${n.stablecoins.defillama_date}T00:00:00Z`)}` : "Source: DefiLlama";
  const a = n.activity_24h, e = n.ecosystem;
  const idx = (k: "abi" | "aii" | "aei") => `${k.toUpperCase()} ${e.index_members[k] === null ? "–" : N0.format(e.index_members[k]!)}`;
  const close = (k: "abi" | "aii" | "aei") => `${k.toUpperCase()} ${e.index_close[k] === null ? "–" : N2.format(e.index_close[k]!)}`;
  const hist = history.length
    ? `<div class="wrap"><table><thead><tr><th>Snapshot</th><th class="n">USDC supply</th><th class="n">All stablecoins</th><th class="n">TVL</th><th class="n">USDC moved, 24 h (est.)</th><th class="n">Attributed to apps</th></tr></thead><tbody>
${history.map((h) => `<tr><td>${esc(when(h.generated_at))}</td><td class="n">${esc(amt(h.stablecoins.usdc_supply, "USDC"))}</td><td class="n">${esc(usd(h.stablecoins.all_stablecoins_usd))}</td><td class="n">${esc(usd(h.stablecoins.tvl_usd))}</td><td class="n">${esc(usd(h.activity_24h.usdc_moved_usd_est))}</td><td class="n">${h.activity_24h.attributed_share_pct === null ? NA : `${N2.format(h.activity_24h.attributed_share_pct)}%`}</td></tr>`).join("\n")}
</tbody></table></div>`
    : "<p>Daily snapshots start at the next 00:00 UTC close.</p>";
  const body = `<h1>Arc in numbers</h1>
<p class="muted">Arc is the layer-1 blockchain built by Circle. Generated ${esc(when(n.generated_at))}; each figure gives its source and date.</p>
<h2>Network</h2>
<table><tbody>
${row("Chain ID", String(n.network.chain_id), "Arc docs")}
${row("Gas token", n.network.gas_token, "Arc docs")}
${row("Mainnet since", day(`${n.network.mainnet_since}T00:00:00Z`), "Circle press release")}
${row("Block height", int(n.network.block_height), rpcAt)}
${row("Average block time", n.network.block_time_s === null ? NA : `${n.network.block_time_s.toFixed(2)} s`, "last 10,000 blocks")}
</tbody></table>
<h2>Stablecoins on Arc</h2>
<table><tbody>
${row("USDC supply", amt(n.stablecoins.usdc_supply, "USDC"), rpcAt)}
${row("EURC supply", amt(n.stablecoins.eurc_supply, "EURC"), rpcAt)}
${row("All stablecoins (USD)", usd(n.stablecoins.all_stablecoins_usd), llamaAt)}
${row("TVL", usd(n.stablecoins.tvl_usd), llamaAt)}
</tbody></table>
<h2>Activity, last 24 h</h2>
<p class="muted">${a.data_until ? `Data until ${esc(when(a.data_until))}` : NA} · Source: Arc Ecosystem Index (Registrai) <details><summary>i</summary> ${esc(METHOD)}</details></p>
<table><tbody>
${row("USDC moved on Arc (estimate)", usd(a.usdc_moved_usd_est))}
${row("EURC moved on Arc, in USD (estimate)", usd(a.eurc_moved_usd_est))}
${row("USDC transfers (estimate)", int(a.usdc_transfers_est))}
${row("Payments to tracked apps", int(a.app_payments))}
${row("USDC to tracked apps", usd(a.app_usd))}
${row("Share attributed to apps", a.attributed_share_pct === null ? NA : `${N2.format(a.attributed_share_pct)}%`)}
</tbody></table>
<h2>Ecosystem</h2>
<p><a href="/ecosystem/">${N0.format(e.projects)} projects</a> in the Arc ecosystem directory: ${N0.format(e.live)} live on mainnet, ${N0.format(e.deployed)} deployed, ${N0.format(e.announced)} announced.</p>
<ul>${e.top_categories.map((c) => `<li><a href="${categoryHref(c.id as CategoryId)}">${esc(c.label)}</a>: ${N0.format(c.count)}</li>`).join("")}</ul>
<p>Apps in the <a href="/builders-index/">Arc indices</a>: ${idx("abi")} · ${idx("aii")} · ${idx("aei")}. Closes: ${close("abi")} · ${close("aii")} · ${close("aei")}${e.data_until ? ` (${esc(when(e.data_until))})` : ""}.</p>
<h2>Timeline</h2>
<ul>${n.timeline.map((t) => `<li>${esc(day(`${t.date}T00:00:00Z`))}: ${esc(t.text)} (<a href="${esc(t.source)}" rel="noreferrer">source</a>)</li>`).join("")}</ul>
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
  return page({ title: "Arc in numbers · Registrai", canonical: `${SITE}/arc/`,
    description: `Arc blockchain in numbers: ${amt(n.stablecoins.usdc_supply, "USDC")} on Arc, ${N0.format(e.projects)} projects, estimated stablecoin volume and index closes, with sources.`, body, ld });
}
