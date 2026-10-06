import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { RecordPage } from "@/components/record/RecordPage";

export const metadata: Metadata = {
  title: "Record · Registrai",
  description: "Daily record of what Registrai published, with its digest and the Arc transaction that anchors it.",
  alternates: { canonical: "/record" },
};

export default function RecordRoute() {
  return (
    <BuildersShell>
      <article className="perennial-app-page">
        <RecordPage />
      </article>
    </BuildersShell>
  );
}
