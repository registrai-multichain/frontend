import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { indexCorrections } from "../../src/lib/arc-ecosystem-corrections";

const E: ArcEntity[] = [
  { slug: "aave", name: "Aave", category: "lending", status: "announced", summary: "Lending.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://aave.com/" }], last_reviewed: "2026-10-20" },
  { slug: "pipe", name: "Pi|pe *x*", category: "dexs", status: "live", summary: "A DEX.", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://p.example/" }], last_reviewed: "2026-10-20" },
];
const C = [{ id: 1, date: "2026-10-22", slug: "gone", field: "removal", change: "Removed at the project's request.", from: "project" }];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: indexCorrections(C as never) }));
vi.mock("../lib/apps-data", async (orig) => ({ ...(await orig<typeof import("../lib/apps-data")>()), loadApp: async () => "unknown" }));

const env = { INVITES: { get: async () => null } };
async function call(path: string, method = "GET") {
  const u = new URL(`https://builder.registrai.cc${path}`);
  const area = u.pathname.split("/")[1];
  const mod = area === "ecosystem" ? await import("../functions/ecosystem/[[path]]") : area === "arc" ? await import("../functions/arc/[[path]]") : await import("../functions/methodology/[[path]]");
  const parts = u.pathname.replace(new RegExp(`^/${area}/?`), "").split("/").filter(Boolean);
  return mod.onRequest({ request: new Request(u, { method }), env, params: { path: parts }, waitUntil: () => undefined } as never);
}

describe("<page>index.md copies", () => {
  test("each reference page has a markdown copy linked as alternate; it resolves to 200 text/markdown starting with '# '", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    try {
      for (const p of ["/ecosystem/", "/ecosystem/dexs/", "/ecosystem/aave/", "/ecosystem/corrections/", "/arc/", "/arc/get-usdc/", "/methodology/"]) {
        const html = await (await call(p)).text();
        expect(html, p).toContain(`<link rel="alternate" type="text/markdown" href="${p}index.md">`);
        const r = await call(`${p}index.md`);
        expect(r.status, p).toBe(200);
        expect(r.headers.get("content-type"), p).toBe("text/markdown; charset=utf-8");
        const md = await r.text();
        expect(md.startsWith("# "), p).toBe(true);
        expect(md, p).toContain("Registrai, builder.registrai.cc, CC BY 4.0");
        expect(md, p).not.toMatch(/<[a-z]/i);
      }
    } finally { vi.unstubAllGlobals(); }
  });
  test("names with | and * stay inside their table cell", async () => {
    const md = await (await call("/ecosystem/dexs/index.md")).text();
    expect(md).toContain("[Pi\\|pe \\*x\\*](https://builder.registrai.cc/ecosystem/pipe/)");
  });
  test("404 and 410 parity; HEAD empty; status filter passes through", async () => {
    expect((await call("/ecosystem/nobody/index.md")).status).toBe(404);
    const gone = await call("/ecosystem/gone/index.md");
    expect(gone.status).toBe(410);
    expect(gone.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await (await call("/ecosystem/aave/index.md", "HEAD")).text()).toBe("");
    const live = await (await call("/ecosystem/index.md?status=live")).text();
    expect(live).toContain("Pi\\|pe");
    expect(live).not.toContain("[Aave]");
  });
});
