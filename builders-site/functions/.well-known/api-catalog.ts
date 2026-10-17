import type { PagesFunction } from "../../lib/env";
import { API_CATALOG, discoveryResponse } from "../../lib/discovery";

/** GET /.well-known/api-catalog (RFC 9727): links the Data API to its OpenAPI and docs. */
export const onRequest: PagesFunction = async (ctx) => discoveryResponse(ctx.request, API_CATALOG, "application/linkset+json");
