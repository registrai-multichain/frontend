import { describe, expect, test } from "vitest";
import { decodeFunctionData, type Address } from "viem";
import { calldataList, planOnboarding, safeBatchJson } from "./onboard-batch";
import { verifiedBuilderAbi } from "./verified-builders-chain";
import { badgeAbi } from "./verified-builder-badge";

const OP = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263" as Address;
const REG = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4" as Address;
const CARE = "0x02CfdE88a97A56A7dbDC05F6c7BD3Dbc34393876" as Address;
const B0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const B1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const B2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;

const records = [
  { builderId: 1, status: "unverified" as const, source: null, owner: B2 },
  { builderId: 2, status: "pending" as const, source: "github:o/r", owner: B0 },
  { builderId: 3, status: "verified" as const, source: "github:v/v", owner: B1 },
  { builderId: 4, status: "lapsed" as const, source: "domain:gone.example", owner: B1 },
  { builderId: 5, status: "pending" as const, source: "domain:app.example.org", owner: B1 },
];

describe("planOnboarding", () => {
  const plan = planOnboarding({
    records,
    registrations: [
      { source: "github:new/one", builder: B2, existingId: 0 },
      { source: "github:bad/proof", builder: null, proofError: "rule 3: forged", existingId: 0 },
      { source: "github:already/there", builder: B0, existingId: 2 },
      { source: "github:v/v", builder: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", existingId: 0 },
    ],
    builderRegistry: REG,
    caretakerRegistry: CARE,
    operator: OP,
  });

  test("setCaretaker only for pending builders; registerFor only for valid, unregistered claims", () => {
    expect(plan.txs.map((t) => t.kind)).toEqual(["registerFor", "setCaretaker", "setCaretaker"]);
    const reg = decodeFunctionData({ abi: verifiedBuilderAbi, data: plan.txs[0].data });
    expect(reg).toEqual({ functionName: "registerFor", args: [B2, "registrai:github:new/one"] });
    expect(plan.txs[0].to).toBe(REG);
    const care = plan.txs.slice(1).map((t) => decodeFunctionData({ abi: verifiedBuilderAbi, data: t.data }));
    expect(care).toEqual([
      { functionName: "setCaretaker", args: [2n, OP] },
      { functionName: "setCaretaker", args: [5n, OP] },
    ]);
    expect(plan.txs.slice(1).every((t) => t.to === CARE && t.value === "0")).toBe(true);
    expect(plan.skipped.map((s) => s.what)).toEqual([
      "registerFor github:bad/proof",
      "registerFor github:already/there",
      "registerFor github:v/v",
    ]);
  });

  test("Safe Transaction Builder shape", () => {
    const safe = safeBatchJson(plan.txs, { chainId: 5042002, createdAt: 1_790_000_000_000 });
    expect(Object.keys(safe)).toEqual(["version", "chainId", "createdAt", "meta", "transactions"]);
    expect(safe.version).toBe("1.0");
    expect(safe.chainId).toBe("5042002");
    expect(safe.createdAt).toBe(1_790_000_000_000);
    expect(safe.transactions).toHaveLength(3);
    for (const t of safe.transactions) {
      expect(Object.keys(t)).toEqual(["to", "value", "data"]);
      expect(t.value).toBe("0");
      expect(t.data).toMatch(/^0x[0-9a-f]+$/);
    }
    expect(safe.meta.description).toBe("1 registerFor, 2 setCaretaker");
  });

  test("calldata list", () => {
    const text = calldataList(plan.txs);
    expect(text.split("\n").filter((l) => l.startsWith("data=0x"))).toHaveLength(3);
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
