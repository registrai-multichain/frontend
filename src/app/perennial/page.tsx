import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { PerennialApp } from "@/components/perennial/PerennialApp";
import { PERENNIAL } from "@/lib/perennial-network";

const ON = PERENNIAL.label;

export const metadata: Metadata = {
  title: "Perennial Markets · Registrai",
  description:
    `Trade builder milestone markets on ${ON}: half of every trading fee is the income of the builder the market is about.`,
  alternates: { canonical: "/perennial" },
  openGraph: {
    title: "Perennial Markets · Registrai",
    description: `Builder milestone markets on ${ON} whose fees pay the builder they are about.`,
    url: "https://registrai.cc/perennial/",
    images: [{ url: "/social/registrai-landing-regi.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Perennial Markets · Registrai",
    description: `Builder milestone markets on ${ON} whose fees pay the builder they are about.`,
    images: ["/social/registrai-landing-regi.png"],
  },
};

export default function PerennialPage() {
  return (
    <PerennialShell>
      <PerennialApp />
    </PerennialShell>
  );
}
