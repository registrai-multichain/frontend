/**
 * Agent reputation indexer: a resumable fold over MarketsPerennial + MarketsV4 +
 * Dispute logs (Attestation is read for the agent behind a ruled attestation).
 * Design: docs/superpowers/specs/2026-09-24-agent-reputation-design.md.
 *
 * Library: `syncReputation({ rpc, contracts, prior?, fromBlock? })` →
 * `{ reputation: { agents }, cursor }`, JSON-safe (bigints as decimal strings).
 * Passing the returned `cursor` back as `prior` resumes from the next block and
 * gives exactly what a from-scratch run over the same range gives.
 *
 * CLI (prints ONE JSON line of that shape to stdout, logs to stderr, never
 * writes a file):
 *   npx tsx scripts/reputation.ts '{"rpc":"http://127.0.0.1:8545","contracts":{...},"fromBlock":0}'
 *
 * No chain-id gate: it indexes whatever `rpc` serves (the e2e runs on anvil).
 */
import {
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  http,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { attestationAbi, disputeAbi, marketsPerennialAbi, marketsV4Abi } from "../src/lib/abi";
import {
  EMPTY_REPUTATION,
  REPUTATION_CURSOR_VERSION,
  cursorMatches,
  foldReputation,
  invalidationsFromRulings,
  marketKey,
  parseReputation,
  serializeReputation,
  tradeVolume,
  type AgentRecordJson,
  type ReputationContractsStamp,
  type ReputationCursor,
  type ReputationEvent,
} from "../src/lib/reputation";

/** Arc rejects eth_getLogs windows wider than this. */
export const MAX_CHUNK = 5_000;

export interface SyncReputationInput {
  rpc: string;
  contracts: {
    MarketsPerennial?: string | null;
    MarketsV4?: string | null;
    Attestation: string;
    Dispute: string;
  };
  /** A previous run's cursor (or its whole output). Ignored, with a rescan, when
   *  it describes another chain, other contracts or an older fold version. */
  prior?: ReputationCursor | { cursor: ReputationCursor } | null;
  /** First block of a fresh scan (default 0). Ignored when resuming. */
  fromBlock?: number | string;
  /** Last block to fold (default: the chain head). */
  toBlock?: number | string;
  /** Blocks per eth_getLogs, capped at 5,000. */
  chunk?: number;
  /** Pause between chunks, ms (public endpoints rate-limit). */
  paceMs?: number;
  log?: (msg: string) => void;
}

export interface SyncReputationOutput {
  reputation: { agents: Record<string, AgentRecordJson> };
  cursor: ReputationCursor;
}

const lc = (s: string) => s.toLowerCase();
const addrOrNull = (s: string | null | undefined): string | null =>
  typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s) ? lc(s) : null;

function stampOf(c: SyncReputationInput["contracts"]): ReputationContractsStamp {
  const attestation = addrOrNull(c.Attestation);
  const dispute = addrOrNull(c.Dispute);
  if (!attestation || !dispute) throw new Error("contracts.Attestation and contracts.Dispute must be addresses");
  const mp = addrOrNull(c.MarketsPerennial);
  const v4 = addrOrNull(c.MarketsV4);
  if (!mp && !v4) throw new Error("need at least one of contracts.MarketsPerennial / contracts.MarketsV4");
  return { MarketsPerennial: mp, MarketsV4: v4, Attestation: attestation, Dispute: dispute };
}

function unwrapPrior(p: SyncReputationInput["prior"]): ReputationCursor | undefined {
  if (!p) return undefined;
  return "cursor" in p && p.cursor ? p.cursor : (p as ReputationCursor);
}

const sortRecord = (o: Record<string, string>) =>
  Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

type Ev = { type: "event"; name: string };
const eventsOf = (abi: Abi, names: string[]) =>
  (abi as readonly Ev[]).filter((x) => x.type === "event" && names.includes(x.name));
const topic0 = (abi: Abi, name: string) => encodeEventTopics({ abi, eventName: name } as never)[0] as Hex;

const MARKET_EVENTS = ["MarketCreated", "Bought", "Sold", "Resolved", "MarketVoided"];

interface RawLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  logIndex: Hex;
  transactionHash: Hex;
}

/**
 * Fold every reputation event in (cursor, head] into the prior state. Market
 * and dispute logs come from ONE eth_getLogs per ≤5,000-block chunk (address
 * list + topic0 list) and are decoded with the emitting contract's own ABI —
 * MarketsV4 and MarketsPerennial lay out MarketCreated differently.
 */
export async function syncReputation(input: SyncReputationInput): Promise<SyncReputationOutput> {
  const log = input.log ?? (() => {});
  const stamp = stampOf(input.contracts);
  const client = createPublicClient({
    transport: http(input.rpc, { retryCount: 8, retryDelay: 1_200, batch: false }),
  }) as PublicClient;
  const chainId = await client.getChainId();

  // ── where to start ──
  const given = unwrapPrior(input.prior);
  const prior = given && cursorMatches(given, chainId, stamp) ? given : undefined;
  if (given && !prior) {
    log(
      `reputation: prior cursor is for chain ${given.chainId} v${given.version} / other contracts; ` +
        `rescanning chain ${chainId} from the anchor`,
    );
  }
  const anchor = prior ? BigInt(prior.fromBlock) : BigInt(input.fromBlock ?? 0);
  const from = prior ? BigInt(prior.lastScannedBlock) + 1n : anchor;
  const head = input.toBlock !== undefined ? BigInt(input.toBlock) : await client.getBlockNumber();
  const chunk = BigInt(Math.max(1, Math.min(MAX_CHUNK, Math.floor(input.chunk ?? MAX_CHUNK))));

  const challenges: Record<string, string> = { ...(prior?.challenges ?? {}) };
  const attesters: Record<string, string> = { ...(prior?.attesters ?? {}) };
  let state = prior ? parseReputation(prior.state) : EMPTY_REPUTATION;

  // ── which logs ──
  const byAddress = new Map<string, { abi: Abi; kind: "market" | "dispute" }>();
  if (stamp.MarketsPerennial) byAddress.set(stamp.MarketsPerennial, { abi: marketsPerennialAbi as Abi, kind: "market" });
  if (stamp.MarketsV4) byAddress.set(stamp.MarketsV4, { abi: marketsV4Abi as Abi, kind: "market" });
  byAddress.set(stamp.Dispute, { abi: disputeAbi as Abi, kind: "dispute" });

  const topics = new Set<Hex>();
  for (const { abi, kind } of byAddress.values()) {
    const names = kind === "market" ? MARKET_EVENTS : ["Challenged", "Resolved"];
    for (const e of eventsOf(abi, names)) topics.add(topic0(abi, e.name));
  }

  const raw: RawLog[] = [];
  let chunks = 0;
  for (let start = from; start <= head; start += chunk) {
    const end = start + chunk - 1n > head ? head : start + chunk - 1n;
    const logs = (await client.request({
      method: "eth_getLogs",
      params: [{ address: [...byAddress.keys()] as Address[], topics: [[...topics]], fromBlock: toHex(start), toBlock: toHex(end) }],
    } as never)) as RawLog[];
    raw.push(...logs);
    chunks++;
    if (input.paceMs) await new Promise((r) => setTimeout(r, input.paceMs));
  }
  log(`reputation: chain ${chainId}, blocks ${from}..${head} (${chunks} chunk(s)), ${raw.length} log(s)`);

  // ── decode ──
  raw.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)));
  const events: ReputationEvent[] = [];
  const rulings: { disputeId: string; outcome: number; block: number; seq: number; tx?: string }[] = [];
  for (const l of raw) {
    const src = byAddress.get(lc(l.address));
    if (!src) continue;
    let ev: { eventName: string; args: Record<string, unknown> };
    try {
      ev = decodeEventLog({ abi: src.abi, data: l.data, topics: l.topics as [Hex, ...Hex[]] }) as never;
    } catch {
      continue; // a same-topic log we cannot decode (e.g. a different legacy layout)
    }
    const block = Number(BigInt(l.blockNumber));
    const seq = Number(BigInt(l.logIndex));
    const a = ev.args;
    if (src.kind === "dispute") {
      if (ev.eventName === "Challenged") challenges[lc(a.disputeId as string)] = lc(a.attestationId as string);
      else if (ev.eventName === "Resolved")
        rulings.push({ disputeId: lc(a.disputeId as string), outcome: Number(a.outcome), block, seq, tx: lc(l.transactionHash) });
      continue;
    }
    const market = marketKey(l.address, a.marketId as string);
    switch (ev.eventName) {
      case "MarketCreated":
        events.push({ kind: "created", block, seq, market, agent: lc(a.agent as string), feed: lc(a.feedId as string) });
        break;
      case "Bought":
        events.push({ kind: "trade", block, seq, market, volume: tradeVolume({ kind: "buy", collateralIn: a.collateralIn as bigint }) });
        break;
      case "Sold":
        events.push({
          kind: "trade", block, seq, market,
          volume: tradeVolume({ kind: "sell", collateralOut: a.collateralOut as bigint, fee: (a.fee as bigint | undefined) ?? 0n }),
        });
        break;
      case "Resolved":
        events.push({ kind: "resolved", block, seq, market });
        break;
      case "MarketVoided":
        events.push({ kind: "voided", block, seq, market });
        break;
    }
  }

  // ── Invalid rulings → agents. Challenged is usually already in the map (this
  // run or an earlier one); otherwise the dispute's own view names the
  // attestation. The attestation's agent is the same field Attested carries. ──
  for (const r of rulings) {
    if (r.outcome !== 2) continue;
    if (!challenges[r.disputeId]) {
      try {
        const d = (await client.readContract({
          address: stamp.Dispute as Address, abi: disputeAbi, functionName: "getDispute", args: [r.disputeId as Hex],
        })) as { attestationId: Hex };
        if (!/^0x0+$/.test(d.attestationId)) challenges[r.disputeId] = lc(d.attestationId);
      } catch (e) {
        log(`reputation: getDispute(${r.disputeId}) failed: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    const att = challenges[r.disputeId];
    if (att && !attesters[att]) {
      try {
        const x = (await client.readContract({
          address: stamp.Attestation as Address, abi: attestationAbi, functionName: "getAttestation", args: [att as Hex],
        })) as { agent: Address };
        if (!/^0x0+$/.test(x.agent)) attesters[att] = lc(x.agent);
      } catch (e) {
        log(`reputation: getAttestation(${att}) failed: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }
  const { events: invalidations, unresolved } = invalidationsFromRulings(
    rulings,
    (d) => challenges[d],
    (a) => attesters[a],
  );
  for (const d of unresolved) log(`reputation: WARNING could not trace Invalid ruling ${d} to an agent`);

  state = foldReputation(state, [...events, ...invalidations]);
  const json = serializeReputation(state);
  const cursor: ReputationCursor = {
    version: REPUTATION_CURSOR_VERSION,
    chainId,
    contracts: stamp,
    fromBlock: anchor.toString(),
    lastScannedBlock: (head >= from ? head : from - 1n).toString(),
    state: json,
    challenges: sortRecord(challenges),
    attesters: sortRecord(attesters),
  };
  return { reputation: { agents: json.agents }, cursor };
}

// ───────────────────────────── CLI ─────────────────────────────

async function cli(): Promise<void> {
  let arg = process.argv[2];
  if (!arg) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    arg = Buffer.concat(chunks).toString("utf8");
  }
  const input = JSON.parse(arg) as SyncReputationInput;
  const out = await syncReputation({ ...input, log: (m) => process.stderr.write(`${m}\n`) });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (typeof require !== "undefined" && require.main === module) {
  cli().catch((e) => {
    process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  });
}
