"use client";

import Link from "next/link";
import useSWR from "swr";
import type { PublicClient } from "viem";
import {
  durationText,
  epochState,
  formatUsd,
  marginalRateBps,
  type EpochIncome,
} from "@/lib/builder-economy";
import { readBuilderEpochs, readEconomyHistory, type EconomyOverview } from "@/lib/economy-chain";
import type { FundStatus } from "@/lib/perennial-chain";
import type { PerennialDeployment } from "@/lib/perennial-network";
import { bpsPct } from "@/lib/perennial-market";

const $ = formatUsd;

/** Copy for the two states in which a network shows no builder income. */
export function fundStatusNote(status: FundStatus, label: string): string | undefined {
  if (status === "not-deployed") {
    return `Builder income is not deployed on ${label} yet. Once the BuilderFund is live, 50% of every trading fee on a builder's markets is credited to that builder per epoch and taxed progressively when claimed.`;
  }
  if (status === "unlinked") {
    return `The MarketsPerennial deployed on ${label} predates the BuilderFund: its 50% fee leg goes to the old builder commons, not to the builder the market is about. Builder income starts with the next markets contract.`;
  }
  return undefined;
}

/** The fund's event history for a deployment (shared SWR key: fetched once per page). */
export function useEconomyHistory(client: PublicClient, d: PerennialDeployment, live: boolean) {
  return useSWR(
    live ? ["economy-history", d.chain.id, d.contracts.BuilderFund] : null,
    async () => readEconomyHistory(client, d, (await client.getBlock({ blockTag: "latest" })).number),
    { refreshInterval: 60_000, dedupingInterval: 30_000, revalidateOnFocus: false },
  );
}

function StateCell({ e, onClaim, canClaim, busy, pending }: { e: EpochIncome; onClaim?: (epoch: bigint) => void; canClaim: boolean; busy: boolean; pending: string }) {
  const st = epochState(e);
  if (st === "claimable") {
    if (!onClaim || !canClaim) return <span className="text-accent">claimable</span>;
    return (
      <button type="button" onClick={() => onClaim(e.epoch)} disabled={busy}>
        {pending === `claim-${e.epoch}` ? "…" : "claim"}
      </button>
    );
  }
  if (st === "claimed") return <span className="text-up" title={e.payout ? `paid to ${e.payout}` : undefined}>claimed</span>;
  if (st === "swept") return <span className="text-down" title="The builder was deactivated; its income went to the season pool untaxed.">swept</span>;
  return <span className="text-fg-dim">open</span>;
}

/**
 * One builder's income from the BuilderFund: this epoch so far (with the tax
 * the current schedule would take) and earlier epochs with their split and
 * whether they were claimed. `claimFor` is permissionless: whoever sends it
 * pays gas, and the net always lands on the builder's payout address.
 */
export function BuilderIncomeCard(props: {
  client: PublicClient;
  deployment: PerennialDeployment;
  fundStatus: FundStatus | undefined;
  economy: EconomyOverview | null | undefined;
  builderId: number;
  name: string;
  active: boolean;
  chainNow: bigint | undefined;
  /** A wallet is connected on the right chain and writes are on. */
  canClaim: boolean;
  busy: boolean;
  pending: string;
  onClaim?: (epoch: bigint) => void;
}) {
  const { client, deployment: d, fundStatus, economy: econ, builderId, name, chainNow } = props;
  const live = fundStatus === "live" && Boolean(econ);
  const history = useEconomyHistory(client, d, live);
  const { data: rows, error } = useSWR(
    live && econ && chainNow ? ["builder-epochs", d.chain.id, econ.fund, builderId, econ.epoch.toString(), history.data?.scannedTo.toString() ?? ""] : null,
    () => readBuilderEpochs(client, econ!, builderId, chainNow!, history.data?.ledger),
    { refreshInterval: 30_000, dedupingInterval: 10_000, revalidateOnFocus: false },
  );

  const note = fundStatus ? fundStatusNote(fundStatus, d.label) : undefined;
  const current = rows?.find((r) => econ && r.epoch === econ.epoch);
  const past = rows?.filter((r) => econ && r.epoch !== econ.epoch) ?? [];

  return (
    <div className="pp-action-card pp-income">
      <div className="pp-panel-heading">
        <span>Builder income · {name}</span>
        <b>{econ ? `epoch ${econ.epoch} · ends in ${chainNow ? durationText(econ.epochEndsAt - chainNow) : "…"}` : "BuilderFund"}</b>
      </div>
      {!fundStatus ? (
        <p className="text-2xs text-fg-dim">Reading the BuilderFund…</p>
      ) : note ? (
        <p className="text-2xs text-fg-dim">{note}</p>
      ) : error ? (
        <p className="text-2xs text-down">Couldn&apos;t read this builder&apos;s income: {String((error as Error).message ?? error).split("\n")[0]}</p>
      ) : !rows || !econ ? (
        <p className="text-2xs text-fg-dim">Reading income…</p>
      ) : (
        <>
          <div className="pp-income-now">
            <div><span>this epoch so far</span><strong>{$(current?.gross ?? 0n)}</strong></div>
            <div><span>est. tax</span><strong>{$(current?.tax ?? 0n)}</strong></div>
            <div><span>1% fee</span><strong>{$(current?.fee ?? 0n)}</strong></div>
            <div><span>est. net</span><strong>{$(current?.net ?? 0n)}</strong></div>
          </div>
          <p className="mt-2 text-2xs text-fg-dim">
            50% of every trading fee on {name}&apos;s markets, credited this epoch. The tax is estimated with this
            epoch&apos;s schedule (next dollar taxed at {bpsPct(BigInt(marginalRateBps(current?.gross ?? 0n, econ.schedule)))});
            it is final once the epoch ends. <Link href="/perennial/economy" className="text-accent hover:underline">Tax schedule →</Link>
          </p>
          {!props.active && (
            <p className="mt-2 text-2xs text-down">
              This builder is deactivated: its income is frozen (claims revert) until it is reactivated, or the Safe sweeps
              it to the season pool.
            </p>
          )}
          <div className="pp-income-table" role="table" aria-label="Income by epoch">
            <div role="row" className="pp-income-row is-head">
              <span role="columnheader">epoch</span><span role="columnheader">gross</span><span role="columnheader">tax</span>
              <span role="columnheader">fee</span><span role="columnheader">net</span><span role="columnheader">status</span>
            </div>
            {past.length === 0 ? (
              <div role="row" className="pp-income-row"><span role="cell" className="text-fg-dim">No income in earlier epochs.</span></div>
            ) : past.map((e) => (
              <div role="row" key={e.epoch.toString()} className="pp-income-row">
                <span role="cell">{e.epoch.toString()}</span>
                <span role="cell">{$(e.gross)}</span>
                <span role="cell">{$(e.tax)}</span>
                <span role="cell">{$(e.fee)}</span>
                <span role="cell">{$(e.net)}</span>
                <span role="cell"><StateCell e={e} onClaim={props.onClaim} canClaim={props.canClaim && props.active} busy={props.busy} pending={props.pending} /></span>
              </div>
            ))}
          </div>
          {past.some((e) => epochState(e) === "claimable") && (
            <p className="mt-2 text-2xs text-fg-dim">
              Anyone can send a claim (the keeper does it too): the tax goes to the season pool, 1% of the rest to
              Registrai, and the net to the builder&apos;s payout address, whoever sends it.
              {props.canClaim ? "" : " Connect a wallet to send one."}
            </p>
          )}
          {history.data?.partial && <p className="mt-1 text-2xs text-fg-dim">Still indexing older fund events…</p>}
        </>
      )}
    </div>
  );
}
