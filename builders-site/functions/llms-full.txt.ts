import type { PagesFunction } from "../lib/env";
import { edgeCachedGet } from "../lib/http";
import { buildLlmsFull } from "../lib/llms-full";

/** GET /llms-full.txt: the full reference in one file (spec 2026-10-23-machine-readable-copies-design.md), cached an hour. */
export const onRequest: PagesFunction = async (ctx) => {
  const m = ctx.request.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET, HEAD" } });
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const url = new URL(ctx.request.url);
  const res = await edgeCachedGet(new Request(`${url.origin}/llms-full.txt`), deps, async () =>
    new Response(await buildLlmsFull(ctx.env, deps), { headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "public, max-age=3600" } }), 3600, "llms-full");
  return m === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
};
