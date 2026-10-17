import type { PagesFunction } from "../../../lib/env";
import { API_INDEX, discoveryResponse } from "../../../lib/discovery";

/** GET /api/v1/: what the Data API offers and where its OpenAPI, docs and MCP server are. */
export const onRequest: PagesFunction = async (ctx) => discoveryResponse(ctx.request, API_INDEX);
