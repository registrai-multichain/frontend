import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { PerennialPanel } from "@/components/PerennialPanel";
import { FaucetHint } from "@/components/FaucetHint";
import { PerennialViews } from "@/components/PerennialViews";

export const metadata: Metadata = {
  title: "Perennial Markets · Registrai",
  description:
    "Trade builder milestone markets and register projects for progress-based commons payouts on Arc testnet.",
  alternates: { canonical: "/perennial" },
  openGraph: {
    title: "Perennial Markets · Registrai",
    description: "Builder milestone markets and progress-based commons payouts on Arc testnet.",
    url: "https://registrai.cc/perennial/",
    images: [{ url: "/social/registrai-landing.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Perennial Markets · Registrai",
    description: "Builder milestone markets and progress-based commons payouts on Arc testnet.",
    images: ["/social/registrai-landing.png"],
  },
};

export default function PerennialPage() {
  return (
    <PerennialShell>
      <article className="perennial-app-page">
        <header className="perennial-app-header">
          <div>
            <div className="perennial-app-status"><i /> Arc testnet · live</div>
            <h1>Perennial markets</h1>
            <p>Builder milestone markets and progress-based commons payouts.</p>
          </div>
          <div className="perennial-app-actions">
            <PerennialViews />
            <FaucetHint
              className="perennial-app-faucet"
              href="https://faucet.circle.com"
              label="get test USDC"
              hint="Arc Testnet — USDC is also gas"
            />
          </div>
        </header>

        <PerennialPanel />

        <p className="perennial-app-note">
          Testnet only. Markets resolve through the bonded oracle; incorrect attestations are
          challengeable and slashable. GitHub releases and tags are keeper-detected in this MVP.
        </p>
      </article>
    </PerennialShell>
  );
}
