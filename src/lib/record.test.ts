import { describe, expect, test } from "vitest";
import vector from "./__fixtures__/record_vector.json";
import { canonicalise, dayToIndex, endOfDayMs, isRecordDay, sha256Hex, validateRecordDay, validateTx } from "./record";

describe("canonicalise", () => {
  test("reproduces the shared Python vector byte for byte", async () => {
    const c = canonicalise(vector.input);
    expect(c).toBe(vector.canonical);
    expect(await sha256Hex(c)).toBe(vector.sha256);
  });
  test("sorts by code point like Python, keeps array order, drops undefined keys", () => {
    expect(canonicalise({ b: 1, a: [3, 1], "\u{1F600}": 1, "～": 2, u: undefined })).toBe('{"a":[3,1],"b":1,"～":2,"\u{1F600}":1}');
  });
  test("escapes like Python ensure_ascii=False", () => {
    expect(canonicalise({ s: 'a"b\\c\n\u0001\u007f/Ä' })).toBe('{"s":"a\\"b\\\\c\\n\\u0001\u007f/Ä"}');
  });
  test("refuses floats and non-finite numbers", () => {
    expect(() => canonicalise({ n: 1.5 })).toThrow();
    expect(() => canonicalise({ n: NaN })).toThrow();
  });
});

describe("days", () => {
  const now = Date.parse("2026-10-06T00:30:00Z");
  test("isRecordDay needs a real calendar date", () => {
    expect(isRecordDay("2026-10-06")).toBe(true);
    expect(isRecordDay("2026-02-30")).toBe(false);
    expect(isRecordDay("2026-1-6")).toBe(false);
    expect(isRecordDay(5)).toBe(false);
  });
  test("dayToIndex is days since the epoch, endOfDayMs the last millisecond", () => {
    expect(dayToIndex("1970-01-02")).toBe(1);
    expect(endOfDayMs("2026-10-05")).toBe(Date.parse("2026-10-05T23:59:59.999Z"));
  });
  test("validateRecordDay: before today and at most 7 days back", () => {
    expect(validateRecordDay("2026-10-05", now)).toBeNull();
    expect(validateRecordDay("2026-09-29", now)).toBeNull();
    expect(validateRecordDay("2026-09-28", now)).toMatch(/7 days/);
    expect(validateRecordDay("2026-10-06", now)).toMatch(/before today/);
    expect(validateRecordDay("2026-10-07", now)).toMatch(/before today/);
    expect(validateRecordDay("nope", now)).toMatch(/YYYY-MM-DD/);
  });
  test("validateTx: 32-byte hex", () => {
    expect(validateTx("0x" + "AB".repeat(32))).toBe("0x" + "ab".repeat(32));
    expect(validateTx("0x" + "ab".repeat(31))).toBeNull();
    expect(validateTx("ab".repeat(32))).toBeNull();
    expect(validateTx(1)).toBeNull();
  });
});
