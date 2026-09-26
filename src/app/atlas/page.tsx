import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { Atlas } from "@/components/Atlas";
import { PERENNIAL, SNAPSHOT_MATCHES_NETWORK, networkStatusLine } from "@/lib/perennial-network";

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
    // No `images` here on purpose: opengraph-image.tsx generates the card from
    // the live season, and an explicit entry would override it.
  },
  twitter: {
    card: "summary_large_image",
    title: "Builder Atlas · Perennial",
    description:
      "Builder density worldwide, and the running season's country, builder and trader boards.",
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
              <i /> {networkStatusLine(PERENNIAL)}
            </div>
            <h1>Builder atlas</h1>
            <p>Where the grind is — by country, by builder, by season.</p>
          </div>
        </header>

        {/* The atlas is baked from a synced snapshot; never show one network's
            snapshot under another network's label. */}
        {PERENNIAL.deployed && SNAPSHOT_MATCHES_NETWORK ? (
          <Atlas />
        ) : (
          <p className="pa-notice">
            The atlas opens with the markets on {PERENNIAL.label}: each verified builder will light up their country. Season 1
            starts 1 Oct.
          </p>
        )}
      </article>
    </PerennialShell>
  );
}
