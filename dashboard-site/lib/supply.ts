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

/** The public RPC rate-limits bursts: one retry after `retryMs` before answering 503. */
async function readSupplyRetrying(fetchRpc: FetchRpc, retryMs: number) {
  try {
    return await readSupply(fetchRpc);
  } catch {
    if (retryMs > 0) await new Promise((r) => setTimeout(r, retryMs));
    return readSupply(fetchRpc);
  }
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
