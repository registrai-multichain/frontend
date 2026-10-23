import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { handleBotInvites } from "../lib/bot";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const SECRET = "b".repeat(64);

function setup(secret: string | undefined = SECRET) {
  const env: Env = { INVITES: new MemoryKV(), SITE_ORIGIN: ORIGIN, BOT_SECRET: secret };
  const call = async (method: string, opts: { auth?: string; body?: unknown; query?: string } = {}) => {
    const res = await handleBotInvites(
      new Request(`${ORIGIN}/api/bot/invites${opts.query ?? ""}`, {
        method,
        headers: { "content-type": "application/json", ...(opts.auth !== undefined ? { authorization: opts.auth } : {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }),
      env,
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { env, call };
}

describe("bot invites endpoint", () => {
  test("fails closed without a configured secret", async () => {
    const { call } = setup("");
    expect((await call("GET", { auth: `Bearer ${SECRET}` })).status).toBe(503);
  });

  test("refuses a missing or wrong bearer", async () => {
    const { call } = setup();
    expect((await call("GET")).status).toBe(401);
    expect((await call("GET", { auth: "Bearer nope" })).status).toBe(401);
    expect((await call("GET", { auth: SECRET })).status).toBe(401);
  });

  test("creates an invite like /admin (normalised source, @handle, claim link), marked as the bot's", async () => {
    const { call } = setup();
    const r = await call("POST", { auth: `Bearer ${SECRET}`, body: { source: "https://github.com/Acme/Tool", x: "acme" } });
    expect(r.status).toBe(201);
    const inv = r.body.invite as { source: string; x: string; createdBy: string; claimLink: string };
    expect(inv.source).toBe("github:acme/tool");
    expect(inv.x).toBe("@acme");
    expect(inv.createdBy).toBe("telegram-bot");
    expect(inv.claimLink).toContain(`${ORIGIN}/verify/?source=github%3Aacme%2Ftool&invite=`);
    expect((await call("POST", { auth: `Bearer ${SECRET}`, body: { source: "github:acme/tool" } })).status).toBe(409);
  });

  test("lists and removes; never edits", async () => {
    const { call } = setup();
    await call("POST", { auth: `Bearer ${SECRET}`, body: { source: "domain:acme.dev" } });
    const list = await call("GET", { auth: `Bearer ${SECRET}` });
    expect((list.body.invites as unknown[]).length).toBe(1);
    expect((await call("PATCH", { auth: `Bearer ${SECRET}`, body: { source: "domain:acme.dev", name: "x" } })).status).toBe(405);
    expect((await call("DELETE", { auth: `Bearer ${SECRET}`, query: "?source=domain%3Aacme.dev" })).status).toBe(200);
  });
});
