/**
 * Verified-builder status as the UI shows it: the synced snapshot
 * (live-data.json `perennialBuilders`, written by scripts/sync.ts), trusted only
 * when it describes the selected network and, when the live profile link is
 * known, only while that link still names the same source.
 */
import live from "./live-data.json";
import { SNAPSHOT_MATCHES_NETWORK } from "./perennial-network";
import { profileURIFor, type BuilderStatus } from "./verified-builders";
import { parseSnapshotBadge, type BadgeInfo } from "./verified-builder-badge";

export interface SnapshotBuilder {
  builderId: number;
  owner: string;
  source: string | null;
  status: BuilderStatus;
  country: string | null;
  proofUrl: string | null;
  milestoneFeedId: string | null;
  /** Raw; read it through snapshotBadgeFor. */
  badge?: unknown;
}

export interface Verification {
  source: string;
  proofUrl: string;
}

export function snapshotBuilders(): SnapshotBuilder[] {
  if (!SNAPSHOT_MATCHES_NETWORK) return [];
  const rows = (live as { perennialBuilders?: Partial<SnapshotBuilder>[] }).perennialBuilders ?? [];
  // Older snapshots carried {address, name, repo}; only rows with a status count.
  return rows.filter((r): r is SnapshotBuilder => typeof r.status === "string" && typeof r.owner === "string");
}

/** Pure: the Verified mark for a builder, or null. */
export function verificationFor(
  rows: SnapshotBuilder[],
  b: { builderId: number; owner: string; profileURI?: string },
): Verification | null {
  const row = rows.find((r) => r.builderId === b.builderId && r.owner.toLowerCase() === b.owner.toLowerCase());
  if (!row || row.status !== "verified" || !row.source || !row.proofUrl) return null;
  if (b.profileURI !== undefined && b.profileURI !== profileURIFor(row.source)) return null;
  return { source: row.source, proofUrl: row.proofUrl };
}

/** Pure: the badge the snapshot recorded for this builder (same id AND owner), or null. */
export function snapshotBadgeFor(rows: SnapshotBuilder[], b: { builderId: number; owner: string }): BadgeInfo | null {
  const row = rows.find((r) => r.builderId === b.builderId && r.owner.toLowerCase() === b.owner.toLowerCase());
  return row ? parseSnapshotBadge(row.badge) : null;
}

/** What a builder's milestone counts, for the disclosure line. */
export function milestoneMetric(source: string | null | undefined): string {
  return source?.startsWith("domain:") ? "contracts its deployers create" : "releases and tags";
}
