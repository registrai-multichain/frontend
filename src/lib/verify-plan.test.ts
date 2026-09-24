import { describe, expect, test } from "vitest";
import { encodeFunctionData } from "viem";
import {
  displayNameError,
  finalStepTitle,
  myProjectStatus,
  planClaim,
  projectSlots,
  projectsToResign,
  sourceError,
  stepStates,
  type MyBuilder,
} from "./verify-plan";
import { verifiedBuilderAbi } from "./verified-builders-chain";
import type { ProjectProofState } from "./builders-gallery";

const OWNER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const builder = (over: Partial<MyBuilder> = {}): MyBuilder => ({
  id: 7,
  owner: OWNER,
  active: true,
  profileURI: "Acme",
  projects: [
    { id: 70, source: "github:acme/tool", active: true },
    { id: 71, source: "domain:old.acme.xyz", active: false },
  ],
  ...over,
});

describe("planClaim: new vs existing builder", () => {
  test("not registered: registerBuilderWithProject(name or '', source) in one tx", () => {
    const t = planClaim({ source: "github:acme/tool", displayName: "  Acme  Labs ", builder: null });
    expect(t).toEqual({ kind: "register", functionName: "registerBuilderWithProject", args: ["Acme Labs", "github:acme/tool"] });
    // an unusable name registers without one (the form blocks it first)
    expect(planClaim({ source: "github:acme/tool", displayName: "https://acme.xyz", builder: null })).toMatchObject({ args: ["", "github:acme/tool"] });
    expect(planClaim({ source: "github:acme/tool", builder: null })).toMatchObject({ args: ["", "github:acme/tool"] });
    // the plan encodes against the registry ABI
    if (t.kind !== "register") throw new Error();
    expect(encodeFunctionData({ abi: verifiedBuilderAbi, functionName: t.functionName, args: [...t.args] })).toMatch(/^0x/);
  });

  test("registered: a new source is addProject(source)", () => {
    expect(planClaim({ source: "domain:acme.xyz", builder: builder() })).toEqual({ kind: "addProject", functionName: "addProject", args: ["domain:acme.xyz"] });
    // a removed project's source is added again (a new project, a new slot)
    expect(planClaim({ source: "domain:old.acme.xyz", builder: builder() }).kind).toBe("addProject");
  });

  test("registered: an active project's source is a re-sign — nothing to send", () => {
    expect(planClaim({ source: "github:acme/tool", builder: builder() })).toEqual({ kind: "resign", projectId: 70 });
  });

  test("blocked: 16 slots used (removed projects count), deactivated builder, source over 128 bytes", () => {
    const full = builder({ projects: Array.from({ length: 16 }, (_, i) => ({ id: i + 1, source: `github:acme/p${i}`, active: i % 2 === 0 })) });
    expect(projectSlots(full)).toEqual({ used: 16, left: 0, max: 16 });
    expect(planClaim({ source: "github:acme/new", builder: full })).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/16 project slots/) });
    // a re-sign still works on a full builder
    expect(planClaim({ source: "github:acme/p0", builder: full }).kind).toBe("resign");
    expect(planClaim({ source: "github:acme/new", builder: builder({ active: false }) })).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/deactivated/) });
    const long = `github:${"a".repeat(39)}/${"r".repeat(100)}`;
    expect(sourceError(long)).toMatch(/at most 128/);
    expect(planClaim({ source: long, builder: null })).toMatchObject({ kind: "blocked" });
    expect(sourceError("github:acme/tool")).toBeNull();
  });

  test("slots and names", () => {
    expect(projectSlots(null)).toEqual({ used: 0, left: 16, max: 16 });
    expect(projectSlots(builder())).toEqual({ used: 2, left: 14, max: 16 });
    expect(displayNameError("")).toBeNull();
    expect(displayNameError("Acme Labs")).toBeNull();
    expect(displayNameError("ipfs://x")).toMatch(/no links/);
  });
});

describe("re-sign detection", () => {
  const proofs = new Map<number, ProjectProofState>([
    [1, { state: "valid", country: "PL" }],
    [2, { state: "resign", signer: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" }],
    [3, { state: "missing" }],
    [4, { state: "invalid", reason: "claim is for chain 1" }],
    [5, { state: "unchecked" }],
    [6, { state: "resign", signer: "0xabc" }],
  ]);
  const projects = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, source: `github:acme/p${id}`, active: id !== 6 }));

  test("a proof naming another wallet asks for a re-sign; removed projects never do", () => {
    expect(projectsToResign(projects, proofs).map((p) => p.id)).toEqual([2]);
    expect(projects.map((p) => myProjectStatus(p, proofs.get(p.id)))).toEqual([
      "verified", "resign", "missing", "lapsed", "unchecked", "removed", "checking",
    ]);
  });
});

describe("stepStates", () => {
  const base = { connected: true, claimFrozen: false, inputsOk: false, signed: false, proofLive: false, target: null, finished: false };
  test("new builder: connect → project → sign → publish → register", () => {
    expect(stepStates({ ...base, connected: false })).toEqual(["active", "todo", "todo", "todo", "todo"]);
    expect(stepStates(base)).toEqual(["done", "active", "todo", "todo", "todo"]);
    expect(stepStates({ ...base, inputsOk: true })).toEqual(["done", "active", "active", "todo", "todo"]);
    const target = planClaim({ source: "github:a/b", builder: null });
    const signed = { ...base, claimFrozen: true, inputsOk: true, signed: true, target };
    expect(stepStates(signed)).toEqual(["done", "done", "done", "active", "active"]);
    expect(stepStates({ ...signed, proofLive: true })).toEqual(["done", "done", "done", "done", "active"]);
    expect(stepStates({ ...signed, proofLive: true, finished: true })).toEqual(["done", "done", "done", "done", "done"]);
    expect(finalStepTitle(target, "Arc")).toBe("Register on Arc");
  });

  test("existing builder: the last step adds the project; a re-sign is done once the proof is live", () => {
    const add = planClaim({ source: "github:new/one", builder: builder() });
    expect(finalStepTitle(add, "Arc")).toBe("Add the project on Arc");
    const resign = planClaim({ source: "github:acme/tool", builder: builder() });
    expect(finalStepTitle(resign, "Arc")).toBe("Done: nothing to send");
    const signed = { ...base, claimFrozen: true, inputsOk: true, signed: true, target: resign };
    expect(stepStates(signed)[4]).toBe("active");
    expect(stepStates({ ...signed, proofLive: true })[4]).toBe("done");
  });
});
