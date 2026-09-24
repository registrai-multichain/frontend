import type { Metadata } from "next";
import Link from "next/link";
import { BuildersShell } from "@/components/BuildersShell";
import { VerifyApp } from "@/components/verify/VerifyApp";
import { BUILDERS, MARKETS_OPEN_ON_BUILDERS_NETWORK, buildersStatusLine } from "@/lib/builders-network";

/** Milestone feeds and markets exist where claims register (not in mainnet phase 1). */
const MARKETS_OPEN = MARKETS_OPEN_ON_BUILDERS_NETWORK;

export const metadata: Metadata = {
  title: "Verify your project · Registrai",
  description:
    "Claim your projects as a Registrai verified builder: sign a proof with your wallet, publish it in your repo or on your domain, and register on Arc.",
  alternates: { canonical: "/verify" },
  robots: { index: false, follow: true },
};

/**
 * The claim page builders are invited to. Nothing about a builder is public or
 * on-chain until they finish it (spec: docs/superpowers/specs/
 * 2026-09-24-verified-builders-design.md; projects, transfer and recovery:
 * 2026-09-24-builder-projects-design.md). A builder registers once and then
 * adds projects, each with its own proof.
 */
export default function VerifyPage() {
  return (
    <BuildersShell wallet>
      <article className="perennial-app-page">
        <header className="perennial-app-header">
          <div>
            <div className="perennial-app-status">
              <i /> {buildersStatusLine(BUILDERS)}
            </div>
            <h1>Verify your project</h1>
            <p>Claim it with your wallet. Nothing about you is public until you finish.</p>
            <div className="vf-invite mt-3">
              <Link href="/builders">See who&apos;s verified →</Link>
            </div>
          </div>
        </header>

        <div className="vf-layout">
          <div className="vf-main">
            <VerifyApp />
          </div>

          <aside className="vf-aside" aria-label="What verifying means">
            <div className="pp-card-label">What this is</div>
            <ul>
              <li>
                A signed statement that this wallet builds this project, published where only you can
                publish it: your repo, or your domain. One wallet is one builder; add up to 16 projects,
                each with its own proof.
              </li>
              {MARKETS_OPEN ? (
                <>
                  <li>
                    Once verified, your project appears on the atlas and season boards, and our milestone
                    operator bonds a feed that records your releases (open source) or contract deployments
                    (closed source).
                  </li>
                  <li>Seasons are a scoreboard. Nothing on them pays out.</li>
                </>
              ) : (
                <>
                  <li>
                    Once verified, your project appears in the builders gallery with a soulbound Verified
                    Builder Badge, numbered in the order builders are verified.
                  </li>
                  <li>
                    Milestone tracking (your releases, or the contracts your deployers create) starts when
                    markets open on {BUILDERS.label}.
                  </li>
                </>
              )}
            </ul>
            <div className="pp-card-label">What it isn&apos;t</div>
            <ul>
              <li>
                Not funding. Registrai does not pay builders to verify, and nothing here promises you a
                return.
              </li>
              {MARKETS_OPEN ? (
                <li>
                  We don&apos;t open markets on you. The community may; a market&apos;s creator earns 30% of its trading
                  fees, and 50% is your income, taxed progressively per epoch.
                </li>
              ) : (
                <li>
                  Markets open later. When they do, we won&apos;t open markets on you; the community may, and part of their
                  trading fees becomes your income.
                </li>
              )}
              <li>
                Milestone markets are builder-triggered: you decide when to ship, so every milestone
                market says so to its traders.
              </li>
            </ul>
            <div className="pp-card-label">What becomes public</div>
            <p>
              Your wallet address, the repo or domain, the deployer addresses you list, and the country
              you declare. Country is self-declared and never decides a reward. Every proof is re-checked
              whenever the gallery loads: removing the proof file marks that project lapsed; with no verified
              project left your builder lapses{MARKETS_OPEN ? " and leaves the atlas" : ""}. Moving to a new wallet means re-signing
              every project&apos;s proof with it.
            </p>
          </aside>
        </div>
      </article>
    </BuildersShell>
  );
}
