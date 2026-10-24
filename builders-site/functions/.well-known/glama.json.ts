import type { PagesFunction } from "../../lib/env";

/** GET /.well-known/glama.json: proves to Glama that this connector (https://builder.registrai.cc/api/mcp) is ours.
 *  The claim is a public token bound to Registrai's Glama account; it must stay published to stay verified. */
const GLAMA = { $schema: "https://glama.ai/mcp/schemas/connector.json", claim: "glama_claim_5u7FdFNeDIOS2rcUCzTrcTc7YkNmnsJ7" };

export const onRequest: PagesFunction = async () =>
  new Response(JSON.stringify(GLAMA, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" } });
