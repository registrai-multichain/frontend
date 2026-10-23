/**
 * Arc vs Ethereum vs Solana for stablecoin payments (spec 2026-10-23-replace-competitor-citations §3): measured block
 * times, estimated USDC transfer fees in USD and USDC in circulation per chain. Every source is read on its own with a
 * timeout under one deadline; a failed source leaves its figures null and adds a line to `errors`, never throws.
 */
import type { AbiData } from "../../src/lib/builders-index";
import { indexFile } from "./data-api";
import type { Env } from "./env";

type Fetcher = typeof fetch;
const ARC_RPCS = ["https://rpc.blockdaemon.mainnet.arc.io", "https://rpc.mainnet.arc.io"];
export const ETH_RPC = "https://ethereum-rpc.publicnode.com";
export const SOL_RPC = "https://api.mainnet-beta.solana.com";
const PRICES = "https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:solana";
const STABLES = "https://stablecoins.llama.fi/stablecoins?includePrices=false";
const TIMEOUT_MS = 8000, SPAN = 10_000;
/** Gas for a transfer: a native USDC transfer on Arc (21,000), an ERC-20 USDC transfer on Ethereum (65,000). */
export const ARC_TRANSFER_GAS = 21_000, ETH_TRANSFER_GAS = 65_000, SOL_BASE_FEE_LAMPORTS = 5_000;

export type ChainFigures = { block_time_s: number | null; fee_usd: number | null; usdc_supply: number | null };
export type Compare = { generated_at: string; arc: ChainFigures & { apps_paying: number | null }; ethereum: ChainFigures; solana: ChainFigures;
  prices: { eth: number | null; sol: number | null }; gas_price_gwei: { arc: number | null; ethereum: number | null }; usdc_date: string; errors: string[] };

async function rpc(fetcher: Fetcher, url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (j.result === undefined || j.result === null) throw new Error(j.error?.message ?? "empty result");
  return j.result;
}
const firstOk = async <T>(urls: string[], f: (u: string) => Promise<T>): Promise<T> => {
  let last: unknown;
  for (const u of urls) { try { return await f(u); } catch (e) { last = e; } }
  throw last instanceof Error ? last : new Error(String(last));
};

/** Seconds per block over the last 10,000 blocks of an EVM chain. */
async function evmBlockTime(fetcher: Fetcher, url: string): Promise<number> {
  const head = (await rpc(fetcher, url, "eth_getBlockByNumber", ["latest", false])) as { number: string; timestamp: string };
  const n = parseInt(head.number, 16);
  const back = (await rpc(fetcher, url, "eth_getBlockByNumber", [`0x${(n - SPAN).toString(16)}`, false])) as { timestamp: string };
  return (parseInt(head.timestamp, 16) - parseInt(back.timestamp, 16)) / SPAN;
}
const gasPrice = async (fetcher: Fetcher, url: string) => Number(BigInt((await rpc(fetcher, url, "eth_gasPrice", [])) as string));

/** Seconds per slot from Solana's recent performance samples. */
async function solanaSlotTime(fetcher: Fetcher): Promise<number> {
  const s = (await rpc(fetcher, SOL_RPC, "getRecentPerformanceSamples", [5])) as { numSlots: number; samplePeriodSecs: number }[];
  const slots = s.reduce((a, x) => a + x.numSlots, 0), secs = s.reduce((a, x) => a + x.samplePeriodSecs, 0);
  if (!slots) throw new Error("no samples");
  return secs / slots;
}

/** USDC in circulation per chain, cut out of DefiLlama's ~550 KB stablecoin list without parsing all of it (free-plan CPU). */
export function usdcByChain(text: string): Record<string, number> {
  const at = text.indexOf('"symbol":"USDC"');
  const key = at < 0 ? -1 : text.indexOf('"chainCirculating":', at);
  if (key < 0) return {};
  let i = text.indexOf("{", key), depth = 0, end = -1;
  for (let k = i; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}" && --depth === 0) { end = k; break; }
  }
  if (i < 0 || end < 0) return {};
  const cc = JSON.parse(text.slice(i, end + 1)) as Record<string, { current?: { peggedUSD?: number } }>;
  return Object.fromEntries(Object.entries(cc).map(([c, v]) => [c, v.current?.peggedUSD]).filter((x): x is [string, number] => typeof x[1] === "number"));
}

export async function collectCompare(env: Env, fetcher: Fetcher = fetch, now = Date.now(), deadlineMs = 10_000): Promise<Compare> {
  const errors: string[] = [];
  const until = Date.now() + deadlineMs;
  const caught = async <T>(label: string, p: Promise<T>): Promise<T | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("deadline")), Math.max(0, until - Date.now())); });
    try { return await Promise.race([p, deadline]); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160)); return null; }
    finally { clearTimeout(timer); }
  };
  const json = async (u: string) => { const r = await fetcher(u, { headers: { "user-agent": "registrai-chain-compare" }, signal: AbortSignal.timeout(TIMEOUT_MS) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };
  const [arcBt, arcGas, ethBt, ethGas, solBt, prices, usdc, aei] = await Promise.all([
    caught("arc block time", firstOk(ARC_RPCS, (u) => evmBlockTime(fetcher, u))),
    caught("arc gas price", firstOk(ARC_RPCS, (u) => gasPrice(fetcher, u))),
    caught("ethereum block time", evmBlockTime(fetcher, ETH_RPC)),
    caught("ethereum gas price", gasPrice(fetcher, ETH_RPC)),
    caught("solana slot time", solanaSlotTime(fetcher)),
    caught("defillama prices", json(PRICES).then((r) => r.json() as Promise<{ coins: Record<string, { price?: number }> }>)),
    caught("defillama stablecoins", json(STABLES).then((r) => r.text()).then(usdcByChain)),
    indexFile(env, "aei").catch(() => null),
  ]);
  const eth = prices?.coins["coingecko:ethereum"]?.price ?? null, sol = prices?.coins["coingecko:solana"]?.price ?? null;
  const projects = (aei as (AbiData & { projects?: { pay_24h?: number }[] }) | null)?.projects;
  return {
    generated_at: new Date(now).toISOString(),
    arc: { block_time_s: arcBt, fee_usd: arcGas === null ? null : (arcGas * ARC_TRANSFER_GAS) / 1e18, usdc_supply: usdc?.Arc ?? null,
      apps_paying: projects ? projects.filter((p) => (p.pay_24h ?? 0) > 0).length : null },
    ethereum: { block_time_s: ethBt, fee_usd: ethGas === null || eth === null ? null : ((ethGas * ETH_TRANSFER_GAS) / 1e18) * eth, usdc_supply: usdc?.Ethereum ?? null },
    solana: { block_time_s: solBt, fee_usd: sol === null ? null : (SOL_BASE_FEE_LAMPORTS / 1e9) * sol, usdc_supply: usdc?.Solana ?? null },
    prices: { eth, sol }, gas_price_gwei: { arc: arcGas === null ? null : arcGas / 1e9, ethereum: ethGas === null ? null : ethGas / 1e9 },
    usdc_date: new Date(now).toISOString().slice(0, 10), errors,
  };
}
