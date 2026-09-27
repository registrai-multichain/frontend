/**
 * The common markets on the dashboard (MarketsV4 + its oracle), counted from public
 * event logs: rounds opened / settled / voided, trading volume, fees to the splitter;
 * readings, challenges, rulings (and how long they took), open disputes, slashes.
 * Pure: raw logs in (eth_getLogs, with Arc's blockTimestamp), totals out; the page scans
 * the logs incrementally and feeds them here.
 */
import { decodeEventLog, parseAbi, type Hex } from "viem";

export const MARKET_EVENTS_ABI = parseAbi([
  "event MarketCreated(bytes32 indexed marketId, address indexed creator, bytes32 indexed feedId, address agent, int256 threshold, uint8 comparator, uint256 expiry, uint256 liquidity)",
  "event Bought(bytes32 indexed marketId, address indexed buyer, uint8 outcome, uint256 collateralIn, uint256 sharesOut, uint256 fee)",
  "event Sold(bytes32 indexed marketId, address indexed seller, uint8 outcome, uint256 sharesIn, uint256 collateralOut, uint256 fee)",
  "event Resolved(bytes32 indexed marketId, bool yesWon, int256 value)",
  "event MarketVoided(bytes32 indexed marketId)",
  "event FeesPaid(bytes32 indexed marketId, uint256 creatorFee, uint256 commonsFee, uint256 agentFee)",
  "event VoidFeesPaid(bytes32 indexed marketId, uint256 creatorFee, uint256 commonsFee, uint256 challengerReward, address challenger)",
  "event DustSwept(bytes32 indexed marketId, uint256 amount)",
]);
export const ATTESTATION_EVENTS_ABI = parseAbi([
  "event Attested(bytes32 indexed attestationId, bytes32 indexed feedId, address indexed agent, int256 value, bytes32 inputHash, uint256 finalizedAt)",
]);
export const DISPUTE_EVENTS_ABI = parseAbi([
  "event Challenged(bytes32 indexed disputeId, bytes32 indexed attestationId, address indexed challenger, uint256 bond, bytes32 evidenceHash)",
  "event Resolved(bytes32 indexed disputeId, uint8 outcome)",
]);
export const REGISTRY_EVENTS_ABI = parseAbi([
  "event AgentSlashed(bytes32 indexed feedId, address indexed agent, uint256 amount, address recipient)",
]);

export interface RawLog {
  address: string;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex;
  /** Arc returns it on eth_getLogs; ruling times need it. */
  blockTimestamp?: Hex;
}

export interface CommonStats {
  markets: { opened: number; settled: number; voided: number; trades: number; volume: bigint; feesToSplitter: bigint };
  oracle: {
    readings: number;
    challenges: number;
    valid: number;
    invalid: number;
    /** Dispute ids challenged and not yet ruled. */
    open: Hex[];
    ruled: number;
    rulingSecsTotal: number;
    slashes: number;
    /** disputeId -> the challenge's block time (for the ruling time). */
    challengedAt: Record<string, number>;
  };
}

export const emptyStats = (): CommonStats => ({
  markets: { opened: 0, settled: 0, voided: 0, trades: 0, volume: 0n, feesToSplitter: 0n },
  oracle: { readings: 0, challenges: 0, valid: 0, invalid: 0, open: [], ruled: 0, rulingSecsTotal: 0, slashes: 0, challengedAt: {} },
});

export interface CommonAddresses { marketsV4: string; attestation: string; dispute: string; registry: string; agent: string }

function decode(abi: readonly unknown[], l: RawLog): { eventName: string; args: Record<string, unknown> } | null {
  try {
    return decodeEventLog({ abi: abi as never, topics: l.topics as never, data: l.data }) as unknown as { eventName: string; args: Record<string, unknown> };
  } catch {
    return null; // an event this dashboard doesn't count
  }
}

/** Pure: fold `logs` into `s` (a new object; `s` is untouched). */
export function reduceLogs(s: CommonStats, logs: RawLog[], a: CommonAddresses): CommonStats {
  const out: CommonStats = {
    markets: { ...s.markets },
    oracle: { ...s.oracle, open: [...s.oracle.open], challengedAt: { ...s.oracle.challengedAt } },
  };
  const m = out.markets;
  const o = out.oracle;
  const lc = (x: string) => x.toLowerCase();
  for (const l of logs) {
    const at = lc(l.address);
    const ts = l.blockTimestamp ? Number(BigInt(l.blockTimestamp)) : null;
    if (at === lc(a.marketsV4)) {
      const e = decode(MARKET_EVENTS_ABI, l);
      if (!e) continue;
      if (e.eventName === "MarketCreated") m.opened++;
      else if (e.eventName === "Resolved") m.settled++;
      else if (e.eventName === "MarketVoided") m.voided++;
      else if (e.eventName === "Bought") { m.trades++; m.volume += e.args.collateralIn as bigint; }
      else if (e.eventName === "Sold") { m.trades++; m.volume += e.args.collateralOut as bigint; }
      else if (e.eventName === "FeesPaid" || e.eventName === "VoidFeesPaid") m.feesToSplitter += e.args.commonsFee as bigint;
      else if (e.eventName === "DustSwept") m.feesToSplitter += e.args.amount as bigint;
    } else if (at === lc(a.attestation)) {
      const e = decode(ATTESTATION_EVENTS_ABI, l);
      if (e?.eventName === "Attested" && lc(e.args.agent as string) === lc(a.agent)) o.readings++;
    } else if (at === lc(a.dispute)) {
      const e = decode(DISPUTE_EVENTS_ABI, l);
      if (!e) continue;
      const id = e.args.disputeId as Hex;
      if (e.eventName === "Challenged") {
        o.challenges++;
        o.open.push(id);
        if (ts !== null) o.challengedAt[id] = ts;
      } else if (e.eventName === "Resolved") {
        const outcome = Number(e.args.outcome);
        if (outcome === 1) o.valid++;
        else if (outcome === 2) o.invalid++;
        o.open = o.open.filter((x) => x !== id);
        const since = o.challengedAt[id];
        if (ts !== null && since !== undefined) { o.ruled++; o.rulingSecsTotal += ts - since; }
        delete o.challengedAt[id];
      }
    } else if (at === lc(a.registry)) {
      const e = decode(REGISTRY_EVENTS_ABI, l);
      if (e?.eventName === "AgentSlashed" && lc(e.args.agent as string) === lc(a.agent)) o.slashes++;
    }
  }
  return out;
}
