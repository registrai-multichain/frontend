import { describe, expect, test } from "vitest";
import { decodeFunctionData, getAddress, zeroAddress, type Address } from "viem";
import {
  FOLLOW_UP_AFTER_MS,
  cancelRecoverySafeFile,
  deactivateProjectSafeFile,
  inviteChainStatus,
  needsFollowUp,
  onboardingQueue,
  onboardingSafeFile,
  readAdminChain,
  readRecoveries,
  revokeSafeFile,
  safeFileName,
  startRecoverySafeFile,
} from "./builders-admin-chain";
import type { GalleryBuilder, GalleryProject, GalleryReader } from "./builders-gallery";
import { verifiedBuilderAbi } from "./verified-builders-chain";
import { badgeAbi, type BadgeInfo } from "./verified-builder-badge";

const OP = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263" as Address;
const REG = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4" as Address;
const CARE = "0x02CfdE88a97A56A7dbDC05F6c7BD3Dbc34393876" as Address;
const BADGE = "0x05de78E9Ff17ccE47D7F4E9170fdfC130Abe278c" as Address;
const B0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

const badge = (serial: number, lapsed = false): BadgeInfo => ({ serial, lapsed, issuedAt: 1, image: "" });
/** A builder with one project `source` (id = builder id * 10) whose status follows the builder's. */
const b = (id: number, status: GalleryBuilder["status"], source: string | null, extra: Partial<GalleryBuilder> = {}): GalleryBuilder => {
  const ps: GalleryProject["status"] =
    status === "verified" || status === "pending" ? "verified" : status === "lapsed" ? "lapsed" : status === "unconfirmed" ? "unconfirmed" : "inactive";
  const unchecked = extra.proofUnchecked || status === "unconfirmed";
  return {
    id,
    owner: B0,
    status,
    profileURI: "",
    projects: source
      ? [{ id: id * 10, source, active: ps !== "inactive", status: ps, country: null, proofUrl: null, ...(unchecked ? { proofUnchecked: true } : {}) }]
      : [],
    country: null,
    badge: null,
    createdAt: 0,
    ...extra,
  };
};

describe("inviteChainStatus", () => {
  test("invited until a shown builder claims the source; the best claim wins", () => {
    expect(inviteChainStatus("github:a/b", [])).toEqual({ kind: "invited" });
    // an inactive or unverified builder is not a claim the gallery shows
    expect(inviteChainStatus("github:a/b", [b(1, "inactive", "github:a/b"), b(2, "unverified", null)])).toEqual({ kind: "invited" });
    expect(inviteChainStatus("github:a/b", [b(3, "lapsed", "github:a/b")])).toEqual({ kind: "lapsed", builderId: 3 });
    expect(inviteChainStatus("github:a/b", [b(3, "lapsed", "github:a/b"), b(4, "pending", "github:a/b", { proofUnchecked: true })])).toEqual({
      kind: "nominated",
      builderId: 4,
      unchecked: true,
    });
    expect(
      inviteChainStatus("github:a/b", [b(4, "pending", "github:a/b"), b(5, "verified", "github:a/b", { badge: badge(7) }), b(6, "verified", "github:c/d")]),
    ).toEqual({ kind: "verified", builderId: 5, serial: 7 });
    // a lapsed badge shows the builder as lapsed
    expect(inviteChainStatus("github:a/b", [b(5, "verified", "github:a/b", { badge: badge(7, true) })])).toEqual({ kind: "lapsed", builderId: 5 });
    // unreadable proof: unconfirmed (the gallery keeps the invite open); a verified claim still wins
    expect(inviteChainStatus("github:a/b", [b(6, "unconfirmed", "github:a/b"), b(3, "lapsed", "github:a/b")])).toEqual({ kind: "unconfirmed", builderId: 6 });
    expect(inviteChainStatus("github:a/b", [b(6, "unconfirmed", "github:a/b"), b(4, "pending", "github:a/b")])).toMatchObject({ kind: "nominated", builderId: 4 });
  });

  test("per project: the invited source among a builder's several projects", () => {
    const multi = b(9, "verified", "github:main/app", { badge: badge(3) });
    multi.projects.push(
      { id: 91, source: "github:a/b", active: true, status: "verified", country: null, proofUrl: null },
      { id: 92, source: "domain:new.example", active: true, status: "lapsed", country: null, proofUrl: null },
      { id: 93, source: "github:gone/away", active: false, status: "inactive", country: null, proofUrl: null },
    );
    expect(inviteChainStatus("github:a/b", [multi])).toEqual({ kind: "verified", builderId: 9, serial: 3 });
    // that project's own proof is lapsed: the invite shows lapsed, even on a verified builder
    expect(inviteChainStatus("domain:new.example", [multi])).toEqual({ kind: "lapsed", builderId: 9 });
    // a removed project is no longer a claim
    expect(inviteChainStatus("github:gone/away", [multi])).toEqual({ kind: "invited" });
    // pending builder: its verified projects are nominated
    const pending = b(8, "pending", "github:p/q");
    expect(inviteChainStatus("github:p/q", [pending])).toEqual({ kind: "nominated", builderId: 8, unchecked: false });
  });
});

describe("needsFollowUp", () => {
  const T = Date.parse("2026-09-24T12:00:00.000Z");
  const inv = (opens: number) => ({ createdAt: "2026-09-24T12:00:00.000Z", opens });
  test("not opened after 3 days, or opened but not claimed", () => {
    expect(needsFollowUp(inv(0), { kind: "invited" }, T + FOLLOW_UP_AFTER_MS - 1)).toBe(false);
    expect(needsFollowUp(inv(0), { kind: "invited" }, T + FOLLOW_UP_AFTER_MS)).toBe(true);
    expect(needsFollowUp(inv(1), { kind: "invited" }, T + 60_000)).toBe(true);
  });
  test("a claim (any chain status) needs no follow-up", () => {
    const later = T + 10 * FOLLOW_UP_AFTER_MS;
    expect(needsFollowUp(inv(3), { kind: "nominated", builderId: 1, unchecked: false }, later)).toBe(false);
    expect(needsFollowUp(inv(0), { kind: "verified", builderId: 1, serial: 1 }, later)).toBe(false);
    expect(needsFollowUp(inv(0), { kind: "lapsed", builderId: 1 }, later)).toBe(false);
  });
});

describe("onboardingQueue (per builder)", () => {
  const builders = [
    b(1, "unverified", null),
    b(2, "pending", "github:o/r"),
    b(3, "verified", "github:v/v"), // no badge -> issue
    b(4, "lapsed", "domain:gone.example"),
    b(5, "unconfirmed", "domain:cors.example"), // never onboarded, proof unreadable
    b(6, "verified", "github:has/badge", { badge: badge(1) }),
    b(7, "unconfirmed", "domain:v.example", { onboarded: true }), // onboarded, no badge, proof unreadable
    b(8, "inactive", "github:off/line"),
    b(9, "unconfirmed", "domain:done.example", { onboarded: true, badge: badge(2) }), // nothing left to do
  ];
  const decode = (t: { to: Address; data: `0x${string}` }) =>
    t.to === BADGE ? decodeFunctionData({ abi: badgeAbi, data: t.data }) : decodeFunctionData({ abi: verifiedBuilderAbi, data: t.data });

  test("setCaretaker then issue for pending, issue for verified without a badge; unconfirmed proofs excluded", () => {
    const q = onboardingQueue(builders, { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: BADGE, revoked: new Set() });
    expect(q.included.map((x) => x.id)).toEqual([2, 3]);
    expect(q.excluded.map((x) => x.id)).toEqual([5, 7]);
    expect(q.revoked).toEqual([]);
    expect(q.plan.txs.map((t) => [t.kind, t.to])).toEqual([
      ["setCaretaker", CARE],
      ["issue", BADGE],
      ["issue", BADGE],
    ]);
    expect(q.plan.txs.map(decode)).toEqual([
      { functionName: "setCaretaker", args: [2n, OP] },
      { functionName: "issue", args: [2n] },
      { functionName: "issue", args: [3n] },
    ]);
    const safe = onboardingSafeFile(q, 5042, 123);
    expect(safe).toMatchObject({ version: "1.0", chainId: "5042", createdAt: 123, meta: { description: "0 registerFor, 1 setCaretaker, 2 issue" } });
    expect(safe.transactions).toHaveLength(3);
  });

  test("one batch entry per builder, however many verified projects it has", () => {
    const multi = b(2, "pending", "github:o/r");
    multi.projects.push({ id: 21, source: "domain:o.org", active: true, status: "verified", country: null, proofUrl: null });
    const q = onboardingQueue([multi], { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: BADGE });
    expect(q.plan.txs.map(decode)).toEqual([
      { functionName: "setCaretaker", args: [2n, OP] },
      { functionName: "issue", args: [2n] },
    ]);
    expect(q.plan.txs[0].label).toContain("# o/r, o.org");
  });

  test("a builder with one checked and one unreadable project is included", () => {
    const mixed = b(2, "pending", "github:o/r");
    mixed.projects.push({ id: 21, source: "domain:cors.example", active: true, status: "unconfirmed", country: null, proofUrl: null, proofUnchecked: true });
    const q = onboardingQueue([mixed], { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: null });
    expect(q.included.map((x) => x.id)).toEqual([2]);
    expect(q.plan.txs[0].label).toContain("# o/r");
    expect(q.plan.txs[0].label).not.toContain("cors.example");
  });

  test("without a badge contract: setCaretaker only, verified builders are done", () => {
    const q = onboardingQueue(builders, { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: null });
    expect(q.included.map((x) => x.id)).toEqual([2]);
    expect(q.excluded.map((x) => x.id)).toEqual([5]);
    expect(q.plan.txs.map(decode)).toEqual([{ functionName: "setCaretaker", args: [2n, OP] }]);
  });

  test("a revoked badge is never re-issued: the builder leaves the queue (and says why)", () => {
    const q = onboardingQueue(builders, { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: BADGE, revoked: new Set([3, 7]) });
    expect(q.included.map((x) => x.id)).toEqual([2]);
    expect(q.revoked.map((r) => [r.builder.id, r.reason])).toEqual([[3, "badge revoked; not reactivated since"]]);
    // a revoked builder whose proof is unreadable is not listed as "excluded" either
    expect(q.excluded.map((x) => x.id)).toEqual([5]);
    expect(q.plan.txs.map(decode)).toEqual([
      { functionName: "setCaretaker", args: [2n, OP] },
      { functionName: "issue", args: [2n] },
    ]);
  });

  test("revocation history unknown: verified builders without a badge are held back, pending ones go ahead", () => {
    const q = onboardingQueue(builders, { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: BADGE, revoked: null });
    expect(q.included.map((x) => x.id)).toEqual([2]);
    expect(q.revoked.map((r) => r.builder.id)).toEqual([3]);
    expect(q.revoked[0].reason).toMatch(/could not be read/);
  });

  test("a deactivated builder (revoke + setActive(false)) is never a candidate", () => {
    const q = onboardingQueue([b(4, "inactive", "github:x/y", { onboarded: true })], { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: BADGE, revoked: null });
    expect([q.included, q.excluded, q.revoked]).toEqual([[], [], []]);
  });
});

describe("revokeSafeFile", () => {
  test("revoke(builderId) on the badge AND setActive(builderId, false) on the registry, in one batch", () => {
    const safe = revokeSafeFile({ badge: BADGE, registry: REG, builderId: 12, serial: 7, chainId: 5042, createdAt: 99 });
    expect(safe.chainId).toBe("5042");
    expect(safe.meta.name).toBe("Registrai: revoke badge No. 007 and deactivate builder #12");
    expect(safe.meta.description).toContain("revoke(12)");
    expect(safe.meta.description).toContain("setActive(12, false)");
    expect(safe.transactions).toEqual([
      { to: BADGE, value: "0", data: expect.stringMatching(/^0x/) },
      { to: REG, value: "0", data: expect.stringMatching(/^0x/) },
    ]);
    expect(decodeFunctionData({ abi: badgeAbi, data: safe.transactions[0].data })).toEqual({ functionName: "revoke", args: [12n] });
    expect(decodeFunctionData({ abi: verifiedBuilderAbi, data: safe.transactions[1].data })).toEqual({ functionName: "setActive", args: [12n, false] });
    // selectors of revoke(uint256) and setActive(uint256,bool)
    expect(safe.transactions[0].data.slice(0, 10)).toBe("0x20c5429b");
    expect(safe.transactions[1].data.slice(0, 10)).toBe("0xe60a955d");
  });

  test("file name", () => {
    expect(safeFileName("onboarding", Date.parse("2026-09-24T23:00:00Z"))).toBe("registrai-onboarding-2026-09-24.safe.json");
  });
});

describe("readAdminChain", () => {
  test("every active project of every active builder is checked in the browser; no snapshot verdict is used", async () => {
    const B1 = getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
    const rows: Record<number, readonly [string, string, string, bigint, boolean]> = {
      1: [B0, "", "0x", 10n, true],
      2: [B1, "Cors Co", "0x", 11n, true],
      3: [B0, "https://not-a-claim", "0x", 12n, true],
      4: [B0, "", "0x", 13n, false],
    };
    const projectsOf: Record<number, bigint[]> = { 1: [1n], 2: [2n, 3n], 3: [], 4: [4n] };
    const projects: Record<number, readonly [bigint, string, boolean, bigint]> = {
      1: [1n, "github:o/r", true, 1n],
      2: [2n, "domain:cors.example", true, 2n],
      3: [2n, "github:removed/one", false, 3n],
      4: [4n, "github:off/line", true, 4n],
    };
    const client: GalleryReader = {
      async readContract({ functionName, args }) {
        const n = args ? Number(args[0] as bigint) : 0;
        if (functionName === "nextId") return 5n;
        if (functionName === "builders") return rows[n];
        if (functionName === "projectsOf") return projectsOf[n];
        if (functionName === "projects") return projects[n];
        if (functionName === "caretakerOf") return zeroAddress;
        throw new Error(functionName);
      },
    };
    const fetched: string[] = [];
    const fetchImpl = (async (url: string) => {
      fetched.push(url);
      if (url.includes("githubusercontent")) return new Response("not found", { status: 404 });
      throw new TypeError("CORS");
    }) as unknown as typeof fetch;
    const out = await readAdminChain(client, { registry: REG, caretakers: CARE, badge: null, imageBase: "", operator: OP, chainId: 5042, fetchImpl });
    expect(fetched).toHaveLength(2);
    expect(out.map((x) => [x.id, x.status, Boolean(x.proofUnchecked)])).toEqual([
      [1, "lapsed", false],
      [2, "unconfirmed", true],
      [3, "unverified", false],
      [4, "inactive", false],
    ]);
  });
});

describe("recovery and project Safe files", () => {
  const NEW = getAddress("0x90f79bf6eb2c4f870365e785982e1f101e93b906");
  test("startRecovery: one call to the registry, named for the builder", () => {
    const f = startRecoverySafeFile({ registry: REG, builderId: 7, newOwner: NEW, chainId: 5042, createdAt: 5 });
    expect(f.meta.name).toBe("Registrai: start recovery of builder #7");
    expect(f.transactions).toHaveLength(1);
    expect(f.transactions[0].to).toBe(REG);
    expect(decodeFunctionData({ abi: verifiedBuilderAbi, data: f.transactions[0].data })).toEqual({ functionName: "startRecovery", args: [7n, NEW] });
  });
  test("cancelRecovery and deactivate project", () => {
    const c = cancelRecoverySafeFile({ registry: REG, builderId: 7, chainId: 5042, createdAt: 5 });
    expect(decodeFunctionData({ abi: verifiedBuilderAbi, data: c.transactions[0].data })).toEqual({ functionName: "cancelRecovery", args: [7n] });
    const d = deactivateProjectSafeFile({ registry: REG, projectId: 31, source: "github:x/y", chainId: 5042, createdAt: 5 });
    expect(d.meta.name).toBe("Registrai: deactivate project #31");
    expect(decodeFunctionData({ abi: verifiedBuilderAbi, data: d.transactions[0].data })).toEqual({ functionName: "setProjectActive", args: [31n, false] });
  });
  test("readRecoveries: only builders with a pending recovery", async () => {
    const client: GalleryReader = {
      async readContract({ functionName, args }) {
        if (functionName !== "recoveryOf") throw new Error(functionName);
        const id = Number(args![0] as bigint);
        return id === 2 ? [NEW, 1_800_000_000n] : [zeroAddress, 0n];
      },
    };
    expect(await readRecoveries(client, REG, [1, 2, 3])).toEqual([{ builderId: 2, newOwner: NEW, readyAt: 1_800_000_000 }]);
  });
});
