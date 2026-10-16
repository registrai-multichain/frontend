# x402 paid extras for the Data API and MCP

Date: 2026-10-16.

**Owner:**
- "add x402 to our api&mcp business first";
- chose **free tier + paid extras**;
- chose "Circle + standard x402 but we build ourselves not using arc light";
- chose "Also watch-feed premium data";
- approved the design in chat ("Yes").

**Status: DRAFT for the owner's review.** Nothing is built.

## Goal

Agents and developers pay per call in USDC on Arc, with no account and no key, for data beyond the free tier. Revenue
lands in a wallet the owner controls. The free CC BY tier stays exactly as published.

## Scope

**Free (unchanged):**
- every current `/api/v1` endpoint within its published windows (744 h, or 168 h on `members/hourly`);
- the 7 current MCP tools;
- `/apps` pages, sitemap, `llms.txt` and OpenAPI;
- the shared rate limit (100 requests per 10 s per IP).

**Paid (new):**

| Product | HTTP route | MCP tool | Circle (Gateway) | Standard x402 |
|---|---|---|---|---|
| Deep index history, any window | `GET /api/v1/paid/indices/{index}/hourly?from&to` | `arc_index_history_deep` | $0.002 | $0.01 |
| Deep member history, any window | `GET /api/v1/paid/members/{id}/hourly?index&from&to` | `arc_app_history_deep` | $0.002 | $0.01 |
| Bulk day export (every member, every hour of one UTC day) | `GET /api/v1/paid/members/day?index&date` | `arc_members_day` | $0.03 | $0.05 |
| Watch-feed events | `GET /api/v1/paid/events?…` (the watch feed's params) | `arc_events` | $0.002 | $0.01 |
| Contract facts | `GET /api/v1/paid/contract/{address}` | `arc_contract` | $0.005 | $0.01 |
| Project scope | `GET /api/v1/paid/projects/{source}/scope?limit&offset` | `arc_project_scope` | $0.01 | $0.02 |

- **Prices** are starting values in one config module and the docs. Changing one is a config change plus a changelog
  line.
- **Why standard x402 costs more:** each standard payment is one onchain transfer that we submit, at about $0.002 of
  gas.

**Paid responses** use exactly the free endpoints' shapes (`version: 1`, `data_until`, rows), so clients reuse the
same parsers. Watch-feed responses keep the watch feed's own documented shapes.

## The 402

A paid route without a payment answers `402` with x402 v2 `PaymentRequired`, offering two `accepts` entries on
`eip155:5042`:
1. **Circle Gateway batched (`exact`, `GatewayWalletBatched`):**
   - the same requirements `@circle-fin/x402-batching/server` builds;
   - `payTo` is the revenue wallet, and the amount is the Circle price;
   - the buyer needs a Circle Gateway balance (Circle's client handles that).
2. **Standard `exact` with EIP-3009:**
   - `asset` is USDC (`0x3600000000000000000000000000000000000000`; supports `transferWithAuthorization`, checked
     onchain 2026-10-16);
   - `payTo` is the revenue wallet, and the amount is the standard price;
   - `maxTimeoutSeconds` is 300;
   - `extra` is `{ name, version }` read from the USDC domain.

The buyer's client picks one and retries with the `X-PAYMENT` header (`PAYMENT-SIGNATURE` in v2).

## Settlement

**Circle path:** verify and settle through `BatchFacilitatorClient` against `gateway-api.circle.com`. The library is
fetch-only (imports `@x402/evm`, `viem`, no `process`), so it runs in the Worker.

**Standard path:** built by us, with no third-party facilitator.
1. **Verify, in the Worker:** the EIP-712 signature recovers `from`, and:
   - `to == payTo`, `value ≥ price`, the validity window covers now, and the network/asset match;
   - `authorizationState(from, nonce)` is unused onchain;
   - the nonce is unused in our ledger.
2. **Reserve:** insert the nonce into `x402_payments` (D1, unique `(scheme, payer, nonce)`) with status `pending`. A
   duplicate is refused with 402 `payment already used`.
3. **Settle:** the gas wallet sends `transferWithAuthorization(from, to=payTo, value, …, signature)` to USDC and waits
   for the receipt. Arc finality is under a second.
4. **Serve:** only after a successful receipt. Status becomes `settled`, with the tx hash in the
   `X-PAYMENT-RESPONSE` header.
5. **On failure:** a revert or timeout gives 402 `settlement_failed` and status `failed`. Nothing moved, because
   EIP-3009 is atomic. An unknown outcome (timeout after send) gives 402 `settlement_unknown` and status `unknown`,
   reconciled on the next request by reading `authorizationState`.

**Gas wallet:**
- an EOA whose key is a Cloudflare secret (`X402_SETTLER_KEY`, set by the owner);
- it never receives revenue: buyers' USDC goes straight to `payTo`;
- it holds only gas USDC (suggested at most $20);
- `/api/v1/paid/health` reports its balance, and a balance under $2 sends an owner alert through the existing
  watchdog path.

**Rate limits:** paid routes sit under `/api/`, so the existing Cloudflare rule applies. Paid callers can batch with
the bulk export.

## Watch-feed data

- **The watch feed:**
  - its writer runs on the index server (`watchfeed/writer`, Python, SQLite);
  - its API runs there too, with payments OFF;
  - it binds to 127.0.0.1 and is reached only through a Cloudflare Tunnel (`watchfeed.internal.registrai.cc`, owner
    step), with a shared secret header (`X-Registrai-Internal`, a Worker secret and a server env value).
- **The Worker** takes the payment, then calls the watch-feed API and passes the JSON through, adding
  `source_url`/`paid: true`.
- **Privacy rules are unchanged:** no Radar private alerts and no `PRIVATE_SOURCES` projects, enforced by the
  watch-feed writer and API (existing tests).

## MCP

The paid tools are listed by `tools/list` with `annotations.readOnlyHint` and a description saying "paid, x402".

1. **First call without payment:** a tool result with `isError: true` and
   `structuredContent: { x402: <PaymentRequired> }`, following the x402-over-MCP convention.
2. **Retry with payment:** the client puts the payment payload in `params._meta["x402/payment"]`, and the server
   settles it the same way as HTTP.
3. **Success:** `structuredContent` holds the data plus `_meta["x402/payment-response"]` with the settlement.

Clients that can't pay still see the tool and the price, and the free tools are unaffected.

## Records

**Table `x402_payments`** (D1 `registrai-data`, new migration):
- `id`, `scheme` (`gateway`|`eip3009`), `route`, `payer`, `nonce`, `amount_usdc`, `status`, `tx_hash`,
  `created_at`;
- unique on `(scheme, payer, nonce)`.

**Dashboard:** `/api/v1/paid/stats` (public, aggregate only) gives sales per day and route plus total USDC. Payer
addresses are never shown publicly.

## Docs and terms

- **`/data-api/`:** a "Paid extras" section with the table, both payment options, example buyer code (Circle client
  and a plain x402 client), and the MCP flow.
- **OpenAPI:** paid paths with a `402` response schema.
- **`llms.txt`:** a line on paid extras.
- **Terms §3:**
  - paid responses are data under the same CC BY licence;
  - the payment buys delivery, not exclusivity;
  - no refunds once data is delivered;
  - failed settlements are not charged.
  - The owner approves the terms text.

## Owner steps

1. Give the revenue wallet address (`payTo`; a Safe is fine). It also becomes the Circle Gateway seller address.
2. Create the gas wallet, fund it with about $20 USDC on Arc, and set its key yourself:
   `npx wrangler pages secret put X402_SETTLER_KEY --project-name=registrai-builders`.
3. Start the watch-feed writer and API on the server with payments off, plus the Cloudflare Tunnel and the shared
   secret.
4. Approve the terms text.

## Testing

- **Unit tests:**
  - 402 shape (both accepts) and price selection;
  - EIP-3009 verification: a good signature; wrong `to`, amount, network or window; a replayed nonce; a used
    onchain nonce;
  - ledger uniqueness under concurrent duplicates;
  - settle success, revert and timeout, with data served only on success;
  - the Circle path with a mocked facilitator;
  - MCP paid-tool flows.
- **Testnet smoke (`eip155:5042002`):** one Circle payment and one standard payment, end to end, before mainnet.
- **Mainnet:** one $0.01 standard call and one Circle call by the owner's buyer wallet. Check the USDC arrived in
  `payTo` and the ledger rows read `settled`.

## Out of scope (later)

- subscriptions and API keys;
- decoded payments and address labels as new data products;
- the parked blue-chip index change.
