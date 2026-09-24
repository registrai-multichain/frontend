/**
 * Live reads behind the agent badge: the agent's bond on the market's feed, the
 * open collateral of its Trading markets on that feed, and a scan for
 * AttestationInvalid rulings newer than the build-time snapshot — so a fresh
 * catch shows before the next sync. Pure math: reputation.ts.
 *
 * Everything degrades silently. Arc testnet still runs legacy markets without
 * `collateralOf`: coverage is then hidden and reputation alone is shown.
 */
import type { Address, Hex, Log, PublicClient } from "viem";
import { attestationAbi, disputeAbi, marketsPerennialAbi, marketsV4Abi, registryAbi } from "./abi";
import live from "./live-data.json";
import { blockChunks } from "./perennial-market";
import { marketFeesAbi } from "./market-fees-chain";
import { DISPUTE_OUTCOME, snapshotFor, type FreshCatch, type ReputationSnapshot } from "./reputation";

export type MarketFlavor = "perennial" | "v4";

const lc = (s: string) => s.toLowerCase();
const ZERO = /^0x0*$/;

/** A view that may be missing or failing on this deployment: undefined, never a throw. */
async function soft<T>(p: Promise<unknown>): Promise<T | undefined> {
  try {
    return (await p) as T;
  } catch {
    return undefined;
  }
}

/** The build-time snapshot, if it describes this chain and market contract. */
export function reputationSnapshot(chainId: number, market: string | null | undefined): ReputationSnapshot | null {
  return snapshotFor((live as { reputation?: unknown }).reputation, { chainId, market });
}

// ───────────────────────────── contract stack ─────────────────────────────

export interface ReputationStack {
  attestation?: Address;
  registry?: Address;
  dispute?: Address;
}

const stackCache = new Map<string, Promise<ReputationStack>>();

/**
 * The market's own Attestation (ATTESTATION()), the Registry that Attestation
 * uses (REGISTRY(), else the market's REGISTRY()), and its Dispute (dispute()).
 * `fallback` fills whatever the chain won't say.
 */
export function resolveStack(client: PublicClient, market: Address, fallback: ReputationStack = {}): Promise<ReputationStack> {
  const key = lc(market);
  let p = stackCache.get(key);
  if (!p) {
    p = (async () => {
      const abi = marketsPerennialAbi; // ATTESTATION()/REGISTRY() are identical on MarketsV4
      const attestation =
        (await soft<Address>(client.readContract({ address: market, abi, functionName: "ATTESTATION" }))) ?? fallback.attestation;
      const registry =
        (attestation ? await soft<Address>(client.readContract({ address: attestation, abi: attestationAbi, functionName: "REGISTRY" })) : undefined) ??
        (await soft<Address>(client.readContract({ address: market, abi, functionName: "REGISTRY" }))) ??
        fallback.registry;
      const dispute =
        (attestation ? await soft<Address>(client.readContract({ address: attestation, abi: attestationAbi, functionName: "dispute" })) : undefined) ??
        fallback.dispute;
      const ok = (a?: Address) => (a && !ZERO.test(a) ? a : undefined);
      return { attestation: ok(attestation), registry: ok(registry), dispute: ok(dispute) };
    })();
    // A failed resolution is retried next time rather than cached forever.
    p.catch(() => stackCache.delete(key));
    stackCache.set(key, p);
  }
  return p;
}

/** Registry.getAgent(feed, agent).bond — per feed: a lie only slashes the stake on its feed. */
export async function readAgentBond(client: PublicClient, registry: Address | undefined, feed: Hex, agent: Address): Promise<bigint | undefined> {
  if (!registry) return undefined;
  const a = await soft<{ bond: bigint }>(client.readContract({ address: registry, abi: registryAbi, functionName: "getAgent", args: [feed, agent] }));
  return a?.bond;
}

// ───────────────────────────── open collateral ─────────────────────────────

export interface CandidateMarket {
  id: Hex;
  /** Known phase/agent/feed/collateral (e.g. from the Perennial overview); read when absent. */
  phase?: number;
  agent?: string;
  feed?: string;
  collateral?: bigint;
}

/**
 * Σ collateralOf over the agent's markets on `feed` still in phase Trading.
 * undefined when the contract has no collateralOf (legacy) — probed on
 * `probeId` so an agent with nothing open is still told apart from a legacy
 * deployment.
 */
export async function readOpenCollateral(
  client: PublicClient,
  market: Address,
  flavor: MarketFlavor,
  agent: Address,
  feed: Hex,
  probeId: Hex,
  candidates: CandidateMarket[],
): Promise<bigint | undefined> {
  const probe = await soft<bigint>(client.readContract({ address: market, abi: marketFeesAbi, functionName: "collateralOf", args: [probeId] }));
  if (probe === undefined) return undefined;
  const seen = new Set<string>();
  let total = 0n;
  const abi = flavor === "v4" ? marketsV4Abi : marketsPerennialAbi;
  for (const c of candidates) {
    const id = lc(c.id);
    if (seen.has(id)) continue;
    seen.add(id);
    let { phase, agent: a, feed: f } = c;
    if (phase === undefined || a === undefined || f === undefined) {
      const m = await soft<{ phase: number; agent: string; feedId: string; createdAt: bigint }>(
        client.readContract({ address: market, abi, functionName: "getMarket", args: [c.id] }),
      );
      if (!m || m.createdAt === 0n) continue;
      phase = Number(m.phase);
      a = m.agent;
      f = m.feedId;
    }
    if (phase !== 0 || lc(a) !== lc(agent) || lc(f) !== lc(feed)) continue;
    const col =
      c.collateral ?? (await soft<bigint>(client.readContract({ address: market, abi: marketFeesAbi, functionName: "collateralOf", args: [c.id] })));
    if (col === undefined) return undefined;
    total += col;
  }
  return total;
}

// ───────────────────────────── fresh rulings ─────────────────────────────

export interface InvalidRuling extends FreshCatch {
  agent: string;
}

const RESOLVED = disputeAbi.find((e) => e.type === "event" && e.name === "Resolved")!;

type RulingScan = { empty: boolean; lo: bigint; hi: bigint; rulings: InvalidRuling[]; traced: Map<string, string | null> };
const scans = new Map<string, RulingScan>();

/**
 * AttestationInvalid rulings on `dispute` in (since, head], at most
 * `budgetChunks` ≤5,000-block getLogs per call. The scanned span is kept per
 * Dispute contract for the session (every agent shares it) and only ever grows
 * contiguously: first the newest blocks, then new heads, then backwards into
 * any gap left before the snapshot's cursor.
 */
export async function scanInvalidRulings(
  client: PublicClient,
  dispute: Address,
  attestation: Address | undefined,
  since: bigint,
  head: bigint,
  budgetChunks = 20,
): Promise<{ rulings: InvalidRuling[]; partial: boolean }> {
  const key = lc(dispute);
  const floor = since + 1n;
  let s = scans.get(key);
  if (!s || floor > s.hi + 1n) s = { empty: true, lo: 0n, hi: -1n, rulings: [], traced: new Map() };
  let budget = budgetChunks;
  const found: Log[] = [];
  const read = async (a: bigint, b: bigint) => {
    if (budget-- <= 0) return false;
    try {
      found.push(...((await client.getLogs({ address: dispute, event: RESOLVED as never, fromBlock: a, toBlock: b })) as Log[]));
      return true;
    } catch {
      return false;
    }
  };
  if (s.empty) {
    for (const [a, b] of blockChunks(floor, head).reverse()) {
      if (!(await read(a, b))) break;
      if (s.empty) {
        s.empty = false;
        s.hi = b;
      }
      s.lo = a;
    }
  } else {
    let ok = true;
    for (const [a, b] of blockChunks(s.hi + 1n, head)) {
      if (!(ok = await read(a, b))) break;
      s.hi = b;
    }
    if (ok) {
      for (const [a, b] of blockChunks(floor, s.lo - 1n).reverse()) {
        if (!(await read(a, b))) break;
        s.lo = a;
      }
    }
  }
  for (const l of found) {
    const args = (l as unknown as { args: { disputeId: Hex; outcome: number } }).args;
    if (Number(args.outcome) !== DISPUTE_OUTCOME.AttestationInvalid) continue;
    const id = lc(args.disputeId);
    if (s.rulings.some((r) => r.disputeId === id)) continue;
    let agent = s.traced.get(id);
    if (agent === undefined) {
      // Dispute → attestation → the agent that gave the answer.
      const d = await soft<{ attestationId: Hex }>(client.readContract({ address: dispute, abi: disputeAbi, functionName: "getDispute", args: [args.disputeId] }));
      const att =
        attestation && d && !ZERO.test(d.attestationId)
          ? await soft<{ agent: Address }>(client.readContract({ address: attestation, abi: attestationAbi, functionName: "getAttestation", args: [d.attestationId] }))
          : undefined;
      agent = att && !ZERO.test(att.agent) ? lc(att.agent) : null;
      s.traced.set(id, agent);
    }
    if (agent) s.rulings.push({ agent, disputeId: id, block: Number(l.blockNumber ?? 0n), tx: l.transactionHash ? lc(l.transactionHash) : undefined });
  }
  scans.set(key, s);
  return { rulings: s.rulings, partial: s.empty || s.lo > floor || s.hi < head };
}

/** The newest ruling against `agent` after the snapshot, if any. */
export function freshCatchFor(rulings: InvalidRuling[], agent: string, afterBlock: number): FreshCatch | undefined {
  const mine = rulings.filter((r) => r.agent === lc(agent) && r.block > afterBlock).sort((a, b) => b.block - a.block);
  const r = mine[0];
  return r ? { disputeId: r.disputeId, block: r.block, tx: r.tx } : undefined;
}
