import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { adminLoginMessage } from "../../src/lib/builders-admin";
import { adminGate, handleLogin, handleLogout, handleMe, handleNonce, makeNonce, nonceProblem, sessionAddress, verifyLogin } from "../lib/auth";
import type { Env } from "../lib/env";
import { csrfFailure, getCookie } from "../lib/http";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
// Anvil's first two dev keys: never real funds.
const ADMIN = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const OTHER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const NOW = Date.parse("2026-09-24T12:00:00.000Z");

function setup() {
  let now = NOW;
  const kv = new MemoryKV(() => now);
  const env: Env = {
    INVITES: kv,
    ADMIN_ADDRESSES: `${ADMIN.address.toLowerCase()}, 0x000000000000000000000000000000000000dead`,
    SITE_ORIGIN: ORIGIN,
    NONCE_SECRET: "test-secret-0123456789",
  };
  return { kv, env, tick: (ms: number) => (now += ms), now: () => now };
}

async function nonceFrom(env: Env, now = NOW): Promise<string> {
  return ((await (await handleNonce(env, now)).json()) as { nonce: string }).nonce;
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

async function signed(env: Env, o: { account?: typeof ADMIN; origin?: string; issued?: string; nonce?: string } = {}) {
  const nonce = o.nonce ?? (await nonceFrom(env));
  const message = adminLoginMessage({ origin: o.origin ?? ORIGIN, nonce, issued: o.issued ?? new Date(NOW).toISOString() });
  const signature = await (o.account ?? ADMIN).signMessage({ message });
  return { message, signature, nonce };
}

describe("nonce (stateless)", () => {
  test("base64url(ts | 16 random bytes | HMAC); issuing one writes nothing to KV", async () => {
    const { env, kv } = setup();
    const a = await nonceFrom(env);
    const b = await nonceFrom(env);
    expect(a).toMatch(/^[A-Za-z0-9_-]{75}$/);
    expect(a).not.toBe(b);
    expect(kv.store.size).toBe(0);
    expect(await nonceProblem(a, env.NONCE_SECRET!, NOW)).toBeNull();
  });

  test("tampered, or made with another secret: refused", async () => {
    const { env } = setup();
    const n = await nonceFrom(env);
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    expect(await nonceProblem(flip(n, 3), env.NONCE_SECRET!, NOW)).toMatch(/unknown/); // the timestamp
    expect(await nonceProblem(flip(n, 20), env.NONCE_SECRET!, NOW)).toMatch(/unknown/); // the random part
    expect(await nonceProblem(flip(n, 70), env.NONCE_SECRET!, NOW)).toMatch(/unknown/); // the MAC
    expect(await nonceProblem(await makeNonce("another secret", NOW), env.NONCE_SECRET!, NOW)).toMatch(/unknown/);
    expect(await nonceProblem("0123456789abcdef0123456789abcdef", env.NONCE_SECRET!, NOW)).toMatch(/unknown/);
    expect(await nonceProblem("", env.NONCE_SECRET!, NOW)).toMatch(/unknown/);
    const body = await signed(env, { nonce: flip(n, 20) });
    const res = await handleLogin(post("/api/auth/login", body), env, NOW);
    expect(res.status).toBe(401);
  });

  test("older than 5 minutes (or from the future): refused", async () => {
    const { env } = setup();
    const n = await nonceFrom(env, NOW);
    expect(await nonceProblem(n, env.NONCE_SECRET!, NOW + 5 * 60_000)).toBeNull();
    expect(await nonceProblem(n, env.NONCE_SECRET!, NOW + 5 * 60_000 + 1)).toMatch(/expired/);
    const future = await nonceFrom(env, NOW + 5 * 60_000);
    expect(await nonceProblem(future, env.NONCE_SECRET!, NOW)).toMatch(/expired/);
    // at login too, even with a fresh `issued` line
    const old = await nonceFrom(env, NOW - 6 * 60_000);
    const res = await handleLogin(post("/api/auth/login", await signed(env, { nonce: old })), env, NOW);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toMatch(/expired/);
  });

  test("without NONCE_SECRET both endpoints fail closed with a clear 500", async () => {
    const { env } = setup();
    const body = await signed(env);
    delete env.NONCE_SECRET;
    const n = await handleNonce(env, NOW);
    expect(n.status).toBe(500);
    expect(((await n.json()) as { error: string }).error).toMatch(/NONCE_SECRET/);
    const res = await handleLogin(post("/api/auth/login", body), env, NOW);
    expect(res.status).toBe(500);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("a failed sign-in does not use the nonce up (nothing written); a successful one does", async () => {
    const { env, kv } = setup();
    const nonce = await nonceFrom(env);
    const refused = await handleLogin(post("/api/auth/login", await signed(env, { nonce, account: OTHER })), env, NOW);
    expect(refused.status).toBe(403);
    expect(kv.store.size).toBe(0);
    const ok = await handleLogin(post("/api/auth/login", await signed(env, { nonce })), env, NOW);
    expect(ok.status).toBe(200);
    expect(await kv.get(`used-nonce:${nonce}`)).toBe("1");
    expect(kv.store.get(`used-nonce:${nonce}`)!.expiresAt).toBe(NOW + 300_000);
  });
});

describe("login (real viem signatures)", () => {
  test("a good signature from an allowlisted wallet creates a 12h session cookie", async () => {
    const { env, kv } = setup();
    const body = await signed(env);
    const res = await handleLogin(post("/api/auth/login", body), env, NOW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: ADMIN.address.toLowerCase(), role: "admin" });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-rb_admin=[0-9a-f]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
    const token = /=([0-9a-f]{64});/.exec(cookie)![1];
    expect(await kv.get(`session:${token}`)).toBe(ADMIN.address.toLowerCase());
    expect(kv.store.get(`session:${token}`)!.expiresAt).toBe(NOW + 43_200_000);
    // single use: the nonce is recorded as used
    expect(await kv.get(`used-nonce:${body.nonce}`)).toBe("1");

    const me = await handleMe(new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: `__Host-rb_admin=${token}` } }), env);
    expect(await me.json()).toEqual({ service: "registrai-builders-admin", address: ADMIN.address.toLowerCase(), role: "admin" });
  });

  test("a wallet not on the allowlist is refused", async () => {
    const { env } = setup();
    const res = await handleLogin(post("/api/auth/login", await signed(env, { account: OTHER })), env, NOW);
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("a signature over another message (wrong signer for this message) is refused", async () => {
    const { env } = setup();
    const good = await signed(env);
    const other = await signed(env);
    // good's message with other's signature recovers to some unrelated address
    const tampered = { message: good.message, signature: await OTHER.signMessage({ message: good.message }) };
    expect((await handleLogin(post("/api/auth/login", tampered), env, NOW)).status).toBe(403);
    // and a signature from the admin over a different message recovers to a random address
    const mixed = { message: other.message, signature: good.signature };
    const r = await verifyLogin(env, mixed, NOW);
    expect(r.ok).toBe(false);
  });

  test("a nonce works once: replayed after a successful sign-in, it is refused", async () => {
    const { env } = setup();
    const body = await signed(env);
    expect((await handleLogin(post("/api/auth/login", body), env, NOW)).status).toBe(200);
    const again = await handleLogin(post("/api/auth/login", body), env, NOW + 1000);
    expect(again.status).toBe(401);
    expect(((await again.json()) as { error: string }).error).toMatch(/already used/);
  });

  test("an unknown nonce is refused", async () => {
    const { env } = setup();
    const body = await signed(env, { nonce: "0123456789abcdef0123456789abcdef" });
    expect((await handleLogin(post("/api/auth/login", body), env, NOW)).status).toBe(401);
  });

  test("a stale issued time is refused (and a far-future one)", async () => {
    const { env } = setup();
    const stale = await signed(env, { issued: new Date(NOW - 5 * 60_000 - 1000).toISOString() });
    const r1 = await handleLogin(post("/api/auth/login", stale), env, NOW);
    expect(r1.status).toBe(401);
    expect(((await r1.json()) as { error: string }).error).toMatch(/expired/);
    const future = await signed(env, { issued: new Date(NOW + 10 * 60_000).toISOString() });
    expect((await handleLogin(post("/api/auth/login", future), env, NOW)).status).toBe(401);
    const fresh = await signed(env, { issued: new Date(NOW - 4 * 60_000).toISOString() });
    expect((await handleLogin(post("/api/auth/login", fresh), env, NOW)).status).toBe(200);
  });

  test("a message for another origin is refused", async () => {
    const { env } = setup();
    const body = await signed(env, { origin: "https://registrai.cc" });
    const res = await handleLogin(post("/api/auth/login", body), env, NOW);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toMatch(/registrai\.cc/);
  });

  test("the request itself must be same-origin JSON", async () => {
    const { env } = setup();
    const body = await signed(env);
    expect((await handleLogin(post("/api/auth/login", body, { origin: "https://evil.example" }), env, NOW)).status).toBe(403);
    expect((await handleLogin(post("/api/auth/login", body, { "content-type": "text/plain" }), env, NOW)).status).toBe(403);
  });

  test("malformed bodies", async () => {
    const { env } = setup();
    expect((await verifyLogin(env, null, NOW)).ok).toBe(false);
    expect(await verifyLogin(env, { message: "hi", signature: `0x${"1".repeat(130)}` }, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await verifyLogin(env, { message: "x", signature: "0x12" }, NOW)).toMatchObject({ ok: false, status: 400 });
  });

  test("with an empty ADMIN_ADDRESSES nobody signs in", async () => {
    const { env } = setup();
    env.ADMIN_ADDRESSES = "";
    expect((await handleLogin(post("/api/auth/login", await signed(env)), env, NOW)).status).toBe(403);
  });
});

describe("session", () => {
  async function loggedIn() {
    const s = setup();
    const res = await handleLogin(post("/api/auth/login", await signed(s.env)), s.env, NOW);
    const token = /=([0-9a-f]{64});/.exec(res.headers.get("set-cookie")!)![1];
    return { ...s, token, cookie: `other=1; __Host-rb_admin=${token}` };
  }

  test("me without a session: service marker, no address", async () => {
    const { env } = setup();
    expect(await (await handleMe(new Request(`${ORIGIN}/api/auth/me`), env)).json()).toEqual({ service: "registrai-builders-admin", address: null, role: null });
  });

  test("removing an address from the allowlist ends its sessions", async () => {
    const { env, cookie } = await loggedIn();
    const req = new Request(`${ORIGIN}/api/admin/invites`, { headers: { cookie } });
    expect(await sessionAddress(req, env)).toBe(ADMIN.address.toLowerCase());
    env.ADMIN_ADDRESSES = "0x000000000000000000000000000000000000dead";
    expect(await sessionAddress(req, env)).toBeNull();
  });

  test("the session expires after 12 hours", async () => {
    const { env, cookie, tick } = await loggedIn();
    const req = new Request(`${ORIGIN}/api/admin/invites`, { headers: { cookie } });
    tick(12 * 3600_000 - 1000);
    expect(await sessionAddress(req, env)).not.toBeNull();
    tick(2000);
    expect(await sessionAddress(req, env)).toBeNull();
  });

  test("admin gate: session required; mutations also need same-origin JSON", async () => {
    const { env, cookie } = await loggedIn();
    expect(await adminGate(new Request(`${ORIGIN}/api/admin/invites`), env)).toBeInstanceOf(Response);
    expect(await adminGate(new Request(`${ORIGIN}/api/admin/invites`, { headers: { cookie } }), env)).toEqual({ address: ADMIN.address.toLowerCase(), role: "admin" });
    const mut = (headers: Record<string, string>) => new Request(`${ORIGIN}/api/admin/invites`, { method: "POST", headers: { cookie, ...headers }, body: "{}" });
    const noOrigin = await adminGate(mut({ "content-type": "application/json" }), env);
    expect(noOrigin).toBeInstanceOf(Response);
    expect((noOrigin as Response).status).toBe(403);
    expect(await adminGate(mut({ "content-type": "application/x-www-form-urlencoded", origin: ORIGIN }), env)).toBeInstanceOf(Response);
    expect(await adminGate(mut({ "content-type": "application/json; charset=utf-8", origin: ORIGIN }), env)).toEqual({ address: ADMIN.address.toLowerCase(), role: "admin" });
    const del = new Request(`${ORIGIN}/api/admin/invites?source=a/b`, { method: "DELETE", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" } });
    expect(((await adminGate(del, env)) as Response).status).toBe(403);
  });

  test("logout deletes the session and clears the cookie", async () => {
    const { env, kv, cookie, token } = await loggedIn();
    const res = await handleLogout(post("/api/auth/logout", {}, { cookie }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBe("__Host-rb_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    expect(await kv.get(`session:${token}`)).toBeNull();
  });
});

describe("onboarder sign-in (ONBOARDER_ADDRESSES)", () => {
  async function onboarderIn(extra: Partial<Env> = {}) {
    const s = setup();
    s.env.ONBOARDER_ADDRESSES = OTHER.address.toLowerCase();
    Object.assign(s.env, extra);
    const res = await handleLogin(post("/api/auth/login", await signed(s.env, { account: OTHER })), s.env, NOW);
    const token = /=([0-9a-f]{64});/.exec(res.headers.get("set-cookie") ?? "")?.[1];
    return { ...s, res, cookie: `__Host-rb_admin=${token}` };
  }
  const read = (cookie: string) => new Request(`${ORIGIN}/api/admin/invites`, { headers: { cookie } });
  const write = (cookie: string, method: string) =>
    new Request(`${ORIGIN}/api/admin/invites?source=a/b`, { method, headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: method === "DELETE" ? undefined : "{}" });

  test("an onboarder signs in, and /me says so", async () => {
    const { env, res, cookie } = await onboarderIn();
    expect(res.status).toBe(200);
    expect(await (await handleMe(read(cookie), env)).json()).toEqual({ service: "registrai-builders-admin", address: OTHER.address.toLowerCase(), role: "onboarder" });
  });

  test("an onboarder reads; every change is refused", async () => {
    const { env, cookie } = await onboarderIn();
    expect(await adminGate(read(cookie), env)).toEqual({ address: OTHER.address.toLowerCase(), role: "onboarder" });
    for (const m of ["POST", "PATCH", "DELETE"]) {
      const r = (await adminGate(write(cookie, m), env)) as Response;
      expect(r).toBeInstanceOf(Response);
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: string }).error).toBe("Onboarders can only read and onboard");
    }
  });

  test("leaving ONBOARDER_ADDRESSES ends the session", async () => {
    const { env, cookie } = await onboarderIn();
    env.ONBOARDER_ADDRESSES = "";
    expect(await adminGate(read(cookie), env)).toBeInstanceOf(Response);
  });

  test("an address on both lists is an admin", async () => {
    const { env, cookie } = await onboarderIn();
    env.ADMIN_ADDRESSES = `${env.ADMIN_ADDRESSES}, ${OTHER.address.toLowerCase()}`;
    expect(await adminGate(write(cookie, "PATCH"), env)).toEqual({ address: OTHER.address.toLowerCase(), role: "admin" });
  });

  test("on neither list: refused at sign-in", async () => {
    const { res } = await onboarderIn({ ONBOARDER_ADDRESSES: "" });
    expect(res.status).toBe(403);
  });
});

describe("http helpers", () => {
  test("csrfFailure", () => {
    const req = (h: Record<string, string>) => new Request(`${ORIGIN}/x`, { method: "POST", headers: h });
    expect(csrfFailure(req({ "content-type": "application/json", origin: ORIGIN }), ORIGIN)).toBeNull();
    expect(csrfFailure(req({ "content-type": "application/json", origin: `${ORIGIN}.evil.example` }), ORIGIN)).toMatch(/cross-origin/);
    expect(csrfFailure(req({ "content-type": "application/json" }), ORIGIN)).toMatch(/cross-origin/);
    expect(csrfFailure(req({ "content-type": "text/plain", origin: ORIGIN }), ORIGIN)).toMatch(/Content-Type/);
    expect(csrfFailure(req({ "content-type": "application/json", origin: ORIGIN }), "")).toMatch(/SITE_ORIGIN/);
  });

  test("getCookie", () => {
    const req = new Request(`${ORIGIN}/`, { headers: { cookie: "a=1; __Host-rb_admin=abc ; b=2" } });
    expect(getCookie(req, "__Host-rb_admin")).toBe("abc");
    expect(getCookie(req, "c")).toBeNull();
  });
});
