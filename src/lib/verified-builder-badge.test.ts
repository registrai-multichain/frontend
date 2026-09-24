import { describe, expect, test } from "vitest";
import type { Address } from "viem";
import {
  attachBadges,
  badgeImageBase,
  badgeImageUrl,
  badgeNetworkKey,
  badgeTokenUrl,
  builderDeepLink,
  parseBuilderParam,
  parseSnapshotBadge,
  readBuilderBadges,
  serialLabel,
  type BadgeReader,
} from "./verified-builder-badge";
import { snapshotBadgeFor, type SnapshotBuilder } from "./builder-verification";
import { resolvePerennialDeployment } from "./perennial-network";
import mainnet from "./deployments/arc-mainnet.json";

const BADGE = "0x05de78E9Ff17ccE47D7F4E9170fdfC130Abe278c" as Address;

describe("names and URLs", () => {
  test("network key per chain, matching render-badges.py", () => {
    expect(badgeNetworkKey(5042)).toBe("arc");
    expect(badgeNetworkKey(5042002)).toBe("arc-testnet");
    expect(badgeNetworkKey(31337)).toBe("local");
    expect(badgeNetworkKey(1)).toBeNull();
  });

  test("image mirrors tokenURI: imageBase + serial + -lapsed? + .jpg", () => {
    const base = badgeImageBase("arc-testnet");
    expect(base).toBe("https://registrai.cc/badge/arc-testnet/");
    expect(badgeImageUrl(base, 7, false)).toBe("https://registrai.cc/badge/arc-testnet/7.jpg");
    expect(badgeImageUrl(base, 7, true)).toBe("https://registrai.cc/badge/arc-testnet/7-lapsed.jpg");
    expect(badgeImageUrl("/badge/arc/", 12, false)).toBe("/badge/arc/12.jpg");
  });

  test("serial label, explorer link, deep link", () => {
    expect(serialLabel(7)).toBe("No. 007");
    expect(serialLabel(1234)).toBe("No. 1234");
    expect(badgeTokenUrl("https://testnet.arcscan.app/", BADGE, 7)).toBe(`https://testnet.arcscan.app/token/${BADGE}/instance/7`);
    expect(builderDeepLink(3)).toBe("https://registrai.cc/perennial/?builder=3");
  });

  test("?builder= accepts positive integers only", () => {
    expect(parseBuilderParam("3")).toBe(3);
    expect(parseBuilderParam(" 12 ")).toBe(12);
    for (const bad of [null, undefined, "", "0", "-1", "1.5", "0x3", "abc", "1e3", "9999999999"]) {
      expect(parseBuilderParam(bad)).toBeNull();
    }
  });
});

describe("snapshot", () => {
  test("parseSnapshotBadge rejects malformed rows", () => {
    expect(parseSnapshotBadge({ serial: 7, lapsed: false, issuedAt: 1790000000, image: "x" })).toEqual({
      serial: 7, lapsed: false, issuedAt: 1790000000, image: "x",
    });
    expect(parseSnapshotBadge(null)).toBeNull();
    expect(parseSnapshotBadge({ serial: 0, lapsed: false })).toBeNull();
    expect(parseSnapshotBadge({ serial: "7", lapsed: false })).toBeNull();
    expect(parseSnapshotBadge({ serial: 7 })).toBeNull();
    expect(parseSnapshotBadge({ serial: 7, lapsed: true })).toEqual({ serial: 7, lapsed: true, issuedAt: 0, image: "" });
  });

  test("snapshotBadgeFor matches id AND owner", () => {
    const rows = [
      { builderId: 3, owner: "0xabc", source: "github:a/b", status: "verified", country: "DE", proofUrl: "u", milestoneFeedId: null, badge: { serial: 2, lapsed: false, issuedAt: 1, image: "" } },
    ] as SnapshotBuilder[];
    expect(snapshotBadgeFor(rows, { builderId: 3, owner: "0xABC" })?.serial).toBe(2);
    expect(snapshotBadgeFor(rows, { builderId: 3, owner: "0xdef" })).toBeNull();
    expect(snapshotBadgeFor(rows, { builderId: 4, owner: "0xabc" })).toBeNull();
  });

  test("attachBadges gives every row a badge or null", () => {
    const badges = new Map([[2, { serial: 1, lapsed: false, issuedAt: 5, image: "i" }]]);
    expect(attachBadges([{ builderId: 1 }, { builderId: 2 }], badges)).toEqual([
      { builderId: 1, badge: null },
      { builderId: 2, badge: { serial: 1, lapsed: false, issuedAt: 5, image: "i" } },
    ]);
  });
});

describe("readBuilderBadges", () => {
  test("serialOf per builder; lapsed + issuedAt only for issued serials; maxSerial = nextSerial - 1", async () => {
    const serialOf: Record<number, bigint> = { 1: 0n, 2: 1n, 3: 3n }; // serial 2 was revoked
    const lapsed: Record<number, boolean> = { 1: false, 3: true };
    const reads: string[] = [];
    const reader: BadgeReader = {
      readContract: async ({ functionName, args }) => {
        const a = args ? Number(args[0] as bigint) : 0;
        reads.push(`${functionName}(${args ? a : ""})`);
        if (functionName === "nextSerial") return 4n;
        if (functionName === "serialOf") return serialOf[a] ?? 0n;
        if (functionName === "lapsed") return lapsed[a];
        if (functionName === "issuedAt") return BigInt(1_790_000_000 + a);
        throw new Error(functionName);
      },
    };
    const r = await readBuilderBadges(reader, { badge: BADGE, builderIds: [1, 2, 3], imageBase: "https://registrai.cc/badge/arc-testnet/" });
    expect(r.maxSerial).toBe(3);
    expect([...r.badges]).toEqual([
      [2, { serial: 1, lapsed: false, issuedAt: 1_790_000_001, image: "https://registrai.cc/badge/arc-testnet/1.jpg" }],
      [3, { serial: 3, lapsed: true, issuedAt: 1_790_000_003, image: "https://registrai.cc/badge/arc-testnet/3-lapsed.jpg" }],
    ]);
    expect(reads.filter((x) => x.startsWith("lapsed") || x.startsWith("issuedAt")).sort()).toEqual([
      "issuedAt(1)", "issuedAt(3)", "lapsed(1)", "lapsed(3)",
    ]);
  });

  test("nothing issued yet: maxSerial 0", async () => {
    const reader: BadgeReader = { readContract: async ({ functionName }) => (functionName === "nextSerial" ? 1n : 0n) };
    const r = await readBuilderBadges(reader, { badge: BADGE, builderIds: [1], imageBase: "" });
    expect(r).toEqual({ badges: new Map(), maxSerial: 0 });
  });
});

describe("network config", () => {
  test("the badge is optional: absent or malformed = null, deployment unaffected", () => {
    const a = "0x71Ea02b2E75e6C65A41DF9E3c78E14F9ae2232D9";
    const full = { NanoLedger: a, BuilderRegistry: a, ProgressPool: a, MarketsPerennial: a };
    expect(resolvePerennialDeployment("testnet", { contracts: full }).contracts.VerifiedBuilderBadge).toBeNull();
    expect(resolvePerennialDeployment("testnet", { contracts: { ...full, VerifiedBuilderBadge: "0x12" } }).contracts.VerifiedBuilderBadge).toBeNull();
    const d = resolvePerennialDeployment("testnet", { contracts: { ...full, VerifiedBuilderBadge: BADGE } });
    expect(d.contracts.VerifiedBuilderBadge).toBe(BADGE);
    expect(d.deployed).toBe(true);
  });

  test("mainnet ships without a badge", () => {
    expect(resolvePerennialDeployment("mainnet", mainnet).contracts.VerifiedBuilderBadge).toBeNull();
  });
});
