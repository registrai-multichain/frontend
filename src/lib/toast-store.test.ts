import { describe, expect, test } from "vitest";
import { EMPTY_TOASTS, MAX_TOASTS, OK_TTL_MS, toastReducer, type ToastState } from "./toast-store";

const push = (s: ToastState, kind: "ok" | "error" | "info", text: string, now = 0) =>
  toastReducer(s, { type: "push", toast: { kind, text }, now });

describe("toastReducer", () => {
  test("push appends with increasing ids and the time it arrived", () => {
    const s = push(push(EMPTY_TOASTS, "ok", "a", 10), "error", "b", 20);
    expect(s.list.map((t) => [t.id, t.kind, t.text, t.at])).toEqual([
      [1, "ok", "a", 10],
      [2, "error", "b", 20],
    ]);
    expect(s.next).toBe(3);
  });

  test("keeps at most MAX_TOASTS, dropping the oldest", () => {
    let s = EMPTY_TOASTS;
    for (let i = 0; i < MAX_TOASTS + 2; i++) s = push(s, "ok", `t${i}`);
    expect(s.list.map((t) => t.text)).toEqual(["t2", "t3", "t4"]);
  });

  test("expire removes ok and info notes after OK_TTL_MS, never errors", () => {
    let s = push(EMPTY_TOASTS, "ok", "done", 0);
    s = push(s, "error", "failed", 0);
    s = push(s, "info", "fyi", 0);
    expect(toastReducer(s, { type: "expire", now: OK_TTL_MS - 1 }).list).toHaveLength(3);
    expect(toastReducer(s, { type: "expire", now: OK_TTL_MS }).list.map((t) => t.text)).toEqual(["failed"]);
  });

  test("dismiss removes exactly that id", () => {
    const s = push(push(EMPTY_TOASTS, "ok", "a"), "ok", "b");
    expect(toastReducer(s, { type: "dismiss", id: 1 }).list.map((t) => t.text)).toEqual(["b"]);
  });

  test("an expire that removes nothing returns the same state object (no re-render)", () => {
    const s = push(EMPTY_TOASTS, "error", "x");
    expect(toastReducer(s, { type: "expire", now: 10 ** 9 })).toBe(s);
  });
});
