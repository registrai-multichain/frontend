import { describe, expect, test } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalClaimMessage, type Claim } from "../../src/lib/verified-builders";
import type { Env } from "../lib/env";
import {
  REQUEST_DEBOUNCE_MS,
  REQUEST_TTL_S,
  handleAdminRegisterRequests,
  handleRegisterRequest,
  listRegisterRequests,
} from "../lib/register-requests";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const CHAIN = 5042;
const T0 = Date.parse("2026-09-25T12:00:00.000Z");
const ALICE = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const MALLORY = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

async function proof(source: string, o: { signer?: typeof ALICE; builder?: string; chain?: number } = {}) {
  const claim: Claim = {
    builder: (o.builder ?? ALICE.address).toLowerCase(),
    source,
    deployers: [],
    country: "PL",
    chain: o.chain ?? CHAIN,
    issued: "2026-09-25",
  };
  const signature = await (o.signer ?? ALICE).signMessage({ message: canonicalClaimMessage(claim) });
  return JSON.stringify({ version: 1, claim, signatures: { builder: signature, deployers: {} } });
}

function setup(files: Record<string, string | null> = {}) {
  const kv = new MemoryKV(() => T0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN };
  const post = async (body: unknown, o: { origin?: string; type?: string; now?: number } = {}) => {
    const res = await handleRegisterRequest(
      new Request(`${ORIGIN}/api/register-requests`, {
        method: "POST",
        headers: { "content-type": o.type ?? "application/json", origin: o.origin ?? ORIGIN },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      env,
      { readProof: async (s) => files[s] ?? null, chainId: CHAIN, now: o.now ?? T0 },
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { kv, env, post };
}

describe("POST /api/register-requests", () => {
  test("a valid published proof is stored under its canonical source, with the wallet it names", async () => {
    const { post, kv } = setup({ "github:alice/app": await proof("github:alice/app") });
    const r = await post({ source: "https://github.com/Alice/App" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, source: "github:alice/app", builder: ALICE.address.toLowerCase(), requestedAt: new Date(T0).toISOString() });
    const stored = kv.store.get("regreq:github:alice/app")!;
    expect(JSON.parse(stored.value)).toEqual({ source: "github:alice/app", builder: ALICE.address.toLowerCase(), requestedAt: new Date(T0).toISOString() });
    expect(stored.expiresAt).toBe(T0 + REQUEST_TTL_S * 1000);
  });

  test("nothing is stored without a readable, valid proof", async () => {
    const forged = await proof("github:alice/app", { signer: MALLORY }); // names alice, signed by mallory
    const wrongChain = await proof("github:alice/other", { chain: 5042002 });
    const { post, kv } = setup({ "github:alice/app": forged, "github:alice/other": wrongChain, "github:alice/junk": "{not json" });
    expect((await post({ source: "github:alice/app" })).status).toBe(422);
    expect((await post({ source: "github:alice/other" })).status).toBe(422);
    expect((await post({ source: "github:alice/junk" })).status).toBe(422);
    expect((await post({ source: "github:alice/unpublished" })).status).toBe(422);
    expect(kv.store.size).toBe(0);
  });

  test("a proof for another source does not count", async () => {
    const { post, kv } = setup({ "github:alice/app": await proof("github:alice/elsewhere") });
    expect((await post({ source: "github:alice/app" })).status).toBe(422);
    expect(kv.store.size).toBe(0);
  });

  test("same-origin JSON only; malformed bodies are 400", async () => {
    const { post, kv } = setup({ "github:alice/app": await proof("github:alice/app") });
    expect((await post({ source: "github:alice/app" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ source: "github:alice/app" }, { type: "text/plain" })).status).toBe(403);
    expect((await post("{")).status).toBe(400);
    expect((await post({ source: 7 })).status).toBe(400);
    expect((await post({ source: "not a source at all" })).status).toBe(400);
    expect((await post({ source: "x".repeat(301) })).status).toBe(400);
    expect(kv.store.size).toBe(0);
  });

  test("asking again within the debounce keeps the first timestamp; later or with a new wallet it is rewritten", async () => {
    const files: Record<string, string> = { "github:alice/app": await proof("github:alice/app") };
    const { post, kv } = setup(files);
    await post({ source: "github:alice/app" });
    const again = await post({ source: "github:alice/app" }, { now: T0 + REQUEST_DEBOUNCE_MS - 1 });
    expect(again.body.requestedAt).toBe(new Date(T0).toISOString());
    const later = await post({ source: "github:alice/app" }, { now: T0 + REQUEST_DEBOUNCE_MS });
    expect(later.body.requestedAt).toBe(new Date(T0 + REQUEST_DEBOUNCE_MS).toISOString());
    // the project moved to a new wallet: the newest valid claim wins
    files["github:alice/app"] = await proof("github:alice/app", { signer: MALLORY, builder: MALLORY.address });
    const moved = await post({ source: "github:alice/app" }, { now: T0 + REQUEST_DEBOUNCE_MS + 1 });
    expect(moved.body.builder).toBe(MALLORY.address.toLowerCase());
    expect(JSON.parse(kv.store.get("regreq:github:alice/app")!.value).builder).toBe(MALLORY.address.toLowerCase());
  });
});

describe("admin register requests", () => {
  test("list (oldest first) and dismiss", async () => {
    const { post, env } = setup({ "github:alice/app": await proof("github:alice/app"), "domain:alice.dev": await proof("domain:alice.dev") });
    await post({ source: "domain:alice.dev" }, { now: T0 + 1000 });
    await post({ source: "github:alice/app" });
    const list = await listRegisterRequests(env.INVITES);
    expect(list.map((r) => r.source)).toEqual(["github:alice/app", "domain:alice.dev"]);

    const res = await handleAdminRegisterRequests(new Request(`${ORIGIN}/api/admin/register-requests`), env);
    expect(((await res.json()) as { requests: unknown[] }).requests).toHaveLength(2);
    const del = await handleAdminRegisterRequests(
      new Request(`${ORIGIN}/api/admin/register-requests?source=github:alice/app`, { method: "DELETE" }),
      env,
    );
    expect(await del.json()).toEqual({ deleted: "github:alice/app" });
    expect((await listRegisterRequests(env.INVITES)).map((r) => r.source)).toEqual(["domain:alice.dev"]);
    expect((await handleAdminRegisterRequests(new Request(`${ORIGIN}/api/admin/register-requests`, { method: "POST" }), env)).status).toBe(405);
  });
});

describe("the Workers bundle", () => {
  test("the chain id matches the site's builders network, without process.env", async () => {
    const { BUILDERS_CHAIN_ID } = await import("../lib/register-requests");
    const { BUILDERS } = await import("../../src/lib/builders-network");
    expect(BUILDERS_CHAIN_ID).toBe(BUILDERS.chainId);
  });
});
