import { describe, expect, test } from "vitest";
import { decodeFunctionData, type Address } from "viem";
import {
  calldataList,
  cancelRecoveryTx,
  planOnboarding,
  safeBatchJson,
  setProjectActiveTx,
  singleTxSafeFile,
  startRecoveryTx,
  verifiedSourcesOf,
} from "./onboard-batch";
import { verifiedBuilderAbi } from "./verified-builders-chain";
import { badgeAbi } from "./verified-builder-badge";

const OP = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263" as Address;
const REG = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4" as Address;
const CARE = "0x02CfdE88a97A56A7dbDC05F6c7BD3Dbc34393876" as Address;
const B0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const B1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const B2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const records = [
  { builderId: 1, status: "unverified" as const, owner: B2, activeProjectCount: 0 },
  { builderId: 2, status: "pending" as const, owner: B0, activeProjectCount: 2, verifiedSources: ["github:o/r", "domain:o.org"] },
  { builderId: 3, status: "verified" as const, owner: B1, activeProjectCount: 1, verifiedSources: ["github:v/v"] },
  { builderId: 4, status: "lapsed" as const, owner: B1, activeProjectCount: 1 },
  { builderId: 5, status: "pending" as const, owner: B1, activeProjectCount: 1, verifiedSources: ["domain:app.example.org"] },
];

describe("planOnboarding", () => {
  const plan = planOnboarding({
    records,
    registrations: [
      { source: "github:new/one", builder: B2, existingId: 0 },
      { source: "github:bad/proof", builder: null, proofError: "rule 3: forged", existingId: 0 },
      { source: "github:already/there", builder: B0, existingId: 2, existingSources: ["github:already/there"], existingProjectCount: 2 },
      // another builder listing the same source never blocks this one: the proof names the wallet
      { source: "github:v/v", builder: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", existingId: 0 },
      { source: "domain:second.example", builder: B0, existingId: 2, existingSources: ["github:already/there"], existingProjectCount: 2 },
      { source: "github:full/up", builder: B1, existingId: 3, existingSources: [], existingProjectCount: 16 },
      { source: "github:off/line", builder: B1, existingId: 4, existingActive: false },
    ],
    builderRegistry: REG,
    caretakerRegistry: CARE,
    operator: OP,
  });

  test("setCaretaker per pending builder; registerFor for new wallets, addProjectFor for registered ones", () => {
    expect(plan.txs.map((t) => t.kind)).toEqual(["registerFor", "registerFor", "addProjectFor", "setCaretaker", "setCaretaker"]);
    const dec = plan.txs.map((t) => decodeFunctionData({ abi: verifiedBuilderAbi, data: t.data }));
    expect(dec.slice(0, 3)).toEqual([
      { functionName: "registerFor", args: [B2, ""] },
      { functionName: "registerFor", args: ["0x90F79bf6EB2c4f870365E785982E1f101E93b906", ""] },
      { functionName: "addProjectFor", args: [2n, "domain:second.example"] },
    ]);
    expect(plan.txs.slice(0, 3).every((t) => t.to === REG)).toBe(true);
    expect(plan.txs[0].label).toContain("addProjectFor(<new id>, \"github:new/one\") in the next batch");
    expect(dec.slice(3)).toEqual([
      { functionName: "setCaretaker", args: [2n, OP] },
      { functionName: "setCaretaker", args: [5n, OP] },
    ]);
    expect(plan.txs[3].label).toBe(`setCaretaker(2, ${OP})  # o/r, o.org`);
    expect(plan.txs.slice(3).every((t) => t.to === CARE && t.value === "0")).toBe(true);
    expect(plan.skipped).toEqual([
      { what: "register github:bad/proof", reason: "rule 3: forged" },
      { what: "register github:already/there", reason: "already a project of builder #2" },
      { what: "register github:full/up", reason: "builder #3 has 16 projects (the limit)" },
      { what: "register github:off/line", reason: "builder #4 is deactivated" },
    ]);
  });

  test("the same wallet twice in one batch registers once", () => {
    const p = planOnboarding({
      records: [],
      registrations: [
        { source: "github:a/one", builder: B2, existingId: 0 },
        { source: "github:a/two", builder: B2, existingId: 0 },
      ],
      builderRegistry: REG, caretakerRegistry: CARE, operator: OP,
    });
    expect(p.txs.map((t) => t.kind)).toEqual(["registerFor"]);
    expect(p.skipped).toEqual([{ what: "register github:a/two", reason: "duplicate in this batch" }]);
  });

  test("Safe Transaction Builder shape", () => {
    const safe = safeBatchJson(plan.txs, { chainId: 5042002, createdAt: 1_790_000_000_000 });
    expect(Object.keys(safe)).toEqual(["version", "chainId", "createdAt", "meta", "transactions"]);
    expect(safe.version).toBe("1.0");
    expect(safe.chainId).toBe("5042002");
    expect(safe.createdAt).toBe(1_790_000_000_000);
    expect(safe.transactions).toHaveLength(5);
    for (const t of safe.transactions) {
      expect(Object.keys(t)).toEqual(["to", "value", "data"]);
      expect(t.value).toBe("0");
      expect(t.data).toMatch(/^0x[0-9a-f]+$/);
    }
    expect(safe.meta.description).toBe("2 registerFor, 2 setCaretaker, 1 addProjectFor");
  });

  test("calldata list", () => {
    const text = calldataList(plan.txs);
    expect(text.split("\n").filter((l) => l.startsWith("data=0x"))).toHaveLength(5);
    expect(text).toContain(`to=${CARE}`);
    expect(calldataList([])).toBe("# nothing to do\n");
  });
});

describe("planOnboarding --badge", () => {
  const BADGE = "0x05de78E9Ff17ccE47D7F4E9170fdfC130Abe278c" as Address;
  const base = { registrations: [], builderRegistry: REG, caretakerRegistry: CARE, operator: OP };
  const decode = (t: { to: Address; data: `0x${string}` }) =>
    t.to === BADGE ? decodeFunctionData({ abi: badgeAbi, data: t.data }) : decodeFunctionData({ abi: verifiedBuilderAbi, data: t.data });
  const calls = (p: ReturnType<typeof planOnboarding>) => p.txs.map((t) => [t.to, decode(t).functionName, (decode(t).args ?? [])[0]]);

  test("pending: setCaretaker then issue, same builder, adjacent", () => {
    const p = planOnboarding({ ...base, records: [records[1]], badge: { address: BADGE, serials: new Map([[2, 0]]) } });
    expect(calls(p)).toEqual([
      [CARE, "setCaretaker", 2n],
      [BADGE, "issue", 2n],
    ]);
    expect(p.txs.map((t) => t.kind)).toEqual(["setCaretaker", "issue"]);
  });

  test("verified without a badge: issue only; verified with one: nothing", () => {
    const without = planOnboarding({ ...base, records: [records[2]], badge: { address: BADGE, serials: new Map() } });
    expect(calls(without)).toEqual([[BADGE, "issue", 3n]]);
    const withBadge = planOnboarding({ ...base, records: [records[2]], badge: { address: BADGE, serials: new Map([[3, 7]]) } });
    expect(withBadge.txs).toEqual([]);
  });

  test("issue only while the builder has an active project (else NoProject)", () => {
    const p = planOnboarding({ ...base, records: [{ ...records[1], activeProjectCount: 0 }], badge: { address: BADGE, serials: new Map() } });
    expect(calls(p)).toEqual([[CARE, "setCaretaker", 2n]]);
    expect(p.skipped).toEqual([{ what: "issue(2)", reason: "no active project (the badge would revert NoProject)" }]);
    expect(p.txs.find((t) => t.kind === "issue")).toBeUndefined();
  });

  test("the issue label names the builder's verified projects", () => {
    const p = planOnboarding({ ...base, records: [records[1]], badge: { address: BADGE, serials: new Map() } });
    expect(p.txs[1].label).toBe("issue(2)  # Verified Builder Badge for builder #2: o/r, o.org");
  });

  test("lapsed and unverified builders never get issue", () => {
    const p = planOnboarding({ ...base, records: [records[0], records[3]], badge: { address: BADGE, serials: new Map() } });
    expect(p.txs).toEqual([]);
  });

  test("a whole cohort: each issue follows its own setCaretaker; description counts issues", () => {
    const p = planOnboarding({ ...base, records, badge: { address: BADGE, serials: new Map([[2, 0], [3, 0], [5, 4]]) } });
    expect(calls(p)).toEqual([
      [CARE, "setCaretaker", 2n],
      [BADGE, "issue", 2n],
      [BADGE, "issue", 3n],
      [CARE, "setCaretaker", 5n],
    ]);
    expect(safeBatchJson(p.txs, { chainId: 5042002, createdAt: 0 }).meta.description).toBe("0 registerFor, 2 setCaretaker, 2 issue");
    expect(calldataList(p.txs)).toContain(`to=${BADGE}`);
  });

  test("without --badge the batch is unchanged: only setCaretaker for pending builders", () => {
    const p = planOnboarding({ ...base, records });
    expect(calls(p)).toEqual([
      [CARE, "setCaretaker", 2n],
      [CARE, "setCaretaker", 5n],
    ]);
    expect(safeBatchJson(p.txs, { chainId: 5042002, createdAt: 0 }).meta.description).toBe("0 registerFor, 2 setCaretaker");
  });
});

describe("single-transaction Safe files", () => {
  const NEW = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;
  test("startRecovery / cancelRecovery / setProjectActive encode the registry calls", () => {
    expect(decodeFunctionData({ abi: verifiedBuilderAbi, data: startRecoveryTx(REG, 7, NEW).data })).toEqual({ functionName: "startRecovery", args: [7n, NEW] });
    expect(decodeFunctionData({ abi: verifiedBuilderAbi, data: cancelRecoveryTx(REG, 7).data })).toEqual({ functionName: "cancelRecovery", args: [7n] });
    expect(decodeFunctionData({ abi: verifiedBuilderAbi, data: setProjectActiveTx(REG, 12, false).data })).toEqual({ functionName: "setProjectActive", args: [12n, false] });
    const f = singleTxSafeFile(setProjectActiveTx(REG, 12, false, "github:x/y"), { chainId: 5042, createdAt: 1, name: "n" });
    expect(f).toMatchObject({ chainId: "5042", meta: { name: "n", description: "setProjectActive(12, false)  # github:x/y" } });
    expect(f.transactions).toEqual([{ to: REG, value: "0", data: expect.stringMatching(/^0x/) }]);
    expect(startRecoveryTx(REG, 7, NEW).to).toBe(REG);
  });

  test("verifiedSourcesOf: the verified projects only", () => {
    const p = (source: string, status: "verified" | "lapsed" | "inactive") => ({ projectId: 1, source, canonical: true, active: true, addedAt: 0, status, country: null, proofUrl: null });
    expect(verifiedSourcesOf({ projects: [p("github:a/b", "verified"), p("github:c/d", "lapsed"), p("domain:e.org", "verified")] })).toEqual(["github:a/b", "domain:e.org"]);
  });
});
