import { describe, expect, test, vi } from "vitest";

const calls = { directory: 0, category: 0 };
vi.mock("../lib/ecosystem-pages", async (orig) => {
  const m = await orig<typeof import("../lib/ecosystem-pages")>();
  return { ...m, renderDirectory: (...a: Parameters<typeof m.renderDirectory>) => { calls.directory++; return m.renderDirectory(...a); },
    renderCategory: (...a: Parameters<typeof m.renderCategory>) => { calls.category++; return m.renderCategory(...a); } };
});

const call = async (path: string) => {
  const { onRequest } = await import("../functions/ecosystem/[[path]]");
  const u = new URL(`https://builder.registrai.cc${path}`);
  return onRequest({ request: new Request(u), env: {}, params: { path: u.pathname.replace(/^\/ecosystem\/?/, "").split("/").filter(Boolean) }, waitUntil: () => undefined } as never);
};

describe("directory and category pages are rendered once per isolate (static data, 10 ms CPU budget)", () => {
  test("same page twice → one render; another variant → its own render", async () => {
    const a = await (await call("/ecosystem/")).text(), b = await (await call("/ecosystem/")).text();
    expect(a).toBe(b);
    expect(calls.directory).toBe(1);
    await call("/ecosystem/?status=live");
    expect(calls.directory).toBe(2);
    await call("/ecosystem/dexs/"); await call("/ecosystem/dexs/");
    expect(calls.category).toBe(1);
  });
});

describe("review I4: category pages keep one rendered copy per category, replaced when the 7-day hour changes", () => {
  test("same hour → reused; new hour → re-rendered; the old hour is not kept", async () => {
    const hour = { v: 1 };
    vi.doMock("../lib/arc-week", async (orig) => ({ ...(await orig<typeof import("../lib/arc-week")>()), loadArcWeek: async () => ({ until_hour: hour.v, until: "x", apps: [] }) }));
    vi.resetModules();
    const { onRequest } = await import("../functions/ecosystem/[[path]]");
    const pages = await import("../lib/ecosystem-pages");
    const spy = vi.spyOn(pages, "renderCategory");
    const get = () => onRequest({ request: new Request("https://builder.registrai.cc/ecosystem/lending/"), env: {}, params: { path: ["lending"] }, waitUntil: () => undefined } as never);
    const n0 = spy.mock.calls.length;
    await get(); await get();
    expect(spy.mock.calls.length - n0).toBeLessThanOrEqual(1);
    hour.v = 2; await get();
    hour.v = 1; await get();
    expect(spy.mock.calls.length - n0).toBe(3);   // back to hour 1 re-renders: only the latest hour is kept
    vi.doUnmock("../lib/arc-week");
  });
});
