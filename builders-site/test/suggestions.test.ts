import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { suggestionMessage, validateSuggestion } from "../../src/lib/suggestions";
import type { Env } from "../lib/env";
import {
  SUGGEST_MAX_BODY,
  SUGGEST_RATE_LIMIT,
  SUGGEST_TTL_S,
  SUGGEST_WALLET_DAILY,
  PUBLIC_DEV_ACCOUNTS,
  handleAdminSuggestions,
  handleSuggest,
  listSuggestions,
} from "../lib/suggestions";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const T0 = Date.parse("2026-09-27T12:00:00.000Z");
const acme = { name: "Acme Tool", website: "https://acme.dev", x: "@acmetool", github: "acme/tool" };
// Fixed random keys (never funded anywhere). NOT the public anvil/hardhat keys: those are refused.
const KEYS = [
  "0x3ec912428587e37069d4d58feb4327017c5cfca8d34399e1b9b10938a4cc709d",
  "0xd0da1b16554d9291f766b84ee2688aabf71ba7e15977e5e1a906671e41f3014a",
  "0x67ad15f93f929f646b971dd3b3753a611d3fca1053472b8e223ea5e8623051a2",
  "0xc36254344637279eb04184fa31335767edd7f56296e06e380c2455f2b27fcfbc",
  "0x62a005a6bad8d94ab3e36558a224026bbdbbdbe0f9d89cf85162792b0362acbb",
  "0x14995f44ef67afebd6bdfb1d91fee5b6ef019f373aa991eae9ef62e5e2e2d8a8",
] as const;
const W = KEYS.map((k) => privateKeyToAccount(k));

type Opts = { ip?: string; origin?: string; type?: string; wallet?: number; signer?: number; issuedAt?: string; tamper?: Record<string, string>; unsigned?: boolean };

function setup(o: { nonces?: Record<string, number>; nonceError?: boolean } = {}) {
  let now = T0;
  const kv = new MemoryKV(() => now);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN, NONCE_SECRET: "test-secret" };
  const getNonce = async (addr: string) => {
    if (o.nonceError) throw new Error("rpc down");
    return o.nonces?.[addr.toLowerCase()] ?? 7;
  };
  const post = async (body: Record<string, unknown>, p: Opts = {}) => {
    const wallet = W[p.wallet ?? 0];
    const issuedAt = p.issuedAt ?? new Date(now).toISOString();
    let payload: Record<string, unknown> = { ...body };
    if (!p.unsigned) {
      const v = validateSuggestion(body);
      const msg = v.ok ? suggestionMessage(v.value, issuedAt) : "invalid";
      const signature = await W[p.signer ?? p.wallet ?? 0].signMessage({ message: msg });
      payload = { ...body, ...(p.tamper ?? {}), wallet: wallet.address, signature, issuedAt };
    }
    const res = await handleSuggest(
      new Request(`${ORIGIN}/api/suggestions`, {
        method: "POST",
        headers: { "content-type": p.type ?? "application/json", origin: p.origin ?? ORIGIN, "cf-connecting-ip": p.ip ?? "203.0.113.1" },
        body: JSON.stringify(payload),
      }),
      env,
      { now, getNonce },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const admin = async (method: string, query = "") => {
    const res = await handleAdminSuggestions(new Request(`${ORIGIN}/api/admin/suggestions${query}`, { method }), env);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { kv, env, post, admin, advance: (ms: number) => (now += ms) };
}

describe("POST /api/suggestions", () => {
  test("a valid, wallet-signed suggestion is stored under the project's key, with that wallet", async () => {
    const { post, kv } = setup();
    const r = await post(acme);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, source: "github:acme/tool", count: 1 });
    const stored = kv.store.get("suggest:github:acme/tool")!;
    const rec = JSON.parse(stored.value);
    expect(rec).toMatchObject({
      source: "github:acme/tool",
      name: "Acme Tool",
      website: "https://acme.dev",
      github: "github:acme/tool",
      x: "@acmetool",
      count: 1,
      wallets: [W[0].address.toLowerCase()],
      firstAt: new Date(T0).toISOString(),
      lastAt: new Date(T0).toISOString(),
    });
    expect(stored.expiresAt).toBe(T0 + SUGGEST_TTL_S * 1000);
    expect(stored.value).not.toContain("203.0.113.1");
  });

  test("an unsigned suggestion is refused", async () => {
    const { post, kv } = setup();
    const r = await post(acme, { unsigned: true });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toMatch(/sign/i);
    expect([...kv.store.keys()].some((k) => k.startsWith("suggest:"))).toBe(false);
  });

  test("a signature by another wallet is refused", async () => {
    const { post } = setup();
    expect((await post(acme, { wallet: 0, signer: 1 })).status).toBe(401);
  });

  test("a suggestion changed after signing is refused", async () => {
    const { post } = setup();
    expect((await post(acme, { tamper: { x: "@impostor" } })).status).toBe(401);
    expect((await post(acme, { tamper: { website: "https://evil.example" } })).status).toBe(401);
  });

  test("a signature older than 10 minutes, or from the future, is refused", async () => {
    const { post } = setup();
    expect((await post(acme, { issuedAt: new Date(T0 - 11 * 60_000).toISOString() })).status).toBe(401);
    expect((await post(acme, { issuedAt: new Date(T0 + 11 * 60_000).toISOString() })).status).toBe(401);
    expect((await post(acme, { issuedAt: "not a date" })).status).toBe(401);
  });

  test("the public dev accounts (anvil/hardhat test mnemonic) are refused even though they have Arc history", async () => {
    const { env } = setup();
    const anvil0 = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    const v = validateSuggestion(acme);
    if (!v.ok) throw new Error(v.error);
    const issuedAt = new Date(T0).toISOString();
    const signature = await anvil0.signMessage({ message: suggestionMessage(v.value, issuedAt) });
    const res = await handleSuggest(
      new Request(`${ORIGIN}/api/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ ...acme, wallet: anvil0.address, signature, issuedAt }),
      }),
      env,
      { now: T0, getNonce: async () => 638 },
    );
    expect(res.status).toBe(403);
    expect(PUBLIC_DEV_ACCOUNTS.has(anvil0.address.toLowerCase())).toBe(true);
    expect(PUBLIC_DEV_ACCOUNTS.size).toBe(10);
  });

  test("a wallet that has never sent a transaction on Arc mainnet is refused", async () => {
    const { post, kv } = setup({ nonces: { [W[0].address.toLowerCase()]: 0 } });
    const r = await post(acme);
    expect(r.status).toBe(403);
    expect(String(r.body.error)).toMatch(/Arc/);
    expect([...kv.store.keys()].some((k) => k.startsWith("suggest:"))).toBe(false);
  });

  test("when the chain cannot be read, the suggestion is refused with a retry message, not stored", async () => {
    const { post } = setup({ nonceError: true });
    expect((await post(acme)).status).toBe(503);
  });

  test("an invalid suggestion is refused with the field to fix, before any signature check", async () => {
    const { post } = setup();
    const r = await post({ name: "Acme", website: "https://acme.dev" }, { unsigned: true });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ field: "x" });
  });

  test("CSRF: cross-origin or non-JSON posts are refused", async () => {
    const { post } = setup();
    expect((await post(acme, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(acme, { type: "text/plain" })).status).toBe(403);
  });

  test("an oversized body is refused", async () => {
    const { post } = setup();
    expect((await post({ ...acme, why: "a".repeat(SUGGEST_MAX_BODY) })).status).toBe(413);
  });

  test("the count is of distinct wallets: one wallet from many IPs counts once", async () => {
    const { post, advance } = setup();
    await post(acme, { wallet: 0, ip: "203.0.113.1" });
    advance(60_000);
    expect((await post(acme, { wallet: 0, ip: "203.0.113.2" })).body).toMatchObject({ count: 1 });
    expect((await post(acme, { wallet: 1, ip: "203.0.113.2" })).body).toMatchObject({ count: 2 });
    expect((await post({ ...acme, github: "https://github.com/Acme/Tool" }, { wallet: 2, ip: "203.0.113.3" })).body).toMatchObject({ count: 3 });
  });

  test("the first suggestion's details stand; a later one only fills what was missing", async () => {
    const { post, kv } = setup();
    await post({ name: "Acme Tool", website: "https://acme.dev", x: "@acmetool" }, { wallet: 0 });
    await post({ name: "SCAM", website: "https://acme.dev", x: "@impostor", social: "https://t.me/acme", by: "@bob" }, { wallet: 1, ip: "203.0.113.2" });
    const rec = JSON.parse(kv.store.get("suggest:domain:acme.dev")!.value);
    expect(rec).toMatchObject({ name: "Acme Tool", x: "@acmetool", social: "https://t.me/acme", by: ["@bob"], count: 2 });
  });

  test("a project already invited is acknowledged without a write", async () => {
    const { post, kv } = setup();
    await kv.put("invite:github:acme/tool", JSON.stringify({ source: "github:acme/tool", code: "x" }));
    const r = await post(acme);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, invited: true });
    expect(kv.store.has("suggest:github:acme/tool")).toBe(false);
  });

  test(`one wallet can send at most ${SUGGEST_WALLET_DAILY} suggestions a day, from any IP`, async () => {
    const { post, advance } = setup();
    for (let i = 0; i < SUGGEST_WALLET_DAILY; i++) {
      expect((await post({ ...acme, github: undefined, website: `https://p${i}.dev` }, { ip: `203.0.113.${10 + i}` })).status).toBe(200);
    }
    expect((await post({ ...acme, github: undefined, website: "https://one-more.dev" }, { ip: "203.0.113.99" })).status).toBe(429);
    expect((await post({ ...acme, github: undefined, website: "https://other-wallet.dev" }, { wallet: 1, ip: "203.0.113.98" })).status).toBe(200);
    advance(24 * 3600_000 + 1);
    expect((await post({ ...acme, github: undefined, website: "https://next-day.dev" }, { ip: "203.0.113.97" })).status).toBe(200);
  });

  test(`one IP can send at most ${SUGGEST_RATE_LIMIT} suggestions an hour, whatever the wallets`, async () => {
    const { post, advance } = setup();
    for (let i = 0; i < SUGGEST_RATE_LIMIT; i++) {
      expect((await post({ ...acme, github: undefined, website: `https://p${i}.dev` }, { wallet: i })).status).toBe(200);
    }
    expect((await post({ ...acme, github: undefined, website: "https://one-more.dev" }, { wallet: 5 })).status).toBe(429);
    expect((await post({ ...acme, github: undefined, website: "https://other-ip.dev" }, { wallet: 5, ip: "203.0.113.9" })).status).toBe(200);
    advance(3600_000 + 1);
    expect((await post({ ...acme, github: undefined, website: "https://later.dev" }, { wallet: 5 })).status).toBe(200);
  });
});

describe("/api/admin/suggestions", () => {
  test("GET lists every suggestion, most suggested first, with the suggesting wallets; the IP hashes stay private", async () => {
    const { post, admin, env } = setup();
    await post({ name: "Once", website: "https://once.dev", x: "@once" }, { wallet: 0 });
    await post(acme, { wallet: 0 });
    await post(acme, { wallet: 1, ip: "203.0.113.2" });
    const r = await admin("GET");
    expect(r.status).toBe(200);
    const list = r.body.suggestions as Record<string, unknown>[];
    expect(list.map((s) => s.source)).toEqual(["github:acme/tool", "domain:once.dev"]);
    expect(list[0].wallets).toEqual([W[0].address.toLowerCase(), W[1].address.toLowerCase()]);
    expect(list[0]).not.toHaveProperty("voters");
    expect(await listSuggestions(env.INVITES)).toHaveLength(2);
  });

  test("DELETE dismisses one suggestion", async () => {
    const { post, admin, kv } = setup();
    await post(acme);
    expect((await admin("DELETE", "?source=github:acme/tool")).status).toBe(200);
    expect(kv.store.has("suggest:github:acme/tool")).toBe(false);
    expect((await admin("DELETE", "?source=nonsense")).status).toBe(400);
  });
});
