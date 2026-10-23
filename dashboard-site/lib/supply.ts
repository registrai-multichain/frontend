/**
 * GET /api/regi/circulating-supply | total-supply  (plain number, for CoinGecko)
 * GET /api/regi/supply                            (the breakdown as JSON)
 * Read live from Arc mainnet in one JSON-RPC batch; any RPC failure is a 503,
 * never a stale or partial number.
 */
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { REGI_CONTRACT } from "../../src/lib/regi";
import { REGI_BURN_ADDRESS, formatSupply, regiSupply } from "../../src/lib/regi-supply";
import { WALLETS } from "../../src/lib/transparency";

export const ARC_RPC = "https://rpc.mainnet.arc.io";

type RpcCall = { jsonrpc: "2.0"; id: number; method: "eth_call"; params: [{ to: Address; data: Hex }, "latest"] };
type RpcResult = { id: number; result?: Hex; error?: unknown };
export type FetchRpc = (body: RpcCall[]) => Promise<RpcResult[]>;

const erc20 = parseAbi(["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"]);
const HEADERS = { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" };

export const fetchArcRpc: FetchRpc = async (body) => {
  const r = await fetch(ARC_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const out = (await r.json()) as RpcResult[];
  if (!Array.isArray(out)) throw new Error("rpc: not a batch answer");
  return out;
};

async function readSupply(fetchRpc: FetchRpc) {
  const holders: Address[] = [REGI_BURN_ADDRESS, ...WALLETS.map((w) => w.address)];
  const calls: RpcCall[] = [
    { jsonrpc: "2.0", id: 0, method: "eth_call", params: [{ to: REGI_CONTRACT, data: encodeFunctionData({ abi: erc20, functionName: "totalSupply" }) }, "latest"] },
    ...holders.map((h, i): RpcCall => ({ jsonrpc: "2.0", id: i + 1, method: "eth_call", params: [{ to: REGI_CONTRACT, data: encodeFunctionData({ abi: erc20, functionName: "balanceOf", args: [h] }) }, "latest"] })),
  ];
  const byId = new Map((await fetchRpc(calls)).map((r) => [r.id, r]));
  const value = (id: number, fn: "totalSupply" | "balanceOf") => {
    const r = byId.get(id);
    if (!r?.result || r.error) throw new Error(`rpc call ${id} failed`);
    return decodeFunctionResult({ abi: erc20, functionName: fn, data: r.result }) as bigint;
  };
  const total = value(0, "totalSupply");
  const burned = value(1, "balanceOf");
  let protocol = 0n;
  for (let i = 1; i < holders.length; i++) protocol += value(i + 1, "balanceOf");
  return regiSupply({ total, burned, protocol });
}

/** The public RPC rate-limits per IP, and Workers share their IPs: up to 3 tries,
 *  `retryMs` then twice that apart, before answering 503. */
async function readSupplyRetrying(fetchRpc: FetchRpc, retryMs: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readSupply(fetchRpc);
    } catch (e) {
      if (attempt >= 2) throw e;
      if (retryMs > 0) await new Promise((r) => setTimeout(r, retryMs * (attempt + 1)));
    }
  }
}

/** The subset of the Workers Cache API used here. */
export interface KeptCache {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

/** How long the last good answer may stand in for a failed read. */
export const LAST_GOOD_SECS = 86_400;

/**
 * Serve `compute()`; keep every 200 as the last good answer for its URL, and when a
 * later read fails with a 5xx (the shared public RPC rate-limits), serve the kept one
 * marked `x-registrai-stale: 1` instead: supply moves only with burns, so a slightly
 * old number beats an error for a poller like CoinGecko.
 */
export async function withLastGood(cache: KeptCache, req: Request, compute: () => Promise<Response>): Promise<Response> {
  const key = new Request(`${new URL(req.url).origin}${new URL(req.url).pathname}?last-good`, { method: "GET" });
  const res = await compute();
  if (res.status === 200) {
    const kept = new Response(res.clone().body, res);
    kept.headers.set("cache-control", `public, max-age=${LAST_GOOD_SECS}`);
    await cache.put(key, kept);
    return res;
  }
  if (res.status < 500) return res;
  const last = await cache.match(key);
  if (!last) return res;
  const stale = new Response(last.body, last);
  stale.headers.set("x-registrai-stale", "1");
  stale.headers.set("cache-control", "no-store");
  return stale;
}

export async function handleRegiSupply(kind: string, fetchRpc: FetchRpc = fetchArcRpc, retryMs = 1500): Promise<Response> {
  if (kind !== "circulating-supply" && kind !== "total-supply" && kind !== "supply") {
    return new Response("not found\n", { status: 404, headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" } });
  }
  let s;
  try {
    s = await readSupplyRetrying(fetchRpc, retryMs);
  } catch {
    return new Response("Arc RPC unavailable, try again shortly\n", { status: 503, headers: { "access-control-allow-origin": "*", "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "retry-after": "60" } });
  }
  if (kind === "supply") {
    const body = {
      token: REGI_CONTRACT,
      chain: "Arc mainnet (5042)",
      decimals: 18,
      total: formatSupply(s.total),
      burned: formatSupply(s.burned),
      burnAddress: REGI_BURN_ADDRESS,
      protocol: formatSupply(s.protocol),
      protocolWallets: WALLETS.map((w) => ({ label: w.label, address: w.address })),
      totalNetOfBurn: formatSupply(s.totalNetOfBurn),
      circulating: formatSupply(s.circulating),
      method: "circulating = totalSupply - balanceOf(0x…dEaD) - REGI held by the protocol wallets; total-supply = totalSupply - burned",
    };
    return new Response(`${JSON.stringify(body, null, 2)}\n`, { headers: { ...HEADERS, "content-type": "application/json; charset=utf-8" } });
  }
  const v = kind === "circulating-supply" ? s.circulating : s.totalNetOfBurn;
  return new Response(formatSupply(v), { headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8" } });
}
