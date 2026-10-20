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
