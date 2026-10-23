import { describe, expect, test } from "vitest";
import { validateResolver } from "./oracle-config";

const ME = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";
const JUDGE = "0x1111111111111111111111111111111111111111";

describe("validateResolver", () => {
  test("accepts an independent address", () => {
    expect(validateResolver(` ${JUDGE} `, ME)).toEqual({ ok: true, value: JUDGE });
  });
  test("refuses the agent's own wallet, case-insensitively", () => {
    const r = validateResolver(ME.toLowerCase(), ME);
    expect(r.ok).toBe(false);
  });
  test("refuses empty and malformed input", () => {
    expect(validateResolver("", ME).ok).toBe(false);
    expect(validateResolver("0x123", ME).ok).toBe(false);
  });
});
