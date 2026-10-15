import type { PagesFunction } from "../lib/env";
import { idToPath, loadAppList } from "../lib/apps-data";
import { edgeCachedGet } from "../lib/http";

/** GET /sitemap.xml: the static pages plus /apps/ and every app page (spec 2026-10-15-agent-reference-design.md). */
const SITE = "https://builder.registrai.cc";
const STATIC = ["/builders/", "/builders-index/", "/apps/", "/data-api/", "/how-we-publish/", "/track-record/", "/verify/"];

export const onRequest: PagesFunction = async (ctx) => {
  const m = ctx.request.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  return edgeCachedGet(ctx.request, deps, () => sitemap(ctx.env, deps), 300, "sitemap");
};

async function sitemap(env: Parameters<typeof loadAppList>[0], deps: Parameters<typeof loadAppList>[1]): Promise<Response> {
  const l = await loadAppList(env, deps);
  const apps = (l?.rows ?? []).map((r) => idToPath(r.id)).filter((p): p is string => p !== null);
  const loc = (p: string) => `<url><loc>${SITE}${p.replace(/&/g, "&amp;")}</loc></url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...STATIC, ...apps].map(loc).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
