import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { handleAdminProject, handleAdminProjects, handlePublicProject } from "../lib/projects";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const T0 = Date.parse("2026-09-27T12:00:00.000Z");
const ADMIN = "0xb7ecf980a4732b75e57e2ec80903dee3964f2573";
const SRC = "domain:arctools.fun";
const profile = {
  source: SRC,
  name: "ArcTools",
  website: "https://arctools.fun",
  x: "@ArcToolsBackup",
  xChecked: true,
  deployers: [{ address: "0x408c3d3fd36fdf84888f343417787d8710e76fe8", note: "key exposed per HANDOVER.md" }],
  contracts: [{ address: "0x43cdbf8edb8fe41dde4ba519f49499d1ed78e74a", label: "swap router", note: "blk 20625109" }],
  token: { address: "0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52" },
  metrics: ["users", "holders", "x-posts"],
  redFlags: ["deployer key exposed"],
};

function setup() {
  const kv = new MemoryKV(() => T0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN };
  const req = (path: string, method = "GET", body?: unknown) =>
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json", origin: ORIGIN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const call = async (res: Promise<Response>) => {
    const r = await res;
    return { status: r.status, body: (await r.json()) as Record<string, unknown>, headers: r.headers };
  };
  const put = (source: string, body: unknown) =>
    call(handleAdminProject(req(`/api/admin/projects/${encodeURIComponent(source)}`, "PUT", body), env, source, ADMIN, { now: T0 }));
  const get = (source: string) => call(handleAdminProject(req(`/api/admin/projects/${encodeURIComponent(source)}`), env, source, ADMIN, { now: T0 }));
  const list = () => call(handleAdminProjects(req("/api/admin/projects"), env));
  const pub = (source: string) => call(handlePublicProject(req(`/api/projects/${encodeURIComponent(source)}`), env, source));
  return { kv, env, put, get, list, pub };
}

describe("/api/admin/projects/<source>", () => {
  test("PUT stores the normalised profile, stamped with the admin and time; GET returns it with its feeds", async () => {
    const { put, get } = setup();
    const r = await put(SRC, { ...profile, declaredBy: "0xevil" });
    expect(r.status).toBe(200);
    expect(r.body.profile).toMatchObject({ source: SRC, name: "ArcTools", declaredBy: ADMIN, declaredAt: new Date(T0).toISOString() });
    const g = await get(SRC);
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ profile: { source: SRC, redFlags: ["deployer key exposed"] }, feeds: [] });
  });

  test("PUT refuses an invalid profile with the reason, and stores nothing", async () => {
    const { put, get } = setup();
    const r = await put(SRC, { ...profile, metrics: ["deploys"], deployers: [] });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/deployer/);
    expect((await get(SRC)).status).toBe(404);
  });

  test("PUT refuses a profile whose source differs from the URL", async () => {
    const { put } = setup();
    expect((await put("domain:other.fun", profile)).status).toBe(400);
  });

  test("an unknown or malformed source is a 404 / 400", async () => {
    const { get } = setup();
    expect((await get("domain:nothing-here.fun")).status).toBe(404);
    expect((await get("not a source")).status).toBe(400);
  });
});

describe("GET /api/admin/projects", () => {
  test("lists profiles, invites and suggestions once each, with a status from what exists", async () => {
    const { put, kv, list } = setup();
    await put(SRC, profile);
    await kv.put("index:invites", JSON.stringify([
      { source: SRC, name: "ArcTools", x: "@ArcToolsBackup", createdAt: "2026-09-27T07:21:07.264Z" },
      { source: "domain:mysphere.fun", name: "MySphere", createdAt: "2026-09-26T07:00:00.000Z" },
    ]));
    await kv.put("suggest:github:acme/tool", JSON.stringify({
      source: "github:acme/tool", name: "Acme", website: "https://acme.dev", github: "github:acme/tool", x: "@acme",
      by: [], wallets: ["0x1"], count: 1, firstAt: "2026-09-27T10:00:00.000Z", lastAt: "2026-09-27T10:00:00.000Z",
    }));
    const r = await list();
    expect(r.status).toBe(200);
    const items = r.body.projects as Record<string, unknown>[];
    const by = Object.fromEntries(items.map((p) => [p.source as string, p]));
    expect(Object.keys(by).sort()).toEqual(["domain:arctools.fun", "domain:mysphere.fun", "github:acme/tool"]);
    expect(by[SRC]).toMatchObject({ status: "invited", declaredBy: ADMIN, metrics: ["users", "holders", "x-posts"] });
    expect(by["domain:mysphere.fun"]).toMatchObject({ status: "invited", name: "MySphere", website: "https://mysphere.fun", deployers: [], metrics: [] });
    expect(by["github:acme/tool"]).toMatchObject({ status: "suggested", website: "https://acme.dev", x: "@acme" });
  });
});

describe("GET /api/projects/<source> (public)", () => {
  test("serves the profile without red flags or notes, cacheable", async () => {
    const { put, pub } = setup();
    await put(SRC, profile);
    const r = await pub(SRC);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain("redFlags");
    expect(text).not.toContain("HANDOVER");
    expect(text).not.toContain("note");
    expect(r.body).toMatchObject({ profile: { source: SRC, contracts: [{ label: "swap router" }] }, feeds: [] });
    expect(r.headers.get("cache-control")).toMatch(/max-age=60/);
  });

  test("a project with no profile is a 404", async () => {
    const { pub } = setup();
    expect((await pub(SRC)).status).toBe(404);
  });
});

describe("sourceParam", () => {
  test("rejoins a source split on a decoded slash, and decodes each piece", async () => {
    const { sourceParam } = await import("../lib/source-param");
    expect(sourceParam("github%3Aacme%2Ftool")).toBe("github:acme/tool");
    expect(sourceParam(["github%3Aacme", "tool"])).toBe("github:acme/tool");
    expect(sourceParam(["github:acme", "tool"])).toBe("github:acme/tool");
    expect(sourceParam(undefined)).toBe("");
    expect(sourceParam("%E0%A4%A")).toBe("");
  });
});
