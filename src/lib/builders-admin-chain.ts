/**
 * The /admin page's chain side: every builder read live in the browser (the
 * registry, caretakers, badges) with every claim's proof re-checked there, and
 * what that means for invites, the onboarding queue and badge actions.
 * Nothing here signs or sends: batches are Safe Transaction Builder files the
 * multisig imports (src/lib/onboard-batch.ts, the same rules as
 * scripts/onboard-batch.ts).
 *
 * Pure except readAdminChain, which takes its client / fetch as arguments.
 */
import { getAddress, parseAbi, zeroAddress, type Address } from "viem";
import {
  browserProofCheck,
  checkLiveProofs,
  displayKind,
  overlayLive,
  projectChipKind,
  readLiveGallery,
  type GalleryBuilder,
  type GalleryReader,
} from "./builders-gallery";
import {
  cancelRecoveryTx,
  planOnboarding,
  revokeBadgeTx,
  safeBatchJson,
  setBuilderActiveTx,
  setProjectActiveTx,
  singleTxSafeFile,
  startRecoveryTx,
  type OnboardingPlan,
} from "./onboard-batch";
import type { ProofReader } from "./proof-fetch";
import type { BuilderStatus } from "./verified-builders";

// ───────────────────────────── chain read ─────────────────────────────

/**
 * Every builder as the chain says right now, the proof of every active project
 * of every active builder checked now (GET /api/proof, else directly; no
 * snapshot verdict is trusted: the batch must reflect the proofs as they are).
 * A proof that could not be read makes its project "unconfirmed".
 */
export async function readAdminChain(
  client: GalleryReader,
  o: {
    registry: Address;
    caretakers: Address | null;
    badge: Address | null;
    imageBase: string;
    operator: string | null;
    chainId: number;
    fetchImpl?: typeof fetch;
    reader?: ProofReader;
    budgetMs?: number;
  },
): Promise<GalleryBuilder[]> {
  const rows = await readLiveGallery(client, o);
  const proofs = await checkLiveProofs(
    rows,
    (p) => browserProofCheck(p, { chainId: o.chainId, fetchImpl: o.fetchImpl, reader: o.reader }),
    { budgetMs: o.budgetMs ?? 60_000 },
  );
  return overlayLive([], rows, proofs, o.operator);
}

// ───────────────────────────── invites ─────────────────────────────

export type InviteChainStatus =
  | { kind: "invited" }
  | { kind: "nominated"; builderId: number; unchecked: boolean }
  | { kind: "verified"; builderId: number; serial: number | null }
  | { kind: "unconfirmed"; builderId: number }
  | { kind: "lapsed"; builderId: number };

const RANK = { verified: 0, nominated: 1, unconfirmed: 2, lapsed: 3 } as const;

/**
 * Pure: an invited source (one PROJECT) on chain. Among the builders holding
 * it as an active project, the best (verified, nominated, unconfirmed, lapsed;
 * lowest id on a tie). Verified / nominated need that project's proof to check
 * out (the gallery then absorbs the invite); unconfirmed = it could not be
 * read; lapsed = it does not check out (or the builder's badge is lapsed).
 * The gallery still shows the invite for the last two. Else invited.
 */
export function inviteChainStatus(source: string, builders: GalleryBuilder[]): InviteChainStatus {
  let best: { b: GalleryBuilder; kind: keyof typeof RANK; unchecked: boolean } | null = null;
  for (const b of builders) {
    // The admin sees every builder, never-onboarded lapsed ones included (the gallery hides those).
    const shown = displayKind({ ...b, onboarded: true });
    if (!shown) continue;
    const p = b.projects.find((x) => x.active && x.source === source);
    if (!p) continue;
    const chip = projectChipKind(p, b);
    if (!chip) continue;
    const kind: keyof typeof RANK = shown === "lapsed" ? "lapsed" : shown === "unconfirmed" ? "unconfirmed" : chip;
    if (!best || RANK[kind] < RANK[best.kind] || (RANK[kind] === RANK[best.kind] && b.id < best.b.id)) {
      best = { b, kind, unchecked: Boolean(p.proofUnchecked) };
    }
  }
  if (!best) return { kind: "invited" };
  const { b, kind } = best;
  if (kind === "verified") return { kind, builderId: b.id, serial: b.badge?.serial ?? null };
  if (kind === "nominated") return { kind, builderId: b.id, unchecked: best.unchecked };
  if (kind === "unconfirmed") return { kind, builderId: b.id };
  return { kind: "lapsed", builderId: b.id };
}

export const FOLLOW_UP_AFTER_MS = 3 * 24 * 60 * 60_000;

/**
 * Pure: an invite to chase — not claimed, and either opened (they looked but
 * did not claim) or never opened three days after it was made.
 */
export function needsFollowUp(inv: { createdAt: string; opens: number }, status: InviteChainStatus, nowMs: number): boolean {
  if (status.kind !== "invited") return false;
  if (inv.opens > 0) return true;
  const t = Date.parse(inv.createdAt);
  return Number.isFinite(t) && nowMs - t >= FOLLOW_UP_AFTER_MS;
}

// ───────────────────────────── onboarding queue ─────────────────────────────

export interface OnboardingQueue {
  plan: OnboardingPlan;
  /** In the batch: pending (setCaretaker, then issue) or verified without a badge (issue). */
  included: GalleryBuilder[];
  /** Would be candidates, but no project proof could be read right now (unconfirmed). */
  excluded: GalleryBuilder[];
  /** Never re-onboarded: the badge was revoked (and the builder not reactivated
   *  since), or — when the revocation history could not be read — a verified
   *  builder without a badge, which is what a revoked one looks like. */
  revoked: { builder: GalleryBuilder; reason: string }[];
}

/**
 * Pure: the onboarding batch, per BUILDER, for builders with ≥1 verified
 * project whose proof was validated just now: `setCaretaker(id, operator)` for
 * each pending builder, then — with a badge contract — `issue(id)` for it and
 * for each verified builder without a badge. Never a deactivated builder, and
 * never one whose badge was revoked (`revoked`: revokedBuilders; null = the
 * history is unknown, so every verified builder without a badge is held back).
 * A builder none of whose proofs could be read is excluded (the CLI checks
 * them server-side). The same planOnboarding as scripts/onboard-batch.ts (no
 * --register here).
 */
export function onboardingQueue(
  builders: GalleryBuilder[],
  o: {
    builderRegistry: Address;
    caretakerRegistry: Address;
    operator: Address;
    badge: Address | null;
    revoked?: ReadonlySet<number> | null;
  },
): OnboardingQueue {
  const known = o.revoked !== null;
  const revokedSet = o.revoked ?? new Set<number>();
  const revoked: OnboardingQueue["revoked"] = [];
  const wanted = (b: GalleryBuilder, status: GalleryBuilder["status"]) =>
    status === "pending" || (status === "verified" && o.badge !== null && !b.badge);
  const candidates = builders.filter((b) => wanted(b, b.status));
  const included: GalleryBuilder[] = [];
  for (const b of candidates) {
    if (revokedSet.has(b.id)) revoked.push({ builder: b, reason: "badge revoked; not reactivated since" });
    else if (!known && b.status === "verified") revoked.push({ builder: b, reason: "verified without a badge, and the revocation history could not be read" });
    else included.push(b);
  }
  // Unconfirmed: would be a candidate if a proof checked out (pending, or onboarded without a badge).
  const excluded = builders.filter(
    (b) => b.status === "unconfirmed" && !revokedSet.has(b.id) && (!b.onboarded || (o.badge !== null && !b.badge)),
  );
  const plan = planOnboarding({
    records: included.map((b) => ({
      builderId: b.id,
      status: b.status as BuilderStatus,
      owner: getAddress(b.owner),
      activeProjectCount: b.projects.filter((p) => p.active).length,
      verifiedSources: b.projects.filter((p) => p.status === "verified" && !p.proofUnchecked).map((p) => p.source),
    })),
    registrations: [],
    builderRegistry: o.builderRegistry,
    caretakerRegistry: o.caretakerRegistry,
    operator: o.operator,
    badge: o.badge ? { address: o.badge, serials: new Map(included.map((b) => [b.id, b.badge?.serial ?? 0])) } : undefined,
  });
  return { plan, included, excluded, revoked };
}

/** Pure: the onboarding Safe file. */
export function onboardingSafeFile(q: OnboardingQueue, chainId: number, createdAt: number) {
  return safeBatchJson(q.plan.txs, { chainId, createdAt });
}

// ───────────────────────────── badge actions ─────────────────────────────

/**
 * Pure: the Safe file revoking one builder's badge: `revoke(id)` on the badge
 * AND `setActive(id, false)` on the registry, in one batch. Revoking alone
 * would leave the builder verified, and the onboarding queue would offer it a
 * new badge; deactivated, it is never onboarded again until the Safe
 * reactivates it (setActive(id, true)).
 */
export function revokeSafeFile(o: { badge: Address; registry: Address; builderId: number; serial: number; chainId: number; createdAt: number }) {
  const txs = [revokeBadgeTx(o.badge, o.builderId, o.serial), setBuilderActiveTx(o.registry, o.builderId, false)];
  return safeBatchJson(txs, {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: revoke badge No. ${String(o.serial).padStart(3, "0")} and deactivate builder #${o.builderId}`,
    description: txs.map((t) => t.label).join("; "),
  });
}

/** A download's file name, e.g. `registrai-onboarding-2026-09-24.safe.json`. */
export function safeFileName(kind: string, nowMs: number): string {
  return `registrai-${kind}-${new Date(nowMs).toISOString().slice(0, 10)}.safe.json`;
}

// ───────────────────────────── recovery + projects ─────────────────────────────

/** Pure: a one-transaction Safe file starting a recovery (REGISTRAR = the Safe). */
export function startRecoverySafeFile(o: { registry: Address; builderId: number; newOwner: Address; chainId: number; createdAt: number }) {
  return singleTxSafeFile(startRecoveryTx(o.registry, o.builderId, o.newOwner), {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: start recovery of builder #${o.builderId}`,
  });
}

/** Pure: a one-transaction Safe file cancelling a recovery. */
export function cancelRecoverySafeFile(o: { registry: Address; builderId: number; chainId: number; createdAt: number }) {
  return singleTxSafeFile(cancelRecoveryTx(o.registry, o.builderId), {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: cancel recovery of builder #${o.builderId}`,
  });
}

/** Pure: a one-transaction Safe file deactivating one project (setProjectActive(id, false)). */
export function deactivateProjectSafeFile(o: { registry: Address; projectId: number; source?: string; chainId: number; createdAt: number }) {
  return singleTxSafeFile(setProjectActiveTx(o.registry, o.projectId, false, o.source), {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: deactivate project #${o.projectId}`,
  });
}

export interface PendingRecovery {
  builderId: number;
  newOwner: Address;
  /** Unix seconds. */
  readyAt: number;
}

const recoveryAbi = parseAbi(["function recoveryOf(uint256 builderId) view returns (address newOwner, uint64 readyAt)"]);

/** Every pending recovery among `builderIds` (recoveryOf with a non-zero newOwner). */
export async function readRecoveries(client: GalleryReader, registry: Address, builderIds: number[]): Promise<PendingRecovery[]> {
  const rows = await Promise.all(
    builderIds.map(async (id) => {
      const [newOwner, readyAt] = (await client.readContract({ address: registry, abi: recoveryAbi, functionName: "recoveryOf", args: [BigInt(id)] })) as readonly [
        Address, bigint,
      ];
      return { builderId: id, newOwner, readyAt: Number(readyAt) };
    }),
  );
  return rows.filter((r) => r.newOwner.toLowerCase() !== zeroAddress);
}
