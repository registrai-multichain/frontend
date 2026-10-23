import type { PagesFunction } from "../../../lib/env";
import { MCP_SERVER_CARD, discoveryResponse } from "../../../lib/discovery";

/** GET /.well-known/mcp/server-card.json: the MCP server's name, remote endpoint and tools, for MCP directories. */
export const onRequest: PagesFunction = async (ctx) => discoveryResponse(ctx.request, MCP_SERVER_CARD);
