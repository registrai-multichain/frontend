import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { indexCorrections } from "../../src/lib/arc-ecosystem-corrections";

const E: ArcEntity[] = [
  { slug: "aave", name: "Aave", category: "lending", status: "announced", summary: "Lending.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://aave.com/" }], last_reviewed: "2026-10-20" },
];
const C = [
  { id: 1, date: "2026-10-22", slug: "aave", field: "summary", change: "Summary <b>fixed</b>.", source: "https://aave.com/x", from: "project" },
  { id: 2, date: "2026-10-23", slug: "gone", field: "removal", change: "Removed at the project's request.", from: "project" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: indexCorrections(C as never) }));
vi.mock("../lib/apps-data", async (orig) => ({ ...(await orig<typeof import("../lib/apps-data")>()), loadApp: async () => "unknown" }));

const route = async (path: string) => {
  const { onRequest } = await import("../functions/ecosystem/[[path]]");
  const u = new URL(`https://builder.registrai.cc${path}`);
  const parts = u.pathname.replace(/^\/ecosystem\/?/, "").split("/").filter(Boolean);
  return onRequest({ request: new Request(u), env: { INVITES: { get: async () => null } }, params: { path: parts }, waitUntil: () => undefined } as never);
};

describe("corrections log", () => {
  test("/ecosystem/corrections/: newest first, escaped, linked, ItemList", async () => {
    const h = await (await route("/ecosystem/corrections/")).text();
    expect(h).toContain("<h1>Corrections</h1>");
    expect(h.indexOf("2026-10-23")).toBeLessThan(h.indexOf("2026-10-22"));
    expect(h).toContain("Summary &lt;b&gt;fixed&lt;/b&gt;.");
    expect(h).toContain('<a href="/ecosystem/aave/">Aave</a>');
    expect(h).toContain('id="aave"');
    expect(h).toContain('"@type":"ItemList"');
    expect(h).toContain("From the project");
  });
  test("a removed slug answers 410 with its log entry; an unknown one 404", async () => {
    const r = await route("/ecosystem/gone/");
    expect(r.status).toBe(410);
    expect(await r.text()).toContain('href="/ecosystem/corrections/#gone"');
    expect((await route("/ecosystem/nobody/")).status).toBe(404);
  });
  test("project page shows 'Corrected 1 time · latest …'", async () => {
    const h = await (await route("/ecosystem/aave/")).text();
    expect(h).toContain('<a href="/ecosystem/corrections/#aave">Corrected 1 time · latest 2026-10-22</a>');
  });
  test("API: /api/v1/ecosystem/corrections lists the log newest first", async () => {
    const { handleEcosystem } = await import("../lib/data-api-ecosystem");
    const r = await handleEcosystem(new Request("https://builder.registrai.cc/api/v1/ecosystem/corrections"), { cache: null }, ["corrections"]);
    const b = await r.json() as { version: number; corrections: { id: number }[] };
    expect(b.version).toBe(1);
    expect(b.corrections.map((c) => c.id)).toEqual([2, 1]);
  });
  test("an entry from Registrai's own review is labelled 'Registrai review'", async () => {
    const { renderCorrectionsLog } = await import("../lib/corrections-pages");
    const h = renderCorrectionsLog([{ id: 3, date: "2026-10-23", slug: "aave", field: "dates", change: "Live since 2026-09-16, from the launch post", source: "https://aave.com/y", from: "review" }] as never, new Map([["aave", "Aave"]]));
    expect(h).toContain("Registrai review");
  });
});
