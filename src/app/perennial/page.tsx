import type { Metadata } from "next";
import Link from "next/link";
import { PerennialShell } from "@/components/PerennialShell";
import { PerennialPanel } from "@/components/PerennialPanel";
import { FaucetHint } from "@/components/FaucetHint";
import { PerennialViews } from "@/components/PerennialViews";
import { PERENNIAL, networkStatusLine } from "@/lib/perennial-network";

const ON = PERENNIAL.label;

export const metadata: Metadata = {
  title: "Perennial Markets · Registrai",
  description:
    `Trade builder milestone markets and register projects for progress-based commons payouts on ${ON}.`,
  alternates: { canonical: "/perennial" },
  openGraph: {
    title: "Perennial Markets · Registrai",
    description: `Builder milestone markets and progress-based commons payouts on ${ON}.`,
    url: "https://registrai.cc/perennial/",
    images: [{ url: "/social/registrai-landing-regi.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Perennial Markets · Registrai",
    description: `Builder milestone markets and progress-based commons payouts on ${ON}.`,
    images: ["/social/registrai-landing-regi.png"],
  },
};

export default function PerennialPage() {
  return (
    <PerennialShell>
      <article className="perennial-app-page">
        <header className="perennial-app-header">
          <div>
            <div className="perennial-app-status"><i /> {networkStatusLine(PERENNIAL)}</div>
            <h1>Perennial markets</h1>
            <p>Builder milestone markets and progress-based commons payouts.</p>
            <div className="vf-invite mt-3">
              Building on Arc? <Link href="/verify">Verify your project →</Link>
            </div>
          </div>
          <div className="perennial-app-actions">
            <PerennialViews />
            {PERENNIAL.chain.testnet && (
              <FaucetHint
                className="perennial-app-faucet"
                href="https://faucet.circle.com"
                label="get test USDC"
                hint="Arc Testnet — USDC is also gas"
              />
            )}
          </div>
        </header>

        <PerennialPanel />

        <p className="perennial-app-note">
          {PERENNIAL.chain.testnet ? "Testnet: test USDC only. " : ""}Markets are settled by the
          protocol&apos;s bonded milestone agent (the caretaker operator) on the first valid attestation
          after expiry. Every buy and sell pays a 1% trading fee, 30% to the market creator, 20% to
          the bonded agent (held until the market settles), 50% to the builder commons; nothing is
          charged at settlement. Builders are paid from the
          commons by verified progress, minus Registrai&apos;s 1% monitoring fee. An incorrect attestation
          can be challenged and its bond slashed; a market that can&apos;t be settled voids, every
          trader gets their net cost back (what they put in after fees, minus what they took out), and
          the agent&apos;s held 20% goes to a successful challenger, otherwise the commons. GitHub
          releases and tags are
          keeper-detected in this MVP.
        </p>
      </article>
    </PerennialShell>
  );
}
