"use client";

import useSWR from "swr";
import type { Hex } from "viem";
import { buildersClient } from "@/components/verify/useMyBuilder";
import { emptyStats, reduceLogs, type CommonStats, type RawLog } from "@/lib/common-stats";
import { usdText } from "@/lib/plain-words";
import { COMMON, COMMON_ON, COMMON_SCAN, LIVE_REFRESH_MS, nextScanRanges } from "@/lib/transparency";
import { Stat } from "./parts";

/**
 * Totals since launch, scanned oldest-first from the oracle's deploy block so they never
 * have a gap; at most COMMON_SCAN.maxPerLoad windows per read, so a long history fills in
 * over a few refreshes ("counting…").
 */
const cache: { scannedTo: bigint | null; stats: CommonStats } = { scannedTo: null, stats: emptyStats() };

async function readCommon(): Promise<{ stats: CommonStats; scannedTo: bigint; head: bigint }> {
  const c = buildersClient();
  const head = await c.getBlockNumber();
  const floor = COMMON_SCAN.fromBlock;
  const addr = { marketsV4: COMMON.marketsV4!, attestation: COMMON.attestation!, dispute: COMMON.dispute!, registry: COMMON.registry!, agent: COMMON.agent! };
  const ranges = nextScanRanges(head, cache.scannedTo ?? floor - 1n, floor, COMMON_SCAN.window, 0).slice(0, COMMON_SCAN.maxPerLoad);
  for (const [fromBlock, toBlock] of ranges) {
    try {
      const logs = (await c.request({
        method: "eth_getLogs",
        params: [{ address: [addr.marketsV4, addr.attestation, addr.dispute, addr.registry], fromBlock: `0x${fromBlock.toString(16)}` as Hex, toBlock: `0x${toBlock.toString(16)}` as Hex }],
      })) as unknown as RawLog[];
      cache.stats = reduceLogs(cache.stats, logs, addr);
      cache.scannedTo = toBlock;
    } catch {
      break; // retried from here on the next read: no gap
    }
  }
  return { stats: cache.stats, scannedTo: cache.scannedTo ?? floor - 1n, head };
}

const dur = (secs: number) => (secs < 90 ? `${Math.round(secs)}s` : secs < 5400 ? `${Math.round(secs / 60)} min` : `${(secs / 3600).toFixed(1)} h`);

export function CommonMarketsPanel({ marketsClass = "", oracleClass = "" }: { marketsClass?: string; oracleClass?: string }) {
  const on = COMMON_ON;
  const { data, error } = useSWR(on ? ["common-markets", COMMON.marketsV4] : null, readCommon, {
    refreshInterval: LIVE_REFRESH_MS.slow / 5,
    revalidateOnFocus: false,
  });
  if (!on) return null;
  const s = data?.stats;
  const behind = data ? data.head - data.scannedTo : null;
  const counting = behind !== null && behind > COMMON_SCAN.window;
  const o = s?.oracle;
  const note = error && !data ? "Couldn't read the chain right now; retrying." : counting ? `Counting… up to block ${data!.scannedTo.toString()}.` : null;
  return (
    <>
      <section className={`pa-stack min-w-0 ${marketsClass}`} aria-labelledby="t-common">
        <h2 id="t-common" className="pa-h2">Common markets</h2>
        <p className="pa-muted pa-small">5-minute Up/Down rounds and event markets, since launch. Frozen since 28 Sept 2026: no new rounds or markets open.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Rounds opened" value={s ? String(s.markets.opened) : "…"} />
          <Stat label="Settled" value={s ? String(s.markets.settled) : "…"} sub={s && s.markets.voided ? `${s.markets.voided} voided, refunded` : "none voided"} />
          <Stat label="Volume" value={s ? usdText(s.markets.volume) : "…"} sub={s ? `${s.markets.trades} trades` : undefined} />
          <Stat label="Fees to the splitter" value={s ? usdText(s.markets.feesToSplitter) : "…"} />
        </div>
        {note && <p className="pa-muted pa-small">{note}</p>}
      </section>
      <section className={`pa-stack min-w-0 ${oracleClass}`} aria-labelledby="t-oracle">
        <h2 id="t-oracle" className="pa-h2">Oracle health</h2>
        <p className="pa-muted pa-small">
          Every round settles on a reading our agent posts: the median of Coinbase, Kraken and OKX. Anyone can challenge a reading;
          the Admin Safe rules. A reading ruled wrong slashes the agent&apos;s bond.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Readings posted" value={o ? String(o.readings) : "…"} />
          <Stat label="Challenged" value={o ? String(o.challenges) : "…"} sub={o ? `${o.open.length} awaiting a ruling` : undefined} tone={o && o.open.length ? "down" : undefined} />
          <Stat label="Ruled wrong" value={o ? String(o.invalid) : "…"} sub={o ? `${o.valid} ruled right` : undefined} tone={o && o.invalid ? "down" : "up"} />
          <Stat label="Safe ruling time" value={o && o.ruled ? dur(o.rulingSecsTotal / o.ruled) : "—"} sub={o && o.ruled ? `average of ${o.ruled}` : "no rulings yet"} />
          <Stat label="Agent slashed" value={o ? String(o.slashes) : "…"} tone={o && o.slashes ? "down" : "up"} />
        </div>
      </section>
    </>
  );
}
