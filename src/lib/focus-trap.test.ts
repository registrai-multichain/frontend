import { expect, test } from "vitest";
import { nextFocusIndex } from "./focus-trap";

test("Tab wraps from the last control to the first, Shift+Tab from the first to the last", () => {
  expect(nextFocusIndex(0, 3, false)).toBe(1);
  expect(nextFocusIndex(2, 3, false)).toBe(0);
  expect(nextFocusIndex(0, 3, true)).toBe(2);
  expect(nextFocusIndex(-1, 3, false)).toBe(0);
  expect(nextFocusIndex(-1, 3, true)).toBe(2);
  expect(nextFocusIndex(0, 0, false)).toBe(-1);
});
