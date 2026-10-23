# Public data repo `registrai-multichain/arc-ecosystem`: design

**Date:** 2026-10-23. **Status:** approved in chat 2026-10-23 (owner: "go"); written spec awaiting review.

## Purpose

Get builder.registrai.cc found by the search index behind Claude's web search, which is reported to be Brave Search, and
by other engines through links from GitHub. GitHub is the domain Claude cited second most in the 19 Oct baseline (25 of
135 runs).

**Evidence (checked 2026-10-23):**
- **Brave:** a `site:builder.registrai.cc` search returns nothing.
- **What Brave knows about "registrai.cc":**
  - our X profile;
  - the CoinGecko REGI page;
  - two oracle-era GitHub repos;
  - the Glama MCP listing;
  - Lithuanian "registrai" (registers) pages.
- **Brave has no webmaster console.** It discovers pages through links on sites it already crawls.

**Secondary goal:** a citable, versioned open dataset (CC BY 4.0) that researchers and agents can use directly.

**Success:**
- The repo is public and links every site page.
- It refreshes itself daily.
- Every public repo and the org profile point to builder.registrai.cc.
- Later, Brave's `site:builder.registrai.cc` returns pages.

**Decisions taken in chat (2026-10-23):**
- **Refresh:** a GitHub Action, not a push from our servers. No secrets are involved.
- **Oracle-era repos:** keep them public and their code unchanged; re-describe them and link them to the site.

**Out of scope:**
- changes to the site or the API;
- archiving any repo;
- the Glama claim, the Claude directory submission and the arc.io listing (separate owner steps).

## 1. The repo

- **Name:** `registrai-multichain/arc-ecosystem`, public.
- **Settings:**
  - homepage `https://builder.registrai.cc`;
  - description "Open data on the Arc ecosystem: projects with status and sources, daily app activity, Arc chain
    figures. CC BY 4.0. By Registrai (registrai.cc).";
  - topics `arc`, `usdc`, `stablecoins`, `open-data`, `blockchain-data`, `mcp`.
- **Local path while building:** `/Users/tobiasd/Desktop/arc/arc-ecosystem-data`, its own git repo, outside the
  frontend repo.

### Layout

```
README.md                 generated daily from scripts/readme.mjs (counts + "updated" date)
CITATION.cff              cff-version 1.2.0, title "Arc ecosystem data (Registrai)", url builder.registrai.cc, license CC-BY-4.0
LICENSE                   CC BY 4.0 (data, README) + MIT notice for scripts/ (two sections)
data/ecosystem.json       { version, updated, count, entities: <full entity objects from /api/v1/ecosystem/{slug}> } sorted by slug
data/ecosystem.csv        slug,name,category,status,website,first_live,last_reviewed,url
data/corrections.json     body of /api/v1/ecosystem/corrections
data/arc-numbers.json     body of /api/v1/arc
data/arc-daily.csv        day,usdc_supply,eurc_supply,all_stablecoins_usd,tvl_usd,usdc_moved_usd_est,app_usd,attributed_share_pct_24h   (from /api/v1/arc/daily?days=365, oldest first)
data/apps-7d.json         body of /api/v1/arc/apps-week
data/apps-7d.csv          id,name,category,usd,payments,new_payers,first_hour,url
data/indices.json         body of /api/v1/indices
scripts/refresh.mjs       fetch → validate → write (no dependencies; Node 20+ fetch)
scripts/lib.mjs           pure helpers: toCsv, validators, readme renderer
scripts/lib.test.mjs      node --test
.github/workflows/refresh.yml
```

**Base URL:** `https://builder.registrai.cc/api/v1`. Every file holds exactly what the public API returns, apart from the
CSV flattening and the `ecosystem.json` wrapper.

### README

- **Opening line:** "Open data on the Arc ecosystem from Registrai (registrai.cc): {n} projects with status and sources,
  daily app activity and Arc chain figures. CC BY 4.0. Updated {date} UTC."
- **Sections:**
  - **Pages:** links to the directory `/ecosystem/` and each of the 20 category pages, `/arc/`, the four question
    pages, `/methodology/`, `/ecosystem/corrections/`, `/apps/`, `/builders-index/`, `/data-api/`, and the MCP server
    URL with its registry name `cc.registrai/arc-data`.
  - **Files:** a table with file, contents and source endpoint.
  - **Cite:** "Registrai, Arc ecosystem data, builder.registrai.cc, CC BY 4.0, retrieved {date}."
  - **Schedule:** "Refreshed daily at 00:30 UTC by a GitHub Action from the public API; each day is one commit."
  - **Corrections:** "Suggest one on any project page; the log is data/corrections.json."
  - **License.**
- **Copy:** plain, no slogans.
- **Generation:** the category list and the counts are generated from `data/ecosystem.json`. Category ids and labels
  come from the API's entity `category` values and the site's category pages.

## 2. The daily refresh

**Workflow:** `.github/workflows/refresh.yml`:
- `on: schedule: cron "30 0 * * *"` plus `workflow_dispatch`;
- `permissions: contents: write`;
- Node 20 on `ubuntu-latest`.

**Steps:**
1. checkout
2. `node --test scripts/`
3. `node scripts/refresh.mjs`
4. If `git status --porcelain` isn't empty, commit as `github-actions[bot]` with the message
   "data: {date} UTC refresh" and push.

**`refresh.mjs` behaviour:**
- **Fetching:**
  - Each request uses a timeout of 20 s, 3 tries, and the user agent `registrai-arc-ecosystem-data`.
  - The entity list comes first, then each `/ecosystem/{slug}`, 4 at a time.
- **Staging:** it writes every file into `tmp/`, then validates:
  - **`ecosystem.json`:** count equals the list count, and is at least 100. Every entity has `slug`, `name`, `status`
    and `sources`.
  - **`arc-numbers.json`:** has `version` and `network`.
  - **`apps-7d.json`:** has an `apps` array. A 503 from that endpoint keeps yesterday's file instead of failing the
    whole run.
  - **CSVs:** have the header plus at least one row.
- **On any failure:** it exits 1 before touching `data/`, so nothing is committed and GitHub emails the owner.
- **On success:** it moves `tmp/*` over `data/` and regenerates the README.

**CSV:** RFC 4180 quoting (quote fields containing `,`, `"` or a newline; double inner quotes), with `\n` line endings.

## 3. Pointing everything at the site

All of this runs with `gh` after the owner's explicit OK, because it publishes under the org.

- **Org:**
  - description "Registrai: Arc ecosystem data (directory, chain figures, app activity).";
  - blog URL `https://builder.registrai.cc`.
- **Org profile repo:** `registrai-multichain/.github`, public, with `profile/README.md`: one paragraph and the main
  links (the site, the data repo, the API, the MCP server, the methodology).
- **Repo homepages:** set to `https://builder.registrai.cc` on `frontend`, `contracts`, `agent-sdk`, `agent` and
  `oracle-primitives`.
- **Oracle-era descriptions:** prefixed "Registrai (Arc ecosystem data, builder.registrai.cc). " on `agent-sdk`, `agent`
  and `oracle-primitives`, keeping the existing text after it. Trim the existing text if the result is over GitHub's
  350-character limit.

## Tests

- **`lib.test.mjs`:**
  - **CSV escaping:** commas, quotes, newlines and empty or null values.
  - **Validators:** reject a short entity list, a missing field, or a missing `version`.
  - **The README renderer:** includes every category link, the count and date, the citation line and all the page links;
    no "undefined" anywhere.
- **Before the first push,** a local dry run against the live API (`node scripts/refresh.mjs`) produces all files and a
  README that the owner reviews.

## Review focus

1. **API partly down during the run:**
   - no partial commit;
   - the apps-week 503 keeps yesterday's file;
   - any other failure exits non-zero.
2. **CSV injection:** a project name starting with `=`, `+`, `-` or `@` is prefixed with `'` in the CSVs.
3. **Rate:** 258 entity fetches at concurrency 4 stays well inside edge cache and Worker limits, and is cached for 300 s.
4. **Determinism:** the same API data gives byte-identical files (sorted keys and stable ordering), so a day without
   changes makes no commit.
5. **Nothing secret in the repo or workflow:** no tokens other than the built-in `GITHUB_TOKEN`.
