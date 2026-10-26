/**
 * Arc in numbers (spec docs/superpowers/specs/2026-10-20-arc-in-numbers-design.md): chain-level Arc figures from the Arc
 * RPC, DefiLlama (labelled on the page), the Registrai index files and the ecosystem directory. Each source is fetched
 * on its own with a timeout; a failed source leaves its fields null and adds a line to `errors`, never throws.
 */
import { CATEGORIES } from "../../src/lib/arc-ecosystem";
import { CHAIN_FACTS } from "../../src/lib/arc-chain-facts";
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
/** Arc's official Blockscout explorer: its public stats service (the explorer's own API sits behind a bot check). */
const BLOCKSCOUT_ACTIVE = "https://explorer.arc.io/stats-service/api/v1/lines/activeAccounts";
const TIMEOUT_MS = 8000;
const BLOCK_SPAN = 10_000;
export const RPC_BLOCKDAEMON = RPCS[0];
const SAMPLE = 240, SAMPLE_BATCH = 80, SAMPLE_MIN = 200;

export const ARC_TIMELINE = [
  { date: "2025-10-28", text: "Arc public testnet launched", source: "https://www.arc.io/pressroom/circle-launches-arc-public-testnet" },
  { date: "2026-08-05", text: "Founding validator cohort announced", source: "https://www.arc.io/pressroom/circle-announces-founding-validator-cohort-and-major-integrations-for-arc-ahead-of-september-16-mainnet-launch" },
  { date: "2026-09-16", text: "Arc mainnet launched", source: "https://www.arc.io/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet" },
];

type ByIndex = Record<IndexId, number | null>;
export type ArcNumbers = {
  version: 1; generated_at: string;
  network: { chain_id: 5042; gas_token: "USDC"; mainnet_since: "2026-09-16"; block_height: number | null; block_time_s: number | null; as_of: string | null;
    rpc_url?: string; explorer_url?: string };   // optional: snapshots before 2026-10-23 lack the new fields
  stablecoins: { usdc_supply: number | null; eurc_supply: number | null; as_of: string | null; all_stablecoins_usd: number | null; tvl_usd: number | null; defillama_date: string | null;
    tokens?: { symbol: string; issuer: string; address: string | null; supply: number | null }[] };
  activity_24h: { data_until: string | null; usdc_moved_usd_est: number | null; eurc_moved_usd_est: number | null; usdc_transfers_est: number | null;
    app_payments: number | null; app_usd: number | null; attributed_share_pct: number | null;
    transactions_est?: number | null; tx_sample?: { blocks: number; from_block: number; to_block: number } | null;
    active_accounts?: { date: string; count: number } | null };
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

/** One JSON-RPC batch to one endpoint: each call's result, or null for an error item or a missing answer. */
/** Accounts that sent at least one transaction on the last complete UTC day (Blockscout marks today's point approximate). */
async function activeAccounts(fetcher: Fetcher, now: number): Promise<{ date: string; count: number }> {
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const r = await fetcher(`${BLOCKSCOUT_ACTIVE}?resolution=DAY&from=${d(now - 7 * 86_400_000)}&to=${d(now)}`, { headers: { "user-agent": "registrai-arc-numbers" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const chart = ((await r.json()) as { chart?: { date: string; value: string; is_approximate?: boolean }[] }).chart ?? [];
  const last = chart.filter((p) => !p.is_approximate && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(Number(p.value))).at(-1);
  if (!last) throw new Error("no complete day");
  return { date: last.date, count: Number(last.value) };
}

export async function rpcBatch(fetcher: Fetcher, url: string, calls: { method: string; params: unknown[] }[]): Promise<(unknown | null)[]> {
  const r = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c }))), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const j = (await r.json()) as unknown;
  const out: (unknown | null)[] = calls.map(() => null);
  if (Array.isArray(j)) for (const x of j as { id?: unknown; result?: unknown }[])
    if (typeof x?.id === "number" && Number.isInteger(x.id) && x.id >= 0 && x.id < out.length && x.result !== undefined && x.result !== null) out[x.id] = x.result;
  return out;
}

/** Transactions in the last 24 h, estimated from 240 evenly spaced blocks (Blockdaemon only: the public RPC rate-limits batches). */
export async function sampleTransactions(fetcher: Fetcher, head: number, blockTimeS: number): Promise<{ estimate: number; blocks: number; from_block: number; to_block: number } | null> {
  const span = Math.round(86400 / blockTimeS), step = span / SAMPLE;
  const nums = Array.from({ length: SAMPLE }, (_, i) => head - Math.round(i * step));
  const counts: number[] = [];
  try {
    for (let k = 0; k < SAMPLE; k += SAMPLE_BATCH) {
      const res = await rpcBatch(fetcher, RPC_BLOCKDAEMON, nums.slice(k, k + SAMPLE_BATCH).map((n) => ({ method: "eth_getBlockTransactionCountByNumber", params: [`0x${n.toString(16)}`] })));
      for (const x of res) if (typeof x === "string" && /^0x[0-9a-f]+$/i.test(x)) counts.push(parseInt(x, 16));
    }
  } catch { return null; }
  if (counts.length < SAMPLE_MIN) return null;
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  return { estimate: Math.round((mean * span) / 1000) * 1000, blocks: counts.length, from_block: nums[nums.length - 1], to_block: head };
}

/** totalSupply of each token with an address, in one batch (Blockdaemon, then the public RPC); null where it fails. Throws only when no endpoint answers. */
export async function tokenSupplies(fetcher: Fetcher, tokens: { address: string | null; decimals: number }[]): Promise<(number | null)[]> {
  const idx = tokens.map((t, i) => (t.address ? i : -1)).filter((i) => i >= 0);
  const calls = idx.map((i) => ({ method: "eth_call", params: [{ to: tokens[i].address, data: "0x18160ddd" }, "latest"] }));
  let best: (unknown | null)[] | null = null, last: unknown = null;
  for (const url of RPCS) {   // each endpoint fills only what the previous one left missing
    const missing = best ? best.map((x, k) => (x === null ? k : -1)).filter((k) => k >= 0) : calls.map((_, k) => k);
    if (!missing.length) break;
    try {
      const got = await rpcBatch(fetcher, url, missing.map((k) => calls[k]));
      best ??= calls.map(() => null);
      missing.forEach((k, j) => { if (got[j] !== null) best![k] = got[j]; });
    } catch (e) { last = e; }
  }
  if (!best) throw new Error(`no RPC answered: ${last instanceof Error ? last.message : String(last)}`.slice(0, 120));
  const out: (number | null)[] = tokens.map(() => null);
  idx.forEach((i, k) => { const v = best![k]; if (typeof v === "string" && /^0x[0-9a-f]+$/i.test(v)) out[i] = Number(BigInt(v)) / 10 ** tokens[i].decimals; });
  return out;
}

/** One error line naming the listed tokens (with an address) whose supply could not be read; null when none failed. */
export function supplyErrors(tokens: { symbol: string; address: string | null }[], supplies: (number | null)[]): string | null {
  const failed = tokens.filter((t, i) => t.address && supplies[i] === null).map((t) => t.symbol);
  return failed.length ? `rpc token supplies: ${failed.join(", ")} failed` : null;
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
  const [head, back, usdcSupply, eurcSupply, tvl, stables, files, active] = await Promise.all([
    caught("rpc head", blockAt(fetcher, "latest")),
    caught("rpc block time", blockAt(fetcher, "latest").then((h) => Promise.all([h, blockAt(fetcher, `0x${(h.number - BLOCK_SPAN).toString(16)}`)]))),
    caught("rpc USDC supply", supplyOf(fetcher, USDC_ARC)),
    caught("rpc EURC supply", supplyOf(fetcher, EURC_ARC)),
    caught("defillama tvl", llamaTvl(fetcher)),
    caught("defillama stablecoins", llamaStables(fetcher)),
    Promise.all(INDEX_IDS.map((id) => (id === "aei" && opts.aei ? Promise.resolve(opts.aei) : indexFile(env, id).catch(() => null)))),
    caught("blockscout active accounts", activeAccounts(fetcher, now)),
  ]);
  const blockTime = back ? Math.round(((back[0].ts - back[1].ts) / BLOCK_SPAN) * 10000) / 10000 : null;
  const [supplies, sample] = await Promise.all([
    caught("rpc token supplies", tokenSupplies(fetcher, CHAIN_FACTS.stablecoins)),
    head && blockTime ? caught("rpc tx sample", sampleTransactions(fetcher, head.number, blockTime).then((s) => s ?? Promise.reject(new Error("too few samples")))) : Promise.resolve(null),
  ]);
  const supplyErr = supplies ? supplyErrors(CHAIN_FACTS.stablecoins, supplies) : null;
  if (supplyErr) errors.push(supplyErr);
  const c = { block_height: head?.number ?? null, block_time_s: blockTime,
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
    network: { chain_id: 5042, gas_token: "USDC", mainnet_since: "2026-09-16", block_height: c.block_height, block_time_s: c.block_time_s, as_of: c.as_of,
      rpc_url: CHAIN_FACTS.network.rpc_url, explorer_url: CHAIN_FACTS.network.explorer_url },
    stablecoins: { usdc_supply: c.usdc_supply, eurc_supply: c.eurc_supply, as_of: c.as_of,
      all_stablecoins_usd: l.all_stablecoins_usd, tvl_usd: l.tvl_usd, defillama_date: l.defillama_date,
      tokens: CHAIN_FACTS.stablecoins.map((t, i) => ({ symbol: t.symbol, issuer: t.issuer, address: t.address, supply: supplies?.[i] ?? null })) },
    activity_24h: { data_until: byId.aei?.data_until ?? null, usdc_moved_usd_est: usdc?.base_usd_est ?? null, eurc_moved_usd_est: eurc?.base_usd_est ?? null,
      usdc_transfers_est: usdc?.base_transfers_est ?? null, app_payments: usdc?.members_payments ?? null, app_usd: usdc?.members_usd ?? null,
      attributed_share_pct: usdc && usdc.base_usd_est > 0 ? round2((100 * usdc.members_usd) / usdc.base_usd_est) : null,
      transactions_est: sample?.estimate ?? null, tx_sample: sample ? { blocks: sample.blocks, from_block: sample.from_block, to_block: sample.to_block } : null,
      active_accounts: active },
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
