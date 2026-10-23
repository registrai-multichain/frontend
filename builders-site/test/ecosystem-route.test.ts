import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

const E: ArcEntity[] = [
  { slug: "archery", name: "Archery", category: "consumer", status: "live", summary: "A game on Arc.", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }],
    sources: [{ url: "https://archery.wtf/" }], index_ids: ["domain:archery.wtf"], facts_source: "domain:archery.wtf", last_reviewed: "2026-10-20" },
  { slug: "aave", name: "Aave", category: "lending", status: "announced", summary: "Lending.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://aave.com/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() }, ECOSYSTEM: indexEntities(E) }));
const loadApp = vi.fn();
vi.mock("../lib/apps-data", async (orig) => ({ ...(await orig<typeof import("../lib/apps-data")>()), loadApp: (...a: unknown[]) => loadApp(...a) }));

const call = async (path: string, method = "GET", env: Record<string, unknown> = {}) => {
  const { onRequest } = await import("../functions/ecosystem/[[path]]");
  const u = new URL(`https://builder.registrai.cc${path}`);
  const parts = u.pathname.replace(/^\/ecosystem\/?/, "").split("/").filter(Boolean);
  return onRequest({ request: new Request(u, { method }), env: { INVITES: { get: async () => null }, ...env }, params: { path: parts }, waitUntil: () => undefined } as never);
};

describe("/ecosystem route", () => {
  test("directory, filtered directory, category, entity, 404s", async () => {
    loadApp.mockResolvedValue("unknown");
    expect(await (await call("/ecosystem/")).text()).toContain("<h1>Every project building on Arc</h1>");
    const evil = await (await call("/ecosystem/?status=evil")).text();
    expect(evil).toContain(">Aave<"); expect(evil).toContain(">Archery<");
    expect(await (await call("/ecosystem/lending/")).text()).toContain("<h1>Lending on Arc</h1>");
    expect(await (await call("/ecosystem/aave/")).text()).toContain("<h1>Aave</h1>");
    expect((await call("/ecosystem/nobody/")).status).toBe(404);
    expect((await call("/ecosystem/dexs/extra/")).status).toBe(404);
  });
  test("missing slash 301s; POST 405; HEAD has no body", async () => {
    const r = await call("/ecosystem/aave");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://builder.registrai.cc/ecosystem/aave/");
    expect((await call("/ecosystem/", "POST")).status).toBe(405);
    expect(await (await call("/ecosystem/aave/", "HEAD")).text()).toBe("");
  });
  test("index data down or facts KV failing: the entity page still answers 200 without those blocks", async () => {
    loadApp.mockResolvedValue(null);
    const r = await call("/ecosystem/archery/", "GET", { INVITES: { get: async () => { throw new Error("kv down"); } } });
    expect(r.status).toBe(200);
    const h = await r.text();
    expect(h).toContain("<h1>Archery</h1>");
    expect(h).not.toContain("<h2>Activity</h2>");
    expect(h).not.toContain("<h2>Project facts</h2>");
  });
});
