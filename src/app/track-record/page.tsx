import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { TrackRecordPage } from "@/components/track/TrackRecordPage";

export const metadata: Metadata = {
  title: "Track record · Registrai",
  description: "What the radar reported, published 24 hours after each change, with evidence.",
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
