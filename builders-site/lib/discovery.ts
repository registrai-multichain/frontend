/**
 * Discovery documents for agents and API catalogs: the Data API index (/api/v1/), an RFC 9727 api-catalog
 * (/.well-known/api-catalog), the MCP server card (/.well-known/mcp/server-card.json). The root /openapi.json
 * serves the same OpenAPI as /api/v1/openapi.json (x402scan and other crawlers look at the origin root).
 */
import { OPENAPI } from "../../src/lib/data-api-openapi";
import { MCP_TOOLS } from "./mcp";

const SITE = "https://builder.registrai.cc";
const OPENAPI_URL = `${SITE}/api/v1/openapi.json`, DOCS_URL = `${SITE}/data-api/`, MCP_URL = `${SITE}/api/mcp`;
const LICENCE = "CC BY 4.0, attribution \"Data: Registrai\"";

type Op = { get?: { summary?: string } };
export const API_INDEX = {
  name: "Registrai Data API",
  version: 1,
  description: "Hourly data on stablecoin apps on Arc: per-app payments, paying wallets and volume, the ABI, AII and AEI indices, and verified builders. No key.",
  docs: DOCS_URL, openapi: OPENAPI_URL, mcp: MCP_URL, paid: `${SITE}/api/v1/paid`, licence: LICENCE,
  endpoints: Object.entries(OPENAPI.paths as Record<string, Op>)
    .filter(([p]) => !p.includes("/paid"))
    .map(([path, op]) => ({ path, summary: op.get?.summary ?? "" })),
};

export const API_CATALOG = {
  linkset: [{
    anchor: `${SITE}/api/v1/`,
    "service-desc": [{ href: OPENAPI_URL, type: "application/openapi+json" }],
    "service-doc": [{ href: DOCS_URL, type: "text/html" }],
    "service-meta": [{ href: `${SITE}/.well-known/mcp/server-card.json`, type: "application/json" }],
  }],
};

export const MCP_SERVER_CARD = {
  name: "cc.registrai/arc-data",
  title: "Registrai Arc data",
  description: "Read-only data on stablecoin apps on Arc: per-app USDC and EURC payments, paying wallets and volume, the Arc indices, verified builders. CC BY 4.0.",
  version: "1.0.0",
  websiteUrl: DOCS_URL,
  remotes: [{ type: "streamable-http", url: MCP_URL }],
  authentication: { required: false },
  tools: MCP_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description })),
};

export function discoveryResponse(req: Request, body: unknown, type = "application/json; charset=utf-8"): Response {
  const headers = { "content-type": type, "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" };
  if (!["GET", "HEAD"].includes(req.method.toUpperCase())) return new Response(JSON.stringify({ error: "Only GET is supported." }), { status: 405, headers: { ...headers, "content-type": "application/json; charset=utf-8", allow: "GET" } });
  return new Response(req.method.toUpperCase() === "HEAD" ? null : JSON.stringify(body), { headers });
}
