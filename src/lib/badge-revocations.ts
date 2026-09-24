/**
 * Which builders had their Verified Builder Badge revoked (and must not be
 * onboarded again). `VerifiedBuilderBadge.revoke(id)` burns the badge but
 * leaves no trace in state (serialOf goes back to 0, as if never issued), so
 * the history is read from the logs: a builder with a `Revoked` event and no
 * `BuilderStatusSet(id, true)` after it is revoked. The /admin revoke file
 * also deactivates the builder (`setActive(id, false)`), so the Safe
 * re-admits one on purpose by reactivating it.
 *
 * Shared by /admin (the onboarding queue) and scripts/onboard-batch.ts.
 * Pure except readRevokedBuilders, which takes its client as an argument.
 */
import { parseAbiItem, type Address } from "viem";

export const REVOKED_EVENT = parseAbiItem("event Revoked(uint256 indexed builderId, uint256 indexed serial)");
export const BUILDER_STATUS_EVENT = parseAbiItem("event BuilderStatusSet(uint256 indexed id, bool active)");

/** A log's place in the chain. */
export interface LogAt {
  block: bigint;
  index: number;
}
export type RevokeLog = LogAt & { builderId: number };
export type StatusLog = LogAt & { builderId: number; active: boolean };

const after = (a: LogAt, b: LogAt) => a.block > b.block || (a.block === b.block && a.index > b.index);

/** Pure: the builders with a Revoked event not followed by a reactivation (BuilderStatusSet(id, true)). */
export function revokedBuilders(revokes: readonly RevokeLog[], statuses: readonly StatusLog[]): Set<number> {
  const out = new Set<number>();
  for (const r of revokes) {
    const reactivated = statuses.some((s) => s.builderId === r.builderId && s.active && after(s, r));
    if (!reactivated) out.add(r.builderId);
  }
  return out;
}

/** Contiguous inclusive block ranges of at most `size` blocks. */
export function blockRanges(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += size) out.push([a, a + size - 1n < to ? a + size - 1n : to]);
  return out;
}

interface RawLog {
  args?: Record<string, unknown>;
  blockNumber: bigint | null;
  logIndex: number | null;
}

/** Minimal read surface (a viem PublicClient satisfies it). */
export interface LogReader {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: { address: Address; event: unknown; fromBlock: bigint; toBlock: bigint }): Promise<unknown[]>;
}

export type RevocationRead = { ok: true; revoked: Set<number>; toBlock: bigint } | { ok: false; error: string };

/**
 * Every Revoked (badge) and BuilderStatusSet (registry) log from `fromBlock`
 * to the head, in ≤`chunk`-block getLogs (Arc caps the range), `parallel` at
 * a time. With `maxChunks`, a longer history is not read at all (ok: false):
 * the caller then treats the history as unknown.
 */
export async function readRevokedBuilders(
  client: LogReader,
  o: { badge: Address; registry: Address; fromBlock: bigint; chunk?: bigint; maxChunks?: number; parallel?: number },
): Promise<RevocationRead> {
  try {
    const head = await client.getBlockNumber();
    const ranges = blockRanges(o.fromBlock, head, o.chunk ?? 5_000n);
    if (o.maxChunks !== undefined && ranges.length > o.maxChunks) {
      return { ok: false, error: `${ranges.length} log ranges since block ${o.fromBlock}: more than this page reads (${o.maxChunks})` };
    }
    const revokes: RevokeLog[] = [];
    const statuses: StatusLog[] = [];
    const queue = [...ranges];
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const [a, b] = r;
        const [rv, st] = await Promise.all([
          client.getLogs({ address: o.badge, event: REVOKED_EVENT, fromBlock: a, toBlock: b }),
          client.getLogs({ address: o.registry, event: BUILDER_STATUS_EVENT, fromBlock: a, toBlock: b }),
        ]);
        for (const l of rv as RawLog[]) {
          revokes.push({ builderId: Number(l.args?.builderId), block: l.blockNumber ?? 0n, index: l.logIndex ?? 0 });
        }
        for (const l of st as RawLog[]) {
          statuses.push({ builderId: Number(l.args?.id), active: Boolean(l.args?.active), block: l.blockNumber ?? 0n, index: l.logIndex ?? 0 });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(o.parallel ?? 4, queue.length) }, worker));
    return { ok: true, revoked: revokedBuilders(revokes, statuses), toBlock: head };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message?.split("\n")[0] ?? "log read failed" };
  }
}
