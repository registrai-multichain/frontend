"use client";

import { useMemo, useState } from "react";
import { createPublicClient, type PublicClient } from "viem";
import useSWR from "swr";
import { transportFor } from "@/lib/chains";
import {
  FEE_SPLIT,
  LAUNCH_SCHEDULE,
  SEASON_CAP_BPS,
  durationText,
  effectiveRate,
  formatUsd,
  marginalRateBps,
  seasonCap,
  splitIncome,
  taxTable,
  type Bracket,
} from "@/lib/builder-economy";
import { readEconomy, readSeasons, type EconomyOverview } from "@/lib/economy-chain";
import { readFundStatus, type FundStatus } from "@/lib/perennial-chain";
import { PERENNIAL } from "@/lib/perennial-network";
import { bpsPct, parseUsdcInput } from "@/lib/perennial-market";
import { fundStatusNote, useEconomyHistory } from "./BuilderIncome";

const D = PERENNIAL;
const $ = formatUsd;
/** Whole-dollar bracket bounds with thousands separators ("$10,000"). */
const bound = (v: bigint) => `$${(v / 1_000_000n).toLocaleString("en-US")}`;
const pct = (bps: number) => bpsPct(BigInt(bps));

type Live = { status: FundStatus; econ: EconomyOverview | null; chainNow: bigint };

function TaxTable({ brackets, caption }: { brackets: readonly Bracket[]; caption: string }) {
  return (
    <div className="econ-table" role="table" aria-label={caption}>
      <div role="row" className="econ-row is-head">
        <span role="columnheader">income slice per epoch</span>
        <span role="columnheader">rate</span>
        <span role="columnheader">tax on a full slice</span>
      </div>
      {taxTable(brackets).map((r) => (
        <div role="row" key={r.from.toString()} className="econ-row">
          <span role="cell">{r.to === null ? `above ${bound(r.from)}` : `${bound(r.from)} – ${bound(r.to)}`}</span>
          <span role="cell">{pct(r.rateBps)}</span>
          <span role="cell">{r.bracketTax === null ? "—" : $(r.bracketTax, 0)}</span>
        </div>
      ))}
    </div>
  );
}

function Calculator({ schedules }: { schedules: { label: string; brackets: readonly Bracket[] }[] }) {
  const [raw, setRaw] = useState("60000");
  const [pick, setPick] = useState(0);
  const sched = schedules[Math.min(pick, schedules.length - 1)];
  const parsed = raw.trim() ? parseUsdcInput(raw, { label: "income" }) : undefined;
  const s = parsed?.ok ? splitIncome(parsed.value, sched.brackets) : undefined;
  return (
    <div className="econ-calc">
      <div className="econ-calc-inputs">
        <label className="pp-amount-field">
          <span>Income this epoch</span>
          <input value={raw} onChange={(e) => setRaw(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Builder income in one epoch, USD" />
          <b>USDC</b>
        </label>
        {schedules.length > 1 && (
          <select value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="Tax schedule" className="econ-select">
            {schedules.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}
          </select>
        )}
      </div>
      {parsed && !parsed.ok && <p className="mt-2 text-[13px] text-down">{parsed.error}</p>}
      {s && (
        <div className="econ-calc-out">
          <div><span>gross</span><strong>{$(s.gross)}</strong></div>
          <div><span>tax → season pool</span><strong>{$(s.tax)}</strong><small>{(effectiveRate(s) * 100).toFixed(2)}% effective · next $ at {pct(marginalRateBps(s.gross, sched.brackets))}</small></div>
          <div><span>1% fee → Registrai</span><strong>{$(s.fee)}</strong></div>
          <div><span>net → builder</span><strong>{$(s.net)}</strong></div>
        </div>
      )}
      <p className="mt-2 text-[13px] text-fg-dim">
        Exactly the contract&apos;s math: each rate applies only to its slice, floored per slice to the
        millionth of a dollar (USDC&apos;s 6 decimals); the fee is 1% of what is left after tax, floored; the net takes the rest.
      </p>
    </div>
  );
}

export function EconomyPanel() {
  const client = useMemo(
    () => createPublicClient({ chain: D.chain.viemChain, transport: transportFor(D.chain, { batch: true }) }) as PublicClient,
    [],
  );
  const { data: live, error } = useSWR<Live>(
    D.fundDeployed ? ["economy-page", D.chain.id, D.contracts.BuilderFund] : null,
    async () => {
      const [status, block] = await Promise.all([readFundStatus(client, D), client.getBlock({ blockTag: "latest" })]);
      const econ = status === "live" ? await readEconomy(client, D.contracts.BuilderFund!, D.contracts.SeasonPool!) : null;
      return { status, econ, chainNow: block.timestamp };
    },
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const econ = live?.econ ?? null;
  const history = useEconomyHistory(client, D, Boolean(econ));
  const seasonIds = useMemo(() => Object.keys(history.data?.ledger.seasons ?? {}).map((x) => BigInt(x)), [history.data]);
  const { data: seasons } = useSWR(
    econ && seasonIds.length ? ["economy-seasons", D.chain.id, econ.pool, seasonIds.join(",")] : null,
    () => readSeasons(client, econ!.pool, seasonIds),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  const status: FundStatus = D.fundDeployed ? live?.status ?? "live" : "not-deployed";
  const note = !D.fundDeployed || (live && live.status !== "live") ? fundStatusNote(status, D.label) : undefined;
  const schedules = econ
    ? [
        { label: `epoch ${econ.epoch} (now)`, brackets: econ.schedule },
        ...econ.upcoming.map((u) => ({ label: `from epoch ${u.effectiveEpoch} (announced)`, brackets: u.brackets })),
      ]
    : [{ label: "launch schedule", brackets: LAUNCH_SCHEDULE }];

  return (
    <div className="econ space-y-3">
      {note && (
        <div className="pp-notice border border-line bg-bg-elev p-3 text-[13px] text-fg-dim">
          {note} Until then the numbers below are the launch parameters from the spec, not chain reads.
        </div>
      )}
      {error && <div className="pp-notice border border-down/35 bg-down/5 p-3 text-[13px] text-down">Couldn&apos;t read {D.label}: {String((error as Error).message ?? error).split("\n")[0]}</div>}

      <section className="pa-strip" aria-label="Right now">
        <div className="pa-card"><span className="pa-muted pa-small">Builder income held</span><b>{econ ? $(econ.outstanding) : "—"}</b></div>
        <div className="pa-card"><span className="pa-muted pa-small">Season pool</span><b>{econ ? $(econ.unallocated) : "—"}</b></div>
        <div className="pa-card"><span className="pa-muted pa-small">Reserved for seasons</span><b>{econ ? $(econ.reserved) : "—"}</b></div>
        <div className="pa-card"><span className="pa-muted pa-small">Epoch {econ ? econ.epoch.toString() : ""} ends in</span><b>{econ && live ? durationText(econ.epochEndsAt - live.chainNow) : "—"}</b></div>
      </section>

      <section className="pa-stack">
        <h2 className="pa-h2">Where the money goes</h2>
        <div className="flex flex-wrap items-stretch gap-3">
          <div className="pa-card text-center"><b className="pa-serif block text-[28px]">{bpsPct(BigInt(FEE_SPLIT.tradeFeeBps))}</b>fee on every buy and sell</div>
          <span className="self-center text-accent" aria-hidden="true">→</span>
          <div className="pa-card text-center"><b className="pa-serif block text-[28px]">{pct(FEE_SPLIT.builderBps)}</b>the builder the market is about</div>
          <div className="pa-card text-center"><b className="pa-serif block text-[28px]">{pct(FEE_SPLIT.creatorBps)}</b>whoever opened the market</div>
          <div className="pa-card text-center"><b className="pa-serif block text-[28px]">{pct(FEE_SPLIT.agentBps)}</b>the agent that settles it, held until it does</div>
        </div>
        <p>
          The builder&apos;s share is collected after each epoch; anyone can send the payout (the keeper does it automatically). A progressive tax on
          it goes to the season pool, 1% of the rest pays for the caretaker that watches milestones, and the rest goes to the builder&apos;s payout address.
        </p>
        <p className="pa-muted pa-small">
          If a market is voided, the agent&apos;s held share goes to whoever successfully challenged its answer, otherwise to the season pool. Common
          markets (the 5-minute rounds) keep their own split: 30% creator, 20% agent, 50% Registrai. A deactivated builder&apos;s income can&apos;t be
          paid out; the Safe can move it, untaxed, to the season pool.
        </p>
      </section>

      <section className="pp-action-card">
        <div className="pp-panel-heading"><span>Progressive tax</span><b>{econ ? `schedule of epoch ${econ.epoch}` : "launch schedule"}</b></div>
        <details className="pa-details">
          <summary>Show the full tax table</summary>
          <div className="mt-3">
        <p className="mb-3 text-[13px] text-fg-dim">
          Marginal, like income tax, on a builder&apos;s income per epoch: each rate applies only to the slice inside its
          bracket, so earning more never lowers take-home. E.g. $800 → $0; $60,000 → $0 + $900 + $8,000 + $3,000 = $11,900.
        </p>
        <TaxTable brackets={schedules[0].brackets} caption="Current tax schedule" />
        {econ?.upcoming.map((u) => (
          <div key={u.effectiveEpoch.toString()} className="mt-4">
            <p className="mb-2 text-[13px] text-fg">
              Announced for epoch {u.effectiveEpoch.toString()} onward
              {u.effectiveEpoch === econ.epoch + 1n ? " (final)" : " (may still be replaced this epoch)"}:
            </p>
            <TaxTable brackets={u.brackets} caption={`Schedule from epoch ${u.effectiveEpoch}`} />
          </div>
        ))}
        <p className="mt-3 text-[13px] text-fg-dim">
          The Safe (GOVERNOR) sets a new schedule; it takes effect two epochs later, and an epoch&apos;s schedule is fixed
          once that epoch is next. Bounds enforced on-chain: up to 8 brackets, thresholds strictly increasing, rates
          non-decreasing, none above 40%, and the first bracket 0% up to at least $100.
        </p>
          </div>
        </details>
      </section>

      <section className="pp-action-card">
        <div className="pp-panel-heading"><span>Calculator</span><b>income → tax · fee · net</b></div>
        <Calculator schedules={schedules} />
      </section>

      <section className="pp-action-card">
        <div className="pp-panel-heading"><span>Season pool</span><b>SeasonPool</b></div>
        <p className="text-[13px] text-fg-dim">
          The shared pool: it receives the tax, frozen income swept from deactivated builders, and the agent escrow of
          voided markets nobody successfully challenged. The Safe publishes seasons as merkle roots over (season, builder,
          amount), allocating at most the unallocated balance; builders, or anyone for them, claim with a proof, paid to the
          builder&apos;s payout address. One claim per builder per season, at most {bpsPct(SEASON_CAP_BPS)} of the season
          total per builder (enforced on-chain); after the deadline the Safe may return the unclaimed rest to the pool.
        </p>
        {econ && (
          <div className="econ-calc-out mt-3">
            <div><span>unallocated</span><strong>{$(econ.unallocated)}</strong></div>
            <div><span>reserved</span><strong>{$(econ.reserved)}</strong></div>
            <div><span>funded (all time)</span><strong>{history.data ? $(BigInt(history.data.ledger.funded)) : "…"}</strong></div>
            <div><span>seasons</span><strong>{history.data ? String(seasonIds.length) : "…"}</strong></div>
          </div>
        )}
        <details className="pa-details mt-3">
          <summary>Published seasons and how they are shared</summary>
        {econ && (
          <div className="econ-table mt-3" role="table" aria-label="Published seasons">
            <div role="row" className="econ-row econ-row--season is-head">
              <span role="columnheader">season</span><span role="columnheader">total</span><span role="columnheader">claimed</span>
              <span role="columnheader">cap / builder</span><span role="columnheader">deadline</span>
            </div>
            {!history.data ? (
              <div role="row" className="econ-row"><span role="cell" className="text-fg-dim">Reading SeasonPublished events…</span></div>
            ) : seasonIds.length === 0 ? (
              <div role="row" className="econ-row"><span role="cell" className="text-fg-dim">No season published yet.</span></div>
            ) : (seasons ?? []).map((x) => (
              <div role="row" key={x.seasonId.toString()} className="econ-row econ-row--season">
                <span role="cell">{x.seasonId.toString()}</span>
                <span role="cell">{$(x.total)}</span>
                <span role="cell">{$(x.claimedAmount)} · {Object.keys(history.data!.ledger.seasons[x.seasonId.toString()]?.claimed ?? {}).length} builder(s)</span>
                <span role="cell">{$(seasonCap(x.total))}</span>
                <span role="cell">{new Date(Number(x.deadline) * 1000).toISOString().slice(0, 10)}{x.reclaimed ? " · rest reclaimed" : ""}</span>
              </div>
            ))}
          </div>
        )}
        {history.data?.partial && <p className="mt-1 text-[13px] text-fg-dim">Still indexing older events…</p>}
        <h3 className="econ-sub">Distribution rule v2: building progress traders confirmed</h3>
        <ul className="econ-list">
          <li>Eligible: builders verified with a non-lapsed badge at the season&apos;s end.</li>
          <li>
            Points: √(counted volume in USD), once per builder, over its milestone markets that resolved YES during the
            season with at least $500 counted each. Only positions held at least 24 hours count (a buy sold back sooner
            counts nothing; sells never count), and volume by the builder&apos;s own wallet, the market creator and the
            agent does not count.
          </li>
          <li>Allocation: pro rata by points, at most {bpsPct(SEASON_CAP_BPS)} per builder, the excess re-spread over the uncapped; amounts floored to the 6-decimal unit, the dust stays in the pool.</li>
          <li>
            Anyone can re-derive a season&apos;s root from chain data with <code>frontend/scripts/season-rewards.ts</code>; the rule
            can evolve per season (published with each root), the on-chain caps cannot be bypassed.
          </li>
        </ul>
        </details>
      </section>

      <section className="pp-action-card">
        <div className="pp-panel-heading"><span>Honest limits</span><b>spec</b></div>
        <ul className="econ-list">
          <li>
            A builder can split into several builder identities to stay in low brackets. Each needs its own verified
            projects and markets, and wide brackets keep the saving small. The admin site flags it.
          </li>
          <li>
            Wash trading on one&apos;s own markets recycles about 80% of the fee to oneself (the builder and creator legs), but it
            raises taxable income and earns no season points: own volume is excluded, so season points need other people&apos;s money.
          </li>
          <li>Season distribution is Safe-published: a trusted computation, verifiable by re-running the script.</li>
        </ul>
      </section>
      <details className="pa-details">
        <summary>The fine print</summary>
        <p className="pa-small mt-2">
          {PERENNIAL.chain.testnet ? "Testnet: test USDC only. " : ""}Markets are settled by the
          protocol&apos;s bonded milestone agent (the caretaker operator) on the first valid attestation
          after expiry. Every buy and sell pays a 1% trading fee, 30% to the market creator, 20% to
          the bonded agent (held until the market settles), 50% to the builder the market is about;
          nothing is charged at settlement. The builder&apos;s 50% is its income for the epoch: once
          the epoch ends, anyone can claim it for the builder, which pays a progressive tax to the
          season pool, 1% of the rest to Registrai (the caretaker&apos;s monitoring fee) and the net
          to the builder (see above). An incorrect
          attestation can be challenged and its bond slashed; a market that can&apos;t be settled
          voids, every trader gets their net cost back (what they put in after fees, minus what they
          took out), and the agent&apos;s held 20% goes to a successful challenger, otherwise the
          season pool. GitHub releases and tags are keeper-detected in this MVP.
        </p>
      </details>
    </div>
  );
}
