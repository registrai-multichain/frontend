"use client";

import type { BadgeInfo } from "@/lib/verified-builder-badge";
import { BuilderBadgeCard, useBuilderBadge } from "./BuilderBadgeCard";
import { ShareCard } from "./verify/ShareCard";

/**
 * A builder's Verified Builder Badge on its detail view, plus the X share card
 * when the connected wallet is the builder itself and the badge is not lapsed.
 * Renders nothing (and reads nothing) when badges are off or there is no badge.
 */
export function BuilderBadgeSection({
  builderId,
  owner,
  name,
  source,
  snapshot = null,
  viewer,
}: {
  builderId: number;
  owner: string;
  name: string;
  source: string | null;
  snapshot?: BadgeInfo | null;
  /** The connected wallet, if any. */
  viewer?: string;
}) {
  const badge = useBuilderBadge(builderId, snapshot);
  if (!badge) return null;
  const mine = Boolean(viewer && viewer.toLowerCase() === owner.toLowerCase());
  return (
    <section className="pp-action-card bb-section" aria-label={`${name}: verified builder badge`}>
      <div className="pp-panel-heading"><span>{name}</span><b>builder #{builderId}</b></div>
      <BuilderBadgeCard badge={badge} owner={owner} />
      {mine && !badge.lapsed && <ShareCard serial={badge.serial} builderId={builderId} source={source} issuedAt={badge.issuedAt} />}
    </section>
  );
}
