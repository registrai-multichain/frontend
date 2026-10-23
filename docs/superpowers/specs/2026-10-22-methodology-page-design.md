# Methodology page and the 7-day attributed share: design

**Date:** 2026-10-22. **Status:** approved in chat 2026-10-22 (owner: "go for it"); written spec awaiting review.

## Purpose

`/methodology/` is the one place every number on builder.registrai.cc points back to. It defines each term, names
each source, states the limits, and is versioned with a changelog. Answer engines and journalists quote figures with
their definitions, and a reference site needs a citable method page.

It also replaces the single-day "share of USDC volume attributed to apps" with a 7-day figure and its daily range.

**What the figures mean (found 2026-10-22):** the 34% (`/apps/` note, 17 Oct), the "~95% unattributed" (internal spec,
15 Oct) and the ~1% (`/arc/`, 21 Oct) are the same measure on different days:
- **Formula:** app USD in 24 h ÷ the estimated USD of all USDC moved on Arc in 24 h.
- **Why it swings:**
  - The denominator is sampled from the first `base_window` (240) blocks of each hour and scaled by `base_scale` (30).
  - Large transfers inside or outside the sample move it a lot.
  - It ranged from about 1% to 34% between 17 and 22 Oct.

**Decision (owner, 2026-10-22):** publish a 7-day share, with the daily range.

**Out of scope:**
- **Any change to how the indices compute.** The page describes the method in use; measurement changes stay the
  owner's call.
- **Moving or rewriting `/how-we-publish/` or `/builders-index/`.** Both are linked, not replaced.

## Copy rules

- **Plain labels, no slogans.** The users know basic DeFi.
- **Short sections.** Each opens with a one-sentence definition.
- **Every number on the page is read from live data at render time,** with its "as of" time. No figure is hard-coded
  into prose.

## 1. The page: `/methodology/`

### Route and rendering

- **Route:** `builders-site/functions/methodology/[[path]].ts`, a Pages Function like `/arc/`.
  - GET and HEAD only;
  - `/methodology` → 301;
  - any subpath → 404;
  - edge-cached for 600 s.
- **Renderer:** `builders-site/lib/methodology-page.ts`, function `renderMethodology(m: MethodologyInput): string`.

### `MethodologyInput`

```ts
{ version: string; date: string;
  params: Record<string, number> | null;
  share: Share7d | null;
  until: string | null }
```

- **`version` and `date`:** constants in the module, `"1"` and `"2026-10-22"`.
- **`params`:** the AEI file's `params` (the method parameters the indices publish), or null.
- **`share`:** from section 2.
- **`until`:** the AEI `data_until`.

### Sections

Each section has an `id` so others can link to it.

1. **`#glossary`: Glossary.** A `<dl>` with one `<dt id="…">` per term.
   - **Payment (`#payment`):** a transfer of USDC or another registered stablecoin into one of an app's attributed
     contracts on Arc mainnet, counted by the index method.
   - **Paying wallet (`#paying-wallet`):** a distinct wallet that made at least one payment to the app within the period.
   - **New paying wallet (`#new-paying-wallet`):** a wallet paying the app for the first time. It must pay at least
     `new_payer_min_usdc`, and at most `new_payer_max_per_hour` count per app per hour.
   - **Received (USD) (`#received-usd`):** the USD value of payments. Other stablecoins are converted at the ECB
     reference rate for their currency. Each wallet counts up to `cap_per_wallet_hour_usdc` per hour.
   - **Attributed contract (`#attributed-contract`):** a contract Registrai assigns to an app from its own deployments,
     its factories' pools, or a reviewed integration list.
   - **Index member (`#index-member`):** an app included in an index:
     - Arc Builders Index (verified builders);
     - Arc Integrations Index (integrations);
     - Arc Ecosystem Index (all).
   - **Index points (`#index-points`):** activity points that decay with a half-life of `half_life_days` days, about
     `decay_per_hour_pct` % an hour. One point per `volume_usdc_per_point` USD received, plus `new_payer_points` per new
     paying wallet.
   - **Closed hour, data until (`#data-until`):** figures cover hours that have ended. "Data until" is the end of the
     last closed hour (UTC).
   - **7-day window (`#window`):** the 168 closed hours ending at "data until".
   - **Directory statuses (`#statuses`):**
     - **Live:** evidence of use on Arc mainnet (contracts, an index id, an explorer link, or the project's own mainnet
       support page).
     - **Deployed:** contracts are on Arc but there's no evidence of use.
     - **Announced:** only an announcement.
   - **Attributed share (`#attributed-share`):** see section 3.

   **Parameter values:** values written above in backticks are filled from `params` at render time, with "as of
   {until}". If `params` is null, the sentence omits the number: "…up to a per-wallet hourly cap…".

2. **`#sources`: Sources.** A table with columns Source, What we take, How often.

   | Source | What we take | How often |
   |---|---|---|
   | Arc RPC (Blockdaemon, then rpc.mainnet.arc.io) | blocks, token supplies, transfer logs | live (Arc in numbers), hourly (indices) |
   | Registrai indices (ABI, AII, AEI) | per-app payments, wallets, USD | hourly |
   | DefiLlama | Arc TVL and stablecoins, always labelled "Source: DefiLlama" | live, cached 10 min |
   | Arc ecosystem directory | project facts, each with its sources and evidence | reviewed by hand; review date on each page |

3. **`#attributed-share`: The attributed share.**
   - **Definition:** "The share of USDC moved on Arc that went into apps the index attributes contracts to:
     received (USD) by all index members ÷ the estimated USD value of all USDC transfers on Arc, over the same period."
   - **Why we use 7 days:** "The all-USDC total is estimated from the first {base_window} blocks of each hour, scaled
     ×{base_scale}, so a single large transfer moves a one-day figure a lot. Over 7 days the figure is steadier."
   - **Current value:** from section 2. Either "{pct}% over the 7 days to {date} (daily {min}–{max}%)", or, with fewer
     than 7 snapshots, "{pct}% over the last 24 h (daily range so far {min}–{max}%, {n} days)".

4. **`#limits`: Known limits.**
   - **Sampled total:** the all-USDC denominator is an estimate (sampled blocks).
   - **Attribution coverage:** payments to contracts we haven't attributed aren't counted for any app.
   - **Missed hours:** an hour the keeper misses is filled from the chain at the next close. If it can't be filled,
     totals for that window are lower.
   - **Directory review dates:** directory facts are as current as their review date; corrections are public at
     `/ecosystem/corrections/`.
   - **Other stablecoins:** converted to USD, so "Received (USD)" isn't USDC-only.

5. **`#changelog`: Changelog.** A list, newest first, starting with "v1 (22 Oct 2026): first published version."

**Each page also:**
- **Header:** `<h1>Methodology</h1>`, then "Version {version} · {date} · Data until {until}".
- **Links:** to `/how-we-publish/` (publishing principles), `/builders-index/` (the indices) and `/data-api/` (the API
  fields).
- **JSON-LD:**
  - a `DefinedTermSet` named "Registrai Arc data glossary", with one `DefinedTerm` per glossary entry (`name`,
    `description` and `url` with its anchor);
  - an `Article` with `dateModified = date` and `version`.

### Linking to the page

- **Footer "Method" link:** `METHOD_URL` in `apps-pages.ts` becomes `/methodology/`. `/builders-index/` stays linked
  from the nav as "Indices".
- **"i" notes:** each existing "i" note on `/apps/`, `/arc/` and the question pages gets a trailing link,
  "Method: /methodology/#…", to the matching anchor:
  - `#received-usd`
  - `#attributed-share`
  - `#new-paying-wallet`
  - `#window`
- **Discovery:** the sitemap (lastmod = `date`) and both `llms.txt` files get one line.

## 2. The 7-day attributed share

**Data:** the `arc_daily` snapshots (one per UTC day), each holding `activity_24h.app_usd` and
`activity_24h.usdc_moved_usd_est`.

**Function:** in `builders-site/lib/arc-share.ts`,
`share7d(days: ArcNumbers[]): Share7d | null`.

```ts
type Share7d = { window_days: number; until: string; pct: number;           // sum(app_usd) / sum(usdc_moved) × 100, 2 dp
                 daily_min: number; daily_max: number;                         // min/max of each day's own share, 2 dp
                 complete: boolean }                                           // window_days === 7
```

**How it's computed:**
- **Which snapshots:** the newest 7 that have both fields as numbers and `usdc_moved_usd_est > 0`, newest first.
- **`until`:** the newest snapshot's `activity_24h.data_until`.
- **Partial data:** fewer than 7 usable snapshots → `complete: false`, with `window_days` set to the number used.
- **No usable snapshot:** → null.

**Shown on:**
- **`/arc/`:** the "Share attributed to apps" row is labelled "7 days" when complete, otherwise "24 h". The daily
  range and a link to `#attributed-share` follow.
- **`/apps/`:** the note's sentence becomes one of:
  - "About {pct}% of the estimated USDC moved on Arc over the 7 days to {date} went to these apps (daily {min}–{max}%)."
  - When not complete: "About {pct}% … over the last {n} days …".
- **API:** `/api/v1/arc` gains `attributed_share_7d: Share7d | null`. The existing
  `activity_24h.attributed_share_pct` stays. The OpenAPI file and the fixture `arc.json` are updated.

**Data access:** `/arc/` already reads 30 snapshots. `/apps/` and the methodology page read 7 via `readArcDaily`. Both
are edge-cached, and a read failure gives null, so the label says "Not available right now".

## Files

- **New:**
  - `builders-site/lib/arc-share.ts`
  - `builders-site/lib/methodology-page.ts`
  - `builders-site/functions/methodology/[[path]].ts`
  - tests `builders-site/test/arc-share.test.ts` and `builders-site/test/methodology-page.test.ts`
- **Changed:**
  - `lib/arc-pages.ts` (share row)
  - `lib/arc-numbers.ts` (the `ArcNumbers` type gains `attributed_share_7d`)
  - `lib/data-api-arc.ts`
  - `lib/apps-pages.ts` (note sentence, `METHOD_URL`)
  - `functions/apps/…` (passes the snapshots in)
  - `lib/arc-question-pages.ts` ("i" link)
  - `lib/sitemap-urls.ts`
  - both `llms.txt` files
  - `src/lib/data-api-openapi.ts` and the `arc.json` fixture

## Review focus

1. **Short history:**
   - 0 snapshots → null → "Not available right now";
   - 1–6 → labelled "24 h" or "last {n} days";
   - exactly 7 → "7 days".
2. **A zero or missing denominator in a snapshot:** that day is skipped, never a division by zero, and never shows
   Infinity or NaN.
3. **Missing AEI params:** the glossary sentences drop the numbers and stay grammatical.
4. **Anchors:** every glossary `id` is unique and exists, and every "i" link points to an existing anchor.
5. **No unlabelled share remains on any page.** Grep the rendered `/apps/`, `/arc/` and `/methodology/` for "% of" and
   check each has a window label.
