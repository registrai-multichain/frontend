import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { PerennialViews } from "@/components/PerennialViews";
import { WonderMarkets } from "@/components/wonder/WonderMarkets";
import { PERENNIAL, networkStatusLine } from "@/lib/perennial-network";

export const metadata: Metadata = {
  title: "Wonder markets · Perennial · Registrai",
  description: "Markets about nominated projects that have not joined Registrai yet; the team's share of the fees waits for them.",
  alternates: { canonical: "/perennial/wonder" },
  robots: { index: false },
};

export default function WonderPage() {
  return (
    <PerennialShell>
      <article className="perennial-app-page">
        <header className="perennial-app-header">
          <div>
            <div className="perennial-app-status"><i /> {networkStatusLine(PERENNIAL)}</div>
            <h1>Wonder markets</h1>
            <p>
              Markets about projects Registrai nominated before their team joined. Half of each trading fee on a market
              using the project&apos;s milestone feed is held for the team until it claims the project; unclaimed after
              about 180 days, it goes to the season pool.
            </p>
          </div>
          <div className="perennial-app-actions">
            <PerennialViews />
          </div>
        </header>
        <WonderMarkets />
      </article>
    </PerennialShell>
  );
}
