import { describe, expect, test } from "vitest";
import { EMPTY_MILESTONES, foldMilestones, lifetimeProgress, type MilestoneReading } from "./milestone-progress";

const FA = "0xAA";
const FB = "0xbb";
const owners: Record<string, string> = { "0xaa": "0xOwner1", "0xbb": "0xowner1" };
const ownerOf = (f: string) => owners[f];
const seasons = [
  { id: 1, startBlock: 0, endBlock: 99 },
  { id: 2, startBlock: 100, endBlock: null },
];
const r = (feedId: string, value: number, block: number, seq = 0): MilestoneReading => ({ feedId, value: BigInt(value), block, seq });

describe("milestone progress", () => {
  test("increases count in the season they were attested in; lifetime = latest counts", () => {
    const s = foldMilestones(EMPTY_MILESTONES, [r(FA, 3, 10), r(FA, 5, 50), r(FB, 2, 60), r(FA, 7, 120)], ownerOf, seasons);
    expect(s.bySeason).toEqual({ "1": { "0xowner1": 7 }, "2": { "0xowner1": 2 } });
    expect(s.latestByFeed).toEqual({ "0xaa": "7", "0xbb": "2" });
    expect(lifetimeProgress(s, [FA, FB, null, "0xAa"])).toBe(9);
  });
  test("a lower or equal reading adds nothing; order by block then log index", () => {
    const s = foldMilestones(EMPTY_MILESTONES, [r(FA, 4, 10, 1), r(FA, 2, 10, 0), r(FA, 4, 11)], ownerOf, seasons);
    // 2 (from 0) then 4 (+2) then 4 (+0)
    expect(s.bySeason["1"]["0xowner1"]).toBe(4);
    expect(s.latestByFeed["0xaa"]).toBe("4");
  });
  test("incremental: two folds equal one; foreign feeds are tracked but credit nobody", () => {
    const all = [r(FA, 1, 10), r("0xcc", 9, 20), r(FA, 6, 150)];
    const once = foldMilestones(EMPTY_MILESTONES, all, ownerOf, seasons);
    const twice = foldMilestones(foldMilestones(EMPTY_MILESTONES, all.slice(0, 2), ownerOf, seasons), all.slice(2), ownerOf, seasons);
    expect(twice).toEqual(once);
    expect(once.bySeason).toEqual({ "1": { "0xowner1": 1 }, "2": { "0xowner1": 5 } });
    expect(EMPTY_MILESTONES).toEqual({ latestByFeed: {}, bySeason: {} });
  });
});
