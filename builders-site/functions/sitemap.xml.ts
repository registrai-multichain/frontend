import type { PagesFunction } from "../lib/env";
import { idToPath, loadAppList } from "../lib/apps-data";

/** GET /sitemap.xml: the static pages plus /apps/ and every app page (spec 2026-10-15-agent-reference-design.md). */
const SITE = "https://builder.registrai.cc";
const STATIC = ["/builders/", "/builders-index/", "/apps/", "/data-api/", "/how-we-publish/", "/track-record/", "/verify/"];

export const onRequest: PagesFunction = async (ctx) => {
  const l = await loadAppList(ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
  const apps = (l?.rows ?? []).map((r) => idToPath(r.id)).filter((p): p is string => p !== null);
  const loc = (p: string) => `<url><loc>${SITE}${p.replace(/&/g, "&amp;")}</loc></url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...STATIC, ...apps].map(loc).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } });
};
