import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { PerennialApp } from "@/components/perennial/PerennialApp";

export const metadata: Metadata = {
  title: "Wonder markets · Perennial · Registrai",
  description: "Markets about nominated projects that have not joined Registrai yet; the team's share of the fees waits for them.",
  alternates: { canonical: "/perennial/wonder" },
  robots: { index: false },
};

export default function WonderPage() {
  return (
    <PerennialShell>
      <PerennialApp initialTab="unclaimed" />
    </PerennialShell>
  );
}
