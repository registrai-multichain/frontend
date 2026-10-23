# Arc in Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Publish `/arc/` on builder.registrai.cc: a dated, sourced page of Arc chain numbers, with a live API, a daily snapshot history, and an MCP tool.

**Architecture:**
- **Pure assembler:** `buildArcNumbers(inputs)`.
- **Collector:** `collectArcNumbers(env, deps, fetcher)` fetches the RPC, DefiLlama, the KV index files and the directory, each with a timeout. Errors go to `errors[]`, never thrown.
- **Live readers:** the page and `/api/v1/arc` use a live result, edge-cached for 10 minutes.
- **Snapshot:** the 00:00 UTC AEI push stores one snapshot per day in D1 `arc_daily`. `/api/v1/arc/daily` and the page's 30-day table read it.

**Tech Stack:** Cloudflare Pages Functions, D1 (`registrai-data`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-arc-in-numbers-design.md`

## Global Constraints

- Copy rule: plain labels, the method behind an "i" bubble whose text is in the HTML, no slogans.
- Every number carries its source and its "as of" time. DefiLlama figures are labelled "Source: DefiLlama".
- **Constants:**

  | Constant | Value |
  |---|---|
  | USDC on Arc | `0x3600000000000000000000000000000000000000` (6 decimals) |
  | EURC on Arc | `0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1` (6 decimals) |
  | `totalSupply()` selector | `0x18160ddd` |
  | RPCs | `https://rpc.blockdaemon.mainnet.arc.io`, then `https://rpc.mainnet.arc.io` |
  | DefiLlama TVL | `https://api.llama.fi/v2/historicalChainTvl/Arc` (last element `{date, tvl}`) |
  | DefiLlama stablecoins | `https://stablecoins.llama.fi/stablecoincharts/Arc` (last element `totalCirculatingUSD.peggedUSD`, `date`) |
- **Timeline** (source URLs from the published entities):
  - 2025-10-28: Arc public testnet (arc.io pressroom "circle-launches-arc-public-testnet")
  - 2026-08-05: founding validator cohort (arc.io pressroom "circle-announces-founding-validator-cohort-…")
  - 2026-09-16: Arc mainnet (arc.io pressroom "circle-launches-arc-mainnet-…")
- A source failure shows "not available" for its section only. Pages and the API never return 503 because of one source.
- The snapshot is best effort and never fails the index publish.
- Workers runtime: no `process`. Deploys only from abi-deploy. The production deploy and the remote D1 migration only with the owner's OK.

## Review Focus

1. **One source down:** if DefiLlama times out or the RPC fails, the page still renders the other sections and says what's missing.
2. **Push re-run:** a second 00:00 push on the same day replaces that day's row and adds no duplicate.
3. **`?days=` input:** `?days=0`, `-5`, `abc` and `9999` are clamped to 1–365 or fall back to 30, never a 500.
4. **Data age:** the activity numbers come from the index, which can be hours old. Its `data_until` must be shown next to them.

---

### Task 1: Model, assembler and collector

**Files:**
- Create: `builders-site/lib/arc-numbers.ts`
- Test: `builders-site/test/arc-numbers.test.ts`

**Interfaces (produced):**
- `type ArcNumbers` (the shape below)
- `buildArcNumbers(i: ArcInputs, now: number): ArcNumbers`
- `collectArcNumbers(env: Env, fetcher?: typeof fetch, now?: number): Promise<ArcNumbers>`
- `ARC_TIMELINE`, `USDC_ARC`, `EURC_ARC`

`ArcNumbers` shape:
```ts
{ version: 1, generated_at: string,
  network: { chain_id: 5042, gas_token: "USDC", mainnet_since: "2026-09-16", block_height: number | null, block_time_s: number | null, as_of: string | null },
  stablecoins: { usdc_supply: number | null, eurc_supply: number | null, as_of: string | null,
                 all_stablecoins_usd: number | null, tvl_usd: number | null, defillama_date: string | null },
  activity_24h: { data_until: string | null, usdc_moved_usd_est: number | null, eurc_moved_usd_est: number | null, usdc_transfers_est: number | null,
                  app_payments: number | null, app_usd: number | null, attributed_share_pct: number | null },
  ecosystem: { projects: number, live: number, deployed: number, announced: number, top_categories: { id: string; label: string; count: number }[],
               index_members: Record<"abi"|"aii"|"aei", number | null>, index_close: Record<"abi"|"aii"|"aei", number | null>, data_until: string | null },
  timeline: { date: string; text: string; source: string }[],
  errors: string[] }
```

Tests:
- `buildArcNumbers` with full inputs fills every field. `attributed_share_pct = round2(100 * members_usd / base_usd_est)`.
- With `null` inputs it leaves those fields `null` and records an error per source.
- `collectArcNumbers` with an injected fetcher:
  - parses the hex `totalSupply` / 1e6
  - computes the block time from two blocks 10,000 apart
  - reads the last DefiLlama TVL and stablecoin points
  - with a fetcher that throws for llama.fi, `tvl_usd` and `all_stablecoins_usd` are `null`, there's one error, and the RPC numbers are still present.

- [ ] Write the failing tests and run them: `npx vitest run builders-site/test/arc-numbers.test.ts` → FAIL (module missing).
- [ ] Implement, then run → PASS.
- [ ] Commit: `arc numbers: model, assembler, collector (RPC, DefiLlama, index files, directory)`.

### Task 2: Daily snapshot (D1) on the 00:00 AEI push

**Files:**
- Create: `builders-site/migrations-data/0003_arc_daily.sql`
- Modify:
  - `builders-site/lib/data-api-ingest.ts` (add `"0003_arc_daily.sql"` to `DATA_MIGRATIONS`)
  - `builders-site/lib/builders-index.ts`: in the AEI push `after`, when `shouldPing(d.data_until)`, run `snapshotArcDaily(env)` (best effort, caught)
- Create: `builders-site/lib/arc-daily.ts`, containing `storeArcDaily(db, day, n)` (UPSERT), `readArcDaily(db, days)` (newest first, `days` clamped 1–365) and `snapshotArcDaily(env, fetcher?)`
- Test: `builders-site/test/arc-daily.test.ts`

Migration:
```sql
-- Arc in numbers: one snapshot per UTC day (spec docs/superpowers/specs/2026-10-20-arc-in-numbers-design.md)
CREATE TABLE arc_daily (
  day        TEXT    NOT NULL PRIMARY KEY,   -- YYYY-MM-DD (UTC) of the 00:00 close that triggered it
  json       TEXT    NOT NULL,               -- ArcNumbers
  created_at INTEGER NOT NULL                -- unix seconds
) WITHOUT ROWID;
```

Tests:
- Upsert twice on the same day keeps one row with the newer JSON.
- `readArcDaily` with `days` of 0, -5, NaN or 9999 is clamped.
- An AEI push at 00:00 with a stubbed fetch writes a row; a 13:00 push writes none.
- A snapshot that throws doesn't fail the push (status 200).

- [ ] Write the failing tests, implement, then run `npx vitest run builders-site`.
- [ ] Commit: `arc numbers: daily snapshot in D1 after the 00:00 AEI close`.

### Task 3: The `/arc/` page

**Files:**
- Create: `builders-site/lib/arc-pages.ts` (`renderArc(n: ArcNumbers, history: ArcNumbers[]): string`), using `page()` from apps-pages
- Create: `builders-site/functions/arc/[[path]].ts`:
  - `/arc` → 301 to `/arc/`
  - `/arc/` → live numbers (edge-cached 600 s) plus `readArcDaily(db, 30)`
  - any other path → 404
  - GET/HEAD only
- Modify: the nav in `page()` (add "Arc in numbers"), and `renderDirectory` (link to `/arc/`)
- Test: `builders-site/test/arc-pages.test.ts`

The page has the sections in the spec order, each with its "as of" time and source.
- **Activity:** an "i" bubble with the method ("Stablecoin transfers on Arc in the last 24 h, estimated from sampled hours by the Arc Ecosystem Index; apps = transfers into contracts the index attributes to an app").
- **A missing section:** "Not available right now (source: …)."
- **History table:** day, USDC supply, all stablecoins, TVL, USDC moved (24 h), share attributed.
- **JSON-LD:** a `Dataset` with `temporalCoverage` from the oldest snapshot to now.

Tests: all sections render, labels are escaped, a null section shows "Not available", DefiLlama is labelled, the history table is newest first, and the route answers 301, 404, HEAD and 405.

- [ ] Write the failing tests, implement, run `npx vitest run builders-site`, then commit.

### Task 4: API, docs, MCP, sitemap, llms.txt

**Files:**
- Create: `builders-site/functions/api/v1/arc/[[path]].ts` and `builders-site/lib/data-api-arc.ts` (`handleArc(req, env, deps, parts)`):
  - `[]` → live
  - `["daily"]` → `{ version: 1, days: ArcNumbers[] }`
  - anything else → 404
- Modify: `src/lib/data-api-docs.ts` (`ENDPOINTS` gains 2 entries; the docs test count goes from 9 to 11), `src/lib/data-api-openapi.ts` (two paths, schemas from new fixtures `docs/superpowers/specs/data-api-v1-fixtures/arc.json` and `arc-daily.json`)
- Modify: `builders-site/lib/mcp.ts`, adding the tool `arc_numbers` ("Arc in numbers"): "Chain-level Arc numbers: USDC and EURC supply, all stablecoins and TVL (DefiLlama), 24 h stablecoin volume estimate, apps and projects, index closes, timeline. Use this when asked how big Arc is or how much USDC is on Arc." The MCP tests' counts go from 15 to 16.
- Modify: `builders-site/lib/sitemap-urls.ts` (`/arc/` with lastmod = the latest `data_until`), `builders-site/functions/llms.txt.ts` and `public/llms.txt` (an "Arc in numbers" line)
- Tests: the API shapes match the fixtures; `days` is clamped; the MCP tool is listed with a title; the sitemap contains `/arc/`; llms.txt contains `/arc/`.

- [ ] Write the failing tests, implement, run `npx vitest run` and `npm run typecheck`, then commit.

### Task 5: Ship

- [ ] **Preview:** apply the migration to the remote D1 (`npx wrangler d1 migrations apply registrai-data --remote`, from `builders-site`, owner OK first), build from abi-deploy, and deploy a preview. Check `/arc/`, `/api/v1/arc`, `/api/v1/arc/daily` (empty until the first 00:00) and the MCP tool.
- [ ] **Production:** report to the owner, then deploy on the OK. The first snapshot comes at the next 00:00 UTC close; check the next day that `/api/v1/arc/daily` has one row.
