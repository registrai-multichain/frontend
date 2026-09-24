import type { Metadata } from "next";
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
          {PERENNIAL.chain.testnet ? "Testnet: test USDC only. " : ""}Markets resolve through the bonded
          oracle on the first valid attestation after expiry; incorrect attestations are challengeable
          and slashable, and a market no attestation settles voids at $0.50 per share. GitHub releases
          and tags are keeper-detected in this MVP.
        </p>
      </article>
    </PerennialShell>
  );
}
