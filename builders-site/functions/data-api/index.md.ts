import type { PagesFunction } from "../../lib/env";
import { withMarkdown } from "../../lib/markdown-route";

/** GET /data-api/index.md: the Markdown copy of the static /data-api/ page (ctx.next(ctx.request) serves the page at the
 *  rewritten URL). Only this URL runs a Function; the page itself stays static. */
export const onRequest: PagesFunction = withMarkdown(async (ctx) => ctx.next(ctx.request));
