import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { VerifyApp } from "@/components/verify/VerifyApp";
import { VerifyHero } from "@/components/verify/VerifyHero";
import { BUILDERS, MARKETS_OPEN_ON_BUILDERS_NETWORK } from "@/lib/builders-network";

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
        <VerifyHero />

        <div className="vf-layout">
          <div className="vf-main">
            <VerifyApp />
          </div>

          <aside className="vf-aside" aria-label="Questions">
            <div className="pp-card-label">Questions</div>
            <details className="vf-faq" open>
              <summary>What do I get?</summary>
              <p>
                Your project listed in the builders gallery, and a soulbound Verified Builder Badge: an NFT in your wallet
                that can&apos;t be transferred, numbered in the order builders are verified.
                {MARKETS_OPEN
                  ? " Our milestone operator also starts recording your releases (open source) or contract deployments (closed source)."
                  : ` When markets open on ${BUILDERS.label}, milestone tracking of your releases or deployments starts too.`}
              </p>
            </details>
            <details className="vf-faq">
              <summary>Does it cost anything?</summary>
              <p>
                No. Signing is free and sends nothing. Registering is one small transaction; if you have no USDC on{" "}
                {BUILDERS.label}, choose &ldquo;we register it for you&rdquo; and the Registrai Safe does it. It works the other way
                too: Registrai doesn&apos;t pay builders to verify. This is a listing, not funding.
              </p>
            </details>
            <details className="vf-faq">
              <summary>Why a file in my repo or on my domain?</summary>
              <p>
                Only you can publish there, so a small signed file proves the project is yours without giving us any access.
                One wallet is one builder, with up to 16 projects, each with its own file.
              </p>
            </details>
            <details className="vf-faq">
              <summary>What becomes public?</summary>
              <p>
                Your wallet address, the repo or domain, any deployer addresses you list, and the country you declare
                (self-declared; it never decides a reward).
              </p>
            </details>
            <details className="vf-faq">
              <summary>Can I undo it?</summary>
              <p>
                Yes. Every proof is re-checked when the gallery loads: delete the file and that project shows as lapsed,
                {MARKETS_OPEN ? " and with no project left your builder leaves the atlas." : " and so does your builder once none is left."}{" "}
                Moving to a new wallet means signing each project&apos;s file again with it.
              </p>
            </details>
            <details className="vf-faq">
              <summary>{MARKETS_OPEN ? "Will you open markets on me?" : "What about markets?"}</summary>
              <p>
                {MARKETS_OPEN
                  ? "No. The community may; a market's creator earns 30% of its trading fees and 50% is your income, taxed progressively per epoch."
                  : "They open later. We won't open markets on you; the community may, and part of their trading fees becomes your income."}{" "}
                Milestone markets are builder-triggered: you decide when to ship, and every milestone market says so to its traders.
              </p>
            </details>
          </aside>
        </div>
      </article>
    </BuildersShell>
  );
}
