import type { PagesFunction } from "../../lib/env";
import { withMarkdown } from "../../lib/markdown-route";

/** /data-api/ is a static page; this function only adds its Markdown copy at /data-api/index.md
 *  (spec 2026-10-23-machine-readable-copies-design.md). ctx.next(ctx.request) serves the static page at the (rewritten) URL. */
export const onRequest: PagesFunction = withMarkdown(async (ctx) => ctx.next(ctx.request));
