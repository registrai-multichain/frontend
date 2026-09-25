/**
 * "Register it for me" requests (builders-site/lib/register-requests.ts) in
 * /admin: where each one stands on-chain, and the RegistrationCandidates that
 * planOnboarding turns into registerFor / addProjectFor for the Safe batch.
 * A new wallet takes two batches: registerFor now, addProjectFor once its
 * builder id exists. Pure; the proof re-check happens in the caller.
 */
import { getAddress, type Address } from "viem";
import type { GalleryBuilder } from "./builders-gallery";
import type { RegistrationCandidate } from "./onboard-batch";

/** GET /api/admin/register-requests. */
export interface GaslessRequest {
  source: string;
  /** claim.builder when the request was made (lowercase). */
  builder: string;
  requestedAt: string;
}

export type GaslessState =
  /** The source is an active project of the requesting wallet's builder: nothing left to do. */
  | { kind: "done"; builderId: number }
  /** The wallet has no builder yet: registerFor now, addProjectFor in the next batch. */
  | { kind: "register" }
  /** The wallet's builder exists: addProjectFor. */
  | { kind: "addProject"; builderId: number }
  | { kind: "blocked"; reason: string };

const MAX_PROJECTS = 16;

/** Pure: where a request stands against the builders as read from the chain. */
export function gaslessState(req: GaslessRequest, builders: readonly GalleryBuilder[]): GaslessState {
  const b = builders.find((x) => x.owner === req.builder.toLowerCase());
  if (!b) return { kind: "register" };
  if (b.projects.some((p) => p.source === req.source && p.active)) return { kind: "done", builderId: b.id };
  if (b.status === "inactive") return { kind: "blocked", reason: `builder #${b.id} is deactivated` };
  if (b.projects.length >= MAX_PROJECTS) return { kind: "blocked", reason: `builder #${b.id} has ${MAX_PROJECTS} projects (the limit)` };
  return { kind: "addProject", builderId: b.id };
}

/**
 * Pure: planOnboarding's registrations for the open requests. `proofOk(source)`
 * is the re-check made just now against the requesting wallet: a request
 * whose proof no longer checks out becomes a skipped candidate (builder null).
 * Done requests are left out.
 */
export function gaslessCandidates(
  requests: readonly GaslessRequest[],
  builders: readonly GalleryBuilder[],
  proofOk: (source: string) => boolean,
): RegistrationCandidate[] {
  const out: RegistrationCandidate[] = [];
  for (const req of requests) {
    const state = gaslessState(req, builders);
    if (state.kind === "done") continue;
    if (!proofOk(req.source)) {
      out.push({ source: req.source, builder: null, proofError: "its proof does not check out for the requesting wallet right now", existingId: 0 });
      continue;
    }
    const builder = getAddress(req.builder) as Address;
    const existing = builders.find((x) => x.owner === req.builder.toLowerCase());
    out.push({
      source: req.source,
      builder,
      existingId: existing?.id ?? 0,
      existingSources: existing ? existing.projects.filter((p) => p.active).map((p) => p.source) : [],
      existingProjectCount: existing?.projects.length ?? 0,
      existingActive: existing ? existing.status !== "inactive" : true,
    });
  }
  return out;
}
