import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { FeedDetail } from "@/components/FeedDetail";
import { ALL_FEEDS } from "@/lib/demo";

export function generateStaticParams() {
  return ALL_FEEDS.map((f) => ({ feedId: f.id }));
}

export const dynamicParams = false;

export default async function FeedPage({ params }: { params: Promise<{ feedId: string }> }) {
  const { feedId } = await params;
  const feed = ALL_FEEDS.find((f) => f.id.toLowerCase() === feedId.toLowerCase());
  if (!feed) notFound();
  return (
    <Shell>
      <FeedDetail feed={feed} />
    </Shell>
  );
}
