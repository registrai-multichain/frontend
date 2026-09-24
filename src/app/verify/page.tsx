import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { VerifyFlow } from "@/components/verify/VerifyFlow";
import { MyBadge } from "@/components/verify/MyBadge";
import { PERENNIAL, networkStatusLine } from "@/lib/perennial-network";

export const metadata: Metadata = {
  title: "Verify your project · Registrai",
  description:
    "Claim your project as a Registrai verified builder: sign a proof with your wallet, publish it in your repo or on your domain, and register on Arc.",
  alternates: { canonical: "/verify" },
  robots: { index: false, follow: true },
};

/**
 * The claim page builders are invited to. Nothing about a builder is public or
 * on-chain until they finish it (spec: docs/superpowers/specs/
 * 2026-09-24-verified-builders-design.md).
 */
export default function VerifyPage() {
  return (
    <PerennialShell>
      <article className="perennial-app-page">
        <header className="perennial-app-header">
          <div>
            <div className="perennial-app-status">
              <i /> {networkStatusLine(PERENNIAL)}
            </div>
            <h1>Verify your project</h1>
            <p>Claim it with your wallet. Nothing about you is public until you finish.</p>
          </div>
        </header>

        <div className="vf-layout">
          <div className="vf-main">
            <MyBadge />
            <VerifyFlow />
          </div>

          <aside className="vf-aside" aria-label="What verifying means">
            <div className="pp-card-label">What this is</div>
            <ul>
              <li>
                A signed statement that this wallet builds this project, published where only you can
                publish it: your repo, or your domain.
              </li>
              <li>
                Once verified, your project appears on the atlas and season boards, and our milestone
                operator bonds a feed that records your releases (open source) or contract deployments
                (closed source).
              </li>
              <li>Seasons are a scoreboard. Nothing on them pays out.</li>
            </ul>
            <div className="pp-card-label">What it isn&apos;t</div>
            <ul>
              <li>
                Not funding. Registrai does not pay builders to verify, and nothing here promises you a
                return.
              </li>
              <li>
                We don&apos;t open markets on you. The community may; a market&apos;s creator earns 30%
                of its trading fees.
              </li>
              <li>
                Milestone markets are builder-triggered: you decide when to ship, so every milestone
                market says so to its traders.
              </li>
            </ul>
            <div className="pp-card-label">What becomes public</div>
            <p>
              Your wallet address, the repo or domain, the deployer addresses you list, and the country
              you declare. Country is self-declared and never decides a reward. Removing the proof file
              takes you off the atlas at the next sync.
            </p>
          </aside>
        </div>
      </article>
    </PerennialShell>
  );
}
