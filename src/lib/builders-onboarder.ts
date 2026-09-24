/**
 * The /admin page's direct onboarding: the ONBOARDER, a hot wallet the Safe
 * granted exactly two roles, sends a builder's onboarding itself instead of a
 * Safe batch:
 *
 *   GOVERNOR_ROLE on CaretakerRegistry   setCaretaker(builderId, operator)
 *   ISSUER_ROLE   on VerifiedBuilderBadge issue(builderId)
 *
 * It can NOT revoke a badge (REVOKER_ROLE is the Safe's), and the Safe can take
 * either role away at any time. The same rules as planOnboarding
 * (onboard-batch.ts), but per builder and on values re-read from the chain
 * right before sending, so a second run never repeats a step.
 *
 * Pure except onboarderRoles / readBuilderForOnboarding, which take their
 * client as an argument.
 */
import { keccak256, parseAbi, toBytes, zeroAddress, type Address } from "viem";
import { verifiedBuilderAbi } from "./verified-builders-chain";
import { badgeAbi } from "./verified-builder-badge";
import type { GalleryReader } from "./builders-gallery";

export const ISSUER_ROLE = keccak256(toBytes("ISSUER_ROLE"));
export const GOVERNOR_ROLE = keccak256(toBytes("GOVERNOR_ROLE"));

/** OZ AccessControl: the role check, and its revert (so a simulation reads well). */
export const accessControlAbi = parseAbi([
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
]);

/** setCaretaker / issue with the AccessControl revert, for sending. */
export const caretakerSendAbi = [...verifiedBuilderAbi, ...accessControlAbi] as const;
export const badgeSendAbi = [...badgeAbi, ...accessControlAbi] as const;

export interface OnboarderContracts {
  caretakers: Address | null;
  badge: Address | null;
}

export interface OnboarderRoles {
  /** ISSUER_ROLE on VerifiedBuilderBadge: issue(builderId). */
  issuer: boolean;
  /** GOVERNOR_ROLE on CaretakerRegistry: setCaretaker(builderId, operator). */
  governor: boolean;
}

/** The two roles `wallet` holds (false where the contract is not deployed). */
export async function onboarderRoles(client: GalleryReader, wallet: Address, c: OnboarderContracts): Promise<OnboarderRoles> {
  const has = (address: Address | null, role: `0x${string}`) =>
    address
      ? (client.readContract({ address, abi: accessControlAbi, functionName: "hasRole", args: [role, wallet] }) as Promise<boolean>)
      : Promise.resolve(false);
  const [issuer, governor] = await Promise.all([has(c.badge, ISSUER_ROLE), has(c.caretakers, GOVERNOR_ROLE)]);
  return { issuer: Boolean(issuer), governor: Boolean(governor) };
}

/**
 * Pure: may this wallet use the direct Onboard buttons? Only with BOTH roles
 * (half an onboarding would leave a builder verified without its badge, or the
 * reverse); `missing` names each absent role for the page.
 */
export function onboarderGate(roles: OnboarderRoles | null | undefined): { ok: boolean; missing: string[] } {
  if (!roles) return { ok: false, missing: ["GOVERNOR_ROLE on CaretakerRegistry", "ISSUER_ROLE on VerifiedBuilderBadge"] };
  const missing = [
    !roles.governor && "GOVERNOR_ROLE on CaretakerRegistry",
    !roles.issuer && "ISSUER_ROLE on VerifiedBuilderBadge",
  ].filter((m): m is string => Boolean(m));
  return { ok: missing.length === 0, missing };
}

/** A builder as the chain says right now, as onboarding needs it. */
export interface OnboardingChainState {
  owner: Address;
  active: boolean;
  activeProjectCount: number;
  caretaker: Address;
  /** serialOf(builderId); 0 = no badge. */
  serial: number;
}

/** Re-read one builder fresh from the chain, right before sending. */
export async function readBuilderForOnboarding(
  client: GalleryReader,
  builderId: number,
  c: { registry: Address; caretakers: Address; badge: Address },
): Promise<OnboardingChainState> {
  const id = BigInt(builderId);
  const [row, count, caretaker, serial] = await Promise.all([
    client.readContract({ address: c.registry, abi: verifiedBuilderAbi, functionName: "builders", args: [id] }) as Promise<
      readonly [Address, string, `0x${string}`, bigint, boolean]
    >,
    client.readContract({ address: c.registry, abi: verifiedBuilderAbi, functionName: "activeProjectCount", args: [id] }) as Promise<bigint>,
    client.readContract({ address: c.caretakers, abi: verifiedBuilderAbi, functionName: "caretakerOf", args: [id] }) as Promise<Address>,
    client.readContract({ address: c.badge, abi: badgeAbi, functionName: "serialOf", args: [id] }) as Promise<bigint>,
  ]);
  return { owner: row[0], active: row[4], activeProjectCount: Number(count), caretaker, serial: Number(serial) };
}

export type OnboardStep = { kind: "setCaretaker"; builderId: number; operator: Address } | { kind: "issue"; builderId: number };

export type OnboardPlan = { ok: true; steps: OnboardStep[] } | { ok: false; reason: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Pure: what is left to onboard one builder, in order: setCaretaker while its
 * caretaker is not the operator, then issue while it holds no badge (serial 0)
 * and has an active project. Refuses an unregistered or deactivated builder,
 * one without an active project, and one whose owner changed since its proof
 * was checked (`expectedOwner`: the proof names the old wallet). Idempotent:
 * once both are done the plan is empty.
 */
export function planOnboardSteps(o: {
  builderId: number;
  active: boolean;
  activeProjectCount: number;
  caretaker: string;
  operator: Address | null;
  serial: number;
  owner?: string;
  expectedOwner?: string;
}): OnboardPlan {
  const id = o.builderId;
  if (!o.operator || same(o.operator, zeroAddress)) return { ok: false, reason: "No operator is configured for this network." };
  if (o.owner !== undefined && same(o.owner, zeroAddress)) return { ok: false, reason: `Builder #${id} is not registered.` };
  if (o.owner !== undefined && o.expectedOwner !== undefined && !same(o.owner, o.expectedOwner)) {
    return { ok: false, reason: `Builder #${id} changed owner since its proof was checked: re-read the chain first.` };
  }
  if (!o.active) return { ok: false, reason: `Builder #${id} is deactivated on the registry.` };
  if (o.activeProjectCount <= 0) return { ok: false, reason: `Builder #${id} has no active project.` };
  const steps: OnboardStep[] = [];
  if (!same(o.caretaker, o.operator)) steps.push({ kind: "setCaretaker", builderId: id, operator: o.operator });
  if (o.serial === 0) steps.push({ kind: "issue", builderId: id });
  return { ok: true, steps };
}

/** Pure: one step as a call (for sendBuildersTx) and a human line. */
export function onboardStepCall(step: OnboardStep, c: { caretakers: Address; badge: Address }) {
  if (step.kind === "setCaretaker") {
    return {
      address: c.caretakers,
      abi: caretakerSendAbi,
      functionName: "setCaretaker",
      args: [BigInt(step.builderId), step.operator] as const,
      label: `setCaretaker(${step.builderId}, ${step.operator})`,
    };
  }
  return {
    address: c.badge,
    abi: badgeSendAbi,
    functionName: "issue",
    args: [BigInt(step.builderId)] as const,
    label: `issue(${step.builderId})`,
  };
}
