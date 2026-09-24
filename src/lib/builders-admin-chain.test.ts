import { describe, expect, test } from "vitest";
import { decodeFunctionData, getAddress, zeroAddress, type Address } from "viem";
import {
  FOLLOW_UP_AFTER_MS,
  inviteChainStatus,
  needsFollowUp,
  onboardingQueue,
  onboardingSafeFile,
  readAdminChain,
  revokeSafeFile,
  safeFileName,
} from "./builders-admin-chain";
import type { GalleryBuilder, GalleryReader } from "./builders-gallery";
import { verifiedBuilderAbi } from "./verified-builders-chain";
import { badgeAbi, type BadgeInfo } from "./verified-builder-badge";

const OP = "0xf26db19bc8DC33c9A72399128CF5cfB5dDC76263" as Address;
const REG = "0x10F8D6D5905E2C4dc565a1894c102B25E9d21DF4" as Address;
const CARE = "0x02CfdE88a97A56A7dbDC05F6c7BD3Dbc34393876" as Address;
const BADGE = "0x05de78E9Ff17ccE47D7F4E9170fdfC130Abe278c" as Address;
const B0 = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

const badge = (serial: number, lapsed = false): BadgeInfo => ({ serial, lapsed, issuedAt: 1, image: "" });
const b = (id: number, status: GalleryBuilder["status"], source: string | null, extra: Partial<GalleryBuilder> = {}): GalleryBuilder => ({
  id,
  owner: B0,
  status,
  source,
  country: null,
  proofUrl: null,
  badge: null,
  createdAt: 0,
  ...extra,
});

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

describe("onboardingQueue", () => {
  const builders = [
    b(1, "unverified", null),
    b(2, "pending", "github:o/r"),
    b(3, "verified", "github:v/v"), // no badge -> issue
    b(4, "lapsed", "domain:gone.example"),
    b(5, "pending", "domain:cors.example", { proofUnchecked: true }),
    b(6, "verified", "github:has/badge", { badge: badge(1) }),
    b(7, "verified", "domain:v.example", { proofUnchecked: true }), // no badge, unchecked
    b(8, "inactive", "github:off/line"),
  ];
  const decode = (t: { to: Address; data: `0x${string}` }) =>
    t.to === BADGE ? decodeFunctionData({ abi: badgeAbi, data: t.data }) : decodeFunctionData({ abi: verifiedBuilderAbi, data: t.data });

  test("setCaretaker then issue for pending, issue for verified without a badge; unchecked proofs excluded", () => {
    const q = onboardingQueue(builders, { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: BADGE });
    expect(q.included.map((x) => x.id)).toEqual([2, 3]);
    expect(q.excluded.map((x) => x.id)).toEqual([5, 7]);
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

  test("without a badge contract: setCaretaker only, verified builders are done", () => {
    const q = onboardingQueue(builders, { builderRegistry: REG, caretakerRegistry: CARE, operator: OP, badge: null });
    expect(q.included.map((x) => x.id)).toEqual([2]);
    expect(q.excluded.map((x) => x.id)).toEqual([5]);
    expect(q.plan.txs.map(decode)).toEqual([{ functionName: "setCaretaker", args: [2n, OP] }]);
  });
});

describe("revokeSafeFile", () => {
  test("one revoke(builderId) to the badge contract", () => {
    const safe = revokeSafeFile({ badge: BADGE, builderId: 12, serial: 7, chainId: 5042, createdAt: 99 });
    expect(safe.chainId).toBe("5042");
    expect(safe.meta.name).toBe("Registrai: revoke badge No. 007");
    expect(safe.meta.description).toContain("revoke(12)");
    expect(safe.transactions).toEqual([{ to: BADGE, value: "0", data: expect.stringMatching(/^0x/) }]);
    expect(decodeFunctionData({ abi: badgeAbi, data: safe.transactions[0].data })).toEqual({ functionName: "revoke", args: [12n] });
    // selector of revoke(uint256)
    expect(safe.transactions[0].data.slice(0, 10)).toBe("0x20c5429b");
  });

  test("file name", () => {
    expect(safeFileName("onboarding", Date.parse("2026-09-24T23:00:00Z"))).toBe("registrai-onboarding-2026-09-24.safe.json");
  });
});

describe("readAdminChain", () => {
  test("every active claim is checked in the browser; no snapshot verdict is used", async () => {
    const rows: Record<number, readonly [string, string, string, bigint, boolean]> = {
      1: [B0, "registrai:github:o/r", "0x", 10n, true],
      2: [getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8"), "registrai:domain:cors.example", "0x", 11n, true],
      3: [B0, "https://not-a-claim", "0x", 12n, true],
      4: [B0, "registrai:github:off/line", "0x", 13n, false],
    };
    const client: GalleryReader = {
      async readContract({ functionName, args }) {
        if (functionName === "nextId") return 5n;
        if (functionName === "builders") return rows[Number(args![0])];
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
      [2, "pending", true],
      [3, "unverified", false],
      [4, "inactive", false],
    ]);
  });
});
