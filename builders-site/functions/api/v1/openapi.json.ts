import type { PagesFunction } from "../../../lib/env";
import { OPENAPI } from "../../../../src/lib/data-api-openapi";

/** GET /api/v1/openapi.json: OpenAPI 3.1 for Data API v1 (CORS *, cached 1 h). */
const BODY = JSON.stringify(OPENAPI);
export const onRequest: PagesFunction = async (ctx) =>
  ctx.request.method.toUpperCase() !== "GET"
    ? new Response(JSON.stringify({ error: "Only GET is supported." }), { status: 405, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" } })
    : new Response(BODY, { headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } });
