import { notFound } from "next/navigation";
import { RoundsPage } from "@/components/RoundsPage";
import { ROUNDS } from "@/lib/rounds";

/** /rounds/event/<key>/: one event market's page. */
export function generateStaticParams() {
  return ROUNDS.events.map((e) => ({ key: e.key }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const ev = ROUNDS.events.find((e) => e.key === key);
  if (!ev) return { title: "Common markets · Registrai" };
  return { title: `${ev.question} · Registrai`, description: `An event market on ${ROUNDS.label}, settled on chain in USDC.` };
}

export default async function EventMarketPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!ROUNDS.events.some((e) => e.key === key)) notFound();
  return <RoundsPage view={{ kind: "event", key }} />;
}
