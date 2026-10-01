import type { Metadata } from "next";
import { BuildersShell } from "@/components/BuildersShell";
import { ProjectFactsPage } from "@/components/project/ProjectFactsPage";

const DESCRIPTION = "What is on chain, who controls it and how it is used: neutral facts with evidence.";

export const metadata: Metadata = {
  title: "Project facts · Registrai",
  description: DESCRIPTION,
  alternates: { canonical: "/project" },
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
