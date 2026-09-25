"use client";

import Link from "next/link";
import useSWR from "swr";
import { BuilderProfile, findDigest } from "@/components/BuilderProfile";
import { MilestoneDisclosure, VerifiedBadge } from "@/components/VerifiedBadge";
import { MarketLabels } from "@/components/wonder/MarketLabels";
import { milestoneMetric } from "@/lib/builder-verification";
import type { ChainMarket } from "@/lib/perennial-chain";
import { readLatestValue } from "@/lib/perennial-chain";
import { formatUsdc } from "@/lib/perennial-market";
import { readingNow, settlesText, statusShort, timeLeft, usdText, when, whenUtc, who } from "@/lib/plain-words";
import { potOf, yesPct } from "@/lib/perennial-view";
import { CopyButton } from "./CopyButton";
import { TradeTicket } from "./TradeTicket";
import { same, type PerennialData } from "./usePerennialData";
import { CHAIN, D, addressUrl, type PerennialTx } from "./usePerennialTx";

export function MarketPage({ data, tx, market: m, initialSide }: { data: PerennialData; tx: PerennialTx; market: ChainMarket; initialSide?: "Yes" | "No" }) {
  const st = data.statusOf(m);
  const wonder = data.isWonder(m);
  const b = wonder ? undefined : data.builderById(m.builderId);
  const metric = data.metricFor(m);
  const subject = data.subjectFor(m);
  const yp = yesPct(m);
  const pos = data.positionOf(m);
  const ov = data.ov;

  const { data: latest } = useSWR(
    ov && st.canTrade && metric ? ["perennial-latest", ov.attestation, m.feedId, m.agent] : null,
    () => readLatestValue(data.publicClient, ov!.attestation, m.feedId, m.agent),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );

  // Who resolves it, and whether they are also a party to the market.
  const roles: string[] = [];
  if (same(m.agent, b?.owner)) roles.push("the builder this market is about");
  if (same(m.agent, m.creator)) roles.push("the person who opened it (they earn the creator's share)");
  const disclosure = roles.length ? `Heads-up: the result is reported by ${roles.join(" and ")}.` : undefined;

  const names: Record<string, string> = {};
  if (b) names[b.owner.toLowerCase()] = b.name;
  if (D.operator) names[D.operator.toLowerCase()] = "the Registrai caretaker";
  const digest = b ? findDigest(CHAIN.id, b.owner) : undefined;
  const reading = latest === undefined ? null : readingNow(latest === null ? null : latest.value);
  const holds = pos.yes > 0n || pos.no > 0n || pos.lp > 0n;

  const Addr = ({ a }: { a: string }) => (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <a className="pa-mono pa-link" href={addressUrl(a)} target="_blank" rel="noreferrer">{a}</a>
      <CopyButton text={a} />
    </span>
  );

  return (
    <div>
      <Link href="/perennial/" className="pa-muted hover:text-fg">← All markets</Link>
      <div className="pa-market mt-4">
        <div>
          <span className="pa-pill" data-tone={wonder ? "unclaimed" : undefined}>
            {wonder ? `Unclaimed · ${subject}` : `${subject}${metric ? ` · ${metric}` : ""}`}
          </span>
          <h1 className="pa-h1 mt-3">{data.questionFor(m)}</h1>
          <p className="pa-muted mt-2">
            {st.canTrade ? `Closes ${when(m.expiry)} · ${timeLeft(data.chainNow, m.expiry)}` : statusShort(st.key)} · {usdText(potOf(m))} in the pot
          </p>
          <MarketLabels subject={m.subject} />

          <div className="mt-6 flex items-baseline gap-3">
            <span className="pa-serif text-up" style={{ fontSize: 44, lineHeight: 1 }}>{yp}%</span>
            <span className="pa-muted">chance of Yes, by today&apos;s price</span>
          </div>
          <div className="pa-bar mt-3"><i style={{ width: `${yp}%` }} /></div>

          <section className="mt-8 pa-stack">
            <h2 className="pa-h3">How this settles</h2>
            <p>
              {settlesText({
                subject, metric, threshold: m.threshold, comparator: m.comparator, expiry: m.expiry,
                windowSecs: ov?.settlementWindow !== undefined ? Number(ov.settlementWindow) : undefined,
                voidRefund: ov?.feeModel.kind === "trade" ? "net-cost" : "half",
                legacy: ov ? !ov.supportsSettlement : false,
              })}
              {reading && ` ${reading}`}
            </p>
            {data.isMilestoneMarket(m) && <p className="pa-muted pa-small"><MilestoneDisclosure metric={milestoneMetric(data.sourceFor(m))} /></p>}
            {disclosure && <p className="text-down pa-small">{disclosure}</p>}
          </section>

          <section className="mt-8 pa-stack">
            <h2 className="pa-h3">Who it pays</h2>
            {wonder ? (
              <p>Half of every fee here waits for {subject}&apos;s team until they claim the project.</p>
            ) : b ? (
              <p>
                <Link className="pa-link" href={`/perennial/builders/?builder=${b.builderId}`}>{b.name}</Link>{" "}
                <VerifiedBadge verification={b.verification} /> gets half of every fee here. They have earned{" "}
                <b>{usdText(data.incomeOf(b.builderId))}</b> from all their markets this epoch.
              </p>
            ) : (
              <p className="pa-muted">Builder #{m.builderId.toString()}.</p>
            )}
          </section>

          {holds && (
            <section className="mt-8">
              <h2 className="pa-h3 mb-2">Your position</h2>
              <div className="pa-card">
                {pos.yes > 0n && <div className="pa-kv"><span>Yes shares</span><span>{formatUsdc(pos.yes, 2)} · pays {usdText(pos.yes)} if Yes</span></div>}
                {pos.no > 0n && <div className="pa-kv"><span>No shares</span><span>{formatUsdc(pos.no, 2)} · pays {usdText(pos.no)} if No</span></div>}
                {pos.netCost !== undefined && <div className="pa-kv"><span>You paid, net</span><span>{usdText(pos.netCost)}</span></div>}
                {pos.lp > 0n && <div className="pa-kv"><span>Liquidity you added</span><span>{formatUsdc(pos.lp, 2)} shares</span></div>}
              </div>
            </section>
          )}

          {digest && (
            <section className="mt-8">
              <BuilderProfile digest={digest} verification={b?.verification} milestone={<span className="pa-small pa-muted">{data.questionFor(m)}</span>} />
            </section>
          )}

          <details className="pa-details mt-8">
            <summary>Details: market, feed and contract addresses</summary>
            <div className="mt-2">
              <div className="pa-kv"><span>Market</span><span className="pa-mono">{m.id}</span></div>
              <div className="pa-kv"><span>Feed</span><span className="pa-mono">{m.feedId}</span></div>
              <div className="pa-kv"><span>Reported by</span><span>{who(m.agent, { me: tx.address, names })}</span></div>
              <div className="pa-kv"><span>Agent address</span><Addr a={m.agent} /></div>
              <div className="pa-kv"><span>Opened by</span><span>{who(m.creator, { me: tx.address, names })}</span></div>
              <div className="pa-kv"><span>Creator address</span><Addr a={m.creator} /></div>
              <div className="pa-kv"><span>Closes (UTC)</span><span>{whenUtc(m.expiry)}</span></div>
              <div className="pa-kv"><span>Liquidity seeded</span><span>{usdText(m.seeded)}</span></div>
              {m.agentEscrow !== undefined && <div className="pa-kv"><span>Agent&apos;s fee share held</span><span>{usdText(m.agentEscrow)}</span></div>}
            </div>
          </details>
        </div>

        <div className="pa-ticket">
          <div className="pa-card">
            <TradeTicket data={data} tx={tx} market={m} initialSide={initialSide} />
          </div>
        </div>
      </div>
    </div>
  );
}
