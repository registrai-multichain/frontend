import { describe, expect, test } from "vitest";
import { getAddress, type Address } from "viem";
import type { GalleryBuilder } from "./builders-gallery";
import { gaslessCandidates, gaslessState, type GaslessRequest } from "./gasless-registrations";
import { planOnboarding } from "./onboard-batch";

const ALICE = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const BOB = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const REG = "0x00000000000000000000000000000000000000a1" as Address;
const CARE = "0x00000000000000000000000000000000000000a2" as Address;
const OP = "0x00000000000000000000000000000000000000a3" as Address;

const req = (source: string, builder = ALICE): GaslessRequest => ({ source, builder, requestedAt: "2026-09-25T12:00:00.000Z" });

function builder(id: number, owner: string, projects: [string, boolean][], status: GalleryBuilder["status"] = "pending"): GalleryBuilder {
  return {
    id,
    owner,
    status,
    profileURI: "",
    projects: projects.map(([source, active], i) => ({ id: id * 100 + i, source, active, status: "verified", country: null, proofUrl: null })),
    country: null,
    badge: null,
    createdAt: 0,
  };
}

describe("gaslessState", () => {
  test("a new wallet registers; an existing one adds the project; an active project is done", () => {
    expect(gaslessState(req("github:alice/app"), [])).toEqual({ kind: "register" });
    const b = builder(3, ALICE, [["github:alice/old", true], ["github:alice/app", false]]);
    expect(gaslessState(req("github:alice/app"), [b])).toEqual({ kind: "addProject", builderId: 3 });
    expect(gaslessState(req("github:alice/old"), [b])).toEqual({ kind: "done", builderId: 3 });
    // another wallet's project with the same source does not make this one done
    expect(gaslessState(req("github:alice/old", BOB), [b])).toEqual({ kind: "register" });
  });

  test("a deactivated builder or a full one is blocked", () => {
    expect(gaslessState(req("github:alice/app"), [builder(3, ALICE, [], "inactive")]).kind).toBe("blocked");
    const full = builder(4, ALICE, Array.from({ length: 16 }, (_, i) => [`github:alice/p${i}`, false] as [string, boolean]));
    expect(gaslessState(req("github:alice/app"), [full])).toEqual({ kind: "blocked", reason: "builder #4 has 16 projects (the limit)" });
  });
});

describe("gaslessCandidates → planOnboarding", () => {
  test("registerFor for a new wallet, addProjectFor for an existing builder, done ones left out, bad proofs skipped", () => {
    const builders = [builder(3, BOB, [["github:bob/live", true]])];
    const requests = [req("github:alice/app"), req("github:bob/next", BOB), req("github:bob/live", BOB), req("github:alice/gone")];
    const candidates = gaslessCandidates(requests, builders, (s) => s !== "github:alice/gone");
    expect(candidates.map((c) => [c.source, c.builder, c.existingId])).toEqual([
      ["github:alice/app", getAddress(ALICE), 0],
      ["github:bob/next", getAddress(BOB), 3],
      ["github:alice/gone", null, 0],
    ]);
    const plan = planOnboarding({ records: [], registrations: candidates, builderRegistry: REG, caretakerRegistry: CARE, operator: OP });
    expect(plan.txs.map((t) => t.kind)).toEqual(["registerFor", "addProjectFor"]);
    expect(plan.txs.every((t) => t.to === REG)).toBe(true);
    expect(plan.skipped).toEqual([{ what: "register github:alice/gone", reason: "its proof does not check out for the requesting wallet right now" }]);
  });

  test("after registerFor ran, the next batch adds the project", () => {
    const afterFirst = [builder(9, ALICE, [], "unverified")];
    const plan = planOnboarding({
      records: [],
      registrations: gaslessCandidates([req("github:alice/app")], afterFirst, () => true),
      builderRegistry: REG,
      caretakerRegistry: CARE,
      operator: OP,
    });
    expect(plan.txs.map((t) => t.label)).toEqual(['addProjectFor(9, "github:alice/app")']);
  });
});
