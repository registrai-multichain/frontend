import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { PerennialViews } from "@/components/PerennialViews";
import { Atlas } from "@/components/Atlas";

export const metadata: Metadata = {
  title: "Builder Atlas · Perennial",
  description:
    "Perennial seen geographically and by season: builder density worldwide, and the running season's country, builder and trader boards.",
  alternates: { canonical: "/atlas" },
  openGraph: {
    title: "Builder Atlas · Perennial",
    description:
      "Builder density worldwide, and the running season's country, builder and trader boards.",
    url: "https://registrai.cc/atlas/",
    images: [{ url: "/social/registrai-landing.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Builder Atlas · Perennial",
    description:
      "Builder density worldwide, and the running season's country, builder and trader boards.",
    images: ["/social/registrai-landing.png"],
  },
};

/**
 * The atlas is a view of Perennial, not a separate product — same shell, same
 * theme, reached through the same switcher as the markets view.
 */
export default function AtlasPage() {
  return (
    <PerennialShell>
      <article className="perennial-app-page">
        <header className="perennial-app-header">
          <div>
            <div className="perennial-app-status">
              <i /> Arc testnet · live
            </div>
            <h1>Builder atlas</h1>
            <p>Where the grind is — by country, by builder, by season.</p>
          </div>
          <PerennialViews />
        </header>

        <Atlas />
      </article>
    </PerennialShell>
  );
}
