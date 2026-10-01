import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { getFacts, handleAdminFacts, handlePublicFacts } from "../lib/facts";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const T0 = Date.parse("2026-09-29T12:00:00.000Z");
const ADMIN = "0xb7ecf980a4732b75e57e2ec80903dee3964f2573";
const SRC = "domain:kairo.market";
const GH = "github:owner/repo";
const fact = (id: string, extra: Record<string, unknown> = {}) => ({
  id, topic: "control", text: "One externally owned account deployed all 16 contracts.",
  evidence: ["0xdaf97c69eb8fb68ca9f4269eb8c458b3a5a31122"], observedAt: "2026-09-27T00:00:00.000Z", ...extra,
});

function setup() {
  const kv = new MemoryKV(() => T0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN };
  const req = (path: string, method = "GET", body?: unknown) =>
    new Request(`${ORIGIN}${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json", origin: ORIGIN }, body: body === undefined ? undefined : JSON.stringify(body) });
  const call = async (res: Promise<Response>) => { const r = await res; return { status: r.status, body: (await r.json()) as Record<string, any>, headers: r.headers }; };
  const put = (s: string, body: unknown, now = T0) => call(handleAdminFacts(req(`/api/admin/facts/${encodeURIComponent(s)}`, "PUT", body), env, s, ADMIN, { now }));
  const get = (s: string) => call(handleAdminFacts(req(`/api/admin/facts/${encodeURIComponent(s)}`), env, s, ADMIN, { now: T0 }));
  const pub = (s: string, now = T0) => call(handlePublicFacts(req(`/api/facts/${encodeURIComponent(s)}`), env, s, { now }));
  return { put, get, pub, kv };
}

describe("facts API", () => {
  test("empty editor state, then save increments rev and logs additions", async () => {
    const { put, get } = setup();
    expect((await get(SRC)).body.facts).toMatchObject({ source: SRC, facts: [], rev: 0 });
    const r = await put(SRC, { rev: 0, facts: [fact("f1")] });
    expect(r.status).toBe(200);
    expect(r.body.facts.rev).toBe(1);
    expect(r.body.facts.reviewedBy).toBe(ADMIN);
    expect(r.body.facts.changelog.map((c: any) => c.kind)).toEqual(["added"]);
  });
  test("stale rev is refused with 409", async () => {
    const { put } = setup();
    await put(SRC, { rev: 0, facts: [fact("f1")] });
    const r = await put(SRC, { rev: 0, facts: [] });
    expect(r.status).toBe(409);
    expect(r.body.rev).toBe(1);
  });
  test("public view hides future publishAt facts and their log", async () => {
    const { put, pub } = setup();
    await put(SRC, { rev: 0, facts: [fact("f1"), fact("sec", { topic: "infrastructure", publishAt: "2026-10-29T00:00:00.000Z" })] });
    const now = await pub(SRC);
    expect(now.status).toBe(200);
    expect(now.body.facts.facts.map((f: any) => f.id)).toEqual(["f1"]);
    expect(JSON.stringify(now.body)).not.toContain("sec");
    expect(now.headers.get("cache-control")).toContain("max-age=60");
    const later = await pub(SRC, Date.parse("2026-11-01T00:00:00.000Z"));
    expect(later.body.facts.facts).toHaveLength(2);
  });
  test("github sources round-trip; non-canonical sources are 400; unknown is 404", async () => {
    const { put, pub } = setup();
    expect((await put(GH, { rev: 0, facts: [fact("f1")] })).status).toBe(200);
    expect((await pub(GH)).status).toBe(200);
    expect((await pub("domain:Kairo.Market")).status).toBe(400);
    expect((await pub("domain:nothing.here")).status).toBe(404);
  });
  test("public view: reviewed by Registrai, no rev, no wallet; lastReviewedAt from public facts only", async () => {
    const { put, get, pub } = setup();
    const none = await pub(SRC);
    expect(none.status).toBe(404);
    await put(SRC, { rev: 0, facts: [fact("sec", { publishAt: "2026-10-29T00:00:00.000Z" })] });
    const onlyPrivate = await pub(SRC);
    expect(onlyPrivate.body.facts.reviewedBy).toBe("Registrai");
    expect(onlyPrivate.body.facts).not.toHaveProperty("lastReviewedAt");
    expect(onlyPrivate.body.facts).not.toHaveProperty("rev");
    await put(SRC, { rev: 1, facts: [fact("f1"), fact("sec", { publishAt: "2026-10-29T00:00:00.000Z" })] }, T0 + 1000);
    const first = await pub(SRC, T0 + 2000);
    const latest = first.body.facts.facts.map((f: any) => f.updatedAt).sort().pop();
    expect(first.body.facts.lastReviewedAt).toBe(latest);
    // A later edit to the private fact alone changes nothing public, not even the review time.
    await put(SRC, { rev: 2, facts: [fact("f1"), fact("sec", { text: "A changed private detail.", publishAt: "2026-10-29T00:00:00.000Z" })] }, T0 + 3_600_000);
    const after = await pub(SRC, T0 + 3_700_000);
    expect(after.body).toEqual(first.body);
    expect(JSON.stringify(after.body).toLowerCase()).not.toContain(ADMIN);
    // The stored document and the admin view keep the wallet and rev.
    const admin = await get(SRC);
    expect(admin.body.facts).toMatchObject({ reviewedBy: ADMIN, rev: 3, lastReviewedAt: new Date(T0 + 3_600_000).toISOString() });
  });
  test("verdict words are refused with 400", async () => {
    const { put } = setup();
    expect((await put(SRC, { rev: 0, facts: [fact("f1", { text: "This looks like a scam." })] })).status).toBe(400);
  });
  test("a changelog in the request body is ignored", async () => {
    const { put } = setup();
    const r = await put(SRC, { rev: 0, facts: [fact("f1")], changelog: [{ at: "2020-01-01T00:00:00.000Z", kind: "added", factId: "fake", text: "forged" }] });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body.facts.changelog)).not.toContain("forged");
  });
  test("private fact log entries stay hidden publicly until publishAt, via the stored previous facts", async () => {
    const { put, pub } = setup();
    await put(SRC, { rev: 0, facts: [fact("f1"), fact("sec", { publishAt: "2026-10-29T00:00:00.000Z" })] });
    expect(JSON.stringify((await pub(SRC)).body)).not.toContain("sec");
    const later = await pub(SRC, Date.parse("2026-11-01T00:00:00.000Z"));
    expect(later.body.facts.changelog.map((c: any) => c.factId).sort()).toEqual(["f1", "sec"]);
    expect(later.body.facts.changelog[0].hiddenUntil).toBeUndefined();
  });
  test("the change log keeps the newest 200 entries", async () => {
    const { put, kv } = setup();
    let rev = 0;
    for (let i = 0; i < 25; i++) {
      const facts = Array.from({ length: 10 }, (_, j) => fact(`f${j}`, { text: `Version ${i} of fact ${j}.` }));
      expect((await put(SRC, { rev, facts }, T0 + i * 1000)).status).toBe(200);
      rev++;
    }
    const stored = (await getFacts(kv, SRC))!;
    expect(stored.changelog).toHaveLength(200);
    expect(stored.changelog.at(-1)!.text).toBe("Version 24 of fact 9.");
    expect(stored.changelog[0].text).not.toBe("Version 0 of fact 0.");
  });
});
