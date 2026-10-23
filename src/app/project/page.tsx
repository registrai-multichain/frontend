import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { ProjectFactsPage } from "@/components/project/ProjectFactsPage";

const DESCRIPTION = "What is on chain, who controls it and how it is used: neutral facts with evidence.";

export const metadata: Metadata = {
  title: "Project facts · Registrai",
  description: DESCRIPTION,
  // no canonical or og:url here: builders-site/functions/project serves this page for every project and sets both
  alternates: {},
  openGraph: { type: "website", siteName: "Registrai", title: "Project facts · Registrai", description: DESCRIPTION },
  twitter: { card: "summary", title: "Project facts · Registrai", description: DESCRIPTION },
};

export default function ProjectPage() {
  return (
    <BuildersShell>
      <article className="perennial-app-page">
        <ProjectFactsPage />
      </article>
    </BuildersShell>
  );
}
