# Registrai Data API v1 (first consumer: Genara)

Date: 2026-10-14. Owner: "prepare the tabula data feed so genara will actually plugin our api"; "go for it. ask genara
session to confirm before building".

**Status: DRAFT, waiting on the Genara session's confirmation. Nothing is built yet.**

## Why

Today Genara's climate feed (`genara/feed`, branch feat/world-server) runs on our index server. It reads
`/opt/abi/out/index*.json` and `/opt/abi/out/archive/` directly. After this change:
- Genara reads the same facts from a public, versioned API on builder.registrai.cc, as its first real customer.
- Genara's feed can run on Genara's own host, and our server stops hosting a game job.
- The landing's "Data API · Building now" card gets its first real build.

## Scope

**In scope.** The four read-only endpoints below, public and keyless:
- the index climate;
- members with 7 days of hourly points;
- new members;
- claims.

**Out of scope:**
- **Player wallet activity:** stays in Genara's feed, so player addresses never reach Registrai.
- **The outflow digest:** later; at least 24 h delayed, never Radar's private alerts.
- **API keys, quotas and billing:** later, for the paid Data API. v1 is designed so keys can be added without
  changing response shapes.
- **Registrai's game score:** game-side only, and not in the index (owner, 2026-10-14).

## Rules

- **Read-only, public data only.** Nothing that isn't already public on the index pages or the chain. The index
  method is unchanged; this only publishes.
- **IDs:** a member's id is its index `source` (for example `domain:archery.wtf`, `integration:uniswap`,
  `base:arc`). It never changes once issued. Genara uses it as its district and mine id.
- **Hours:** every hour is given as its close time in ISO UTC (`2026-10-14T19:00:00Z`) plus
  `hour = unix_seconds / 3600`. This is the convention Genara's feed already uses.
- **Versioning:**
  - every response carries `"version": 1` and `data_until` (the last closed hour);
  - fields are only ever added within v1;
  - a breaking change becomes `/api/v1` → `/api/v2`, with v1 kept for at least 30 days.
- **Delivery:**
  - CORS `*`;
  - `cache-control: public, max-age=60` and edge-cached;
  - `etag`, so pollers can send `if-none-match` and get a 304;
  - GET only, anything else returns 405.
- **Errors:** JSON `{ "error": "..." }` with a 4xx/5xx status. A missing upstream file returns 503, never an empty 200.

## Endpoints

### 1. `GET /api/v1/climate`

Index-level numbers for one closed hour, with 7 days of hourly closes:

```json
{
  "version": 1,
  "data_until": "2026-10-14T19:00:00Z",
  "hour": 497779,
  "indices": {
    "abi": { "close": 962.93, "close_24h_ago": 963.05,
             "hourly": [["2026-10-07T20:00:00Z", 963.6], "... 168 entries, oldest first"] },
    "aii": { "...": "same shape" },
    "aei": { "...": "same shape" }
  },
  "params": { "half_life_days": 21, "decay_per_hour_pct": 0.137 }
}
```

- **Source:** the three index files already in KV.
- **Genara uses it for:** `abiChangePct` (from the last two closes), `decayPerHour`, and the cold-attack trigger
  (worst 5% of the trailing 7 days).

### 2. `GET /api/v1/members?index=abi|aii`

Every member of that index, with its last 7 days of hourly points:

```json
{
  "version": 1,
  "index": "aii",
  "data_until": "2026-10-14T19:00:00Z",
  "members": [
    { "id": "integration:uniswap", "name": "Uniswap", "kind": "integration",
      "points": 1234.5, "first_hour": "2026-10-02T00:00:00Z",
      "hourly": [["2026-10-07T20:00:00Z", 1201.2], "..."] }
  ]
}
```

- **`kind`:** one of `builder`, `integration` or `base`. Members are the projects the index scores (the `projects`
  list), not the 205-company integrations catalogue.
- **`hourly`:** holds the member's points at each closed hour that this API has recorded, up to 168 entries, oldest
  first. Hours where the member did not exist are absent.
- **How history is kept:**
  - each time the index pipeline pushes a new hourly index file, the site appends that hour's points per member to a
    rolling 168-hour history in KV (`<index>:hist`);
  - the pipeline itself does not change;
  - a one-time backfill from the server's hourly archives fills the first 7 days.
- **Genara uses it for:**
  - `mineMultiplier = clamp((points_now / avg_7d)^2, 0.5, 2.0)` per integration (AII);
  - district heat per builder (ABI);
  - the base layer as the village.

### 3. `GET /api/v1/members/new?since=<ISO hour>`

Members whose `first_hour` is after `since`, in the same member shape, oldest first. It is capped at 168 hours back.

- **Genara uses it for:** map growth, where each new builder or integration adds a region or a mine.
- **How it's built:** a convenience filter over endpoint 2, so the two can never disagree.

### 4. `GET /api/v1/claims`

Projects whose builder is verified, keyed by the same member id:

```json
{
  "version": 1,
  "updated": "2026-10-14T19:03:00Z",
  "claims": [
    { "id": "domain:archery.wtf", "method": "registry", "since": "2026-09-30T12:00:00Z" }
  ]
}
```

- **Source:** the on-chain BuilderRegistry, the same data as the builders gallery, read with `eth_call` (which
  works from Workers) and edge-cached for 5 minutes.
- `method` is `registry` today. `tabula.json` is added when Radar publishes its validated declarations.
- **Contents:** only the id, method and time. No builder addresses or countries.
- **Genara uses it for:** district claims (the banner, protected commons heat, citizens).

## Genara-side change (in the Genara repo, by the Genara session)

The feed reads these endpoints instead of `INDEX_OUT` and `INDEX_ARCHIVE`:
- `climate.py` and `run.py`: a `REGISTRAI_API` base URL replaces the file paths;
- `PointsHistory`'s archive bootstrap is replaced by the `hourly` field;
- wallet scanning (Arc RPC) and the signed push to the world server stay as they are.

## Testing

- **Unit tests per handler:** shapes, 405, 503 on missing files, etag/304, CORS.
- **History append:**
  - a push of hour H appends H once;
  - a re-push of the same hour replaces it rather than duplicating it;
  - entries older than 168 h drop off;
  - a push that is older than the latest hour is ignored.
- **Contract fixture:** a JSON fixture of each response is committed in our repo and given to Genara, and both sides
  test against it.
- **Live checks after deploy:** curl each endpoint, then cross-check endpoint 1's last close against
  `/api/index/summary`.

## Open questions for the Genara session

1. **Coverage:** are these four endpoints everything the feed and the world server need for Plans 2–4? Anything
   missing or unneeded?
2. **Points shape:** is `hourly` as `[iso, points]` pairs right, or does it want `hour` integers?
3. **5-second marks (§4.1, animating heat inside the hour):** take them from the existing public
   `/api/index/mark`, or does it need a v1 endpoint?
4. **Polling:** is hourly polling of 1–3 and a 5-minute poll of 4 fine?
