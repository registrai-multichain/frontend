"use client";

import { useMemo } from "react";
import { createPublicClient, type PublicClient } from "viem";
import useSWR from "swr";
import { BUILDERS_NETWORK } from "@/lib/builders-network";
import { transportFor } from "@/lib/chains";
import { epochState, formatUsd, type EpochIncome } from "@/lib/builder-economy";
import { readBuilderEpochs, readEconomy, readEconomyHistory, seasonRewardsOf } from "@/lib/economy-chain";
import { readFundStatus } from "@/lib/perennial-chain";
import { perennialDeploymentFor } from "@/lib/perennial-network";

/** The markets deployment on the builders network: phase 1 mainnet has none. */
const MARKETS = perennialDeploymentFor(BUILDERS_NETWORK);

/** Whether the builder detail shows income at all (BuilderFund + SeasonPool configured). */
export const FUND_ON_BUILDERS_NETWORK = MARKETS.fundDeployed;

const epochLine = (e: EpochIncome | undefined, current: boolean) => {
  if (!e || e.gross === 0n) return "$0";
  const st = epochState(e);
  const tail = current ? `est. net ${formatUsd(e.net)}` : st === "claimable" ? "claimable" : st;
  return `${formatUsd(e.gross)} · ${tail}`;
};

/**
 * Builder income (current and last epoch) and season rewards claimed, for the
 * gallery's detail view. Renders nothing unless the BuilderFund is deployed on
 * the builders network AND the markets there pay it (phase 1 has no fund).
 */
export function BuilderEconomyFacts({ builderId }: { builderId: number }) {
  const client = useMemo(
    () => createPublicClient({ chain: MARKETS.chain.viemChain, transport: transportFor(MARKETS.chain, { batch: true }) }) as PublicClient,
    [],
  );
  const { data } = useSWR(
    FUND_ON_BUILDERS_NETWORK ? ["builder-economy-facts", MARKETS.chain.id, MARKETS.contracts.BuilderFund, builderId] : null,
    async () => {
      if ((await readFundStatus(client, MARKETS)) !== "live") return null;
      const [econ, block] = await Promise.all([
        readEconomy(client, MARKETS.contracts.BuilderFund!, MARKETS.contracts.SeasonPool!),
        client.getBlock({ blockTag: "latest" }),
      ]);
      const history = await readEconomyHistory(client, MARKETS, block.number);
      const rows = await readBuilderEpochs(client, econ, builderId, block.timestamp, history.ledger, 1n);
      return { econ, rows, rewards: seasonRewardsOf(history.ledger, builderId) };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  if (!FUND_ON_BUILDERS_NETWORK || !data) return null;
  const { econ, rows, rewards } = data;
  const current = rows.find((r) => r.epoch === econ.epoch);
  const last = econ.epoch > 0n ? rows.find((r) => r.epoch === econ.epoch - 1n) : undefined;
  const total = rewards.reduce((s, r) => s + r.amount, 0n);
  return (
    <dl className="bld-facts" aria-label="Builder income">
      <div>
        <dt>income, epoch {econ.epoch.toString()}</dt>
        <dd className="tnum">{epochLine(current, true)}</dd>
      </div>
      {econ.epoch > 0n && (
        <div>
          <dt>income, epoch {(econ.epoch - 1n).toString()}</dt>
          <dd className="tnum">{epochLine(last, false)}</dd>
        </div>
      )}
      <div>
        <dt>season rewards</dt>
        <dd className="tnum" title={rewards.map((r) => `season ${r.seasonId}: ${formatUsd(r.amount)}`).join("\n") || undefined}>
          {rewards.length ? `${formatUsd(total)} · ${rewards.length} season${rewards.length === 1 ? "" : "s"}` : "none claimed"}
        </dd>
      </div>
    </dl>
  );
}
