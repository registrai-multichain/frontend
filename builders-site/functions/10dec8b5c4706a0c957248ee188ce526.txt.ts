import type { PagesFunction } from "../lib/env";
import { INDEXNOW_KEY } from "../lib/sitemap-urls";

/** GET /<IndexNow key>.txt: the key file that proves builder.registrai.cc owns the IndexNow key (lib/sitemap-urls.ts). */
export const onRequest: PagesFunction = async () =>
  new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
