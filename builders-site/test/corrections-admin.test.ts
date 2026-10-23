import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { MemoryD1 } from "./memory-d1";

const E: ArcEntity[] = [
  { slug: "visa", name: "Visa", category: "payments", status: "announced", summary: "Payments.", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://visa.com/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

const ADMIN = { address: "0xadmin", role: "admin" as const }, ONB = { address: "0xonb", role: "onboarder" as const };
function seeded() {
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  db.q("INSERT INTO corrections (slug, field, text, email, name, domain_match, ip_hash, created_at) VALUES ('visa','summary','Fix <b>it</b> please now','a@visa.com','Ana',1,'h1',100)");
  db.q("INSERT INTO corrections (slug, field, text, email, domain_match, ip_hash, created_at) VALUES ('visa','other','Second one here','b@x.com',0,'h2',200)");
  return db;
}
const req = (body?: unknown) => new Request("https://builder.registrai.cc/api/admin/corrections", body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("admin corrections", () => {
  test("GET: open items oldest first, with the entity name and domain hint; never the IP hash", async () => {
    const { handleAdminCorrections } = await import("../lib/corrections");
    const b = await (await handleAdminCorrections(req(), { DATA_DB: seeded() } as never, ONB)).json() as { open: Record<string, unknown>[]; decided: unknown[] };
    expect(b.open.map((c) => c.id)).toEqual([1, 2]);
    expect(b.open[0]).toMatchObject({ slug: "visa", name: "Visa", domain_match: true, email: "a@visa.com", person: "Ana", status: "open" });
    expect(JSON.stringify(b)).not.toContain("ip_hash");
    expect(b.decided).toEqual([]);
  });
  test("POST approve needs a 5-200 char note; reject needs none; deciding twice → 409; unknown → 404", async () => {
    const { handleAdminCorrections } = await import("../lib/corrections");
    const env = { DATA_DB: seeded() } as never;
    expect((await handleAdminCorrections(req({ id: 1, decision: "approve", public_note: "abc" }), env, ADMIN)).status).toBe(400);
    const r = await handleAdminCorrections(req({ id: 1, decision: "approve", public_note: "Summary now says the pilot is live." }), env, ADMIN, 5_000_000);
    expect(r.status).toBe(200);
    expect((await r.json() as { correction: Record<string, unknown> }).correction).toMatchObject({ status: "approved", public_note: "Summary now says the pilot is live.", decided_by: "0xadmin", decided_at: 5000 });
    expect((await handleAdminCorrections(req({ id: 1, decision: "reject" }), env, ADMIN)).status).toBe(409);
    expect((await handleAdminCorrections(req({ id: 2, decision: "reject" }), env, ADMIN)).status).toBe(200);
    expect((await handleAdminCorrections(req({ id: 99, decision: "reject" }), env, ADMIN)).status).toBe(404);
    expect((await handleAdminCorrections(req({ id: 1, decision: "maybe" }), env, ADMIN)).status).toBe(400);
  });
  test("an onboarder can read but not decide (403)", async () => {
    const { handleAdminCorrections } = await import("../lib/corrections");
    expect((await handleAdminCorrections(req({ id: 1, decision: "reject" }), { DATA_DB: seeded() } as never, ONB)).status).toBe(403);
  });
  test("no DATA_DB → 503", async () => {
    const { handleAdminCorrections } = await import("../lib/corrections");
    expect((await handleAdminCorrections(req(), {} as never, ADMIN)).status).toBe(503);
  });
  test("purge: clears email, name and IP hash 30 days after the decision; open items untouched", async () => {
    const { purgeCorrections, RETAIN_S } = await import("../lib/corrections");
    const db = seeded();
    db.q("UPDATE corrections SET status='rejected', decided_at=1000 WHERE id=1");
    expect(await purgeCorrections(db as never, (1000 + RETAIN_S - 1) * 1000)).toBe(0);
    expect(await purgeCorrections(db as never, (1000 + RETAIN_S + 1) * 1000)).toBe(1);
    expect(db.q("SELECT id, email, name, ip_hash FROM corrections ORDER BY id")).toEqual([
      { id: 1, email: null, name: null, ip_hash: "" }, { id: 2, email: "b@x.com", name: null, ip_hash: "h2" }]);
  });
});
