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
  displayKind,
  overlayLive,
  projectChipKind,
  projectsNeedingCheck,
  readLiveGallery,
  type GalleryBuilder,
  type GalleryReader,
  type LiveProof,
} from "./builders-gallery";
import {
  cancelRecoveryTx,
  planOnboarding,
  revokeBadgeTx,
  safeBatchJson,
  setProjectActiveTx,
  singleTxSafeFile,
  startRecoveryTx,
  type OnboardingPlan,
} from "./onboard-batch";

// ───────────────────────────── chain read ─────────────────────────────

/** Run `fn` over `items`, at most `limit` at a time. */
async function eachLimited<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
    }),
  );
}

/**
 * Every builder as the chain says right now, the proof of every active project
 * of every active builder checked by the browser (no snapshot verdict is
 * trusted: the batch must reflect the proofs as they are). A domain the browser
 * may not read (CORS) comes back `proofUnchecked`.
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
  },
): Promise<GalleryBuilder[]> {
  const rows = await readLiveGallery(client, o);
  const proofs = new Map<number, LiveProof>();
  // An empty snapshot: every active project of an active builder is checked.
  const checks = rows.flatMap((r) => projectsNeedingCheck(r, undefined).map((p) => ({ owner: r.owner, id: p.id, source: p.source })));
  await eachLimited(checks, 4, async (c) => {
    proofs.set(c.id, await browserProofCheck({ owner: c.owner, source: c.source }, { chainId: o.chainId, fetchImpl: o.fetchImpl }));
  });
  return overlayLive([], rows, proofs, o.operator);
}

// ───────────────────────────── invites ─────────────────────────────

export type InviteChainStatus =
  | { kind: "invited" }
  | { kind: "nominated"; builderId: number; unchecked: boolean }
  | { kind: "verified"; builderId: number; serial: number | null }
  | { kind: "lapsed"; builderId: number };

const RANK = { verified: 0, nominated: 1, lapsed: 2 } as const;

/**
 * Pure: an invited source (one PROJECT) on chain. Among the shown builders
 * holding it as an active project, the best (verified, nominated, lapsed;
 * lowest id on a tie). Its status is the builder's: verified / nominated by
 * the builder's onboarding, lapsed when that project's proof (or the builder's
 * badge) is lapsed. Else invited.
 */
export function inviteChainStatus(source: string, builders: GalleryBuilder[]): InviteChainStatus {
  let best: { b: GalleryBuilder; kind: keyof typeof RANK; unchecked: boolean } | null = null;
  for (const b of builders) {
    const shown = displayKind(b);
    if (!shown) continue;
    const p = b.projects.find((x) => x.active && x.source === source);
    if (!p) continue;
    const chip = projectChipKind(p, b);
    if (!chip) continue;
    const kind: keyof typeof RANK = shown === "lapsed" ? "lapsed" : chip;
    if (!best || RANK[kind] < RANK[best.kind] || (RANK[kind] === RANK[best.kind] && b.id < best.b.id)) {
      best = { b, kind, unchecked: Boolean(p.proofUnchecked) };
    }
  }
  if (!best) return { kind: "invited" };
  const { b, kind } = best;
  if (kind === "verified") return { kind, builderId: b.id, serial: b.badge?.serial ?? null };
  if (kind === "nominated") return { kind, builderId: b.id, unchecked: best.unchecked };
  return { kind, builderId: b.id };
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
  /** Would be in the batch, but the browser could not read the proof. */
  excluded: GalleryBuilder[];
}

/**
 * Pure: the onboarding batch, per BUILDER, for builders with ≥1 verified
 * project whose proof the browser validated: `setCaretaker(id, operator)` for
 * each pending builder, then — with a badge contract — `issue(id)` for it and
 * for each verified builder without a badge. A builder whose only verified
 * projects are domains the browser could not read (CORS) is excluded (the CLI
 * checks them server-side). The same planOnboarding as scripts/onboard-batch.ts
 * (no --register here).
 */
export function onboardingQueue(
  builders: GalleryBuilder[],
  o: { builderRegistry: Address; caretakerRegistry: Address; operator: Address; badge: Address | null },
): OnboardingQueue {
  const eligible = builders.filter((b) => b.status === "pending" || (b.status === "verified" && o.badge !== null && !b.badge));
  const included = eligible.filter((b) => !b.proofUnchecked);
  const excluded = eligible.filter((b) => b.proofUnchecked);
  const plan = planOnboarding({
    records: included.map((b) => ({
      builderId: b.id,
      status: b.status,
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
  return { plan, included, excluded };
}

/** Pure: the onboarding Safe file. */
export function onboardingSafeFile(q: OnboardingQueue, chainId: number, createdAt: number) {
  return safeBatchJson(q.plan.txs, { chainId, createdAt });
}

// ───────────────────────────── badge actions ─────────────────────────────

/** Pure: a one-transaction Safe file revoking one builder's badge. */
export function revokeSafeFile(o: { badge: Address; builderId: number; serial: number; chainId: number; createdAt: number }) {
  const tx = revokeBadgeTx(o.badge, o.builderId, o.serial);
  return safeBatchJson([tx], {
    chainId: o.chainId,
    createdAt: o.createdAt,
    name: `Registrai: revoke badge No. ${String(o.serial).padStart(3, "0")}`,
    description: tx.label,
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
