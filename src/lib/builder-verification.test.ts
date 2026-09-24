import { describe, expect, test } from "vitest";
import { milestoneMetric, verificationFor, type SnapshotBuilder } from "./builder-verification";

const row = (over: Partial<SnapshotBuilder> = {}): SnapshotBuilder => ({
  builderId: 2,
  owner: "0xabc0000000000000000000000000000000000001",
  source: "github:o/r",
  status: "verified",
  country: "PL",
  proofUrl: "https://raw.githubusercontent.com/o/r/HEAD/.registrai.json",
  milestoneFeedId: null,
  ...over,
});

describe("verificationFor", () => {
  const b = { builderId: 2, owner: "0xABC0000000000000000000000000000000000001" };
  test("verified snapshot row -> badge linking to the proof", () => {
    expect(verificationFor([row()], b)).toEqual({ source: "github:o/r", proofUrl: row().proofUrl });
  });
  test("no badge unless verified", () => {
    for (const status of ["pending", "lapsed", "unverified"] as const) expect(verificationFor([row({ status })], b)).toBeNull();
  });
  test("no badge when the id or owner differ", () => {
    expect(verificationFor([row()], { ...b, builderId: 3 })).toBeNull();
    expect(verificationFor([row({ owner: "0xdef0000000000000000000000000000000000001" })], b)).toBeNull();
  });
  test("no badge once the live profile link no longer names the source", () => {
    expect(verificationFor([row()], { ...b, profileURI: "registrai:github:o/r" })).not.toBeNull();
    expect(verificationFor([row()], { ...b, profileURI: "registrai:github:o/other" })).toBeNull();
  });
  test("milestone metric by proof path", () => {
    expect(milestoneMetric("github:o/r")).toBe("releases and tags");
    expect(milestoneMetric("domain:x.org")).toBe("contracts its deployers create");
  });
});
