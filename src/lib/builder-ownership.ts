/**
 * Moving a builder to another wallet (spec docs/superpowers/specs/
 * 2026-09-24-builder-projects-design.md "Ownership"), as the /verify and
 * /admin pages show it:
 *
 *   transfer  the owner proposes (`proposeOwner(new)`), the new wallet accepts
 *             (`acceptOwnership(id)`); the new wallet must hold no builder.
 *   recovery  the REGISTRAR (the Safe) starts it (`startRecovery(id, new)`), the
 *             current owner may `cancelRecovery(id)` for RECOVERY_DELAY (7 days),
 *             then anyone may `finishRecovery(id)`.
 *
 * After either, every project proof names the OLD wallet and reads lapsed until
 * it is re-signed with the new one, and the badge stays with the old wallet
 * until someone calls `VerifiedBuilderBadge.sync(id)`.
 *
 * Pure.
 */
import { isAddress, zeroAddress } from "viem";

/** BuilderRegistry.RECOVERY_DELAY. */
export const RECOVERY_DELAY_S = 7 * 24 * 60 * 60;

export type RecoveryView =
  | { kind: "none" }
  /** The owner can still cancel it. */
  | { kind: "waiting"; newOwner: string; readyAt: number; secondsLeft: number }
  /** Anyone may finish it now. */
  | { kind: "ready"; newOwner: string; readyAt: number };

/** `recoveryOf(id)` at `nowS` (unix seconds). */
export function recoveryView(r: { newOwner: string; readyAt: number } | null | undefined, nowS: number): RecoveryView {
  if (!r || !r.newOwner || r.newOwner.toLowerCase() === zeroAddress) return { kind: "none" };
  const left = r.readyAt - Math.floor(nowS);
  return left > 0
    ? { kind: "waiting", newOwner: r.newOwner, readyAt: r.readyAt, secondsLeft: left }
    : { kind: "ready", newOwner: r.newOwner, readyAt: r.readyAt };
}

/** "6d 23h", "5h 04m", "3m 12s", "45s"; "0s" at or past zero. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

/** Unix seconds -> "2026-10-01 12:00 UTC". */
export function utcMinute(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Why `newOwner` cannot take `owner`'s builder, or null when it can. The
 * registry also refuses a wallet that already holds a builder
 * (`newOwnerBuilderId` = builderIdOf(newOwner), when known).
 */
export function transferTargetError(newOwner: string, o: { owner: string; newOwnerBuilderId?: number }): string | null {
  const a = newOwner.trim();
  if (!a) return "Enter the new wallet's address.";
  if (!isAddress(a, { strict: false })) return "Not an address.";
  if (a.toLowerCase() === zeroAddress) return "The zero address cannot own a builder.";
  if (a.toLowerCase() === o.owner.toLowerCase()) return "That is already the owner.";
  if (o.newOwnerBuilderId) return `That wallet already owns builder #${o.newOwnerBuilderId}; a wallet holds one builder.`;
  return null;
}

/** Pure: the builder ids whose pending owner is `who` (from pendingOwner reads, id -> address). */
export function pendingFor(who: string | null | undefined, pending: ReadonlyMap<number, string>): number[] {
  if (!who) return [];
  const w = who.toLowerCase();
  return [...pending].filter(([, a]) => a && a.toLowerCase() === w && a.toLowerCase() !== zeroAddress).map(([id]) => id).sort((a, b) => a - b);
}

/** Pure: the builders whose pending RECOVERY moves them to `who` (from recoveryOf reads, id -> {newOwner, readyAt}). */
export function recoveriesFor(
  who: string | null | undefined,
  recoveries: ReadonlyMap<number, { newOwner: string; readyAt: number }>,
): { builderId: number; readyAt: number }[] {
  if (!who) return [];
  const w = who.toLowerCase();
  return [...recoveries]
    .filter(([, r]) => r.newOwner && r.newOwner.toLowerCase() !== zeroAddress && r.newOwner.toLowerCase() === w)
    .map(([builderId, r]) => ({ builderId, readyAt: r.readyAt }))
    .sort((a, b) => a.builderId - b.builderId);
}

/**
 * Pure: show the public "Finish recovery" button (finishRecovery is
 * permissionless) to this viewer? Only to the builder's current (old) owner and
 * to the recovery's new owner, and only once `readyAt` has passed.
 */
export function showFinishRecovery(
  o: { viewer: string | null | undefined; owner: string | null | undefined; recovery: { newOwner: string; readyAt: number } | null | undefined },
  nowS: number,
): boolean {
  if (!o.viewer || !o.recovery) return false;
  const v = recoveryView(o.recovery, nowS);
  if (v.kind !== "ready") return false;
  const w = o.viewer.toLowerCase();
  return w === v.newOwner.toLowerCase() || (Boolean(o.owner) && w === o.owner!.toLowerCase());
}
