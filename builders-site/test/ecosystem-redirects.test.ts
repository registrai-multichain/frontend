import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities([{ slug: "archery", name: "Archery", category: "consumer", status: "live", summary: "A game.",
  status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://archery.wtf/" }],
  index_ids: ["domain:archery.wtf"], facts_source: "domain:archery.wtf", last_reviewed: "2026-10-20" } as ArcEntity]) }));

const ctx = (path: string, parts: string[]) => ({ request: new Request(`https://builder.registrai.cc${path}`), env: { INVITES: { get: async () => null } }, params: { path: parts }, waitUntil: () => undefined,
  next: async () => new Response("STATIC", { headers: { "content-type": "text/html" } }) }) as never;

describe("one page per project", () => {
  test("appHref: entity page when claimed, the app page otherwise (a new index member keeps its page)", async () => {
    const { appHref } = await import("../lib/app-href");
    expect(appHref("domain:archery.wtf")).toBe("/ecosystem/archery/");
    expect(appHref("domain:brand-new.app")).toBe("/apps/domain/brand-new.app/");
  });
  test("/apps/<id>/ 301s to the entity page; an unclaimed id is not redirected", async () => {
    const { onRequest } = await import("../functions/apps/[[path]]");
    const r = await onRequest(ctx("/apps/domain/archery.wtf/", ["domain", "archery.wtf"]));
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://builder.registrai.cc/ecosystem/archery/");
    expect((await onRequest(ctx("/apps/domain/brand-new.app/", ["domain", "brand-new.app"]))).status).not.toBe(301);
  });
  test("/project/<id>/ 301s to the entity page when its facts source is claimed", async () => {
    const { onRequest } = await import("../functions/project/[[path]]");
    const r = await onRequest(ctx("/project/domain/archery.wtf/", ["domain", "archery.wtf"]));
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://builder.registrai.cc/ecosystem/archery/");
  });
  test("the /apps/ list links claimed apps to their entity page", async () => {
    const { renderAppList } = await import("../lib/apps-pages");
    const row = { id: "domain:archery.wtf", name: "Archery", kind: "builder", verified: true, points: 1, share: 1, first_hour: "2026-10-10T00:00:00Z", last_24h: { points_earned: 0, payments: 1, usdc: 1 }, contracts: 1, indices: ["aei"] };
    const h = renderAppList({ data_until: "2026-10-20T10:00:00Z", rows: [row as never, { ...row, id: "domain:brand-new.app", name: "New" } as never], totals: { apps: 2, payments_24h: 2, usdc_24h: 2, arc_usdc_24h_est: 0 } }, "payments");
    expect(h).toContain('href="/ecosystem/archery/"');
    expect(h).toContain('href="/apps/domain/brand-new.app/"');
  });
});
