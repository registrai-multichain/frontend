import { describe, expect, test } from "vitest";
import type { InviteRecord } from "../../src/lib/builders-admin";
import type { Env } from "../lib/env";
import { INDEX_KEY, OPEN_DEBOUNCE_MS, getInvite, handleAdminInvites, handleInviteOpen, handlePublicInvites, invitesCacheKey } from "../lib/invites";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const ADMIN = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const T0 = Date.parse("2026-09-24T12:00:00.000Z");

type WithLink = InviteRecord & { claimLink: string };

function setup() {
  const kv = new MemoryKV();
  const env: Env = { INVITES: kv, ADMIN_ADDRESSES: ADMIN, SITE_ORIGIN: ORIGIN };
  const call = async (method: string, body?: unknown, query = "", now = T0) => {
    const res = await handleAdminInvites(
      new Request(`${ORIGIN}/api/admin/invites${query}`, {
        method,
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      ADMIN,
      now,
    );
    return { status: res.status, body: (await res.json()) as { invite?: WithLink; invites?: WithLink[]; error?: string; deleted?: string } };
  };
  const open = (body: unknown, now = T0) =>
    handleInviteOpen(new Request(`${ORIGIN}/api/invites/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env, now);
  const publicList = async () => {
    const res = await handlePublicInvites(env);
    return { res, body: (await res.json()) as { invites: Record<string, unknown>[] } };
  };
  return { kv, env, call, open, publicList };
}

describe("admin invites", () => {
  test("create: normalised source, @handle, a code, and the claim link", async () => {
    const { call, kv } = setup();
    const r = await call("POST", { source: "https://github.com/Foo/Bar", name: " Foo ", x: "foo_dev", note: "met at ETHGlobal" });
    expect(r.status).toBe(201);
    const inv = r.body.invite!;
    expect(inv).toMatchObject({
      source: "github:foo/bar",
      name: "Foo",
      x: "@foo_dev",
      note: "met at ETHGlobal",
      createdAt: "2026-09-24T12:00:00.000Z",
      createdBy: ADMIN,
      opens: 0,
    });
    expect(inv.code).toMatch(/^[0-9a-f]{24}$/);
    expect(inv.claimLink).toBe(`${ORIGIN}/verify/?source=github%3Afoo%2Fbar&invite=${inv.code}`);
    // stored under the normalised source, public projection as metadata
    expect(JSON.parse((await kv.get("invite:github:foo/bar"))!)).toMatchObject({ code: inv.code, note: "met at ETHGlobal" });
    expect(kv.store.get("invite:github:foo/bar")!.metadata).toEqual({ source: "github:foo/bar", name: "Foo", x: "@foo_dev", createdAt: inv.createdAt });
  });

  test("an existing source is a 409 with the existing record", async () => {
    const { call } = setup();
    const first = await call("POST", { source: "foo/bar", name: "Foo" });
    const again = await call("POST", { source: "github:FOO/bar.git", name: "Other" });
    expect(again.status).toBe(409);
    expect(again.body.invite).toMatchObject({ source: "github:foo/bar", name: "Foo", code: first.body.invite!.code });
    expect(again.body.invite!.claimLink).toBe(first.body.invite!.claimLink);
  });

  test("validation", async () => {
    const { call } = setup();
    expect((await call("POST", { source: "not a source" })).status).toBe(400);
    expect((await call("POST", {})).status).toBe(400);
    expect((await call("POST", { source: "a/b", name: "n".repeat(81) })).body.error).toMatch(/name/);
    expect((await call("POST", { source: "a/b", x: "@has-dash" })).body.error).toMatch(/x must/);
    expect((await call("POST", { source: "a/b", x: "@abcdefghijklmnop" })).status).toBe(400);
    expect((await call("POST", { source: "a/b", note: "n".repeat(501) })).body.error).toMatch(/note/);
    expect((await call("POST", { source: "a/b", name: 5 })).status).toBe(400);
    expect((await call("POST", { source: "a/b", name: "n".repeat(80), note: "n".repeat(500), x: "@a" })).status).toBe(201);
  });

  test("list, edit, delete", async () => {
    const { call } = setup();
    await call("POST", { source: "example.org", name: "Example" }, "", T0);
    await call("POST", { source: "a/b" }, "", T0 + 1000);
    const list = await call("GET");
    expect(list.body.invites!.map((i) => i.source)).toEqual(["github:a/b", "domain:example.org"]); // newest first
    expect(list.body.invites![1].claimLink).toContain("/verify/?source=domain%3Aexample.org&invite=");

    const edited = await call("PATCH", { source: "https://example.org/", x: "@ex", name: "", note: "private" });
    expect(edited.status).toBe(200);
    expect(edited.body.invite).toMatchObject({ source: "domain:example.org", x: "@ex", note: "private" });
    expect(edited.body.invite!.name).toBeUndefined();
    expect((await call("PATCH", { source: "nope.example" })).status).toBe(404);
    expect((await call("PATCH", { source: "example.org", x: "bad handle" })).status).toBe(400);

    const del = await call("DELETE", undefined, "?source=https%3A%2F%2Fgithub.com%2Fa%2Fb");
    expect(del.body).toEqual({ deleted: "github:a/b" });
    expect((await call("DELETE", undefined, "?source=a/b")).status).toBe(404);
    expect((await call("DELETE", undefined, "")).status).toBe(400);
    expect((await call("GET")).body.invites!.map((i) => i.source)).toEqual(["domain:example.org"]);
  });
});

describe("public invites", () => {
  test("public fields only: never the note, the code or tracking", async () => {
    const { call, open, publicList } = setup();
    const inv = (await call("POST", { source: "foo/bar", name: "Foo", x: "@foo", note: "secret note" })).body.invite!;
    await call("POST", { source: "example.org" }, "", T0 + 1);
    await open({ source: "foo/bar", code: inv.code });
    const { res, body } = await publicList();
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(body.invites).toEqual([
      { source: "github:foo/bar", name: "Foo", x: "@foo", createdAt: "2026-09-24T12:00:00.000Z" },
      { source: "domain:example.org", createdAt: "2026-09-24T12:00:00.001Z" },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/secret|code|opens|createdBy|0xf39f/);
  });

  test("the index follows edits and deletes, and is rebuilt when missing", async () => {
    const { call, kv, publicList } = setup();
    await call("POST", { source: "foo/bar", name: "Foo" });
    await call("PATCH", { source: "foo/bar", name: "Foo 2" });
    expect((await publicList()).body.invites[0].name).toBe("Foo 2");
    await kv.delete(INDEX_KEY);
    expect((await publicList()).body.invites).toEqual([{ source: "github:foo/bar", name: "Foo 2", createdAt: "2026-09-24T12:00:00.000Z" }]);
    await call("DELETE", undefined, "?source=foo/bar");
    expect((await publicList()).body.invites).toEqual([]);
  });

  test("open tracking: the right code counts, anything else is a silent 204", async () => {
    const { call, env, open } = setup();
    const inv = (await call("POST", { source: "foo/bar" })).body.invite!;
    const wrong = await open({ source: "foo/bar", code: "0".repeat(24) });
    expect(wrong.status).toBe(204);
    expect((await open({ source: "foo/bar" })).status).toBe(204);
    expect((await open("garbage")).status).toBe(204);
    expect((await open({ source: "nope/nope", code: inv.code })).status).toBe(204);
    expect((await getInvite(env.INVITES, "github:foo/bar"))!.opens).toBe(0);

    expect((await open({ source: "github:foo/bar", code: inv.code }, T0 + 60_000)).status).toBe(204);
    expect((await open({ source: "https://github.com/foo/bar", code: inv.code }, T0 + 120_000)).status).toBe(204);
    const r = (await getInvite(env.INVITES, "github:foo/bar"))!;
    expect(r).toMatchObject({ opens: 2, firstOpenedAt: "2026-09-24T12:01:00.000Z", lastOpenedAt: "2026-09-24T12:02:00.000Z" });
  });

  test("open: cheap rejects (size, type, code / source format) never touch KV", async () => {
    const { env, kv } = setup();
    let reads = 0;
    const get = kv.get.bind(kv);
    kv.get = async (k: string) => {
      reads++;
      return get(k);
    };
    const raw = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
      handleInviteOpen(new Request(`${ORIGIN}/api/invites/open`, { method: "POST", headers, body }), env, T0);
    const code = "a".repeat(24);
    for (const res of await Promise.all([
      raw(JSON.stringify({ source: "foo/bar", code: "not-a-code" })),
      raw(JSON.stringify({ source: "foo/bar" })),
      raw(JSON.stringify({ source: "not a source", code })),
      raw(JSON.stringify({ source: "x".repeat(400), code })),
      raw(JSON.stringify({ source: "foo/bar", code, pad: "y".repeat(600) })),
      raw(JSON.stringify({ source: "foo/bar", code }), { "content-type": "text/plain" }),
      raw("{not json"),
      raw(JSON.stringify({ source: "foo/bar", code }), { "content-type": "application/json", "content-length": "99999" }),
    ])) {
      expect(res.status).toBe(204);
    }
    expect(reads).toBe(0);
    // a well-formed open does read (and finds nothing here)
    await raw(JSON.stringify({ source: "foo/bar", code }));
    expect(reads).toBe(1);
  });

  test("open: at most one write per invite a minute", async () => {
    const { call, env, open } = setup();
    const inv = (await call("POST", { source: "foo/bar" })).body.invite!;
    await open({ source: "foo/bar", code: inv.code }, T0 + 1000);
    await open({ source: "foo/bar", code: inv.code }, T0 + 1000 + OPEN_DEBOUNCE_MS - 1);
    expect((await getInvite(env.INVITES, "github:foo/bar"))!.opens).toBe(1);
    await open({ source: "foo/bar", code: inv.code }, T0 + 1000 + OPEN_DEBOUNCE_MS);
    expect((await getInvite(env.INVITES, "github:foo/bar"))!.opens).toBe(2);
  });

  test("GET /api/invites: one edge cache key whatever the query string", () => {
    expect(invitesCacheKey(`${ORIGIN}/api/invites?bust=1&x=2`)).toBe(`${ORIGIN}/api/invites`);
    expect(invitesCacheKey(`${ORIGIN}/api/invites`)).toBe(`${ORIGIN}/api/invites`);
  });
});
