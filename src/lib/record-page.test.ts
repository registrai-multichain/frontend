import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { VERDICT_WORDS } from "./facts";
import { checkDay, jsonHref, needsReview, recheckedLine, recordState, shortDigest, txHref, RECORD_COPY } from "./record-page";

const D = "a".repeat(64);
const TX = "0x" + "b".repeat(64);

describe("record-page view model", () => {
  test("date formatting", () => {
    expect(checkDay("2026-10-06T12:34:56.000Z")).toBe("2026-10-06");
    expect(checkDay("garbage")).toBeNull();
    expect(checkDay(undefined)).toBeNull();
    expect(recheckedLine("2026-10-06T12:34:56.000Z")).toBe("Evidence re-checked on 2026-10-06");
    expect(recheckedLine(undefined)).toBeNull();
    expect(recheckedLine("nope")).toBeNull();
  });
  test("short digest", () => {
    expect(shortDigest(D)).toBe("aaaaaaaa…aaaaaa");
  });
  test("links are explorer-https / same-origin only", () => {
    expect(txHref(TX)).toBe(`https://explorer.arc.io/tx/${TX}`);
    expect(txHref(null)).toBeNull();
    expect(txHref("javascript:alert(1)")).toBeNull();
    expect(txHref("0x12")).toBeNull();
    expect(jsonHref("2026-10-06")).toBe("/api/record/2026-10-06.json");
    expect(jsonHref("../x")).toBeNull();
  });
  test("record state: pending tx and bad rows", () => {
    const s = recordState({ status: 200, body: [{ day: "2026-10-06", digest: D, tx: null }, { day: "2026-10-05", digest: D, tx: TX }, { day: "bad", digest: D, tx: null }, { day: "2026-10-04", digest: "zz", tx: null }, { day: "2026-10-03", digest: D, tx: "http://evil" }] });
    expect(s.kind).toBe("ready");
    if (s.kind !== "ready") return;
    expect(s.rows.map((r) => r.day)).toEqual(["2026-10-06", "2026-10-05"]); // newest first
    expect(s.rows[0].txUrl).toBeNull();
    expect(s.rows[1].txUrl).toBe(`https://explorer.arc.io/tx/${TX}`);
    expect(recordState({ status: 500, body: [] }).kind).toBe("error");
    expect(recordState({ status: 200, body: {} }).kind).toBe("error");
    expect(recordState({ status: 200, body: [] })).toEqual({ kind: "ready", rows: [] });
  });
  test("needs review", () => {
    expect(needsReview({ f1: { ok: false, at: "x", problems: ["link dead"] } }, "f1")).toEqual(["link dead"]);
    expect(needsReview({ f1: { ok: true, at: "x", problems: [] } }, "f1")).toBeNull();
    expect(needsReview({}, "f1")).toBeNull();
    expect(needsReview(undefined, "f1")).toBeNull();
    expect(needsReview({ f1: { ok: false, at: "x", problems: [] } }, "f1")).toEqual([]);
  });
  test("copy lint: neutral, no slogans", () => {
    const pages = ["../components/record/RecordPage.tsx", "../app/record/page.tsx", "../app/how-we-publish/page.tsx"].map((p) => readFileSync(new URL(p, import.meta.url), "utf8"));
    const all = [...Object.values(RECORD_COPY), ...pages].join("\n").toLowerCase();
    for (const w of VERDICT_WORDS) expect(all, w).not.toMatch(new RegExp(`\\b${w.replace(" ", "\\s+")}\\b`));
    for (const w of ["trusted", "audited", "verified safe", "guarantee"]) expect(all, w).not.toContain(w);
    expect(RECORD_COPY.heading).toBe("Record");
    expect(RECORD_COPY.howTo).toContain("shasum -a 256");
  });
});
