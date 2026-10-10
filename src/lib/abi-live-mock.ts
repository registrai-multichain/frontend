/** A deterministic mock of the Arc RPC for the live engine's tests (also drives the reference live.js). */
import { EMITTER, TRANSFER } from "./abi-live";
import index from "./fixtures/builders-index.json";
import { validateIndex } from "./builders-index";

export type LiveData = import("./builders-index").AbiData & { live: import("./builders-index").AbiLive };
// the page only ever sees a validated file: the tests use the same shape (defaults for keys the fixture predates)
const checked = validateIndex(index);
if (!checked.ok || !checked.data.live) throw new Error("fixture: " + (checked.ok ? "no live block" : checked.error));
export const INDEX = checked.data as LiveData;
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

/* ---------- fiat stablecoins and milestones (spec §12, §13) ---------- */
export const EURC = "0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1";
export const JPYC = "0xe7c3d8c9a439fede00d2600032d5db0be71c3c29";
export const GBPA = "0xbbe6aab0ed76e90aea0d1cd978ec231c8adcdf8b"; // added one hour after HS: counts from the next hour
export const NOT_REGISTERED = "0x" + "5".repeat(40);
const raw = (v: number, dec: number) => "0x" + (BigInt(Math.round(v * 1e6)) * 10n ** BigInt(dec - 6)).toString(16);
type ScLog = Log & { address: string };
const sc = (token: string, dec: number, offset: number, from: string, to: string, v: number, withTs = true): ScLog => ({ address: token, ...log(offset, from, to, 0, withTs), data: raw(v, dec) });

export const SC_LOGS: ScLog[] = [
  sc(EURC, 6, 25, WALLET_C, ARGUS, 100), // new payer into Argus, EUR at the 8 Oct fix
  sc(JPYC, 18, 45, w("9"), PEACH, 1000, false), // 18 decimals (raw over 2^53); timestamp looked up from the block
  sc(EURC, 6, 55, ARGUS_DEPLOYER, ARGUS, 500), // own deployer: excluded
  sc(EURC, 6, 65, ZERO, ARGUS, 500), // mint: excluded
  sc(GBPA, 6, 80, WALLET_A, ARGUS, 20), // before GBPA's `added`: excluded this hour
  sc(EURC, 6, 4050, WALLET_B, PEACH, 2500), // second getLogs chunk; over the per-payer cap in USD
  sc(GBPA, 6, 7260, WALLET_A, ARGUS, 20), // next hour: GBPA counts now
  // base layer sample: d already sent USDC (merged per sender after USDC); a self-transfer and a mint do not count
  sc(EURC, 6, 11, w("d"), w("e"), 50), sc(JPYC, 18, 12, w("8"), w("7"), 30000), sc(EURC, 6, 13, w("7"), w("7"), 9), sc(EURC, 6, 14, ZERO, w("7"), 9),
  sc(NOT_REGISTERED, 6, 15, w("8"), ARGUS, 1e6), // a token the registry does not hold: never asked for
];

/** The fixture with three registered coins, ECB fixes and three synthetic milestones (two in the open hour, one in the next). */
export function scIndex(): LiveData {
  const d = JSON.parse(JSON.stringify(INDEX)) as LiveData;
  d.live.stablecoins = {
    [EURC]: { symbol: "EURC", currency: "EUR", decimals: 6, added: HS - 3600 },
    [JPYC]: { symbol: "JPYC", currency: "JPY", decimals: 18, added: HS },
    [GBPA]: { symbol: "GBPA", currency: "GBP", decimals: 6, added: HS + 3600 },
  };
  // HS is 9 Oct 21:00 UTC: payments that day use the 8 Oct fix, never the 9 Oct one
  d.live_fx = {
    "2026-10-07": { EUR: 1.1177, JPY: 0.0063200452, GBP: 1.3204560222 },
    "2026-10-08": { EUR: 1.1186, JPY: 0.0063179893, GBP: 1.3206923422 },
    "2026-10-09": { EUR: 1.1206, JPY: 0.0063189354, GBP: 1.3220390972 },
  };
  d.milestones = [
    { id: "test-arc-upgrade", t: HS + 1800, target: "base:arc", tier: "arc-upgrade", mult: 1.25, title: "Arc network upgrade (synthetic)", evidence: ["https://docs.arc.io/"] },
    { id: "test-release", t: HS + 2700, target: "domain:argus.world", tier: "project-release", mult: 1.1, title: "Argus release (synthetic)", evidence: [ARGUS] },
    { id: "test-next-hour", t: HS + 3620, target: "domain:peach.ag", tier: "project-release", mult: 1.1, title: "Peach release (synthetic)", evidence: ["0x" + "ab".repeat(32)] },
  ];
  return d;
}

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
      const f = params[0] as { fromBlock: string; toBlock: string; address: string | string[]; topics: (string | string[] | null)[] };
      const from = parseInt(f.fromBlock, 16), to = parseInt(f.toBlock, 16);
      if (to - from >= 10_000) throw new Error("RPC range too large");
      const source: Log[] = Array.isArray(f.address) ? SC_LOGS.filter((l) => (f.address as string[]).includes(l.address)) : f.address === EMITTER ? CHAIN_LOGS : [];
      return source.filter((l) => {
        const b = parseInt(l.blockNumber, 16);
        if (b < from || b > to || l.topics[0] !== f.topics[0]) return false;
        const t2 = f.topics[2];
        return !t2 || (Array.isArray(t2) && t2.includes(l.topics[2]));
      }).map((l) => ({ ...l }));
    }
    throw new Error("unexpected " + method);
  };
}
