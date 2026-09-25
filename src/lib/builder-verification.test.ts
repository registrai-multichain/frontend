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
    for (const status of ["pending", "lapsed", "unverified", "inactive"] as const) expect(verificationFor([row({ status })], b)).toBeNull();
  });
  test("no badge when the id or owner differ", () => {
    expect(verificationFor([row()], { ...b, builderId: 3 })).toBeNull();
    expect(verificationFor([row({ owner: "0xdef0000000000000000000000000000000000001" })], b)).toBeNull();
  });
  test("an owner change voids the mark (every proof names the owner)", () => {
    expect(verificationFor([row()], { ...b, owner: "0xdef0000000000000000000000000000000000002" })).toBeNull();
  });
  test("an inactive builder shows no mark", () => {
    expect(verificationFor([row({ status: "inactive" })], b)).toBeNull();
  });
  test("milestone metric by proof path", () => {
    expect(milestoneMetric("github:o/r")).toBe("published GitHub releases, counted at most one a day (not tags, drafts or pre-releases)");
    expect(milestoneMetric("domain:x.org")).toBe("contracts its deployers create");
  });
});
