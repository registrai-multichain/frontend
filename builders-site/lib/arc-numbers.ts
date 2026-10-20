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

const blockAt = async (fetcher: Fetcher, tag: string) => {
  const b = (await rpc(fetcher, "eth_getBlockByNumber", [tag, false])) as { number: string; timestamp: string };
  return { number: parseInt(b.number, 16), ts: parseInt(b.timestamp, 16) };
};
const supplyOf = async (fetcher: Fetcher, to: string) => Number(BigInt((await rpc(fetcher, "eth_call", [{ to, data: "0x18160ddd" }, "latest"])) as string)) / 1e6;

async function llamaGet(fetcher: Fetcher, u: string): Promise<unknown[]> {
  const r = await fetcher(u, { headers: { "user-agent": "registrai-arc-numbers" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`defillama ${r.status}`);
  return (await r.json()) as unknown[];
}
async function llamaTvl(fetcher: Fetcher) {
  const l = await llamaGet(fetcher, LLAMA_TVL);
  const t = l[l.length - 1] as { date: number; tvl: number } | undefined;
  if (!t || typeof t.tvl !== "number") throw new Error("defillama tvl: unexpected shape");
  return { tvl_usd: t.tvl, date: iso(Number(t.date) * 1000).slice(0, 10) };
}
async function llamaStables(fetcher: Fetcher) {
  const l = await llamaGet(fetcher, LLAMA_STABLES);
  const s = l[l.length - 1] as { date: string | number; totalCirculatingUSD?: Record<string, number> } | undefined;
  const pegs = Object.values(s?.totalCirculatingUSD ?? {}).filter((x) => typeof x === "number");
  if (!s || !pegs.length) throw new Error("defillama stablecoins: unexpected shape");
  return { all_stablecoins_usd: pegs.reduce((a, b) => a + b, 0), date: iso(Number(s.date) * 1000).slice(0, 10) };   // every peg (USD, EUR, GBP, …) in USD
}

const lastClose = (d: AbiData) => (d.candles?.length ? (d.candles[d.candles.length - 1][4] as number) : null);

/** Every source is independent and the whole collection has one deadline (it may run inside the hourly index publish). */
export async function collectArcNumbers(env: Env, fetcher: Fetcher = fetch, now = Date.now(), opts: { deadlineMs?: number; aei?: AbiData | null } = {}): Promise<ArcNumbers> {
  const errors: string[] = [];
  const until = Date.now() + (opts.deadlineMs ?? 10_000);
  const caught = async <T>(label: string, p: Promise<T>): Promise<T | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("deadline")), Math.max(0, until - Date.now())); });
    try { return await Promise.race([p, deadline]); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)); return null; }
    finally { clearTimeout(timer); }
  };
  const [head, back, usdcSupply, eurcSupply, tvl, stables, files] = await Promise.all([
    caught("rpc head", blockAt(fetcher, "latest")),
    caught("rpc block time", blockAt(fetcher, "latest").then((h) => Promise.all([h, blockAt(fetcher, `0x${(h.number - BLOCK_SPAN).toString(16)}`)]))),
    caught("rpc USDC supply", supplyOf(fetcher, USDC_ARC)),
    caught("rpc EURC supply", supplyOf(fetcher, EURC_ARC)),
    caught("defillama tvl", llamaTvl(fetcher)),
    caught("defillama stablecoins", llamaStables(fetcher)),
    Promise.all(INDEX_IDS.map((id) => (id === "aei" && opts.aei ? Promise.resolve(opts.aei) : indexFile(env, id).catch(() => null)))),
  ]);
  const c = { block_height: head?.number ?? null, block_time_s: back ? Math.round(((back[0].ts - back[1].ts) / BLOCK_SPAN) * 10000) / 10000 : null,
    usdc_supply: usdcSupply, eurc_supply: eurcSupply, as_of: head || usdcSupply !== null ? iso(now) : null };
  const l = { tvl_usd: tvl?.tvl_usd ?? null, all_stablecoins_usd: stables?.all_stablecoins_usd ?? null, defillama_date: tvl?.date ?? stables?.date ?? null };
  const byId = Object.fromEntries(INDEX_IDS.map((id, k) => [id, files[k]])) as Record<IndexId, AbiData | null>;
  if (!byId.aei) errors.push("index: the AEI file is not available");
  const v = (byId.aei as (AbiData & { volume_24h?: Record<string, { members_usd: number; members_payments: number; base_usd_est: number; base_transfers_est: number }> }) | null)?.volume_24h;
  const usdc = v?.USDC, eurc = v?.EURC;
  const e = ECOSYSTEM.entities;
  const count = (id: string) => e.filter((x) => x.category === id || (x.tags ?? []).includes(id as never)).length;
  return {
    version: 1, generated_at: iso(now),
    network: { chain_id: 5042, gas_token: "USDC", mainnet_since: "2026-09-16", block_height: c.block_height, block_time_s: c.block_time_s, as_of: c.as_of },
    stablecoins: { usdc_supply: c.usdc_supply, eurc_supply: c.eurc_supply, as_of: c.as_of,
      all_stablecoins_usd: l.all_stablecoins_usd, tvl_usd: l.tvl_usd, defillama_date: l.defillama_date },
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
