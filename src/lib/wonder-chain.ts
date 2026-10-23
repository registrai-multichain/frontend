/**
 * Wonder reads keyed by source (keccak256(source)): no log scans, so the gallery,
 * /verify and /admin read exactly the sources they show. A source (or market)
 * whose read fails is left out: the page shows nothing rather than a wrong number.
 */
import type { Address, Hex } from "viem";
import { blockChunks } from "./perennial-market";
import { feedCreatedEvent } from "./verified-builders-chain";
import { sourceKey, wonderEscrowAbi, wonderMarketsAbi, type MarketSubject, type WonderContracts, type WonderStatus } from "./wonder";

export interface WonderReader {
  readContract(args: { address: Address; abi: unknown; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

const n = (v: unknown) => Number(v as bigint);

export async function readWonderStatus(client: WonderReader, w: WonderContracts, sources: string[]): Promise<Record<string, WonderStatus>> {
  const rows = await Promise.all(
    [...new Set(sources)].map(async (source) => {
      const key = sourceKey(source);
      const esc = (functionName: string) => client.readContract({ address: w.escrow, abi: wonderEscrowAbi, functionName, args: [key] });
      try {
        const [nominated, escrow, releasedTo, pending, first] = await Promise.all([
          client.readContract({ address: w.markets, abi: wonderMarketsAbi, functionName: "nominated", args: [key] }),
          esc("escrowOf"), esc("releasedTo"), esc("pendingRelease"), esc("firstCreditAt"),
        ]);
        const [pb, pp, pr] = pending as readonly [bigint, bigint, bigint];
        const s: WonderStatus = {
          source, key, nominated: nominated === true, escrow: escrow as bigint, releasedTo: n(releasedTo),
          pending: pr > 0n ? { builderId: n(pb), projectId: n(pp), readyAt: n(pr) } : null,
          firstCreditAt: n(first),
        };
        return s;
      } catch {
        return null;
      }
    }),
  );
  const out: Record<string, WonderStatus> = {};
  for (const r of rows) if (r) out[r.source] = r;
  return out;
}

export async function readExpiry(client: WonderReader, w: WonderContracts): Promise<number | null> {
  try {
    return n(await client.readContract({ address: w.escrow, abi: wonderEscrowAbi, functionName: "EXPIRY" }));
  } catch {
    return null;
  }
}

export async function readMarketSubjects(
  client: WonderReader,
  markets: Address,
  ids: Hex[],
  sources: Record<string, string>,
): Promise<Record<string, MarketSubject>> {
  const out: Record<string, MarketSubject> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const [s, bound] = (await client.readContract({ address: markets, abi: wonderMarketsAbi, functionName: "subjectOf", args: [id] })) as readonly [
          { kind: number; builderId: bigint; sourceKey: Hex },
          boolean,
        ];
        const key = id.toLowerCase();
        out[key] = { kind: Number(s.kind), builderId: s.builderId, sourceKey: s.sourceKey, bound, ...(sources[key] ? { source: sources[key] } : {}) };
      } catch {
        // pre-wonder contract or RPC hiccup: no subject, no labels
      }
    }),
  );
  return out;
}

/**
 * The operator's `registrai-milestone:<source>` feed, from Registry.FeedCreated by the
 * operator in [fromBlock, head] (latest wins): the feeds provisioned since the build's
 * snapshot. At most `budget` 5,000-block chunks; null when not found (or a read failed).
 */
export async function findFeedLive(
  client: { getLogs(args: unknown): Promise<unknown[]> },
  registry: Address,
  operator: Address,
  fromBlock: bigint,
  head: bigint,
  source: string,
  budget = 60,
): Promise<Hex | null> {
  const want = `registrai-milestone:${source}`;
  let found: Hex | null = null;
  for (const [a, b] of blockChunks(fromBlock, head).slice(-budget)) {
    let logs: unknown[];
    try {
      logs = await client.getLogs({ address: registry, event: feedCreatedEvent, args: { creator: operator }, fromBlock: a, toBlock: b });
    } catch {
      return found;
    }
    for (const lg of logs as { args?: { feedId?: Hex; description?: string } }[]) {
      if (lg.args?.description === want && lg.args.feedId) found = lg.args.feedId;
    }
  }
  return found;
}
