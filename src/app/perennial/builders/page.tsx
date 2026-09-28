import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { BuildersPage } from "@/components/perennial/BuildersPage";
import { BUILDERS } from "@/lib/builders-network";
import { parseGallerySnapshot, verifiedCards } from "@/lib/builders-gallery";
import live from "@/lib/live-data.json";

export const metadata: Metadata = {
  title: "Builders · Perennial · Registrai",
  description: "The builders Perennial markets pay, what they earned this epoch, and your own builder income.",
  alternates: { canonical: "/perennial/builders" },
};

export default function PerennialBuildersPage() {
  // Resolved at build time: before markets open, the page lists the verified builders from the synced registry.
  const verified = verifiedCards(
    parseGallerySnapshot((live as { gallery?: unknown }).gallery, { chainId: BUILDERS.chainId, builderRegistry: BUILDERS.contracts.BuilderRegistry }),
  );
  return (
    <PerennialShell>
      <div className="pu-bridge">
        <BuildersPage verified={verified} />
      </div>
    </PerennialShell>
  );
}
