import { describe, expect, test } from "vitest";
import { BaseError, encodeErrorResult, keccak256, toBytes, zeroAddress, type Address } from "viem";
import {
  GOVERNOR_ROLE,
  ISSUER_ROLE,
  accessControlAbi,
  onboardStepCall,
  onboarderGate,
  onboarderRoles,
  planOnboardSteps,
  readBuilderForOnboarding,
} from "./builders-onboarder";
import type { GalleryReader } from "./builders-gallery";
import { decodeRevertData, humanizeError } from "./humanize-error";

const OP = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263" as Address;
const REG = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4" as Address;
const CARE = "0x02CfdE88a97A56A7dbDC05F6c7BD3Dbc34393876" as Address;
const BADGE = "0x05de78E9Ff17ccE47D7F4E9170fdfC130Abe278c" as Address;
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const HOT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const base = { builderId: 7, active: true, activeProjectCount: 1, caretaker: zeroAddress as string, operator: OP as Address | null, serial: 0 };
const kinds = (p: ReturnType<typeof planOnboardSteps>) => (p.ok ? p.steps.map((s) => s.kind) : p.reason);

describe("role ids", () => {
  test("are the OZ keccak256 of the role names", () => {
    expect(ISSUER_ROLE).toBe(keccak256(toBytes("ISSUER_ROLE")));
    expect(GOVERNOR_ROLE).toBe(keccak256(toBytes("GOVERNOR_ROLE")));
    expect(ISSUER_ROLE).not.toBe(GOVERNOR_ROLE);
  });
});

describe("planOnboardSteps", () => {
  // caretaker ∈ {none, other, operator} × serial ∈ {0, n} × activeProjectCount ∈ {0, 2}
  const caretakers = { none: zeroAddress, other: OTHER, operator: OP } as const;
  for (const [cName, caretaker] of Object.entries(caretakers)) {
    for (const serial of [0, 12]) {
      for (const activeProjectCount of [0, 2]) {
        test(`caretaker ${cName}, serial ${serial}, ${activeProjectCount} active projects`, () => {
          const p = planOnboardSteps({ ...base, caretaker, serial, activeProjectCount });
          if (activeProjectCount === 0) {
            expect(p).toEqual({ ok: false, reason: "Builder #7 has no active project." });
            return;
          }
          const want = [...(cName === "operator" ? [] : ["setCaretaker"]), ...(serial === 0 ? ["issue"] : [])];
          expect(kinds(p)).toEqual(want);
        });
      }
    }
  }

  test("setCaretaker comes before issue and names the operator", () => {
    const p = planOnboardSteps(base);
    expect(p).toEqual({ ok: true, steps: [{ kind: "setCaretaker", builderId: 7, operator: OP }, { kind: "issue", builderId: 7 }] });
  });

  test("the caretaker compare ignores address case", () => {
    expect(kinds(planOnboardSteps({ ...base, caretaker: OP.toLowerCase() }))).toEqual(["issue"]);
  });

  test("idempotent: re-running on the state the plan produces is empty", () => {
    let state = { ...base };
    const first = planOnboardSteps(state);
    expect(kinds(first)).toEqual(["setCaretaker", "issue"]);
    // apply the steps as the chain would
    for (const s of first.ok ? first.steps : []) {
      if (s.kind === "setCaretaker") state = { ...state, caretaker: s.operator };
      if (s.kind === "issue") state = { ...state, serial: 31 };
    }
    expect(planOnboardSteps(state)).toEqual({ ok: true, steps: [] });
    expect(planOnboardSteps(state)).toEqual({ ok: true, steps: [] });
  });

  test("a run that stopped after setCaretaker resumes with issue only", () => {
    expect(kinds(planOnboardSteps({ ...base, caretaker: OP }))).toEqual(["issue"]);
  });

  test("refuses a deactivated builder, even with everything else to do", () => {
    expect(planOnboardSteps({ ...base, active: false })).toEqual({ ok: false, reason: "Builder #7 is deactivated on the registry." });
    expect(planOnboardSteps({ ...base, active: false, activeProjectCount: 0 }).ok).toBe(false);
  });

  test("refuses without an operator", () => {
    expect(planOnboardSteps({ ...base, operator: null })).toEqual({ ok: false, reason: "No operator is configured for this network." });
    expect(planOnboardSteps({ ...base, operator: zeroAddress }).ok).toBe(false);
  });

  test("refuses an unregistered builder (owner 0)", () => {
    expect(planOnboardSteps({ ...base, owner: zeroAddress })).toEqual({ ok: false, reason: "Builder #7 is not registered." });
  });

  test("refuses when the owner changed since the proof check", () => {
    const p = planOnboardSteps({ ...base, owner: OTHER, expectedOwner: OWNER.toLowerCase() });
    expect(p.ok).toBe(false);
    expect(p.ok ? "" : p.reason).toMatch(/changed owner/);
    expect(kinds(planOnboardSteps({ ...base, owner: OWNER, expectedOwner: OWNER.toLowerCase() }))).toEqual(["setCaretaker", "issue"]);
  });
});

describe("onboardStepCall", () => {
  test("setCaretaker goes to the CaretakerRegistry, issue to the badge", () => {
    const c = { caretakers: CARE, badge: BADGE };
    const a = onboardStepCall({ kind: "setCaretaker", builderId: 3, operator: OP }, c);
    expect(a).toMatchObject({ address: CARE, functionName: "setCaretaker", args: [3n, OP], label: `setCaretaker(3, ${OP})` });
    const b = onboardStepCall({ kind: "issue", builderId: 3 }, c);
    expect(b).toMatchObject({ address: BADGE, functionName: "issue", args: [3n], label: "issue(3)" });
  });
});

describe("onboarderGate", () => {
  test("needs both roles", () => {
    expect(onboarderGate({ issuer: true, governor: true })).toEqual({ ok: true, missing: [] });
    expect(onboarderGate({ issuer: true, governor: false })).toEqual({ ok: false, missing: ["GOVERNOR_ROLE on CaretakerRegistry"] });
    expect(onboarderGate({ issuer: false, governor: true })).toEqual({ ok: false, missing: ["ISSUER_ROLE on VerifiedBuilderBadge"] });
    expect(onboarderGate({ issuer: false, governor: false }).missing).toHaveLength(2);
  });
  test("unknown roles gate closed", () => {
    expect(onboarderGate(null).ok).toBe(false);
    expect(onboarderGate(undefined).missing).toHaveLength(2);
  });
});

describe("chain reads", () => {
  type Call = { address: Address; functionName: string; args?: readonly unknown[] };
  const reader = (fn: (c: Call) => unknown): GalleryReader & { calls: Call[] } => {
    const calls: Call[] = [];
    return {
      calls,
      readContract: async (c) => {
        calls.push(c as Call);
        return fn(c as Call);
      },
    };
  };

  test("onboarderRoles asks each contract for its role", async () => {
    const r = reader((c) => (c.address === BADGE ? c.args?.[0] === ISSUER_ROLE : c.address === CARE && c.args?.[0] === GOVERNOR_ROLE));
    expect(await onboarderRoles(r, HOT, { caretakers: CARE, badge: BADGE })).toEqual({ issuer: true, governor: true });
    expect(r.calls.every((c) => c.functionName === "hasRole" && c.args?.[1] === HOT)).toBe(true);
  });

  test("onboarderRoles: a missing role, and a missing contract, read false", async () => {
    const r = reader((c) => c.address === CARE);
    expect(await onboarderRoles(r, HOT, { caretakers: CARE, badge: BADGE })).toEqual({ issuer: false, governor: true });
    const none = reader(() => true);
    expect(await onboarderRoles(none, HOT, { caretakers: null, badge: null })).toEqual({ issuer: false, governor: false });
    expect(none.calls).toHaveLength(0);
  });

  test("readBuilderForOnboarding reads the registry row, project count, caretaker and serial", async () => {
    const r = reader((c) => {
      if (c.functionName === "builders") return [OWNER, "", "0x", 1n, true];
      if (c.functionName === "activeProjectCount") return 2n;
      if (c.functionName === "caretakerOf") return OP;
      if (c.functionName === "serialOf") return 5n;
      throw new Error(c.functionName);
    });
    const s = await readBuilderForOnboarding(r, 9, { registry: REG, caretakers: CARE, badge: BADGE });
    expect(s).toEqual({ owner: OWNER, active: true, activeProjectCount: 2, caretaker: OP, serial: 5 });
    expect(r.calls.map((c) => [c.address, c.functionName, c.args?.[0]])).toEqual([
      [REG, "builders", 9n],
      [REG, "activeProjectCount", 9n],
      [CARE, "caretakerOf", 9n],
      [BADGE, "serialOf", 9n],
    ]);
    expect(kinds(planOnboardSteps({ builderId: 9, ...s, operator: OP }))).toEqual([]);
  });
});

describe("humanizeError", () => {
  test("explains a missing AccessControl role", () => {
    const data = encodeErrorResult({ abi: accessControlAbi, errorName: "AccessControlUnauthorizedAccount", args: [HOT, ISSUER_ROLE] });
    expect(decodeRevertData(data)).toBe("AccessControlUnauthorizedAccount");
    const e = new BaseError("call failed", { cause: Object.assign(new Error("reverted"), { data }) as never });
    expect(humanizeError(e)).toMatch(/lacks the role/);
  });
});
