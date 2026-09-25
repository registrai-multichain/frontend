"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import type { Hex } from "viem";
import { Dialog } from "@/components/paper/Dialog";
import { MilestoneDisclosure } from "@/components/VerifiedBadge";
import { marketsPerennialAbi } from "@/lib/abi";
import { milestoneMetric } from "@/lib/builder-verification";
import { humanizeError } from "@/lib/humanize-error";
import { marketIdFromLogs, probeAbi, readLatestValue, rememberMarket, type BuilderRow } from "@/lib/perennial-chain";
import { COMPARATOR, expiryOnTheHour, nextMilestoneThreshold, parseDays, parseUsdcInput } from "@/lib/perennial-market";
import { marketQuestion, metricNoun, usdText } from "@/lib/plain-words";
import { sourceLabel } from "@/lib/verified-builders";
import { same, type PerennialData } from "./usePerennialData";
import { D, HUMAN, type PerennialTx } from "./usePerennialTx";

export function CreateMarket({ data, tx, onClose }: { data: PerennialData; tx: PerennialTx; onClose: () => void }) {
  const router = useRouter();
  const ov = data.ov;
  const mp = D.contracts.MarketsPerennial!;
  const [cBuilder, setCBuilder] = useState<number>();
  const [cFeedPick, setCFeedPick] = useState<Hex>();
  const [cDays, setCDays] = useState("7");
  const [cLiq, setCLiq] = useState("5");

  const activeBuilders = data.builders.filter((b) => b.active);
  const createBuilder: BuilderRow | undefined = activeBuilders.find((b) => b.builderId === cBuilder) ?? activeBuilders[0];
  // One of the builder's project feeds, verified first; a legacy builder keeps its one feed.
  const cProjects = (createBuilder?.projects ?? [])
    .filter((p) => p.milestoneFeedId)
    .sort((a, b) => Number(b.status === "verified") - Number(a.status === "verified"));
  const cProject = cProjects.find((p) => same(p.milestoneFeedId, cFeedPick)) ?? cProjects[0];
  const cFeed = cProject?.milestoneFeedId ?? createBuilder?.milestoneFeedId;
  const { data: latest, error: latestError } = useSWR(
    ov && cFeed && D.operator ? ["perennial-latest", ov.attestation, cFeed, D.operator] : null,
    () => readLatestValue(data.publicClient, ov!.attestation, cFeed!, D.operator!),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const { data: cApproved } = useSWR(
    ov?.approvalView && cFeed && D.operator ? ["perennial-approved", mp, cFeed, D.operator] : null,
    async () => (await data.publicClient.readContract({ address: mp, abi: probeAbi, functionName: "isApprovedFeed", args: [cFeed!, D.operator!] })) as boolean,
    { revalidateOnFocus: false },
  );
  // Only from a real on-chain reading: with nothing attested the count is unknown.
  const cThreshold = latest ? nextMilestoneThreshold(latest.value) : undefined;
  const ledgerBal = data.acct?.ledgerBal ?? 0n;
  const blocker: string | undefined = !ov
    ? "Reading markets…"
    : !ov.supportsSettlement
      ? "This network runs the older markets contract. New markets open after its upgrade."
      : !activeBuilders.length
        ? `No active builders on ${D.label} yet.`
        : !D.operator
          ? `No milestone operator is set up on ${D.label}.`
          : !cFeed
            ? `${createBuilder!.name} has no milestone feed yet. The caretaker adds one per verified project.`
            : ov.approvalView && cApproved === false
              ? "This builder's milestone feed isn't approved for new markets."
              : latestError
                ? `Couldn't read the latest count: ${humanizeError(latestError, HUMAN)}`
                : latest === null
                  ? `Waiting for the first count of ${createBuilder!.name}'s milestones. Markets open once it is on-chain.`
                  : cThreshold === undefined
                    ? "Reading the latest count…"
                    : undefined;

  const days = parseDays(cDays);
  const preview =
    createBuilder && cThreshold !== undefined && days.ok && data.chainNow
      ? marketQuestion({
          subject: createBuilder.name,
          metric: metricNoun(cProject?.source ?? createBuilder.source),
          threshold: cThreshold,
          comparator: COMPARATOR.GreaterOrEqual,
          expiry: expiryOnTheHour(data.chainNow + BigInt(days.value * 86_400)),
        })
      : null;

  async function create() {
    if (blocker || !ov || !createBuilder || !cFeed || !D.operator || cThreshold === undefined) return tx.fail(blocker ?? "Not ready.");
    const liq = parseUsdcInput(cLiq, { min: ov.minLiquidity, max: ledgerBal, label: "liquidity" });
    if (!liq.ok) return tx.fail(ledgerBal < ov.minLiquidity ? `Add at least ${usdText(ov.minLiquidity)} to your trading balance first.` : liq.error);
    if (!days.ok) return tx.fail(days.error);
    const builderId = BigInt(createBuilder.builderId);
    const feed = cFeed;
    const agent = D.operator;
    const threshold = cThreshold;
    await tx.run(
      "create",
      async () => {
        const expiry = expiryOnTheHour((await tx.latestChainTime()) + BigInt(days.value * 86_400)); // markets expire on the hour
        const args = [builderId, feed, agent, threshold, COMPARATOR.GreaterOrEqual, expiry, liq.value] as const;
        await tx.publicClient.simulateContract({ address: mp, abi: marketsPerennialAbi, functionName: "createMarket", args, account: tx.address! });
        return tx.walletClient!.writeContract({ address: mp, abi: marketsPerennialAbi, functionName: "createMarket", args, ...tx.w() });
      },
      {
        before: () => tx.ensureLedgerAllowance(mp, liq.value),
        done: preview ? `Opened: ${preview}` : "Market opened.",
        after: (r) => {
          const id = marketIdFromLogs(r.logs, mp);
          onClose();
          if (id) {
            rememberMarket(D, id);
            router.push(`/perennial/?market=${id}`);
          }
        },
      },
    );
  }

  return (
    <Dialog title="Open a market" onClose={onClose}>
      <div className="pa-stack">
        {activeBuilders.length > 0 && (
          <label className="block">
            <span className="pa-label">Builder</span>
            <select className="pa-input" value={createBuilder?.builderId ?? ""} onChange={(e) => { setCBuilder(Number(e.target.value)); setCFeedPick(undefined); }}>
              {activeBuilders.map((b) => <option key={b.builderId} value={b.builderId}>{b.name}</option>)}
            </select>
          </label>
        )}
        {cProjects.length > 1 && (
          <label className="block">
            <span className="pa-label">Project</span>
            <select className="pa-input" value={cProject?.milestoneFeedId ?? ""} onChange={(e) => setCFeedPick(e.target.value as Hex)}>
              {cProjects.map((p) => <option key={p.id} value={p.milestoneFeedId!}>{sourceLabel(p.source)}{p.status === "verified" ? "" : ` (${p.status})`}</option>)}
            </select>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="pa-label">Runs for (days)</span><input className="pa-input" value={cDays} onChange={(e) => setCDays(e.target.value)} inputMode="numeric" /></label>
          <label className="block"><span className="pa-label">Your liquidity (min {ov ? usdText(ov.minLiquidity) : "$5"})</span><input className="pa-input" value={cLiq} onChange={(e) => setCLiq(e.target.value)} inputMode="decimal" /></label>
        </div>
        {preview && (
          <div className="pa-card">
            <p className="pa-small pa-muted">The question will be</p>
            <p className="pa-h3 mt-1">{preview}</p>
            {latest && <p className="pa-small pa-muted mt-1">It&apos;s at {latest.value.toString()} now{latest.finalized ? "" : " (not final yet)"}.</p>}
          </div>
        )}
        {createBuilder && <p className="pa-small pa-muted"><MilestoneDisclosure metric={milestoneMetric(cProject?.source ?? createBuilder.source)} /></p>}
        <p className="pa-small pa-muted">
          You earn 30% of every trading fee on it. Your liquidity comes back when it settles.
          {ledgerBal > 0n ? ` You have ${usdText(ledgerBal)} to use.` : ""}
        </p>
        {blocker && <p className="text-down pa-small">{blocker}</p>}
        <button type="button" className="pa-btn pa-btn--block" onClick={create} disabled={tx.busy || Boolean(blocker)}>
          {tx.pending === "create" ? "Opening…" : "Open market"}
        </button>
      </div>
    </Dialog>
  );
}
