import { describe, expect, test } from "vitest";
import type { Env } from "../lib/env";
import { handleAdminDraft, handleAdminDrafts } from "../lib/drafts";
import { MemoryKV } from "./memory-kv";

const ORIGIN = "https://builder.registrai.cc";
const draft = {
  source: "domain:arctools.fun",
  invite: { name: "ArcTools", x: "@ArcToolsBackup" },
  recommendation: "nominate",
  summary: "17 contracts from 2 team wallets.",
  investigation: "docs/superpowers/investigations/domain-arctools-fun.md",
  investigatedAt: "2026-09-27",
  investigatedBy: "arc-80",
  profile: { source: "domain:arctools.fun", name: "ArcTools", website: "https://arctools.fun", deployers: [], contracts: [], metrics: [], redFlags: ["deployer key exposed"] },
};

function setup() {
  const kv = new MemoryKV(() => 0);
  const env: Env = { INVITES: kv, SITE_ORIGIN: ORIGIN };
  const run = async (res: Promise<Response>) => {
    const r = await res;
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const list = () => run(handleAdminDrafts(new Request(`${ORIGIN}/api/admin/drafts`), env));
  const post = (body: unknown) =>
    run(handleAdminDrafts(new Request(`${ORIGIN}/api/admin/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env));
  const del = (source: string) => run(handleAdminDraft(new Request(`${ORIGIN}/api/admin/drafts/x`, { method: "DELETE" }), env, source));
  return { kv, list, post, del };
}

describe("/api/admin/drafts", () => {
  test("POST stores a valid draft; GET lists it with its red flags (admin only data)", async () => {
    const { post, list } = setup();
    expect((await post(draft)).status).toBe(200);
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.body.drafts).toEqual([expect.objectContaining({ source: "domain:arctools.fun", recommendation: "nominate", profile: expect.objectContaining({ redFlags: ["deployer key exposed"] }) })]);
  });

  test("POST refuses an invalid draft with the reason", async () => {
    const { post, list } = setup();
    const r = await post({ ...draft, recommendation: "yes" });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/recommendation/);
    expect((await list()).body.drafts).toEqual([]);
  });

  test("nominate drafts come first, then hold, each by name", async () => {
    const { post, list } = setup();
    await post({ ...draft, source: "domain:zeta.fun", invite: { name: "Zeta" }, recommendation: "hold", profile: { ...draft.profile, source: "domain:zeta.fun", name: "Zeta" } });
    await post(draft);
    await post({ ...draft, source: "domain:alpha.fun", invite: { name: "Alpha" }, profile: { ...draft.profile, source: "domain:alpha.fun", name: "Alpha" } });
    const names = ((await list()).body.drafts as { invite: { name: string } }[]).map((d) => d.invite.name);
    expect(names).toEqual(["Alpha", "ArcTools", "Zeta"]);
  });

  test("DELETE removes one draft; a bad source is a 400", async () => {
    const { post, del, list } = setup();
    await post(draft);
    expect((await del("domain:arctools.fun")).status).toBe(200);
    expect((await list()).body.drafts).toEqual([]);
    expect((await del("nonsense")).status).toBe(400);
  });
});
