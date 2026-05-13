import { Shell } from "@/components/Shell";
import { FeedDetail } from "@/components/FeedDetail";
import { DEMO_FEED } from "@/lib/demo";

// Pre-render the demo feed id at build time. When real feeds are deployed,
// extend this list (or fetch from chain at build time) so each feed has a
// static page on Cloudflare Pages.
export function generateStaticParams() {
  return [{ feedId: DEMO_FEED.id }];
}

export const dynamicParams = false;

export default function FeedPage() {
  // V1: one demo feed regardless of the param. When contracts are wired in,
  // this becomes a chain read keyed on params.feedId.
  return (
    <Shell>
      <FeedDetail feed={DEMO_FEED} />
    </Shell>
  );
}
