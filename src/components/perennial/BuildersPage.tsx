"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BuilderBadgeSection } from "@/components/BuilderBadgeSection";
import { BuilderIncomeCard } from "@/components/BuilderIncome";
import { BuilderProfile, findDigest } from "@/components/BuilderProfile";
import { BuilderCardView } from "@/components/builders/BuilderCardView";
import { builderFundAbi } from "@/lib/abi";
import { humanizeError } from "@/lib/humanize-error";
import { PERENNIAL_WRITES_ENABLED } from "@/lib/perennial";
import { usdText } from "@/lib/plain-words";
import { rowAvatar } from "@/lib/perennial-view";
import { sourceLabel } from "@/lib/verified-builders";
import type { VerifiedCard } from "@/lib/builders-gallery";
import { parseBuilderParam } from "@/lib/verified-builder-badge";
import { MarketCard } from "./MarketCard";
import { same, usePerennialData } from "./usePerennialData";
import { CHAIN, D, HUMAN, usePerennialTx } from "./usePerennialTx";

const BUILDER_SITE = "https://builder.registrai.cc";

export function BuildersPage({ verified = [] }: { verified?: VerifiedCard[] }) {
  if (!D.deployed) return <BeforeLaunch verified={verified} />;
  return <Suspense fallback={<p className="pa-muted">Reading builders…</p>}><Live /></Suspense>;
}

/** Before Perennial is deployed on this network: the verified builders its markets will pay. */
function BeforeLaunch({ verified }: { verified: VerifiedCard[] }) {
  return (
    <>
      <h1 className="pa-h1 pu-h">Builders</h1>
      <p className="pa-lede">
        The verified builders Perennial markets will pay. Markets aren&apos;t live on {D.label} yet; once they open, half of each trading fee on a
        market about a builder is their income.
      </p>
      <ul className="bld-grid mt-10">
        {verified.map((b) => (
          <BuilderCardView
            key={b.id}
            nameText={b.name}
            name={<a href={`${BUILDER_SITE}/builders/?builder=${b.id}`} className="hover:text-accent">{b.name}</a>}
            avatar={b.avatar && b.avatar.startsWith("/") ? `${BUILDER_SITE}${b.avatar}` : b.avatar}
            tone="ok"
            pill={{ text: "✓ Verified", tone: "ok" }}
            sub={b.source ? sourceLabel(b.source) : undefined}
            facts={[
              { label: "Projects", value: <span className="tnum">{b.projects}</span> },
              { label: "Open markets", value: "At launch" },
            ]}
          />
        ))}
      </ul>
      <p className="pa-muted mt-6">
        {verified.length ? "Building on Arc? " : "No verified builders yet. "}
        <a className="pa-link" href={`${BUILDER_SITE}/verify/`}>Verify your project →</a> · <a className="pa-link" href={BUILDER_SITE}>Every builder</a>
      </p>
    </>
  );
}

function Live() {
  const params = useSearchParams();
  const router = useRouter();
  const focusId = parseBuilderParam(params?.get("builder"));
  const tx = usePerennialTx();
  const data = usePerennialData(tx.address);
  const { ov, acct, acctError } = data;
  const econ = ov?.economy ?? null;
  const myBuilder = tx.address ? data.builders.find((b) => same(b.owner, tx.address)) : undefined;
  const focus = focusId != null ? data.builderById(focusId) : undefined;
  const canClaim = !tx.needsConnect && PERENNIAL_WRITES_ENABLED;

  async function claim(builderId: number, e: bigint) {
    const fund = ov?.economy?.fund;
    if (!fund) return tx.fail("The builder fund isn't live on this network.");
    await tx.run(`claim-${e}`, async () => {
      await tx.publicClient.simulateContract({ address: fund, abi: builderFundAbi, functionName: "claimFor", args: [e, BigInt(builderId)], account: tx.address! });
      return tx.walletClient!.writeContract({ address: fund, abi: builderFundAbi, functionName: "claimFor", args: [e, BigInt(builderId)], ...tx.w() });
    }, { done: `Paid out epoch ${e.toString()}.` });
  }

  const sorted = [...data.builders].sort((a, b) => {
    const d = data.incomeOf(b.builderId) - data.incomeOf(a.builderId);
    return d > 0n ? 1 : d < 0n ? -1 : a.builderId - b.builderId;
  });
  const openCount = (id: number) => data.markets.filter((m) => m.builderId === BigInt(id) && data.statusOf(m).canTrade).length;

  const income = (b: { builderId: number; name: string; active: boolean }) => (
    <BuilderIncomeCard
      client={data.publicClient} deployment={D} fundStatus={ov?.fundStatus} economy={econ}
      builderId={b.builderId} name={b.name} active={b.active} chainNow={data.chainNow}
      canClaim={canClaim} busy={tx.busy} pending={tx.pending} onClaim={(e) => claim(b.builderId, e)}
    />
  );

  return (
    <>
      <h1 className="pa-h1 pu-h">Builders</h1>
      <p className="pa-lede">Every builder these markets pay. Half of each trading fee on a market about a builder is their income, paid out after each epoch.</p>

      <section className="mt-6">
        {tx.needsConnect ? (
          <div className="pa-card pu-card pu-card--static flex flex-wrap items-center justify-between gap-3">
            <p>Are you a builder? Connect to see your income and collect it.</p>
            <button type="button" className="pa-btn pu-btn pu-btn--primary" onClick={tx.connectOrSwitch}>{tx.address ? `Switch to ${D.label}` : "Connect wallet"}</button>
          </div>
        ) : !acct ? (
          <p className="pa-muted">{acctError ? `Couldn't read your builder status: ${humanizeError(acctError, HUMAN)}` : "Reading your builder status…"}</p>
        ) : !acct.registered || !myBuilder ? (
          <div className="pa-card pu-card pu-card--static">
            <h2 className="pa-h3 pu-h">Claim your project</h2>
            <p className="pa-muted mt-1">Sign a proof with this wallet, publish it in your repo or on your domain, then register. Once verified, half of every trading fee on markets about you is your income.</p>
            <a className="pa-btn pu-btn pu-btn--primary mt-3" href="https://builder.registrai.cc/verify/">Verify your project →</a>
          </div>
        ) : (
          <div className="pa-stack">
            <h2 className="pa-h2 pu-h">You · {myBuilder.name}</h2>
            <p className="pa-muted">
              Your income is half of the 1% fee on every market about you. After each epoch anyone can pay it out: a progressive tax goes to the
              season pool, 1% of the rest to Registrai, and the rest to your payout address. <Link className="pa-link" href="/perennial/economy/">How it works</Link>
            </p>
            {income(myBuilder)}
          </div>
        )}
      </section>

      {focus && (
        <section className="mt-10 pa-stack" aria-label={focus.name}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="pa-h2 pu-h">{focus.name}</h2>
            <button type="button" className="pa-link" onClick={() => router.replace("/perennial/builders/", { scroll: false })}>Close</button>
          </div>
          <BuilderBadgeSection builderId={focus.builderId} owner={focus.owner} name={focus.name} source={focus.source} snapshot={focus.badge} viewer={tx.address} />
          {income(focus)}
          <ul className="pa-grid">
            {data.markets.filter((m) => m.builderId === BigInt(focus.builderId)).map((m) => <MarketCard key={m.id} data={data} m={m} />)}
          </ul>
          {findDigest(CHAIN.id, focus.owner) && <BuilderProfile digest={findDigest(CHAIN.id, focus.owner)!} verification={focus.verification} />}
        </section>
      )}

      <ul className="bld-grid mt-10">
        {sorted.map((b) => (
          <BuilderCardView
            key={b.builderId}
            nameText={b.name}
            name={<Link href={`/perennial/builders/?builder=${b.builderId}`} scroll={false} className="hover:text-accent">{b.name}</Link>}
            avatar={rowAvatar(b.projects)}
            tone={b.verification ? "ok" : "plain"}
            pill={{ text: b.verification ? "✓ Verified" : b.active ? "Registered" : "Inactive", tone: b.verification ? "ok" : "muted" }}
            sub={b.source ? sourceLabel(b.source) : b.repo}
            facts={[
              { label: "Earned this epoch", value: econ ? usdText(data.incomeOf(b.builderId)) : "—" },
              { label: "Open markets", value: <span className="tnum">{openCount(b.builderId)}</span> },
            ]}
            grey={!b.active}
            highlighted={focus?.builderId === b.builderId}
          />
        ))}
      </ul>
      {!data.builders.length && <p className="pa-muted mt-6">{ov ? "No builders registered yet." : "Reading builders…"}</p>}
    </>
  );
}
