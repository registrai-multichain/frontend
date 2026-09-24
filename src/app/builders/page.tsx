import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { BuildersGallery } from "@/components/builders/BuildersGallery";
import { BUILDERS } from "@/lib/builders-network";
import { parseGallerySnapshot, parseNominees } from "@/lib/builders-gallery";
import live from "@/lib/live-data.json";
import nominees from "@/data/nominees.json";

const DESCRIPTION =
  "Every project building on Arc that claimed its place with a signed proof: verified builders with their soulbound badge, builders awaiting onboarding, and projects invited to claim.";

export const metadata: Metadata = {
  title: "Verified builders · Registrai",
  description: DESCRIPTION,
  alternates: { canonical: "/builders" },
  openGraph: {
    title: "Verified builders · Registrai",
    description: DESCRIPTION,
    url: "https://builder.registrai.cc/builders/",
    images: [{ url: "/social/registrai-landing-regi.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Verified builders · Registrai",
    description: DESCRIPTION,
    images: ["/social/registrai-landing-regi.png"],
  },
};

/**
 * The builders gallery. Works with the builder registries and the badge alone
 * (mainnet phase 1): no market, pool, oracle or feed is read, linked or shown.
 * The synced snapshot is resolved here, at build time, so the client bundle
 * carries only the gallery rows; the page then overlays the live chain.
 */
export default function BuildersPage() {
  const snapshot = parseGallerySnapshot((live as { gallery?: unknown }).gallery, {
    chainId: BUILDERS.chainId,
    builderRegistry: BUILDERS.contracts.BuilderRegistry,
  });
  return (
    <BuildersShell wallet>
      <article className="perennial-app-page">
        <BuildersGallery snapshot={snapshot} nominees={parseNominees(nominees)} />
      </article>
    </BuildersShell>
  );
}
