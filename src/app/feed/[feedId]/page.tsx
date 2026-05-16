import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { FeedDetail } from "@/components/FeedDetail";
import { ALL_FEEDS } from "@/lib/demo";

export function generateStaticParams() {
  return ALL_FEEDS.map((f) => ({ feedId: f.id }));
}

export const dynamicParams = false;

export default function FeedPage({ params }: { params: { feedId: string } }) {
  const feed = ALL_FEEDS.find((f) => f.id.toLowerCase() === params.feedId.toLowerCase());
  if (!feed) notFound();
  return (
    <Shell>
      <FeedDetail feed={feed} />
    </Shell>
  );
}
