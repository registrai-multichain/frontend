/**
 * What /verify does for the connected wallet (spec docs/superpowers/specs/
 * 2026-09-24-builder-projects-design.md "Surfaces"): register once, then add
 * projects; every project has its own proof file (claim format v1, naming the
 * builder wallet and that project's source).
 *
 *   not registered   sign the claim for the project, publish the proof, then
 *                    `registerBuilderWithProject(displayName or "", source)`: one tx
 *   registered       its projects with their statuses, and "Add a project":
 *                    sign, publish, `addProject(source)`
 *   re-sign          a project whose proof names ANOTHER wallet (the builder
 *                    moved to this one): sign a new proof with this wallet and
 *                    publish it; the project is already on chain, nothing is sent
 *
 * Pure.
 */
import { MAX_PROJECTS_PER_BUILDER, byteLength, sourceFits, sourceLabel, MAX_SOURCE_LEN } from "./verified-builders";
import { MAX_NAME_LEN, plainProfileName, type ProjectProofState } from "./builders-gallery";

export interface MyProject {
  id: number;
  source: string;
  active: boolean;
}

/** The connected wallet's builder, as read live. */
export interface MyBuilder {
  id: number;
  owner: string;
  active: boolean;
  profileURI: string;
  /** Every project ever added (removed ones included: they keep their slot). */
  projects: MyProject[];
}

export type ClaimTarget =
  | { kind: "register"; functionName: "registerBuilderWithProject"; args: readonly [string, string] }
  | { kind: "addProject"; functionName: "addProject"; args: readonly [string] }
  /** Already an active project of this builder: publishing the new proof is all. */
  | { kind: "resign"; projectId: number }
  | { kind: "blocked"; reason: string };

/** Slots used / left of the MAX_PROJECTS_PER_BUILDER (16); a removed project keeps its slot. */
export function projectSlots(b: Pick<MyBuilder, "projects"> | null): { used: number; left: number; max: number } {
  const used = b?.projects.length ?? 0;
  return { used, left: Math.max(0, MAX_PROJECTS_PER_BUILDER - used), max: MAX_PROJECTS_PER_BUILDER };
}

/** Why a typed display name cannot be the profile, or null (empty is fine: no name). */
export function displayNameError(name: string): string | null {
  if (!name.trim()) return null;
  return plainProfileName(name) ? null : `Up to ${MAX_NAME_LEN} Latin letters, digits, spaces and . , ' & + _ ( ) ! - (no links, no other scripts).`;
}

/** BuilderRegistry.MAX_PROFILE_LEN: the profile (display name), in UTF-8 bytes. */
export const MAX_PROFILE_LEN = 256;

/**
 * Pure: an owner's new display name (`updateProfile`), as /verify previews it.
 * The registry takes up to MAX_PROFILE_LEN bytes of anything; the gallery only
 * ever SHOWS a plain name (plainProfileName) and only once the builder is
 * onboarded, so the preview says what will actually appear. Empty clears it.
 */
export function profileEdit(name: string): { ok: boolean; bytes: number; value: string; shownAs: string | null; error: string | null } {
  const value = name.trim();
  const bytes = byteLength(value);
  if (bytes > MAX_PROFILE_LEN) return { ok: false, bytes, value, shownAs: null, error: `${bytes} bytes: the registry takes at most ${MAX_PROFILE_LEN}.` };
  const shownAs = value ? plainProfileName(value) : null;
  return { ok: true, bytes, value, shownAs, error: null };
}

/** Pure: may the owner remove this project (`removeProject`)? Its slot stays used. */
export function removeProjectNote(b: Pick<MyBuilder, "projects">): string {
  const s = projectSlots(b);
  return `A removed project keeps its slot (${s.used} of ${s.max} used, still ${s.used} after); adding it again later takes a new one.`;
}

/** Why a canonical source cannot be registered as it is, or null. */
export function sourceError(source: string): string | null {
  if (!sourceFits(source)) return `${sourceLabel(source)} is ${byteLength(source)} bytes as a source; the registry takes at most ${MAX_SOURCE_LEN}.`;
  return null;
}

/** Pure: the transaction (if any) that finishes a claim of `source` by this wallet. */
export function planClaim(o: { source: string; displayName?: string; builder: MyBuilder | null }): ClaimTarget {
  const tooLong = sourceError(o.source);
  if (tooLong) return { kind: "blocked", reason: tooLong };
  const b = o.builder;
  if (!b) {
    const name = plainProfileName(o.displayName ?? "") ?? "";
    return { kind: "register", functionName: "registerBuilderWithProject", args: [name, o.source] };
  }
  if (!b.active) return { kind: "blocked", reason: `Builder #${b.id} is deactivated; it cannot take projects.` };
  const existing = b.projects.find((p) => p.active && p.source === o.source);
  if (existing) return { kind: "resign", projectId: existing.id };
  if (projectSlots(b).left === 0) {
    return { kind: "blocked", reason: `Builder #${b.id} has used all ${MAX_PROJECTS_PER_BUILDER} project slots (removed projects keep theirs).` };
  }
  return { kind: "addProject", functionName: "addProject", args: [o.source] };
}

/** What the connected owner's project list says about one project. */
export type MyProjectStatus = "verified" | "lapsed" | "missing" | "resign" | "unchecked" | "checking" | "removed";

export function myProjectStatus(p: MyProject, proof: ProjectProofState | undefined): MyProjectStatus {
  if (!p.active) return "removed";
  if (!proof) return "checking";
  if (proof.state === "valid") return "verified";
  if (proof.state === "resign") return "resign";
  if (proof.state === "missing") return "missing";
  if (proof.state === "unchecked") return "unchecked";
  return "lapsed";
}

/** Pure: the active projects whose proof names another wallet (re-sign with this one). */
export function projectsToResign(projects: MyProject[], proofs: ReadonlyMap<number, ProjectProofState>): MyProject[] {
  return projects.filter((p) => p.active && proofs.get(p.id)?.state === "resign");
}

export type StepState = "done" | "active" | "todo";

/**
 * Pure: the five steps' states — connect, project, sign, publish, and the
 * last one (register / add the project / nothing to send for a re-sign).
 */
export function stepStates(o: {
  connected: boolean;
  claimFrozen: boolean;
  inputsOk: boolean;
  signed: boolean;
  proofLive: boolean;
  target: ClaimTarget | null;
  /** The last step's tx was mined (or, for a re-sign, the proof is live). */
  finished: boolean;
}): [StepState, StepState, StepState, StepState, StepState] {
  const s1: StepState = o.connected || o.claimFrozen ? "done" : "active";
  const s2: StepState = o.claimFrozen ? "done" : o.connected ? "active" : "todo";
  const s3: StepState = o.signed ? "done" : o.claimFrozen || (o.connected && o.inputsOk) ? "active" : "todo";
  const s4: StepState = o.signed ? (o.proofLive ? "done" : "active") : "todo";
  const resign = o.target?.kind === "resign";
  const s5: StepState = !o.signed ? "todo" : o.finished || (resign && o.proofLive) ? "done" : "active";
  return [s1, s2, s3, s4, s5];
}

/** The last step's title. */
export function finalStepTitle(target: ClaimTarget | null, network: string): string {
  if (!target || target.kind === "register") return `Register on ${network}`;
  if (target.kind === "addProject") return `Add the project on ${network}`;
  if (target.kind === "resign") return "Done: nothing to send";
  return `Register on ${network}`;
}
