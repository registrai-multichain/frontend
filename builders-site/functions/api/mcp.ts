import type { PagesFunction } from "../../lib/env";
import { handleMcp } from "../../lib/mcp";

/** POST /api/mcp: read-only MCP server over Data API v1 (JSON-RPC 2.0, stateless). Covered by the /api/ rate-limit rule. */
export const onRequest: PagesFunction = (ctx) => handleMcp(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
