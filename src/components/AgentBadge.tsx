"use client";

import useSWR from "swr";
import type { Address, Hex, PublicClient } from "viem";
import {
  CAUGHT_BANNER,
  assessAgent,
  coverageLabel,
  coverageWarning,
  multiplierLabel,
  openMarketsFor,
  usd,
  type AgentAssessment,
} from "@/lib/reputation";
import {
  freshCatchFor,
  readAgentBond,
  readOpenCollateral,
  reputationSnapshot,
  resolveStack,
  scanInvalidRulings,
  type CandidateMarket,
  type MarketFlavor,
  type ReputationStack,
} from "@/lib/reputation-chain";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Without a snapshot, how far back the live scan looks for rulings. */
const UNINDEXED_LOOKBACK = 100_000n;

export interface AgentReputationParams {
  client: PublicClient;
  chainId: number;
  /** The market contract (MarketsPerennial or MarketsV4). */
  market: Address | null | undefined;
  flavor: MarketFlavor;
  marketId: Hex | undefined;
  agent: Address | undefined;
  feed: Hex | undefined;
  /** Markets already read (Perennial overview); the snapshot's open markets are added. */
  candidates?: CandidateMarket[];
  /** Addresses to use when the chain won't name them. */
  fallback?: ReputationStack;
}

export interface AgentReputation {
  assessment?: AgentAssessment;
  /** Ruling scan hasn't reached every block since the snapshot yet. */
  partialScan?: boolean;
  /** The Dispute contract the rulings come from (for an explorer link). */
  dispute?: Address;
  loading: boolean;
}

/**
 * Snapshot reputation + live bond, open collateral and fresh Invalid rulings
 * for one market's agent. Every read is soft: what can't be read is left out.
 */
export function useAgentReputation(p: AgentReputationParams): AgentReputation {
  const { client, chainId, market, flavor, marketId, agent, feed, candidates = [], fallback } = p;
  const candKey = candidates.map((c) => `${c.id}:${c.phase ?? ""}:${c.collateral ?? ""}`).join(",");
  const { data, error, isLoading } = useSWR(
    market && marketId && agent && feed ? ["agent-reputation", chainId, market, marketId, agent, feed, candKey] : null,
    async () => {
      const snap = reputationSnapshot(chainId, market);
      const record = snap?.agents[agent!.toLowerCase()] ?? null;
      const stack = await resolveStack(client, market!, fallback);
      const head = await client.getBlockNumber();
      const since = snap ? BigInt(snap.cursor.lastScannedBlock) : head > UNINDEXED_LOOKBACK ? head - UNINDEXED_LOOKBACK : 0n;
      const snapOpen = openMarketsFor(snap, market!, agent!, feed!).map((id) => ({ id: id as Hex }));
      const [bond, openCollateral, scan] = await Promise.all([
        readAgentBond(client, stack.registry, feed!, agent!),
        readOpenCollateral(client, market!, flavor, agent!, feed!, marketId!, [...candidates, ...snapOpen, { id: marketId! }]),
        stack.dispute ? scanInvalidRulings(client, stack.dispute, stack.attestation, since, head) : Promise.resolve(undefined),
      ]);
      const fresh = scan ? freshCatchFor(scan.rulings, agent!, Number(since)) : undefined;
      return {
        assessment: assessAgent({ record, indexed: Boolean(snap), fresh, bond, openCollateral }),
        partialScan: scan?.partial,
        dispute: stack.dispute,
      };
    },
    { refreshInterval: 60_000, dedupingInterval: 20_000, revalidateOnFocus: false, keepPreviousData: true },
  );
  if (error) console.error("agent reputation", error);
  return { assessment: data?.assessment, partialScan: data?.partialScan, dispute: data?.dispute, loading: isLoading };
}

/** Level, score and coverage for a market's agent, plus the coverage warning when < 100%. */
export function AgentBadge({ agent, rep, className = "" }: { agent: Address | undefined; rep: AgentReputation; className?: string }) {
  const a = rep.assessment;
  if (!agent) return null;
  const cov = a ? coverageLabel(a) : undefined;
  const warning = a ? coverageWarning(a) : undefined;
  const tierClass = a?.tier === "thin" ? "text-down" : a?.tier === "partial" ? "text-accent" : "text-up";
  return (
    <div className={`agent-badge text-[13px] ${className}`} data-level={a?.level}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[13px] text-fg-mute">
        <span className="text-fg-dim">agent {short(agent)}</span>
        {a ? (
          <>
            <span className="border border-line px-1.5 py-px text-fg" title={`Level ${a.level}: recommended bond ${multiplierLabel(a.level)} the base rate`}>
              level {a.level} · {multiplierLabel(a.level)}
            </span>
            <span title="Trading volume of markets this agent settled correctly">score {usd(a.score)}</span>
            <span>{a.settledMarkets} settled</span>
            {a.caught && <span className="text-down">caught</span>}
            {cov && (
              <span className={tierClass} title={a.recommended !== undefined ? `bond ${usd(a.bond ?? 0n)} vs recommended ${usd(a.recommended)}` : undefined}>
                {cov}
              </span>
            )}
          </>
        ) : (
          <span>{rep.loading ? "reading reputation…" : "reputation unavailable"}</span>
        )}
      </div>
      {warning && <p className={`mt-1 ${a?.tier === "thin" ? "text-down" : "text-accent"}`}>{warning}</p>}
      {a && !a.indexed && (
        <p className="mt-1 text-fg-dim">No reputation snapshot for this network yet, so the agent is treated as new (level 1).</p>
      )}
    </div>
  );
}

/** Prominent notice when the agent has an AttestationInvalid ruling against it. */
export function CaughtAgentBanner({
  rep,
  explorer,
  className = "",
}: {
  rep: AgentReputation;
  className?: string;
  /** Explorer base URL, e.g. https://testnet.arcscan.app */
  explorer: string;
}) {
  const a = rep.assessment;
  if (!a?.caught) return null;
  // The ruling's transaction when known; else the Dispute contract it came from.
  const dispute = rep.dispute;
  const href = a.caughtTx ? `${explorer}/tx/${a.caughtTx}` : dispute ? `${explorer}/address/${dispute}` : undefined;
  return (
    <div className={`caught-banner border border-down/50 bg-down/10 p-3 text-[13px] text-down ${className}`} role="alert">
      <strong className="block text-[13px]">{CAUGHT_BANNER}.</strong>
      <span className="text-fg-mute">
        A dispute ruled one of its answers invalid, so its reputation was reset. This market keeps trading; you can sell your
        position at any time before it closes.
      </span>{" "}
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          {a.caughtTx ? "view the ruling ↗" : `dispute ${a.disputeId ? short(a.disputeId) : ""} ↗`}
        </a>
      )}
    </div>
  );
}
