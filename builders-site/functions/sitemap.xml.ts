import type { PagesFunction } from "../lib/env";
import { idToPath, loadAppList } from "../lib/apps-data";
import { edgeCachedGet } from "../lib/http";

/** GET /sitemap.xml: the static pages plus /apps/ and every app page (spec 2026-10-15-agent-reference-design.md). */
const SITE = "https://builder.registrai.cc";
/** Pages whose content follows the hourly data: their lastmod is the data's last closed hour. /verify/ is noindex, so it is not listed. */
const DATA = ["/builders-index/", "/apps/", "/track-record/"];
const STATIC = ["/builders/", "/data-api/", "/how-we-publish/", "/guide/", "/terms/", "/privacy/"];

export const onRequest: PagesFunction = async (ctx) => {
  const m = ctx.request.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  return edgeCachedGet(ctx.request, deps, () => sitemap(ctx.env, deps), 300, "sitemap");
};

async function sitemap(env: Parameters<typeof loadAppList>[0], deps: Parameters<typeof loadAppList>[1]): Promise<Response> {
  const l = await loadAppList(env, deps);
  const apps = (l?.rows ?? []).map((r) => idToPath(r.id)).filter((p): p is string => p !== null);
  const mod = l?.data_until ? `<lastmod>${l.data_until}</lastmod>` : "";
  const loc = (p: string, lastmod = "") => `<url><loc>${SITE}${p.replace(/&/g, "&amp;")}</loc>${lastmod}</url>`;
  const urls = [...DATA.map((p) => loc(p, mod)), ...STATIC.map((p) => loc(p)), ...apps.map((p) => loc(p, mod))];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
