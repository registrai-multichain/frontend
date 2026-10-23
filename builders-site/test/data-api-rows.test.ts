import { describe, expect, test } from "vitest";
import { hourOf, indexHourRows, isoHour, memberHourRows } from "../lib/data-api-rows";
import type { AbiData } from "../../src/lib/builders-index";

const H = (s: string) => Date.parse(s) / 3600e3;
function file(): AbiData {
  return {
    data_until: "2026-10-14T21:00:00Z",
    candles: [
      ["2026-10-14T19:00:00Z", 961.2, 961.3, 961.0, 961.046, 10, 100, 5],
      ["2026-10-14T20:00:00Z", 961.05, 961.1, 960.9, 961.013, 12, 120, 6],
    ],
    projects: [
      { source: "domain:archery.wtf", name: "Archery", kind: "project", points: 9.2 },
      { source: "integration:0x", name: "0x", kind: "integration", points: 1 },
    ],
    events: [
      { t: "2026-10-14T20:00:00Z", source: "domain:archery.wtf", name: "Archery", kind: "activity", payments: 158, wallets: 13, new_payers: 1, points: 1174.9, usdc: 24725.94 },
      { t: "2026-10-14T19:00:00Z", source: "domain:archery.wtf", name: "Archery", kind: "activity", payments: 133, wallets: 13, new_payers: 0, points: 1123.1, usdc: 21970.75 },
      { t: "2026-10-14T20:00:00Z", source: "domain:archery.wtf", name: "Archery", kind: "rise_limit", payments: 0, wallets: 0, new_payers: 0, points: 0, usdc: 0 },
    ],
    live: { P: { "domain:archery.wtf": 9.209897164461097, "integration:0x": 635293.7859520507 } },
  } as unknown as AbiData;
}

describe("hours", () => {
  test("hourOf takes exact ISO hours only", () => {
    expect(hourOf("2026-10-14T21:00:00Z")).toBe(H("2026-10-14T21:00:00Z"));
    for (const bad of ["2026-10-14T21:30:00Z", "2026-10-14T21:00:00.000Z", "2026-10-14", "497781", ""]) expect(hourOf(bad)).toBeNull();
    expect(isoHour(H("2026-10-14T21:00:00Z"))).toBe("2026-10-14T21:00:00Z");
  });
});

describe("indexHourRows", () => {
  test("a candle stamped at its hour's start gives the close of the next hour", () => {
    expect(indexHourRows("abi", file())).toEqual([
      { index: "abi", hour: H("2026-10-14T20:00:00Z"), close: 961.046 },
      { index: "abi", hour: H("2026-10-14T21:00:00Z"), close: 961.013 },
    ]);
    expect(indexHourRows("abi", file(), H("2026-10-14T21:00:00Z"))).toHaveLength(1);
  });
});

describe("memberHourRows", () => {
  test("stock from live.P at full precision, activity from the event stamped one hour before the close", () => {
    const rows = memberHourRows("abi", file());
    expect(rows).toEqual([
      { index: "abi", id: "domain:archery.wtf", hour: H("2026-10-14T21:00:00Z"), points: 9.209897164461097, points_earned: 1174.9, payments: 158, wallets: 13, new_payers: 1, usdc: 24725.94 },
      { index: "abi", id: "integration:0x", hour: H("2026-10-14T21:00:00Z"), points: 635293.7859520507, points_earned: 0, payments: 0, wallets: 0, new_payers: 0, usdc: 0 },
    ]);
  });
  test("a file without live, or a member missing from live.P, gives no row for it", () => {
    expect(memberHourRows("abi", { ...file(), live: undefined })).toEqual([]);
    const f = file(); delete (f.live as { P: Record<string, number> }).P["integration:0x"];
    expect(memberHourRows("abi", f).map((r) => r.id)).toEqual(["domain:archery.wtf"]);
  });
});
