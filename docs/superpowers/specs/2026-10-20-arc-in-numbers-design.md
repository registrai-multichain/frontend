# Arc in numbers — design

Date: 2026-10-20. Status: design approved in chat (owner, 2026-10-20). The roadmap step is "Arc in numbers".

**Goal.** Make one dated, sourced page on builder.registrai.cc that answers chain-level Arc questions in one place. In the 2026-10-19 citation baseline these questions (TVL, USDC on Arc, transactions, wallets, volume) were answered from DefiLlama, Bitquery and arc-scan.org, and never from Registrai.

## Owner decisions (2026-10-20)

1. **DefiLlama figures** (TVL, all stablecoins on Arc) are shown, each labelled "Source: DefiLlama". Our own numbers stay the core of the page.
2. **A daily snapshot** is stored once a day, after the 00:00 UTC AEI close. Past days stay fixed and citable. The page shows a 30-day table, and an API serves the history.

## Content (`/arc/`, plain labels)

| Section | Fields | Source |
|---|---|---|
| Network | chain ID 5042, gas token USDC, mainnet since 2026-09-16, block height, average block time (last 10,000 blocks) | Circle's release; Arc RPC |
| Stablecoins on Arc | USDC supply, EURC supply (`totalSupply` on the token contracts); all stablecoins (USD); TVL | Arc RPC; DefiLlama (labelled) |
| Activity, last 24 h | estimated USDC and EURC moved on Arc, estimated USDC transfers, payments to tracked apps and their USD, share attributed to apps ("i": method) | Registrai AEI index file (`volume_24h`) |
| Ecosystem | projects in the directory by status, top categories, apps in each index, ABI, AII and AEI closes | directory file, index files |
| Timeline | 2025-10-28 public testnet; 2026-08-05 founding validator cohort; 2026-09-16 mainnet | arc.io press releases |
| History | the last 30 daily snapshots | D1 `arc_daily` |

**Dating.** Every section carries its own "as of" time:
- the index's `data_until`
- the RPC read time
- DefiLlama's date

**Failures.** A failed source shows "not available" for that section only. The page never returns 503 because one source is down.

## Mechanics

- **One builder for both:** `buildArcNumbers(inputs)` is a pure assembler, and `collectArcNumbers(env, deps)` does the fetches (RPC, DefiLlama, KV index files, `ECOSYSTEM`) with timeouts. Its result `ArcNumbers` carries `errors[]` for the sources that failed.
- **Live page and API:** `/arc/` and `GET /api/v1/arc` use a live `ArcNumbers`, edge-cached for 10 minutes.
- **Snapshot:** after the 00:00 UTC AEI push (the same hook as the IndexNow ping), `collectArcNumbers` runs once. Its result is upserted into D1 `registrai-data` table `arc_daily (day TEXT PRIMARY KEY, json TEXT, created_at INTEGER)`, migration `0003_arc_daily.sql`. This is best effort and never fails the publish. A re-push of the same day replaces that day's row.
- **History API:** `GET /api/v1/arc/daily?days=30` (at most 365) serves the history. The page reads the last 30 days.
- **Agents and search:**
  - MCP tool `arc_numbers` ("Arc in numbers"), backed by `/api/v1/arc`
  - OpenAPI and docs entries for the two endpoints
  - a sitemap entry (lastmod = `data_until`), an llms.txt line, and a link from `/ecosystem/` and the nav
- **JSON-LD:** a `Dataset` with `temporalCoverage`, `variableMeasured` and two `DataDownload`s (live and daily). The license is CC BY 4.0 for our numbers; DefiLlama figures are attributed in-line.

## Out of scope

- Daily transactions and active wallets. Arc's explorer API blocks scripts (403), so these need a keeper-side counter later.
- Any change to the index method.

## Risks

- **A third-party API down or changed:** that section becomes "not available", and the error is in `errors[]`.
- **The attributed share swings daily** (34% on 2026-10-17, 2.97% on 2026-10-20): it is always shown dated, with its method in the "i" bubble.
- **CPU:** the live page is edge-cached for 10 minutes. The snapshot runs once a day inside the push handler.
