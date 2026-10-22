# Arc question pages: design

**Date:** 2026-10-22. **Status:** approved in chat 2026-10-22 (owner: "Yes"); written spec awaiting review.

## Purpose

Four pages on builder.registrai.cc, each titled the way people ask AI assistants about Arc:
- **Shape:** each opens with a one-sentence answer that carries its date, then a table built from Registrai's own data,
  with sources.
- **Why:** answer engines quote pages that answer the question directly with a dated table.
- **Data:** the directory and the hourly index database already hold what the pages need.

**Success:**
- Each page answers its question in its first sentence, with a date.
- Every figure has a source and an "as of" time.
- A page ships only if it carries data Registrai publishes itself. This keeps the pages clear of Google's
  scaled-content policy.

**Decisions taken in chat (2026-10-22):**
- **Most-used ranking:** by USD received over 7 days.
- **"Accepts USDC":** two parts.
  - **Measured:** apps whose contracts received payments in the last 7 days.
  - **Listed:** directory payment apps we don't measure, marked "not measured".

**Out of scope:**
- **The share-of-volume-attributed figure:** it waits for the owner's 34% vs 95% decision.
- **Methodology and glossary page:** a separate spec.
- **Any page without data of our own.**

## Copy rules

- **Plain labels, no slogans.**
- **The method sits behind an "i" bubble** whose text is in the HTML (`<details><summary>i</summary>…</details>`), as on
  `/arc/`.
- **Every table carries its source and its "as of" time.** Dates are written like "22 Oct 2026, 16:00 UTC", with the
  `at()` formatter from `arc-pages.ts`.
- **Payments include other stablecoins.** The index counts payments in USDC and other registered stablecoins, converted
  to USD. The money columns are therefore labelled "Received (USD)", and the "i" says so.

## Data

### The 7-day window

The window is the 168 closed hours ending at the AEI's last closed hour, `dataUntil(db, "aei")`. The query:

```sql
SELECT m.id,
       SUM(m.usdc)       AS usd,
       SUM(m.payments)   AS payments,
       SUM(m.new_payers) AS new_payers,
       f.first_hour
FROM member_hour m
LEFT JOIN member_first f ON f.idx = m.idx AND f.id = m.id
WHERE m.idx = 'aei' AND m.hour > ?1 - 168 AND m.hour <= ?1
GROUP BY m.id
```

- **Which apps:** members of the Arc Ecosystem Index (AEI), the broadest of the three indices (42 members on 21 Oct).
- **Wallets:** only `new_payers` adds up correctly over hours. Hourly `wallets` counts would double-count, so they are
  not used.
- **Names and categories:**
  - **Linked:** from the directory, via `ECOSYSTEM.byIndexId`. The app links to `/ecosystem/<slug>/`.
  - **Unlinked:** otherwise from the AEI file's project name, linked to the app's `/apps/…` page.

### Shared module

`builders-site/lib/arc-week.ts`:

**Function:** `loadArcWeek(env, deps): Promise<ArcWeek | null>`. It returns null when `DATA_DB` or the AEI data is
missing, and never throws.

```ts
type WeekApp = { id: string; name: string; href: string; category: string | null; usd: number; payments: number;
                 new_payers: number; first_hour: number | null };
type ArcWeek = { until_hour: number; until: string; apps: WeekApp[] };   // apps sorted by usd desc, then name
```

**Caching:** the four pages and the API use one edge-cached computation, for 600 s.

## Pages

These are new routes in `functions/arc/[[path]].ts`, which today serves `/arc/` and answers 404 for anything else:
- missing trailing slash → 301;
- GET and HEAD only;
- unknown paths → 404;
- each page edge-cached for 600 s.

### 1. `/arc/most-used-apps/`: "Most-used apps on Arc, last 7 days"

- **Opening sentence:** "In the 7 days to {until}, {top.name} received the most in stablecoin payments of the {n} apps
  Registrai measures on Arc: {usd}."
- **Fallback sentence:** "No measured app received payments in the 7 days to {until}." This is used when no app has
  `usd > 0`.
- **Table:** apps with `payments > 0`, ranked by `usd`. Columns:
  - #
  - App
  - Category
  - Received (USD)
  - Payments
  - New paying wallets
- **Source line:** "Source: Arc Ecosystem Index (Registrai), hourly, 7 days to {until}."
- **"i" text:** "Payments into each app's contracts in USDC and other registered stablecoins, converted to USD, as attributed by
  the Arc Ecosystem Index. New paying wallets: wallets paying the app for the first time."

### 2. `/arc/apps-that-accept-usdc/`: "Apps that accept USDC on Arc"

- **Opening sentence:** "{n} apps on Arc received stablecoin payments in the 7 days to {until}. {m} more payment apps
  list USDC on Arc but are not measured by Registrai."
- **Table 1, "Measured":** apps with `payments > 0`. Columns: App, Category, Payments (7 d), Received (USD, 7 d).
- **Table 2, "Listed, not measured":** directory entities whose category or tags include `payments` and that have no
  index id among the measured apps.
  - **Columns:** Project, Status, Evidence (first `status_evidence` link).
  - **Order:** live, then deployed, then announced, then by name.

### 3. `/arc/new/`: "New on Arc this week"

- **Opening sentence:** "In the 7 days to {until}, {a} projects in the directory went live on Arc and {b} apps started
  receiving payments in Registrai's index."
- **Table 1, "Went live":** directory entities with `first_live` within the 7 days. Columns: Project, Category,
  Live since.
- **Table 2, "Started receiving payments":** apps with `first_hour` within the window. Columns: App, First payment hour,
  Payments (7 d).
- **Empty tables:** say "None this week."

### 4. `/arc/get-usdc/`: "How to get USDC onto Arc"

- **Opening sentence:** "USDC reaches Arc three ways: buy it through an on-ramp, withdraw it from an exchange that
  supports the Arc network, or bridge it from another chain."
- **Three sections:** "On-ramps" (`ramps`), "Exchanges" (`exchanges`), "Bridges" (`bridges`).
  - **Main table:** live and deployed entries. Columns: Project, Status, Evidence.
  - **Announced entries:** a separate list.
- **No database dependency.** It is rendered once per isolate, like the category pages.

### Common

**Every page has:**
- `page()` with a canonical URL, a description equal to the opening sentence, and JSON-LD: an `ItemList` of the table
  rows, max 100.
- A "Questions" list on `/arc/` linking all four.

**If `loadArcWeek` returns null:**
- **Pages 1–3:** the data tables say "Not available right now (source: Registrai index database)", and the opening
  sentence becomes "Data not available right now." The page still answers 200 and shows its directory parts.

**Also updated:**
- **Sitemap:** the four URLs, with lastmod at the last closed hour (page 4 uses the directory's lastmod).
- **llms.txt:** one line per page.

## API and MCP

**`GET /api/v1/arc/apps-week`:**
- **Response:** `{version: 1, until, window_hours: 168, apps: WeekApp[]}`.
- **No data:** 503 "Weekly data is not available right now."
- **Where:** added to `handleArc` next to `daily`.
- **Docs:** the docs list and the OpenAPI file, with fixture
  `docs/superpowers/specs/data-api-v1-fixtures/arc-apps-week.json`.

**MCP tool `arc_apps_week`:**
- **Title:** "Arc apps, last 7 days".
- **Description:** "Apps on Arc ranked by stablecoin payments received in the last 7 days (USD, payments, new paying
  wallets) and when each first received payments. Use this when asked which apps on Arc are most used, which accept
  USDC, or what is new on Arc."
- **Tool count:** 16 → 17.

## Files

- **New:**
  - `builders-site/lib/arc-week.ts`
  - `builders-site/lib/arc-question-pages.ts` (four renderers)
  - tests `builders-site/test/arc-week.test.ts` and `builders-site/test/arc-question-pages.test.ts`
  - the fixture
- **Changed:**
  - `functions/arc/[[path]].ts`
  - `lib/arc-pages.ts` (the Questions list)
  - `lib/data-api-arc.ts`
  - `lib/mcp.ts`
  - `lib/sitemap-urls.ts`
  - `functions/llms.txt.ts` and `public/llms.txt`
  - `src/lib/data-api-docs.ts` and `data-api-openapi.ts`, with their tests

## Review focus

1. **No `DATA_DB` or no AEI data:** pages 1–3 answer 200 with "Not available right now" in their data tables, page 4 is
   unaffected, and the API answers 503.
2. **A quiet week:**
   - no app has payments → the fallback sentence, with no table rows;
   - nothing new → "None this week".
3. **HTML in names:** an app name containing HTML from the index file is escaped.
4. **The window edge:** an app whose `first_hour` is exactly 168 hours before `until` is not "new". The window is
   `> until − 168`.
5. **Payments outside the window:** a member with rows only outside the window doesn't appear on pages 1–3.
