import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { EconomyPanel } from "@/components/EconomyPanel";
import { PERENNIAL, networkStatusLine } from "@/lib/perennial-network";

const ON = PERENNIAL.label;
const DESCRIPTION = `How builders are paid on ${ON}: 50% of every Perennial trading fee is the income of the builder the market is about, taxed progressively per epoch; the tax funds seasonal rewards.`;

export const metadata: Metadata = {
  title: "How it works · Perennial · Registrai",
  description: DESCRIPTION,
  alternates: { canonical: "/perennial/economy" },
  openGraph: {
    title: "How it works · Perennial · Registrai",
    description: DESCRIPTION,
    url: "https://registrai.cc/perennial/economy/",
    images: [{ url: "/social/registrai-landing-regi.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "How it works · Perennial · Registrai",
    description: DESCRIPTION,
    images: ["/social/registrai-landing-regi.png"],
  },
};

export default function EconomyPage() {
  return (
    <PerennialShell>
      <article className="perennial-app-page">
        <header className="perennial-app-header">
          <div>
            <div className="perennial-app-status"><i /> {networkStatusLine(PERENNIAL)}</div>
            <h1>How it works</h1>
            <p>
              Every trade pays a 1% fee. Half of it is the income of the builder the market is about, paid out after each
              epoch; a progressive tax on that income funds a season pool for builders whose progress traders confirmed.
            </p>
          </div>
        </header>
        <EconomyPanel />
      </article>
    </PerennialShell>
  );
}
