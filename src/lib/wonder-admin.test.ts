import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { decodeErrorResult, keccak256, toBytes, toFunctionSelector, type Address } from "viem";
import { cancelReleaseSafeFile, nominateInput, nominateSafeFile } from "./wonder-admin";
import {
  expiryDaysText, marketLabelsShort, SUBJECT, wonderAnchor, wonderEscrowAbi, wonderMarketsAbi, wonderMarketsHref,
} from "./wonder";

const SRC = "github:acme/tool";
const KEY = keccak256(toBytes(SRC));

describe("public pages do not ship the Safe-file code", () => {
  test("wonder.ts imports no onboarding batch", () => {
    expect(readFileSync(resolve(__dirname, "wonder.ts"), "utf8")).not.toContain("onboard-batch");
  });
  test("the admin helpers moved to wonder-admin.ts", () => {
    expect(nominateInput(SRC, new Set([SRC])).ok).toBe(true);
    expect(nominateSafeFile({ markets: "0x00000000000000000000000000000000000000a1" as Address, source: SRC, on: true, chainId: 1, createdAt: 1 }).transactions).toHaveLength(1);
    expect(cancelReleaseSafeFile({ escrow: "0x00000000000000000000000000000000000000e5" as Address, source: SRC, chainId: 1, createdAt: 1 }).meta.description).toContain("cancelRelease(");
  });
});

describe("custom errors decode by name", () => {
  const sel = (sig: string) => toFunctionSelector(sig);
  test("markets and escrow errors", () => {
    expect(decodeErrorResult({ abi: wonderMarketsAbi, data: sel("NotNominated()") }).errorName).toBe("NotNominated");
    expect(decodeErrorResult({ abi: wonderMarketsAbi, data: sel("NotCanonical()") }).errorName).toBe("NotCanonical");
    expect(decodeErrorResult({ abi: wonderMarketsAbi, data: sel("BadSubject()") }).errorName).toBe("BadSubject");
    expect(decodeErrorResult({ abi: wonderEscrowAbi, data: sel("NoPendingRelease()") }).errorName).toBe("NoPendingRelease");
  });
});

describe("compact labels for the market rows", () => {
  test("short text, the full sentence as the title", () => {
    const s = { kind: SUBJECT.Wonder, builderId: 0n, sourceKey: KEY, bound: false, source: SRC };
    expect(marketLabelsShort(s).map((l) => l.short)).toEqual(["Unclaimed", "Community"]);
    expect(marketLabelsShort(s)[0].full).toMatch(/^Unclaimed: this team/);
    expect(marketLabelsShort(undefined)).toEqual([]);
  });
});

describe("links to a project's wonder markets", () => {
  test("anchor and href", () => {
    expect(wonderAnchor(SRC)).toBe("wonder-github-acme-tool");
    expect(wonderMarketsHref(SRC)).toBe("https://registrai.cc/perennial/wonder/#wonder-github-acme-tool");
  });
});

describe("expiry wording", () => {
  test("the contract's EXPIRY when known, else the default", () => {
    expect(expiryDaysText(180 * 86_400)).toBe("180 days");
    expect(expiryDaysText(90 * 86_400)).toBe("90 days");
    expect(expiryDaysText(null)).toBe("about 180 days");
  });
});
