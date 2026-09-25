import type { Metadata } from "next";
import Link from "next/link";
import { PerennialShell } from "@/components/PerennialShell";

export const metadata: Metadata = {
  title: "Builders · Perennial · Registrai",
  description: "The builders Perennial markets pay, what they earned this epoch, and your own builder income.",
  alternates: { canonical: "/perennial/builders" },
};

export default function PerennialBuildersPage() {
  return (
    <PerennialShell>
      <h1 className="pa-h1">Builders</h1>
      <p className="pa-lede">
        Coming together here. Meanwhile, see the <Link className="pa-link" href="/perennial/">markets</Link>.
      </p>
    </PerennialShell>
  );
}
