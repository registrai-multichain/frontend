import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { TrackRecordPage } from "@/components/track/TrackRecordPage";

export const metadata: Metadata = {
  title: "Track record · Registrai",
  description: "Radar alerts that pass our publication rules appear here at least 24 hours after the alert, with evidence. Security findings and alerts we hold are not published here. Retracted entries stay listed with the reason.",
  alternates: { canonical: "/track-record" },
};

export default function TrackRecordRoute() {
  return (
    <BuildersShell>
      <article className="perennial-app-page">
        <TrackRecordPage />
      </article>
    </BuildersShell>
  );
}
