import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { IndexPage } from "@/components/builders-index/IndexPage";

export const metadata: Metadata = {
  title: "Arc Builders Index · Registrai",
  description: "Hourly index of builder activity on Arc mainnet, computed from public chain data.",
  alternates: { canonical: "/builders-index" },
};

export default function IndexRoute() {
  return (
    <BuildersShell>
      <article className="perennial-app-page">
        <IndexPage />
      </article>
    </BuildersShell>
  );
}
