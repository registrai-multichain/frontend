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

/**
 * The raw revocation history up to `toBlock` of one badge + registry pair: a
 * checkpoint that a later read resumes from instead of the deploy block (Arc
 * mainnet makes ~170k blocks a day, so a full rescan grows by ~34 log ranges
 * per event per day). scripts/sync.ts carries one in live-data.json
 * `revocations`; /admin also keeps its latest in the browser.
 */
export interface RevocationCheckpoint {
  chainId: number;
  badge: Address;
  registry: Address;
  toBlock: bigint;
  revokes: RevokeLog[];
  statuses: StatusLog[];
}

export type RevocationRead =
  | { ok: true; revoked: Set<number>; toBlock: bigint; checkpoint: RevocationCheckpoint }
  | { ok: false; error: string };

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A checkpoint as JSON (block numbers as decimal strings). */
export function checkpointToJson(c: RevocationCheckpoint) {
  return {
    chainId: c.chainId,
    badge: c.badge,
    registry: c.registry,
    toBlock: c.toBlock.toString(),
    revokes: c.revokes.map((r) => ({ builderId: r.builderId, block: r.block.toString(), index: r.index })),
    statuses: c.statuses.map((r) => ({ builderId: r.builderId, active: r.active, block: r.block.toString(), index: r.index })),
  };
}

const uint = (v: unknown) => (typeof v === "string" && /^\d{1,30}$/.test(v) ? BigInt(v) : null);
const smallInt = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/**
 * A checkpoint from JSON, only if it is well-formed AND describes this chain,
 * badge and registry (a checkpoint of another deployment is not history of
 * this one); otherwise null, and the caller reads from the deploy block.
 */
export function checkpointFromJson(
  raw: unknown,
  want: { chainId: number; badge: Address; registry: Address },
): RevocationCheckpoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.chainId !== want.chainId || typeof o.badge !== "string" || typeof o.registry !== "string") return null;
  if (!sameAddr(o.badge, want.badge) || !sameAddr(o.registry, want.registry)) return null;
  const toBlock = uint(o.toBlock);
  if (toBlock === null || !Array.isArray(o.revokes) || !Array.isArray(o.statuses)) return null;
  const revokes: RevokeLog[] = [];
  for (const r of o.revokes as Record<string, unknown>[]) {
    const builderId = smallInt(r?.builderId), block = uint(r?.block), index = smallInt(r?.index);
    if (builderId === null || block === null || index === null || block > toBlock) return null;
    revokes.push({ builderId, block, index });
  }
  const statuses: StatusLog[] = [];
  for (const r of o.statuses as Record<string, unknown>[]) {
    const builderId = smallInt(r?.builderId), block = uint(r?.block), index = smallInt(r?.index);
    if (builderId === null || block === null || index === null || typeof r?.active !== "boolean" || block > toBlock) return null;
    statuses.push({ builderId, active: r.active, block, index });
  }
  return { chainId: want.chainId, badge: want.badge, registry: want.registry, toBlock, revokes, statuses };
}

/**
 * Every Revoked (badge) and BuilderStatusSet (registry) log from `fromBlock`
 * to the head, in ≤`chunk`-block getLogs (Arc caps the range), `parallel` at
 * a time. With `prior` (a checkpoint of this chain, badge and registry), only
 * the blocks after it are read and its logs are kept. With `maxChunks`, a
 * longer read is not done at all (ok: false): the caller then treats the
 * history as unknown.
 */
export async function readRevokedBuilders(
  client: LogReader,
  o: {
    badge: Address;
    registry: Address;
    fromBlock: bigint;
    chainId?: number;
    prior?: RevocationCheckpoint | null;
    chunk?: bigint;
    maxChunks?: number;
    parallel?: number;
  },
): Promise<RevocationRead> {
  try {
    const prior =
      o.prior && sameAddr(o.prior.badge, o.badge) && sameAddr(o.prior.registry, o.registry) &&
      (o.chainId === undefined || o.prior.chainId === o.chainId) && o.prior.toBlock >= o.fromBlock
        ? o.prior
        : null;
    const head = await client.getBlockNumber();
    const start = prior ? prior.toBlock + 1n : o.fromBlock;
    const ranges = blockRanges(start, head, o.chunk ?? 5_000n);
    if (o.maxChunks !== undefined && ranges.length > o.maxChunks) {
      return { ok: false, error: `${ranges.length} log ranges since block ${start}: more than this page reads (${o.maxChunks})` };
    }
    const revokes: RevokeLog[] = prior ? [...prior.revokes] : [];
    const statuses: StatusLog[] = prior ? [...prior.statuses] : [];
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
    const toBlock = head > (prior?.toBlock ?? -1n) ? head : prior!.toBlock;
    return {
      ok: true,
      revoked: revokedBuilders(revokes, statuses),
      toBlock,
      checkpoint: { chainId: o.chainId ?? prior?.chainId ?? 0, badge: o.badge, registry: o.registry, toBlock, revokes, statuses },
    };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message?.split("\n")[0] ?? "log read failed" };
  }
}
