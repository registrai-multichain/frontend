"use client";

import { createPublicClient, type PublicClient } from "viem";
import useSWR from "swr";
import { transportFor } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { PERENNIAL } from "@/lib/perennial-network";
import { isoDay } from "@/lib/share-card";
import {
  badgeImageBase,
  badgeImageUrl,
  badgeNetworkKey,
  badgeTokenUrl,
  readBadge,
  serialLabel,
  type BadgeInfo,
  type BadgeReader,
} from "@/lib/verified-builder-badge";

const CHAIN = PERENNIAL.chain;
const BADGE = PERENNIAL.contracts.VerifiedBuilderBadge;
/** `public/badge/<network>/` — null when this chain has no badge art. */
export const BADGE_NETWORK = badgeNetworkKey(CHAIN.id);
/** Badges are on only with a badge contract AND art for its network. */
export const BADGES_ON = Boolean(BADGE && BADGE_NETWORK);

let client: PublicClient | undefined;
const reader = () =>
  (client ??= createPublicClient({ chain: CHAIN.viemChain, transport: transportFor(CHAIN, { batch: true }) }) as PublicClient);

/**
 * A builder's badge, read live (the keeper can lapse or restore it between
 * syncs), starting from the synced snapshot. No contract call when badges are
 * off or there is no builder.
 */
export function useBuilderBadge(builderId: number | undefined, snapshot: BadgeInfo | null = null): BadgeInfo | null {
  const on = BADGES_ON && Boolean(builderId);
  const { data } = useSWR(
    on ? ["verified-builder-badge", CHAIN.id, BADGE, builderId] : null,
    () => readBadge(reader() as unknown as BadgeReader, BADGE!, builderId!, badgeImageBase(BADGE_NETWORK!)),
    { fallbackData: snapshot, refreshInterval: 60_000, dedupingInterval: 20_000, revalidateOnFocus: false },
  );
  return on ? (data ?? null) : null;
}

/** The badge as the site serves it (same art as the on-chain image, served locally). */
export const badgeSrc = (b: BadgeInfo) => badgeImageUrl(`/badge/${BADGE_NETWORK}/`, b.serial, b.lapsed);

/** The badge on a builder's detail: image, number, status, explorer link. */
export function BuilderBadgeCard({ badge, owner }: { badge: BadgeInfo; owner: string }) {
  const href = badgeTokenUrl(CHAIN.explorer.url, BADGE!, badge.serial);
  const label = serialLabel(badge.serial);
  const day = isoDay(badge.issuedAt);
  return (
    <div className="bb-card" data-lapsed={badge.lapsed}>
      <a href={href} target="_blank" rel="noreferrer" className="bb-art" title={`Registrai Verified Builder ${label} on ${CHAIN.explorer.name}`}>
        {/* Static export: next/image optimisation is off, a plain lazy img is the same thing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={badgeSrc(badge)} alt={`Registrai Verified Builder ${label}${badge.lapsed ? ", proof lapsed" : ""}`} width={144} height={144} loading="lazy" decoding="async" />
      </a>
      <div className="bb-body">
        <div className="pp-card-label">Verified builder badge</div>
        <div className="bb-title">
          <strong className="tnum">{label}</strong>
          <span className={`vbadge ${badge.lapsed ? "vbadge-lapsed" : ""}`}>{badge.lapsed ? "lapsed" : "✓ verified"}</span>
        </div>
        <p>
          {badge.lapsed
            ? "The proof file is missing or no longer checks out. The badge keeps its number and turns verified again once the proof is back."
            : `Soulbound, held by ${shortAddr(owner)}${day ? ` since ${day}` : ""}.`}
        </p>
        <a className="vf-link" href={href} target="_blank" rel="noreferrer">view on {CHAIN.explorer.name} ↗</a>
      </div>
    </div>
  );
}
