import type { Metadata } from "next";
import Link from "next/link";
import { BuildersShell } from "@/components/BuildersShell";
import { PILOT_MAX_LEV_DEFAULT, REGI_MIN_DEFAULT } from "@/lib/abi-pilot-api";
import { PILOT_COPY, PILOT_DISCLAIMERS } from "@/lib/abi-pilot-copy";
import { RULES } from "@/lib/abi-pilot";

export const metadata: Metadata = {
  title: "Points pilot rules · Registrai",
  description: "How the points pilot on ABI, AII and AEI works: eligibility, markets, orders, leverage, funding, borrow, liquidation and the points economy.",
  alternates: { canonical: "/pilot-rules" },
  // own share tags: the root layout's carry the landing page's line and image (audit L12)
  openGraph: { type: "website", siteName: "Registrai", title: "Points pilot rules · Registrai", description: "How the points pilot on ABI, AII and AEI works: eligibility, markets, orders, leverage, funding, borrow, liquidation and the points economy.", url: "https://builder.registrai.cc/pilot-rules/" },
  twitter: { card: "summary", title: "Points pilot rules · Registrai", description: "How the points pilot on ABI, AII and AEI works: eligibility, markets, orders, leverage, funding, borrow, liquidation and the points economy." },
};

const H = ({ children }: { children: React.ReactNode }) => <h2 className="pa-h2 mt-8 mb-2">{children}</h2>;

/** builder.registrai.cc/pilot-rules: the points pilot's rules in one place. The texts are the ticket's own (abi-pilot-copy.ts), so they
 * follow the engine's RULES; the leverage cap and REGI minimum shown are the defaults (PILOT_MAX_LEV, PILOT_REGI_MIN). */
export default function PilotRulesPage() {
  return (
    <BuildersShell>
      <article className="perennial-app-page pa-legal">
        <header className="mb-6">
          <h1 className="pa-h1">Points pilot rules</h1>
          <p className="pa-muted">These rules are part of the <Link href="/terms/">Terms of use</Link>. We may change them; this page shows the current version.</p>
        </header>

        <ul className="pa-list">{PILOT_DISCLAIMERS.map((d) => <li key={d}><strong>{d}</strong></li>)}</ul>

        <H>Who can join</H>
        <ul className="pa-list">
          <li>You must be 18 or older and accept the Terms; sign-in asks you to confirm both.</li>
          <li>{PILOT_COPY.holdRegi(REGI_MIN_DEFAULT)} You must hold it when you place each order; the balance is checked at that moment. Closing a position needs no REGI.</li>
          <li>The leaderboard lists only wallets that currently hold the REGI minimum.</li>
          <li>One person, one wallet. Starting balance {RULES.startBalance.toLocaleString("en-US")} points, once per wallet per season, for all three markets.</li>
          <li>{PILOT_COPY.signInNote}</li>
        </ul>

        <H>Markets</H>
        <ul className="pa-list">
          <li>The pilot trades three markets, one per Arc index: ABI (Arc Builders Index), AII (Arc Integrations Index) and AEI (Arc Ecosystem Index).</li>
          <li>One points balance per wallet covers all three. Every open and close is paid from and back to it.</li>
          <li>One direction at a time in each market: you can be long ABI and short AII, not long and short ABI. Up to {RULES.maxOpen} open positions per market.</li>
          <li>Each market has its own mark, funding rates, house, fee pool, insurance and weekly split. The same rules apply in all three. AII has no base layer, so the base-sample pause doesn&apos;t apply there.</li>
        </ul>

        <H>Orders and leverage</H>
        <p>{PILOT_COPY.rulesTip}</p>
        <p>Leverage is currently capped at {PILOT_MAX_LEV_DEFAULT}×.</p>

        <H>Funding</H>
        <p>{PILOT_COPY.fundingTip}</p>
        <p>{PILOT_COPY.bookTip}</p>

        <H>Borrow</H>
        <p>{PILOT_COPY.borrowTip}</p>

        <H>Liquidation and milestones</H>
        <p>{PILOT_COPY.liqTip}</p>
        <p>{PILOT_COPY.milestoneTip}</p>
        <p>{PILOT_COPY.insuranceTip}</p>

        <H>The house and the points economy</H>
        <p>{PILOT_COPY.economyTip}</p>
        <p>{PILOT_COPY.houseLinesTip}</p>
        <p>These figures are bookkeeping in points inside the game. They are not payments and not a commitment to buy REGI or anything else.</p>

        <H>Leaderboard</H>
        <p>{PILOT_COPY.leaderboardTip} It shows a shortened wallet address.</p>

        <H>Fair play</H>
        <p>
          Moving the index on purpose to profit in the pilot, running several wallets, or exploiting bugs isn&apos;t allowed; we may reset or
          remove the points, positions or accounts involved. We may also pause trading, change parameters, start a new season or end the pilot.
        </p>
      </article>
    </BuildersShell>
  );
}
