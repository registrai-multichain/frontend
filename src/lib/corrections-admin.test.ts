import { describe, expect, test } from "vitest";
import { defaultNote } from "./corrections-admin";

describe("defaultNote", () => {
  test("short text unchanged; long text cut at a word under 200", () => {
    expect(defaultNote("Fix the summary.")).toBe("Fix the summary.");
    const n = defaultNote("word ".repeat(80));
    expect(n.length).toBeLessThanOrEqual(200);
    expect(n.endsWith("word")).toBe(true);
  });
});
