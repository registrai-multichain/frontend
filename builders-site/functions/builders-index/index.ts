import type { PagesFunction } from "../../lib/env";
import { builderIndexPage } from "../../lib/builders-index-route";

/** GET /builders-index/: the static page plus a server-rendered summary (lib/builders-index-route.ts). */
export const onRequest: PagesFunction = builderIndexPage;
