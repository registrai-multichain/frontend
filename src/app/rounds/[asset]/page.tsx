import { notFound } from "next/navigation";
import { RoundsPage } from "@/components/RoundsPage";
import { ROUNDS, assetBySlug, assetSlug } from "@/lib/rounds";

/** /rounds/<symbol>/: one asset's market page; it always shows the current round. */
export function generateStaticParams() {
  return ROUNDS.assets.map((a) => ({ asset: assetSlug(a) }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ asset: string }> }) {
  const a = assetBySlug((await params).asset);
  if (!a) return { title: "Common markets · Registrai" };
  return {
    title: `${a.symbol} Up or Down · 5 minutes · Registrai`,
    description: `Bet on ${a.name}'s next five-minute move, settled on chain in USDC on ${ROUNDS.label} by the median of Coinbase, Kraken and OKX.`,
  };
}

export default async function AssetMarketPage({ params }: { params: Promise<{ asset: string }> }) {
  const a = assetBySlug((await params).asset);
  if (!a) notFound();
  return <RoundsPage view={{ kind: "asset", key: a.key }} />;
}
