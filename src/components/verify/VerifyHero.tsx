"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { BUILDERS, buildersStatusLine } from "@/lib/builders-network";
import { parseSourceParam } from "@/lib/builders-gallery";
import { badgeAbi } from "@/lib/verified-builder-badge";
import { sourceLabel } from "@/lib/verified-builders";
import { nextBadgeImage, nextBadgeLine } from "@/lib/verify-invite";
import { buildersClient } from "./useMyBuilder";

const BADGE = BUILDERS.badgesOn ? BUILDERS.contracts.VerifiedBuilderBadge : undefined;
const NET = BUILDERS.badgeNetwork ?? "arc";

/**
 * /verify's header. From a claim link (`?source=…`) it greets the invitee by
 * project and shows the badge they would get with the next serial, read live;
 * otherwise the generic header. Three facts either way: time, cost, gas.
 */
export function VerifyHero() {
  return (
    <Suspense fallback={<HeroView source={null} />}>
      <HeroFromParams />
    </Suspense>
  );
}

function HeroFromParams() {
  const params = useSearchParams();
  return <HeroView source={parseSourceParam(params?.get("source"))?.source ?? null} />;
}

function HeroView({ source }: { source: string | null }) {
  const { data: next } = useSWR(
    BADGE ? ["verify-next-serial", BUILDERS.chainId, BADGE] : null,
    async () => Number(await buildersClient().readContract({ address: BADGE!, abi: badgeAbi, functionName: "nextSerial" })),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const nextLine = nextBadgeLine(next);
  return (
    <header className="perennial-app-header vf-hero">
      <div className="vf-hero-text">
        <div className="perennial-app-status">
          <i /> {buildersStatusLine(BUILDERS)}
        </div>
        {source ? (
          <>
            <p className="vf-hero-kicker">You&apos;re invited</p>
            <h1>
              List <span className="vf-hero-source">{sourceLabel(source)}</span> as a verified builder on Arc
            </h1>
            <p>Claim it with your wallet and get a soulbound Verified Builder Badge. Nothing about you is public until you finish.</p>
          </>
        ) : (
          <>
            <h1>Verify your project</h1>
            <p>Claim it with your wallet and get a soulbound Verified Builder Badge. Nothing about you is public until you finish.</p>
          </>
        )}
        <ul className="vf-facts">
          <li>
            <b>~5 min</b>
            <span>start to finish</span>
          </li>
          <li>
            <b>Free</b>
            <span>signing sends nothing</span>
          </li>
          <li>
            <b>No gas needed</b>
            <span>we can register it for you</span>
          </li>
        </ul>
        <div className="vf-invite">
          <Link href="/builders">See who&apos;s verified →</Link>
        </div>
      </div>
      {BADGE && (
        <figure className="vf-hero-badge">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimizer */}
          <img src={nextBadgeImage(NET, next)} alt="Registrai Verified Builder Badge" width={168} height={168} decoding="async" />
          <figcaption>
            Soulbound, numbered in the order builders are verified.
            {nextLine && <b>{nextLine}</b>}
          </figcaption>
        </figure>
      )}
    </header>
  );
}
