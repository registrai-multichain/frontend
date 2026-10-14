# Registrai Data API v1

Date: 2026-10-14.

Owner's words:
- "prepare the tabula data feed so genara will actually plugin our api";
- "ask genara session to confirm before building";
- "it is an api for general public, no just genara. We are dogfooding the data business now".

**Status: DRAFT, waiting on the Genara session's confirmation. Nothing is built yet.**

## What it is

The Data API is the public, documented product behind the landing's "Data API" card. Anyone can read Arc index and
per-app data from it. Genara is the first consumer: we dogfood the product by building a real app on it, not a
private feed.

Today Genara's climate feed reads `/opt/abi/out` on our index server. After v1:
- Genara reads the same public API anyone else can;
- Genara's feed runs on Genara's own host;
- our server stops hosting a third-party job.

## Scope of v1

**In scope:**
- **Free and keyless:** public, read-only.
- **Index-level data:** closes and parameters for ABI, AII and AEI.
- **Per-app data:** every scored member of each index, with hourly points and activity (payments, paying wallets, new
  payers, stablecoin volume), stored for the full history (no pruning).
- **Verified projects:** from the on-chain builder registry.
- **Public docs** at builder.registrai.cc/data-api/, with examples, the schema, a changelog and terms of use.

**Later** (the rest of the landing card; each gets its own spec):
- API keys, higher limits and a paid tier;
- decoded payments per address;
- address labels;
- payment webhooks;
- the outflow digest (at least 24 h delayed, never Radar's private alerts);
- other chains.

**Never in the API:**
- non-public data;
- Radar's private alerts;
- builder addresses or countries from claims;
- anything a project marked private.

## Rules

- **What's published:** it publishes what the index already computes. The index method is unchanged, and the method
  and its changes stay on the public method pages.
- **IDs:**
  - a member's `id` is its index `source` (for example `domain:archery.wtf`, `integration:uniswap`, `base:arc`);
  - it is stable once issued;
  - in a path it is URL-encoded.
- **Hours:**
  - each hour is identified by its close time in ISO UTC (`2026-10-14T19:00:00Z`);
  - rows also carry `hour = unix_seconds / 3600`;
  - only closed hours are served.
- **Versioning:**
  - every response has `"version": 1` and `data_until` (the last closed hour);
  - fields are only ever added within v1;
  - a breaking change ships as `/api/v2`, with v1 kept for at least 90 days and dated in the changelog.
- **Delivery:**
  - CORS `*` and an `etag` (`if-none-match` gets a 304);
  - edge-cached for 60 s, or for 5 min on claims;
  - GET only, anything else returns 405.
- **Limits (free tier):**
  - a Cloudflare rate limit of 120 requests per minute per IP, returning 429 with `retry-after`;
  - at most 744 hours (31 days) per history request.
- **Errors:** `{ "error": "<plain sentence>" }` with a 4xx/5xx status. A missing upstream returns 503, never an
  empty 200.
- **Terms:**
  - free to use with attribution ("Data: Registrai");
  - no warranty, not financial advice;
  - the terms page gets a Data API section.
  - The licence choice is the owner's (see Open questions).

## Endpoints

### 1. `GET /api/v1/indices`

The latest close of every index, its 24 h change and its parameters:

```json
{
  "version": 1,
  "data_until": "2026-10-14T19:00:00Z",
  "indices": {
    "abi": { "name": "Arc Builders Index", "close": 962.93, "close_24h_ago": 963.05, "base": 1000,
             "base_date": "2026-10-02T00:00:00Z", "members": 19 },
    "aii": { "...": "same" },
    "aei": { "...": "same" }
  },
  "params": { "half_life_days": 21, "decay_per_hour_pct": 0.137 }
}
```

### 2. `GET /api/v1/indices/{abi|aii|aei}/hourly?from=&to=`

Hourly closes as `{hour_close, hour, close}` rows, oldest first. The default and maximum window is the last 744
hours. The full history goes back to the base date, 2 Oct 2026.

### 3. `GET /api/v1/members?index=abi|aii|aei`

Every scored member of that index, now:

```json
{
  "version": 1,
  "index": "aii",
  "data_until": "2026-10-14T19:00:00Z",
  "members": [
    { "id": "integration:uniswap", "name": "Uniswap", "kind": "integration", "verified": false,
      "points": 1234.5, "share": 3.2, "first_hour": "2026-10-10T23:00:00Z",
      "last_24h": { "points": 51.2, "payments": 312, "usdc": 18230.5 } }
  ]
}
```

- **Members:** the projects the index scores (its `projects` list), not the 205-company integrations catalogue.
- **`kind`:** one of `builder`, `integration` or `base`.

### 4. `GET /api/v1/members/{id}/hourly?index=&from=&to=`

One member's hourly rows, oldest first:

```json
{ "hour_close": "2026-10-14T19:00:00Z", "hour": 497779, "points": 1142.98,
  "payments": 133, "wallets": 13, "new_payers": 0, "usdc": 21970.75 }
```

- **Window:** at most 744 hours per request.
- Hours where the member did not exist are absent.
- **Depth:** member history starts at **2026-10-10T23:00Z**, the oldest archived hour on the server. The docs state
  that date.

### 5. `GET /api/v1/members/hourly?index=&hour=`

Every member's row for one closed hour. It saves a consumer from making N calls per hour (Genara polls this).

### 6. `GET /api/v1/members/new?index=&since=`

Members whose `first_hour` is after `since`, in the members shape. Used for map growth in Genara, and for "new on
Arc" lists generally.

### 7. `GET /api/v1/verified`

Verified projects, keyed by member id:

```json
{ "version": 1, "updated": "2026-10-14T19:03:00Z",
  "verified": [ { "id": "domain:archery.wtf", "method": "registry", "since": "2026-09-30T12:00:00Z" } ] }
```

- **Source:** the on-chain BuilderRegistry (Worker `eth_call`), cached for 5 minutes.
- `method` is `registry` today. `tabula.json` is added when Radar publishes its validated declarations.

## How the data gets in

- **Storage:** a new D1 database `registrai-data` with two tables:
  - `index_hour` (`index, hour, close`);
  - `member_hour` (`index, id, hour, points, payments, wallets, new_payers, usdc`), with primary key
    (`index, id, hour`).
- **On every push:** when the index pipeline pushes a new index file, the site's existing push handler upserts that
  hour's rows. The pipeline doesn't change.
  - A re-push of the same hour replaces its rows.
  - An older hour never overwrites a newer one.
- **Backfill, once, by an admin script:**
  - index closes since 2 Oct, from each index file's `series`;
  - member rows since 10 Oct 23:00, from the server's hourly archives;
  - the script is idempotent.
- **Size:** about 25 members × 3 indices × 8,760 hours ≈ 650k rows a year, which is small for D1.

## Docs page

builder.registrai.cc/data-api/ holds, in plain labels:
- the endpoint list and a copy-paste `curl` for each;
- the schema;
- limits, the changelog and the terms link;
- the history start dates.

The landing's Data API card changes from "Building now" to "Live: index and per-app endpoints". The rest of the card
stays "Building now".

## Genara (first consumer)

Genara's feed swaps `INDEX_OUT`/`INDEX_ARCHIVE` for `REGISTRAI_API=https://builder.registrai.cc/api/v1`:
- climate comes from 1–2;
- mine multipliers come from 4–5 (AII);
- districts come from 3–5 (ABI) and the village from `base:arc`;
- map growth comes from 6;
- claims come from 7.

Wallet scanning and the signed push to world.genara.life stay in Genara, so player addresses never reach Registrai.

## Testing

- **Handler unit tests:** shapes, 405, 503, etag/304, CORS, window caps, from/to validation, URL-encoded ids.
- **Ingest tests:** upsert on push, re-push replaces, an older hour is ignored, backfill is idempotent.
- **Contract fixtures:** one JSON fixture per endpoint, used by our tests and handed to Genara.
- **Live checks after deploy:** curl every endpoint; `indices` must match `/api/index/summary`; one member's last row
  must match the index page.

## Open questions

**For the Genara session:**
1. Do endpoints 1–7 cover Plans 2–4?
2. For the 5-second heat animation, is the existing public `GET /api/index/mark` (ABI only) enough?
3. Is it OK to poll hourly on 5 and every 5 min on 7?

**For the owner:**

4. **Licence:** CC BY 4.0 ("Data: Registrai") is the assistant's recommendation; the alternative is a custom licence
   that bars resale.
5. **Free-tier limits:** is 120 requests per minute per IP and a 31-day window per request OK?
