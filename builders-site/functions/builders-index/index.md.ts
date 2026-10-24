import type { PagesFunction } from "../../lib/env";
import { builderIndexPage } from "../../lib/builders-index-route";
import { withMarkdown } from "../../lib/markdown-route";

/** GET /builders-index/index.md: the Markdown copy, converted from the server-rendered summary. Only this URL runs a Function;
 *  Next's data files under /builders-index/ stay static. */
export const onRequest: PagesFunction = withMarkdown(builderIndexPage);
