import type { PagesFunction } from "../lib/env";
import { edgeCachedGet } from "../lib/http";
import { sitemapUrls } from "../lib/sitemap-urls";

/** GET /sitemap.xml: the static pages, /apps/, every app page and every project facts page with public facts (lib/sitemap-urls.ts). */
export const onRequest: PagesFunction = async (ctx) => {
  const m = ctx.request.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  return edgeCachedGet(ctx.request, deps, async () => {
    const urls = await sitemapUrls(ctx.env, deps);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u.loc.replace(/&/g, "&amp;")}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
    return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
  }, 300, "sitemap");
};
