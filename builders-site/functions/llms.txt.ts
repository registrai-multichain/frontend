import type { PagesFunction } from "../lib/env";

/** GET /llms.txt (llmstxt.org): where agents find Registrai's Arc data (spec 2026-10-15-agent-reference-design.md). */
export const LLMS_TXT = `# Registrai

> Hourly data on stablecoin apps on Arc: per-app stablecoin payments, paying wallets and volume, the Arc Builders, Integrations and Ecosystem indices, and verified builders. Every number links to the chain.

## Data
- [Stablecoin apps on Arc](https://builder.registrai.cc/apps/): every app with its last 24 h, sorted by payments
- [Arc indices](https://builder.registrai.cc/builders-index/): ABI, AII, AEI, hourly
- [Data API v1](https://builder.registrai.cc/data-api/): public JSON API, no key, CC BY 4.0
- [OpenAPI](https://builder.registrai.cc/api/v1/openapi.json)
- [MCP server](https://builder.registrai.cc/api/mcp): read-only tools over the same data (Streamable HTTP)

## Method
- [How we publish](https://builder.registrai.cc/how-we-publish/)

Licence: CC BY 4.0, attribution "Data: Registrai".
`;

export const onRequest: PagesFunction = async () =>
  new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
