import type { Metadata } from "next";
import { PerennialShell } from "@/components/PerennialShell";
import { Transparency } from "@/components/transparency/Transparency";

const DESCRIPTION =
  "Every wallet, role and contract behind Registrai on Arc mainnet, read live from the chain: who holds which key, where fees go, the REGI buyback and burn, and the public record.";

export const metadata: Metadata = {
  title: "Transparency · Registrai",
  description: DESCRIPTION,
  alternates: { canonical: "https://dashboard.registrai.cc/" },
  openGraph: { title: "Transparency · Registrai", description: DESCRIPTION, url: "https://dashboard.registrai.cc/" },
};

export default function TransparencyPage() {
  return (
    <PerennialShell>
      <Transparency />
    </PerennialShell>
  );
}
