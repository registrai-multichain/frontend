"use client";

import { createPublicClient, type Address, type PublicClient } from "viem";
import useSWR from "swr";
import { transportFor, type WalletChain } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import { PERENNIAL } from "@/lib/perennial-network";
import { isoDay } from "@/lib/share-card";
import {
  badgeDisplayBase,
  badgeImageBase,
  badgeImageUrl,
  badgeNetworkKey,
  badgeTokenUrl,
  readBadge,
  serialLabel,
  type BadgeInfo,
  type BadgeReader,
} from "@/lib/verified-builder-badge";

/**
 * Which chain + badge contract a badge view reads. Perennial's by default; the
 * builder pages (/verify, /builders) pass the builders network's, which is Arc
 * mainnet in phase 1 while the markets may still be elsewhere.
 */
export interface BadgeNet {
  chain: WalletChain;
  badge: Address | null;
  /** `public/badge/<network>/` — null when this chain has no badge art. */
  network: string | null;
}

export const PERENNIAL_BADGE_NET: BadgeNet = {
  chain: PERENNIAL.chain,
  badge: PERENNIAL.contracts.VerifiedBuilderBadge,
  network: badgeNetworkKey(PERENNIAL.chain.id),
};

/** Badges are on only with a badge contract AND art for its network. */
export const badgesOnFor = (n: BadgeNet) => Boolean(n.badge && n.network);

/** `public/badge/<network>/` of the Perennial network. */
export const BADGE_NETWORK = PERENNIAL_BADGE_NET.network;
export const BADGES_ON = badgesOnFor(PERENNIAL_BADGE_NET);

const clients = new Map<number, PublicClient>();
function reader(chain: WalletChain): PublicClient {
  let c = clients.get(chain.id);
  if (!c) {
    c = createPublicClient({ chain: chain.viemChain, transport: transportFor(chain, { batch: true }) }) as PublicClient;
    clients.set(chain.id, c);
  }
  return c;
}

/**
 * A builder's badge, read live (the keeper can lapse or restore it between
 * syncs), starting from the synced snapshot. No contract call when badges are
 * off or there is no builder.
 */
export function useBuilderBadge(
  builderId: number | undefined,
  snapshot: BadgeInfo | null = null,
  net: BadgeNet = PERENNIAL_BADGE_NET,
): BadgeInfo | null {
  const on = badgesOnFor(net) && Boolean(builderId);
  const { data } = useSWR(
    on ? ["verified-builder-badge", net.chain.id, net.badge, builderId] : null,
    () => readBadge(reader(net.chain) as unknown as BadgeReader, net.badge!, builderId!, badgeImageBase(net.network!)),
    { fallbackData: snapshot, refreshInterval: 60_000, dedupingInterval: 20_000, revalidateOnFocus: false },
  );
  return on ? (data ?? null) : null;
}

/** The badge picture (same art as the on-chain image): mainnet from the builders site, which falls back to a generic picture for a serial not rendered yet; other networks from this site. */
export const badgeSrc = (b: BadgeInfo, network: string | null = BADGE_NETWORK) =>
  badgeImageUrl(badgeDisplayBase(network ?? "arc"), b.serial, b.lapsed);

/** The badge on a builder's detail: image, number, status, explorer link. */
export function BuilderBadgeCard({ badge, owner, net = PERENNIAL_BADGE_NET }: { badge: BadgeInfo; owner: string; net?: BadgeNet }) {
  const CHAIN = net.chain;
  const href = badgeTokenUrl(CHAIN.explorer.url, net.badge!, badge.serial);
  const label = serialLabel(badge.serial);
  const day = isoDay(badge.issuedAt);
  return (
    <div className="bb-card" data-lapsed={badge.lapsed}>
      <a href={href} target="_blank" rel="noreferrer" className="bb-art" title={`Registrai Verified Builder ${label} on ${CHAIN.explorer.name}`}>
        {/* Static export: next/image optimisation is off, a plain lazy img is the same thing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={badgeSrc(badge, net.network)} alt={`Registrai Verified Builder ${label}${badge.lapsed ? ", proof lapsed" : ""}`} width={144} height={144} loading="lazy" decoding="async" />
      </a>
      <div className="bb-body">
        <div className="pp-card-label">Verified builder badge</div>
        <div className="bb-title">
          <strong className="tnum">{label}</strong>
          <span className={`vbadge ${badge.lapsed ? "vbadge-lapsed" : ""}`}>{badge.lapsed ? "lapsed" : "✓ verified"}</span>
        </div>
        <p>
          {badge.lapsed
            ? "No project proof checks out right now (or the builder is deactivated). The badge keeps its number and turns verified again once a proof is back."
            : `Soulbound, held by ${shortAddr(owner)}${day ? ` since ${day}` : ""}.`}
        </p>
        <a className="vf-link" href={href} target="_blank" rel="noreferrer">view on {CHAIN.explorer.name} ↗</a>
      </div>
    </div>
  );
}
