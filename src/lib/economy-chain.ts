/**
 * Builder-economy chain reads: the BuilderFund (builder income per epoch, the
 * tax schedule) and the SeasonPool (the shared pool and its seasons).
 *
 * Views give the current numbers; the event history (IncomeCredited, Claimed,
 * FrozenSwept, SeasonPublished, SeasonClaimed, ...) is folded into a JSON-safe
 * ledger by `foldEconomyLogs` — the same fold scripts/sync.ts runs at build
 * time (live-data.json `economy`) and the browser tops up from the snapshot's
 * block to head (Arc caps getLogs at 5,000 blocks, so the scan is chunked,
 * budgeted per call and resumed from a persisted cursor).
 *
 * Every read here is gated on `fundDeployed`: a network whose MarketsPerennial
 * predates the fund makes no fund or pool call at all.
 */
import { decodeEventLog, type Abi, type Address, type Log, type PublicClient } from "viem";
import { builderFundAbi, marketsPerennialAbi, seasonPoolAbi } from "./abi";
import live from "./live-data.json";
import { isRevert } from "./market-fees-chain";
import { blockChunks } from "./perennial-market";
import type { PerennialDeployment } from "./perennial-network";
import { epochEnd, splitIncome, toBrackets, type Bracket, type EpochIncome } from "./builder-economy";

// ───────────────────────────── views ─────────────────────────────

export interface ScheduleEntry {
  effectiveEpoch: bigint;
  brackets: Bracket[];
}

export interface EconomyOverview {
  fund: Address;
  pool: Address;
  epoch: bigint;
  start: bigint;
  epochLength: bigint;
  /** First second after the current epoch. */
  epochEndsAt: bigint;
  /** Builder income credited and not yet claimed or swept. */
  outstanding: bigint;
  /** The schedule in force this epoch. */
  schedule: Bracket[];
  /** Announced schedules for later epochs (ascending). The one for epoch+1 is
   *  final; one for epoch+2 may still be replaced. */
  upcoming: ScheduleEntry[];
  /** SeasonPool: free to publish in a season. */
  unallocated: bigint;
  /** SeasonPool: published and not yet claimed or reclaimed. */
  reserved: bigint;
}

type Read = <T>(address: Address, abi: Abi, functionName: string, args?: readonly unknown[]) => Promise<T>;
const reader = (client: PublicClient): Read => (address, abi, functionName, args) =>
  client.readContract({ address, abi, functionName, args } as never) as never;

type RawBracket = { upTo: bigint; rateBps: number | bigint };

export async function readEconomy(client: PublicClient, fund: Address, pool: Address): Promise<EconomyOverview> {
  const r = reader(client);
  const F = builderFundAbi as Abi;
  const S = seasonPoolAbi as Abi;
  const [epoch, start, epochLength, outstanding, count, unallocated, reserved] = await Promise.all([
    r<bigint>(fund, F, "currentEpoch"),
    r<bigint>(fund, F, "START"),
    r<bigint>(fund, F, "EPOCH_LENGTH"),
    r<bigint>(fund, F, "outstanding"),
    r<bigint>(fund, F, "scheduleCount"),
    r<bigint>(pool, S, "unallocated"),
    r<bigint>(pool, S, "reserved"),
  ]);
  const schedule = toBrackets(await r<RawBracket[]>(fund, F, "scheduleFor", [epoch]));
  // Walk the history back from the newest entry while it is still in the future.
  const upcoming: ScheduleEntry[] = [];
  for (let i = count - 1n; i >= 0n; i--) {
    const [effectiveEpoch, brackets] = await r<readonly [bigint, RawBracket[]]>(fund, F, "scheduleAt", [i]);
    if (effectiveEpoch <= epoch) break;
    upcoming.unshift({ effectiveEpoch, brackets: toBrackets(brackets) });
  }
  return {
    fund, pool, epoch, start, epochLength,
    epochEndsAt: epochEnd(epoch, start, epochLength),
    outstanding, schedule, upcoming, unallocated, reserved,
  };
}

/**
 * The fund MarketsPerennial actually pays (`FUND()`), or null when the
 * deployed markets predate the fund (the view reverts). Transport errors throw.
 */
export async function readMarketsFund(client: PublicClient, markets: Address): Promise<Address | null> {
  try {
    return (await client.readContract({ address: markets, abi: marketsPerennialAbi, functionName: "FUND" })) as Address;
  } catch (e) {
    if (isRevert(e)) return null;
    throw e;
  }
}

/** incomeOf(epoch, id) for many builders at once (the market pages sort by it). */
export async function readIncomes(client: PublicClient, fund: Address, epoch: bigint, builderIds: number[]): Promise<Record<number, bigint>> {
  const r = reader(client);
  const vals = await Promise.all(builderIds.map((id) => r<bigint>(fund, builderFundAbi as Abi, "incomeOf", [epoch, BigInt(id)])));
  return Object.fromEntries(builderIds.map((id, i) => [id, vals[i]]));
}

/**
 * One builder's income by epoch, from the views (exactly what claimFor would
 * pay: `quote` is the contract's own split): the current epoch (always) and
 * every earlier epoch in the last `window` with income. `ledger` (the folded
 * events, if any) adds the payout address and tells a sweep from a claim.
 */
export async function readBuilderEpochs(
  client: PublicClient,
  econ: Pick<EconomyOverview, "fund" | "epoch" | "start" | "epochLength" | "schedule">,
  builderId: number,
  chainNow: bigint,
  ledger?: EconomyLedger | null,
  window = 24n,
): Promise<EpochIncome[]> {
  const r = reader(client);
  const F = builderFundAbi as Abi;
  const id = BigInt(builderId);
  const first = econ.epoch > window ? econ.epoch - window : 0n;
  const epochs = Array.from({ length: Number(econ.epoch - first + 1n) }, (_, i) => first + BigInt(i));
  // Epochs the event history knows about, even beyond the window.
  for (const e of Object.keys(ledger?.income[String(builderId)] ?? {})) {
    const b = BigInt(e);
    if (b < first) epochs.push(b);
  }
  const incomes = await Promise.all(epochs.map((e) => r<bigint>(econ.fund, F, "incomeOf", [e, id])));
  const rows: EpochIncome[] = [];
  await Promise.all(
    epochs.map(async (e, i) => {
      const gross = incomes[i];
      if (gross === 0n && e !== econ.epoch) return;
      const ended = chainNow >= epochEnd(e, econ.start, econ.epochLength);
      if (e === econ.epoch) {
        // The schedule of the current epoch is already read: no quote call.
        rows.push({ epoch: e, ...splitIncome(gross, econ.schedule), claimed: false, ended });
        return;
      }
      const [claimed, q] = await Promise.all([
        r<boolean>(econ.fund, F, "claimed", [e, id]),
        r<readonly [bigint, bigint, bigint, bigint]>(econ.fund, F, "quote", [e, id]),
      ]);
      const c = ledger?.claims[String(builderId)]?.[e.toString()];
      const swept = ledger?.swept[String(builderId)]?.[e.toString()] !== undefined;
      rows.push({
        epoch: e, gross: q[0], tax: q[1], fee: q[2], net: q[3], claimed, ended,
        ...(claimed && swept ? { swept: true } : {}),
        ...(c ? { payout: c.payout } : {}),
      });
    }),
  );
  return rows.sort((a, b) => Number(b.epoch - a.epoch));
}

export interface SeasonView {
  seasonId: bigint;
  root: `0x${string}`;
  total: bigint;
  claimedAmount: bigint;
  deadline: bigint;
  reclaimed: boolean;
}

/** SeasonPool.seasons(id) for each id; unknown ids (deadline 0) are dropped. */
export async function readSeasons(client: PublicClient, pool: Address, ids: bigint[]): Promise<SeasonView[]> {
  const r = reader(client);
  const rows = await Promise.all(
    ids.map(async (seasonId) => {
      const [root, total, claimedAmount, deadline, reclaimed] = await r<readonly [`0x${string}`, bigint, bigint, bigint, boolean]>(
        pool, seasonPoolAbi as Abi, "seasons", [seasonId],
      );
      return { seasonId, root, total, claimedAmount, deadline: BigInt(deadline), reclaimed };
    }),
  );
  return rows.filter((s) => s.deadline !== 0n).sort((a, b) => Number(a.seasonId - b.seasonId));
}

// ───────────────────────────── event ledger (pure) ─────────────────────────────

/** JSON-safe (every amount a decimal string) so it can live in live-data.json and localStorage. */
export interface EconomyLedger {
  /** builderId -> epoch -> income credited (IncomeCredited + LateIncomeCredited, summed). */
  income: Record<string, Record<string, string>>;
  /** builderId -> epoch -> its Claimed events, summed (late income makes an epoch claimable again). */
  claims: Record<string, Record<string, { gross: string; tax: string; fee: string; net: string; payout: string }>>;
  /** builderId -> epoch -> gross swept to the season pool (FrozenSwept). */
  swept: Record<string, Record<string, string>>;
  /** Effective epochs of every ScheduleSet, in order. */
  schedules: string[];
  /** Everything the pool was funded with (Funded + Synced). */
  funded: string;
  /** Void escrows forwarded to the pool (SeasonCredited). */
  voidEscrows: string;
  /** seasonId -> the published season and its claims. */
  seasons: Record<string, { root: string; total: string; deadline: string; claimed: Record<string, string>; reclaimed: string | null }>;
}

export const EMPTY_LEDGER: EconomyLedger = {
  income: {}, claims: {}, swept: {}, schedules: [], funded: "0", voidEscrows: "0", seasons: {},
};

export type EconomyEvent = { eventName: string; args: Record<string, unknown> };

const add = (a: string | undefined, b: unknown) => (BigInt(a ?? "0") + BigInt(b as bigint)).toString();
const s = (v: unknown) => String(v as bigint);

/** Fold decoded fund + pool events (in chain order) into a new ledger. */
export function foldEconomyLogs(prev: EconomyLedger, events: readonly EconomyEvent[]): EconomyLedger {
  const l: EconomyLedger = structuredClone(prev);
  for (const { eventName, args: a } of events) {
    switch (eventName) {
      case "IncomeCredited":
      case "LateIncomeCredited": {
        const b = (l.income[s(a.builderId)] ??= {});
        b[s(a.epoch)] = add(b[s(a.epoch)], a.amount);
        break;
      }
      case "Claimed": {
        const b = (l.claims[s(a.builderId)] ??= {});
        const was = b[s(a.epoch)];
        b[s(a.epoch)] = {
          gross: add(was?.gross, a.gross), tax: add(was?.tax, a.tax), fee: add(was?.fee, a.fee), net: add(was?.net, a.net),
          payout: String(a.payout).toLowerCase(),
        };
        break;
      }
      case "FrozenSwept":
        (l.swept[s(a.builderId)] ??= {})[s(a.epoch)] = s(a.gross);
        break;
      case "ScheduleSet":
        l.schedules.push(s(a.effectiveEpoch));
        break;
      case "SeasonCredited":
        l.voidEscrows = add(l.voidEscrows, a.amount);
        break;
      case "Funded":
      case "Synced":
        l.funded = add(l.funded, a.amount);
        break;
      case "SeasonPublished":
        l.seasons[s(a.seasonId)] = { root: String(a.root), total: s(a.total), deadline: s(a.deadline), claimed: {}, reclaimed: null };
        break;
      case "SeasonClaimed": {
        const season = l.seasons[s(a.seasonId)];
        if (season) season.claimed[s(a.builderId)] = s(a.amount);
        break;
      }
      case "SeasonReclaimed": {
        const season = l.seasons[s(a.seasonId)];
        if (season) season.reclaimed = s(a.amount);
        break;
      }
    }
  }
  return l;
}

/** Season rewards a builder claimed, from the ledger: [{seasonId, amount}]. */
export function seasonRewardsOf(l: EconomyLedger | null | undefined, builderId: number): { seasonId: string; amount: bigint }[] {
  if (!l) return [];
  return Object.entries(l.seasons)
    .filter(([, v]) => v.claimed[String(builderId)] !== undefined)
    .map(([seasonId, v]) => ({ seasonId, amount: BigInt(v.claimed[String(builderId)]) }))
    .sort((a, b) => Number(BigInt(a.seasonId) - BigInt(b.seasonId)));
}

/** Released wonder escrow credited to the ended epoch it was earned in (BuilderFund after the
 *  2026-09-27 audit fixes; not in the generated ABI of the deployed builder stack yet). */
const LATE_INCOME_EVENT = {
  type: "event", name: "LateIncomeCredited", anonymous: false,
  inputs: [
    { name: "epoch", type: "uint256", indexed: true, internalType: "uint256" },
    { name: "builderId", type: "uint256", indexed: true, internalType: "uint256" },
    { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
  ],
} as const;

/** The fund's events, late income included. */
const FUND_EVENTS_ABI = [...(builderFundAbi as Abi), LATE_INCOME_EVENT] as Abi;

/** The fund and pool events the ledger folds (one getLogs per chunk covers both contracts). */
const LEDGER_EVENTS = [
  ...(builderFundAbi as Abi).filter((x) => x.type === "event" && ["IncomeCredited", "Claimed", "FrozenSwept", "ScheduleSet", "SeasonCredited"].includes(x.name)),
  LATE_INCOME_EVENT,
  ...(seasonPoolAbi as Abi).filter((x) => x.type === "event" && ["Funded", "Synced", "SeasonPublished", "SeasonClaimed", "SeasonReclaimed"].includes(x.name)),
];

/** Decode raw logs of the fund and the pool, in chain order; other logs are skipped. */
export function decodeEconomyLogs(logs: readonly Log[], fund: Address, pool: Address): EconomyEvent[] {
  const out: EconomyEvent[] = [];
  const sorted = [...logs].sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || (a.logIndex ?? 0) - (b.logIndex ?? 0));
  for (const lg of sorted) {
    const at = lg.address.toLowerCase();
    const abi = at === fund.toLowerCase() ? FUND_EVENTS_ABI : at === pool.toLowerCase() ? seasonPoolAbi : null;
    if (!abi) continue;
    try {
      const ev = decodeEventLog({ abi: abi as Abi, data: lg.data, topics: lg.topics });
      out.push({ eventName: String(ev.eventName), args: ev.args as unknown as Record<string, unknown> });
    } catch {
      // an event the ledger does not fold (roles)
    }
  }
  return out;
}

/** A ledger plus what it describes and how far it reaches. */
export interface EconomyCursor {
  chainId: number;
  fund: string;
  pool: string;
  scannedTo: string;
  ledger: EconomyLedger;
}

/** True when `c` describes this chain's fund and pool (anything else is rescanned). */
export function cursorMatches(c: Partial<EconomyCursor> | null | undefined, chainId: number, fund: Address, pool: Address): c is EconomyCursor {
  return Boolean(
    c && c.chainId === chainId && c.fund?.toLowerCase() === fund.toLowerCase() && c.pool?.toLowerCase() === pool.toLowerCase() &&
      typeof c.scannedTo === "string" && c.ledger,
  );
}

/**
 * Scan fund + pool events from `from` to `head` in 5,000-block chunks, two at
 * a time, at most `budgetChunks`, stopping at the first failed chunk (the
 * cursor only advances over a contiguous run). Pure over the client.
 */
export async function scanEconomy(
  client: PublicClient,
  start: EconomyCursor,
  head: bigint,
  budgetChunks = 40,
): Promise<{ cursor: EconomyCursor; partial: boolean }> {
  const fund = start.fund as Address;
  const pool = start.pool as Address;
  let ledger = start.ledger;
  let scannedTo = BigInt(start.scannedTo);
  const chunks = blockChunks(scannedTo + 1n, head).slice(0, budgetChunks);
  let failed = false;
  for (let i = 0; i < chunks.length && !failed; i += 2) {
    const pair = chunks.slice(i, i + 2);
    const res = await Promise.allSettled(
      pair.map(([a, b]) => client.getLogs({ address: [fund, pool], events: LEDGER_EVENTS as never, fromBlock: a, toBlock: b })),
    );
    for (let j = 0; j < res.length; j++) {
      const r = res[j];
      if (r.status !== "fulfilled") { failed = true; break; }
      ledger = foldEconomyLogs(ledger, decodeEconomyLogs(r.value as Log[], fund, pool));
      scannedTo = pair[j][1];
    }
  }
  return { cursor: { ...start, ledger, scannedTo: scannedTo.toString() }, partial: scannedTo < head };
}

// ───────────────────────────── browser: snapshot + cache ─────────────────────────────

const cacheKey = (chainId: number, fund: Address) => `perennial:economy:v1:${chainId}:${fund.toLowerCase()}`;

function readCache(chainId: number, fund: Address, pool: Address): EconomyCursor | undefined {
  try {
    const raw = window.localStorage.getItem(cacheKey(chainId, fund));
    const c = raw ? (JSON.parse(raw) as EconomyCursor) : undefined;
    return cursorMatches(c, chainId, fund, pool) ? c : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(c: EconomyCursor) {
  try {
    window.localStorage.setItem(cacheKey(c.chainId, c.fund as Address), JSON.stringify(c));
  } catch {
    // storage unavailable: the next load rescans from the snapshot
  }
}

/** The build-time ledger (live-data.json `economy`), when it describes this fund. */
export function snapshotEconomy(chainId: number, fund: Address, pool: Address): EconomyCursor | undefined {
  const c = (live as unknown as { economy?: Partial<EconomyCursor> }).economy;
  return cursorMatches(c, chainId, fund, pool) ? c : undefined;
}

export interface EconomyHistory {
  ledger: EconomyLedger;
  scannedTo: bigint;
  /** Older blocks still unscanned (the next refresh resumes). */
  partial: boolean;
}

/** The event ledger for a deployment: snapshot or this browser's cache (the
 *  further one), topped up to head within a budget. */
export async function readEconomyHistory(client: PublicClient, d: PerennialDeployment, head: bigint): Promise<EconomyHistory> {
  const fund = d.contracts.BuilderFund!;
  const pool = d.contracts.SeasonPool!;
  const seed = snapshotEconomy(d.chain.id, fund, pool);
  const cached = typeof window !== "undefined" ? readCache(d.chain.id, fund, pool) : undefined;
  let start: EconomyCursor =
    cached && (!seed || BigInt(cached.scannedTo) >= BigInt(seed.scannedTo))
      ? cached
      : seed ?? { chainId: d.chain.id, fund, pool, scannedTo: ((d.deployBlock ?? 1n) - 1n).toString(), ledger: EMPTY_LEDGER };
  if (BigInt(start.scannedTo) < 0n) start = { ...start, scannedTo: "0" };
  const { cursor, partial } = await scanEconomy(client, start, head);
  if (typeof window !== "undefined") writeCache(cursor);
  return { ledger: cursor.ledger, scannedTo: BigInt(cursor.scannedTo), partial };
}
