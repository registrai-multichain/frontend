import type { PagesFunction } from "../lib/env";
import { discoveryResponse } from "../lib/discovery";
import { OPENAPI } from "../../src/lib/data-api-openapi";

/** GET /openapi.json: the Data API v1 OpenAPI at the origin root (same document as /api/v1/openapi.json). */
export const onRequest: PagesFunction = async (ctx) => discoveryResponse(ctx.request, OPENAPI);
