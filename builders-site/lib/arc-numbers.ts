/**
 * Arc in numbers (spec docs/superpowers/specs/2026-10-20-arc-in-numbers-design.md): chain-level Arc figures from the Arc
 * RPC, DefiLlama (labelled on the page), the Registrai index files and the ecosystem directory. Each source is fetched
 * on its own with a timeout; a failed source leaves its fields null and adds a line to `errors`, never throws.
 */
import { CATEGORIES } from "../../src/lib/arc-ecosystem";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import type { AbiData } from "../../src/lib/builders-index";
import { indexFile } from "./data-api";
import { INDEX_IDS, type IndexId } from "./data-api-rows";
import type { Env } from "./env";

export const USDC_ARC = "0x3600000000000000000000000000000000000000";
export const EURC_ARC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1";
const RPCS = ["https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.mainnet.arc.io"];
const LLAMA_TVL = "https://api.llama.fi/v2/historicalChainTvl/Arc";
const LLAMA_STABLES = "https://stablecoins.llama.fi/stablecoincharts/Arc";
const TIMEOUT_MS = 8000;
const BLOCK_SPAN = 10_000;

export const ARC_TIMELINE = [
  { date: "2025-10-28", text: "Arc public testnet launched", source: "https://www.arc.io/pressroom/circle-launches-arc-public-testnet" },
  { date: "2026-08-05", text: "Founding validator cohort announced", source: "https://www.arc.io/pressroom/circle-announces-founding-validator-cohort-and-major-integrations-for-arc-ahead-of-september-16-mainnet-launch" },
  { date: "2026-09-16", text: "Arc mainnet launched", source: "https://www.arc.io/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet" },
];

type ByIndex = Record<IndexId, number | null>;
export type ArcNumbers = {
  version: 1; generated_at: string;
  network: { chain_id: 5042; gas_token: "USDC"; mainnet_since: "2026-09-16"; block_height: number | null; block_time_s: number | null; as_of: string | null };
  stablecoins: { usdc_supply: number | null; eurc_supply: number | null; as_of: string | null; all_stablecoins_usd: number | null; tvl_usd: number | null; defillama_date: string | null };
  activity_24h: { data_until: string | null; usdc_moved_usd_est: number | null; eurc_moved_usd_est: number | null; usdc_transfers_est: number | null;
    app_payments: number | null; app_usd: number | null; attributed_share_pct: number | null };
  ecosystem: { projects: number; live: number; deployed: number; announced: number; top_categories: { id: string; label: string; count: number }[];
    index_members: ByIndex; index_close: ByIndex; data_until: string | null };
  timeline: typeof ARC_TIMELINE;
  errors: string[];
};

type Fetcher = typeof fetch;
const iso = (ms: number) => new Date(ms).toISOString();
const round2 = (x: number) => Math.round(x * 100) / 100;

async function rpc(fetcher: Fetcher, method: string, params: unknown[]): Promise<unknown> {
  let last: unknown = null;
  for (const url of RPCS) {
    try {
      const r = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(TIMEOUT_MS) });
      const j = (await r.json()) as { result?: unknown; error?: unknown };
      if (j.result !== undefined && j.result !== null) return j.result;
      last = j.error ?? "empty result";
    } catch (e) { last = e; }
  }
  throw new Error(`rpc ${method}: ${last instanceof Error ? last.message : JSON.stringify(last)}`.slice(0, 160));
}

async function chain(fetcher: Fetcher, now: number) {
  const head = (await rpc(fetcher, "eth_getBlockByNumber", ["latest", false])) as { number: string; timestamp: string };
  const h = parseInt(head.number, 16), t = parseInt(head.timestamp, 16);
  const back = (await rpc(fetcher, "eth_getBlockByNumber", [`0x${(h - BLOCK_SPAN).toString(16)}`, false])) as { timestamp: string };
  const supply = async (to: string) => Number(BigInt((await rpc(fetcher, "eth_call", [{ to, data: "0x18160ddd" }, "latest"])) as string)) / 1e6;
  const [usdc, eurc] = await Promise.all([supply(USDC_ARC), supply(EURC_ARC)]);
  return { block_height: h, block_time_s: Math.round(((t - parseInt(back.timestamp, 16)) / BLOCK_SPAN) * 10000) / 10000, usdc_supply: usdc, eurc_supply: eurc, as_of: iso(now) };
}

async function llama(fetcher: Fetcher) {
  const get = async (u: string) => {
    const r = await fetcher(u, { headers: { "user-agent": "registrai-arc-numbers" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`defillama ${r.status}`);
    return (await r.json()) as unknown[];
  };
  const [tvl, stables] = await Promise.all([get(LLAMA_TVL), get(LLAMA_STABLES)]);
  const t = tvl[tvl.length - 1] as { date: number; tvl: number } | undefined;
  const s = stables[stables.length - 1] as { date: string | number; totalCirculatingUSD?: { peggedUSD?: number } } | undefined;
  if (!t || !s || typeof t.tvl !== "number" || typeof s.totalCirculatingUSD?.peggedUSD !== "number") throw new Error("defillama: unexpected shape");
  return { tvl_usd: t.tvl, all_stablecoins_usd: s.totalCirculatingUSD.peggedUSD, defillama_date: iso(Number(t.date) * 1000).slice(0, 10) };
}

const lastClose = (d: AbiData) => (d.candles?.length ? (d.candles[d.candles.length - 1][4] as number) : null);

export async function collectArcNumbers(env: Env, fetcher: Fetcher = fetch, now = Date.now()): Promise<ArcNumbers> {
  const errors: string[] = [];
  const caught = async <T>(label: string, p: Promise<T>): Promise<T | null> => {
    try { return await p; } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); return null; }
  };
  const [c, l, files] = await Promise.all([
    caught("rpc", chain(fetcher, now)),
    caught("defillama", llama(fetcher)),
    Promise.all(INDEX_IDS.map((id) => indexFile(env, id).catch(() => null))),
  ]);
  const byId = Object.fromEntries(INDEX_IDS.map((id, k) => [id, files[k]])) as Record<IndexId, AbiData | null>;
  if (!byId.aei) errors.push("index: the AEI file is not available");
  const v = (byId.aei as (AbiData & { volume_24h?: Record<string, { members_usd: number; members_payments: number; base_usd_est: number; base_transfers_est: number }> }) | null)?.volume_24h;
  const usdc = v?.USDC, eurc = v?.EURC;
  const e = ECOSYSTEM.entities;
  const count = (id: string) => e.filter((x) => x.category === id || (x.tags ?? []).includes(id as never)).length;
  return {
    version: 1, generated_at: iso(now),
    network: { chain_id: 5042, gas_token: "USDC", mainnet_since: "2026-09-16", block_height: c?.block_height ?? null, block_time_s: c?.block_time_s ?? null, as_of: c?.as_of ?? null },
    stablecoins: { usdc_supply: c?.usdc_supply ?? null, eurc_supply: c?.eurc_supply ?? null, as_of: c?.as_of ?? null,
      all_stablecoins_usd: l?.all_stablecoins_usd ?? null, tvl_usd: l?.tvl_usd ?? null, defillama_date: l?.defillama_date ?? null },
    activity_24h: { data_until: byId.aei?.data_until ?? null, usdc_moved_usd_est: usdc?.base_usd_est ?? null, eurc_moved_usd_est: eurc?.base_usd_est ?? null,
      usdc_transfers_est: usdc?.base_transfers_est ?? null, app_payments: usdc?.members_payments ?? null, app_usd: usdc?.members_usd ?? null,
      attributed_share_pct: usdc && usdc.base_usd_est > 0 ? round2((100 * usdc.members_usd) / usdc.base_usd_est) : null },
    ecosystem: {
      projects: e.length, live: e.filter((x) => x.status === "live").length, deployed: e.filter((x) => x.status === "deployed").length, announced: e.filter((x) => x.status === "announced").length,
      top_categories: CATEGORIES.map((cat) => ({ id: cat.id, label: cat.label, count: count(cat.id) })).filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1)).slice(0, 6),
      index_members: Object.fromEntries(INDEX_IDS.map((id) => [id, byId[id]?.projects?.length ?? null])) as ByIndex,
      index_close: Object.fromEntries(INDEX_IDS.map((id) => [id, byId[id] ? lastClose(byId[id]!) : null])) as ByIndex,
      data_until: byId.aei?.data_until ?? null,
    },
    timeline: ARC_TIMELINE,
    errors,
  };
}
