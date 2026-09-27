import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { BuildersPage } from "@/components/perennial/BuildersPage";

export const metadata: Metadata = {
  title: "Builders · Perennial · Registrai",
  description: "The builders Perennial markets pay, what they earned this epoch, and your own builder income.",
  alternates: { canonical: "/perennial/builders" },
};

export default function PerennialBuildersPage() {
  return (
    <PerennialShell>
      <div className="pu-bridge">
        <BuildersPage />
      </div>
    </PerennialShell>
  );
}
