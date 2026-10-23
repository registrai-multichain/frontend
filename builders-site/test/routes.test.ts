import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { onRequest as draftRoute } from "../functions/api/admin/drafts/[[source]]";
import { onRequest as projectRoute } from "../functions/api/admin/projects/[[source]]";
import { MemoryKV } from "./memory-kv";

/**
 * Cloudflare Pages sends the bare collection path (/api/admin/drafts) to the optional
 * catch-all [[source]].ts, not to index.ts (live 2026-09-27: "Could not read the
 * drafts: method not allowed"). The catch-all must therefore serve the list itself.
 */
const ORIGIN = "https://builder.registrai.cc";
const ADMIN = "0xb7ecf980a4732b75e57e2ec80903dee3964f2573";
const draft = {
  source: "domain:arctools.fun",
  invite: { name: "ArcTools" },
  recommendation: "nominate",
  summary: "17 contracts from 2 team wallets.",
  investigation: "docs/superpowers/investigations/domain-arctools-fun.md",
  investigatedAt: "2026-09-27",
  investigatedBy: "arc-80",
  profile: { source: "domain:arctools.fun", name: "ArcTools", website: "https://arctools.fun", deployers: [], contracts: [], metrics: [], redFlags: [] },
};

function ctx(env: Env, path: string, method = "GET", params: Record<string, string | string[]> = {}, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) Object.assign(init, { headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { request: new Request(`${ORIGIN}${path}`, init), env, params, data: { admin: ADMIN } } as never;
}

async function run(r: Response | Promise<Response>) {
  const res = await r;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("catch-all admin routes also serve the bare collection path", () => {
  test("GET /api/admin/drafts through [[source]] lists the drafts", async () => {
    const env: Env = { INVITES: new MemoryKV(() => 0), SITE_ORIGIN: ORIGIN };
    await env.INVITES.put("draft:domain:arctools.fun", JSON.stringify(draft));
    const r = await run(draftRoute(ctx(env, "/api/admin/drafts")));
    expect(r.status).toBe(200);
    expect(r.body.drafts).toEqual([expect.objectContaining({ source: "domain:arctools.fun" })]);
  });

  test("DELETE /api/admin/drafts/<source> through [[source]] still deletes one", async () => {
    const env: Env = { INVITES: new MemoryKV(() => 0), SITE_ORIGIN: ORIGIN };
    await env.INVITES.put("draft:domain:arctools.fun", JSON.stringify(draft));
    const r = await run(draftRoute(ctx(env, "/api/admin/drafts/domain%3Aarctools.fun", "DELETE", { source: ["domain%3Aarctools.fun"] })));
    expect(r.status).toBe(200);
    expect(await env.INVITES.get("draft:domain:arctools.fun")).toBeNull();
  });

  test("GET /api/admin/projects through [[source]] lists the projects", async () => {
    const env: Env = { INVITES: new MemoryKV(() => 0), SITE_ORIGIN: ORIGIN };
    const r = await run(projectRoute(ctx(env, "/api/admin/projects")));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.projects)).toBe(true);
  });
});
