import type { PagesFunction } from "../lib/env";

/** GET /llms.txt (llmstxt.org): where agents find Registrai's Arc data (spec 2026-10-15-agent-reference-design.md). */
export const LLMS_TXT = `# Registrai

> Registrai is a data company for the Arc blockchain (by Circle). Data on the Arc ecosystem: apps on Arc with their hourly stablecoin payments, paying wallets and volume, the Arc Builders, Integrations and Ecosystem indices, and verified builders. Computed from public Arc mainnet data; the method and evidence are published.

## Data
- [Full reference](https://builder.registrai.cc/llms-full.txt): every project, the method, Arc in numbers and the question pages in one file
- [Arc in numbers](https://builder.registrai.cc/arc/): USDC and EURC supply on Arc, stablecoins and TVL, estimated 24 h volume, projects and a dated timeline; JSON at https://builder.registrai.cc/api/v1/arc
- [Methodology](https://builder.registrai.cc/methodology/): definitions of every figure (payments, paying wallets, received USD, index points, the 7-day window, directory statuses), sources, the attributed share and known limits
- [Most-used apps on Arc, last 7 days](https://builder.registrai.cc/arc/most-used-apps/): apps ranked by stablecoin payments received (USD), payments and new paying wallets; JSON at https://builder.registrai.cc/api/v1/arc/apps-week
- [Apps that accept USDC on Arc](https://builder.registrai.cc/arc/apps-that-accept-usdc/): apps measured receiving payments in the last 7 days, and payment apps listed but not measured
- [New on Arc, last 30 days](https://builder.registrai.cc/arc/new/): projects that went live in the last 30 days (the latest launches when there are none) and apps added to Registrai's index in the last 7 days
- [How to get USDC onto Arc](https://builder.registrai.cc/arc/get-usdc/): on-ramps, exchanges and bridges for Arc, each with its evidence
- [Arc vs Ethereum vs Solana for stablecoin payments](https://builder.registrai.cc/arc/arc-vs-ethereum-vs-solana/): fee currency, measured block times, finality, estimated USDC transfer fees in USD and USDC in circulation per chain, each with its source
- [Arc ecosystem directory](https://builder.registrai.cc/ecosystem/): every project on Arc with category, status and sources; JSON at https://builder.registrai.cc/api/v1/ecosystem
- [Apps on Arc](https://builder.registrai.cc/apps/): every app with its last 24 h, sorted by payments
- [Arc indices](https://builder.registrai.cc/builders-index/): ABI, AII, AEI, hourly
- [Data API v1](https://builder.registrai.cc/data-api/): public JSON API, no key, CC BY 4.0
- [OpenAPI](https://builder.registrai.cc/api/v1/openapi.json)
- [MCP server](https://builder.registrai.cc/api/mcp): read-only tools over the same data (Streamable HTTP)
- [MCP server card](https://builder.registrai.cc/.well-known/mcp/server-card.json) and [API catalog](https://builder.registrai.cc/.well-known/api-catalog)
- [Paid extras](https://builder.registrai.cc/api/v1/paid): deep history, a day export and watch-feed data, per request via x402 (USDC on Arc)

## Method
- [How we publish](https://builder.registrai.cc/how-we-publish/)

Licence: CC BY 4.0. Credit: "Registrai, builder.registrai.cc, CC BY 4.0".
`;

export const onRequest: PagesFunction = async () =>
  new Response(LLMS_TXT, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
