import { describe, expect, test } from "vitest";
import type { ArcNumbers } from "../lib/arc-numbers";
import { ARC_TIMELINE } from "../lib/arc-numbers";
import { CHAIN_FACTS } from "../../src/lib/arc-chain-facts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const now = (o: Partial<ArcNumbers> = {}): ArcNumbers => ({
  version: 1, generated_at: "2026-10-23T13:03:00.000Z",
  network: { chain_id: 5042, gas_token: "USDC", mainnet_since: "2026-09-16", block_height: 27452377, block_time_s: 0.51, as_of: "2026-10-23T13:03:00.000Z", rpc_url: "https://rpc.mainnet.arc.io", explorer_url: "https://explorer.arc.io" },
  stablecoins: { usdc_supply: 819428662.4, eurc_supply: 9032853, as_of: "2026-10-23T13:03:00.000Z", all_stablecoins_usd: 830347636, tvl_usd: 634731218, defillama_date: "2026-10-23",
    tokens: [{ symbol: "USDC", issuer: "Circle", address: "0x3600000000000000000000000000000000000000", supply: 819428662.4 }, { symbol: "JPYC", issuer: "JPYC", address: "0xe7c3d8c9a439fede00d2600032d5db0be71c3c29", supply: null }, { symbol: "XYZ", issuer: "X", address: null, supply: null }] },
  activity_24h: { data_until: "2026-10-23T13:00:00Z", usdc_moved_usd_est: 682898520, eurc_moved_usd_est: 1, usdc_transfers_est: 400000, app_payments: 80000, app_usd: 28499285, attributed_share_pct: 4.17,
    transactions_est: 342000, tx_sample: { blocks: 240, from_block: 27283657, to_block: 27452377 } },
  ecosystem: { projects: 258, live: 83, deployed: 20, announced: 155, top_categories: [], index_members: { abi: 1, aii: 1, aei: 1 }, index_close: { abi: 1, aii: 1, aei: 1 }, data_until: "2026-10-23T13:00:00Z" },
  timeline: ARC_TIMELINE, errors: [], ...o,
});

describe("/arc/ answers in sentences (spec 2026-10-23-ai-search-gaps §1)", () => {
  test("a Facts section: every sourced fact with its link and date, then the live sentences", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const h = renderArc(now(), []);
    expect(h).toContain("<h2>Facts</h2>");
    for (const f of CHAIN_FACTS.facts) { expect(h, f.id).toContain(esc(f.text)); expect(h, f.id).toContain(`href="${f.source}"`); }
    expect(h).toContain("Arc held 819,428,662 USDC on 23 Oct 2026, 13:03 UTC.");
    expect(h).toContain("TVL on Arc was $634,731,218 on 23 Oct 2026.");
    expect(h).toContain("About 342,000 transactions in the last 24 h, estimated from 240 sampled blocks.");
    expect(h).toContain("Apps tracked by Registrai received $28,499,285 in USDC payments in the last 24 h.");
  });
  test("a missing figure drops its sentence; its table row says Not available", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const n = now();
    n.activity_24h.transactions_est = null; n.activity_24h.tx_sample = null;
    const h = renderArc(n, []);
    expect(h).not.toContain("transactions in the last 24 h, estimated");
    expect(h).toMatch(/<th>Transactions \(estimate\)<\/th><td class="n">Not available right now/);
  });
  test("RPC and explorer rows; a stablecoin table with contracts and supplies", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const h = renderArc(now(), []);
    expect(h).toMatch(/<th>RPC<\/th><td class="n">https:\/\/rpc.mainnet.arc.io<\/td>/);
    expect(h).toMatch(/<th>Explorer<\/th><td class="n">https:\/\/explorer.arc.io<\/td>/);
    expect(h).toContain('<a href="https://explorer.arc.io/address/0x3600000000000000000000000000000000000000" rel="noreferrer"><code>0x3600000000000000000000000000000000000000</code></a>');
    expect(h).toMatch(/<td>USDC<\/td><td>Circle<\/td>.*?<td class="n">819,428,662<\/td>/s);
    expect(h).toMatch(/<td>JPYC<\/td>.*?Not available right now/s);
    expect(h).toMatch(/<td>XYZ<\/td><td>X<\/td><td>Address not published<\/td>/);
  });
  test("an old snapshot without the new fields still renders, with – for transactions", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const old = now();
    delete old.activity_24h.transactions_est; delete old.activity_24h.tx_sample; delete old.stablecoins.tokens; delete old.network.rpc_url; delete old.network.explorer_url;
    const h = renderArc(old, [old]);
    expect(h).toContain("<th class=\"n\">Transactions, 24 h (est.)</th>");
    expect(h).toMatch(/<td class="n">–<\/td><\/tr>/);
    expect(h).toMatch(/<td>USDC<\/td>/);   // falls back to USDC and EURC from the older fields
  });
  test("the Markdown copy carries the facts", async () => {
    const { renderArc } = await import("../lib/arc-pages");
    const { htmlToMarkdown } = await import("../lib/markdown");
    const md = htmlToMarkdown(renderArc(now(), []), "https://builder.registrai.cc/arc/");
    expect(md).toContain("Circle launched the public Arc mainnet on 16 September 2026");
    expect(md).not.toMatch(/<[a-z]/i);
  });
});
