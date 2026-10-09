/** A deterministic mock of the Arc RPC for the live engine's tests (also drives the reference live.js). */
import { EMITTER, TRANSFER } from "./abi-live";
import index from "./fixtures/builders-index.json";

export const INDEX = index as never as import("./builders-index").AbiData;
export const HS = INDEX.live!.hour_start;
export const HB = INDEX.live!.hour_start_block;
export const ARGUS = "0x07a688a001f416cc433c68ff56aa26bc5131cc6e";
export const PEACH = "0x139271e6694b4047949cdd0d4343d116dc732113";
export const ARGUS_DEPLOYER = "0x7d613c6316ede9d257f3bf512777cb4ea4a6bee4";
const w = (n: string) => "0x" + n.repeat(40);
export const WALLET_A = w("a"), WALLET_B = w("b"), WALLET_C = w("c");
export const ZERO = "0x" + "0".repeat(40);

/** Block n has timestamp HS + floor((n - HB) / 2). */
export const tsOf = (n: number) => HS + Math.floor((n - HB) / 2);
const pad = (a: string) => "0x" + "0".repeat(24) + a.slice(2);
const usdc = (v: number) => "0x" + (BigInt(Math.round(v * 1e6)) * 10n ** 12n).toString(16); // 18 decimals

type Log = { blockNumber: string; blockTimestamp?: string; topics: string[]; data: string };
const log = (offset: number, from: string, to: string, v: number, withTs = true): Log => ({
  blockNumber: "0x" + (HB + offset).toString(16),
  ...(withTs ? { blockTimestamp: "0x" + tsOf(HB + offset).toString(16) } : {}),
  topics: [TRANSFER, pad(from), pad(to)],
  data: usdc(v),
});

export const CHAIN_LOGS: Log[] = [
  log(20, WALLET_A, ARGUS, 5), // new payer
  log(30, WALLET_A, ARGUS, 1500, false), // over the cap; timestamp looked up from the block
  log(40, WALLET_B, ARGUS, 12), // B is in the seen file: not new
  log(50, ARGUS_DEPLOYER, ARGUS, 40), // own deployer: excluded
  log(60, PEACH, ARGUS, 40), // from a tracked contract: excluded
  log(70, ZERO, ARGUS, 40), // mint: excluded
  log(4000, WALLET_C, PEACH, 50), // second getLogs chunk
  log(7250, WALLET_A, ARGUS, 3), // next hour
  // base layer sample (first 240 blocks): untracked senders, plus a self-transfer and a mint that do not count
  log(5, w("d"), w("e"), 100), log(6, w("d"), w("f"), 20), log(7, w("e"), w("f"), 7.5), log(8, w("f"), w("f"), 9), log(9, ZERO, w("d"), 9),
];

export const SEEN = { hour_start: HS, seen: { "domain:argus.world": WALLET_B.slice(2, 12) } };

/** The JSON-RPC handler: `head` is the chain's latest block number. */
export function mockRpc(head: number, stats = { calls: [] as string[] }) {
  return async (method: string, params: unknown[]): Promise<unknown> => {
    stats.calls.push(method);
    if (method === "eth_getBlockByNumber") {
      const tag = params[0] as string;
      const n = tag === "latest" ? head : parseInt(tag, 16);
      return { number: "0x" + n.toString(16), timestamp: "0x" + tsOf(n).toString(16) };
    }
    if (method === "eth_getLogs") {
      const f = params[0] as { fromBlock: string; toBlock: string; address: string; topics: (string | string[] | null)[] };
      const from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
      if (to - from >= 10_000) throw new Error("RPC range too large");
      if (f.address !== EMITTER) return [];
      return CHAIN_LOGS.filter((l) => {
        const b = parseInt(l.blockNumber, 16);
        if (b < from || b > to || l.topics[0] !== f.topics[0]) return false;
        const t2 = f.topics[2];
        return !t2 || (Array.isArray(t2) && t2.includes(l.topics[2]));
      }).map((l) => ({ ...l }));
    }
    throw new Error("unexpected " + method);
  };
}
