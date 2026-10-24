import type { Metadata } from "next";
import { builderUrl } from "@/lib/public-site";
import { BuildersShell } from "@/components/BuildersShell";
import { IndexPage } from "@/components/builders-index/IndexPage";
import { INDEX_FOOT_NOTE } from "@/lib/builders-index-page";

const TITLE = "Arc indices · Registrai";
const DESCRIPTION = "Hourly indices of builder, integration and ecosystem activity on Arc mainnet, computed from public chain data.";

// audit L12: the page's own title and description in the share tags too (the root layout's carry the landing
// page's line and image)
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: builderUrl("builders-index"), types: { "text/markdown": "/builders-index/index.md" } },
  openGraph: { type: "website", siteName: "Registrai", title: TITLE, description: DESCRIPTION, url: "https://builder.registrai.cc/builders-index/" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export default function IndexRoute() {
  return (
    <BuildersShell note={INDEX_FOOT_NOTE}>
      <article className="perennial-app-page">
        <IndexPage />
      </article>
    </BuildersShell>
  );
}
