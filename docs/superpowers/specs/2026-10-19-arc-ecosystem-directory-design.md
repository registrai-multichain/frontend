# Arc ecosystem directory — design

Date: 2026-10-19. Status: draft for owner review.
Goal (owner, 2026-10-19): Registrai becomes the page LLMs cite for the Arc ecosystem, beyond stablecoin use.
Evidence: citation baseline 2026-10-19 (`docs/citation-panel/2026-10-19-summary.md`). Registrai was cited in 1 of 369 answers to non-brand Arc questions. Lists like "What apps are on Arc", "Which DEXs", "Which wallets" are answered from arc.io, circle.com and exchange or airdrop blogs; no directory is cited.

## Owner decisions (2026-10-19)

1. **Inclusion:** everything with a public Arc link (contracts on mainnet, a live integration, or an official announcement). Each entry shows a status: Live on mainnet / Deployed / Announced.
2. **One page per project.** It combines facts, contracts, status and, where measured, activity. The current `/apps/<kind>/<id>/` and `/project/<kind>/<id>/` URLs 301 to it.
3. **Curation:** Claude drafts every entry from public sources, and each fact carries a source link and a "last reviewed" date. Entries publish directly, and every page has correction and removal links. The owner spot-checks.
4. **Seed sources:**
   - the owner's tracker `research/arc-builders-index/integrations.json` (read-only; nothing is written to `research/`)
   - the index members
   - DefiLlama's Arc protocols
   - the organisations on arc.io/ecosystem (names and links only; no copied descriptions)

## Scope

**In:**
- the directory data (≈250–300 entities after dedup)
- entity pages, the directory page, category pages
- an API endpoint, MCP tools, sitemap and llms.txt entries
- 301s from the old URLs
- validation tests

**Out (separate work):**
- the "Arc in numbers" page
- broader per-app activity metrics (transactions, active wallets, all tokens)
- any change to the ABI/AII/AEI method
- a submission form (phase C below)

## Data model

The source of truth is one JSON file in the repo: `data/arc-ecosystem/entities.json`. Git history is the changelog, and a reviewable diff is the publish step. The build copies it to `dist-builders/ecosystem/entities.json`, where it is also the open download (CC BY 4.0). Functions read it with `env.ASSETS.fetch` and cache it at the edge, so there is no KV write quota to manage.

```ts
type ArcEntity = {
  slug: string;                 // URL id, kebab-case, unique: "aave", "archery"
  name: string;
  aliases?: string[];           // other spellings LLMs and users use
  category: Category;           // one primary category (taxonomy below)
  tags?: Category[];            // secondary categories
  status: "live" | "deployed" | "announced";
  status_evidence: Source[];    // why this status (explorer link, docs page, press release)
  summary: string;              // 1–2 plain sentences, ≤ 280 chars: what it does on Arc. No verdict words.
  website?: string; x?: string; github?: string; docs?: string;
  first_announced?: string;     // YYYY-MM-DD
  first_live?: string;          // YYYY-MM-DD
  contracts?: { address: string; role: string; source: string }[];  // hand-checked; index digest adds more
  index_ids?: string[];         // ABI/AII/AEI member ids, e.g. ["domain:archery.wtf"]
  facts_source?: string;        // Tabula facts/profile key (domain:… / github:…), if any
  sources: Source[];            // every claim on the page traces to one of these
  last_reviewed: string;        // YYYY-MM-DD
};
type Source = { url: string; title?: string; date?: string };
```

**Excluded from the public file:** the tracker's `revenue_*`, `wallets`, `research_notes` and internal ids.

**Taxonomy.** Primary categories use plain labels, built from the tracker's 30 categories merged into 20:
- payments
- wallet
- exchange
- bank
- stablecoin issuer
- infrastructure (RPC, indexers, oracles, explorers)
- developer tools
- DEX
- lending
- trading
- market maker
- custody
- RWA and tokenization
- cross-chain and bridges
- AI agents
- on/off-ramp
- games and consumer
- launchpad
- validator
- asset manager

Each category has a fixed label ("DEXs on Arc", "Wallets that support Arc") and a URL slug.

## Pages (builder.registrai.cc)

All pages are server-rendered by Pages Functions in plain HTML, the same pattern as today's `/apps`. They follow the copy rule: plain labels, with explanations behind "i" bubbles whose text is in the HTML.

**`/ecosystem/<slug>/` — the entity page:**
- name, status badge, category, summary, links (website, X, GitHub, docs)
- **Status:** first announced, first live, and the evidence links
- **Contracts on Arc:** the hand-checked list with roles, then the index digest (`data:app-contracts`) with "and N more"
- **Activity:** only for index members, showing the last 24 h and 7 days (the current app page block)
- **Project facts:** the Tabula facts and profile when public (the current facts block)
- **Sources:** a numbered list. Last reviewed date. Links for "Report an error" and "Ask for removal".
- JSON-LD: `Organization` (name, url, sameAs, description). Index members also carry a `Dataset` for their activity, as today.

**`/ecosystem/` — the directory:**
- counts by status and category
- a table of every entity (name, category, status, first live) with a status filter (links, no JS required)

**`/ecosystem/<category-slug>/`:** for example "DEXs on Arc" or "Wallets that support Arc". These are the question-shaped pages for the baseline's ecosystem questions.

**Redirects (301):**
- `/apps/<kind>/<id>/` → `/ecosystem/<slug>/` when an entity lists that index id
- `/project/<kind>/<id>/` → the same when `facts_source` matches
- unmapped URLs keep working as today

`/apps/` stays as the sortable activity table and links to the entity pages.

## API, MCP, discovery

- **Data API:**
  - `GET /api/v1/ecosystem`: list, filterable by `category` and `status`
  - `GET /api/v1/ecosystem/{slug}`: one entity
  - both added to OpenAPI and the `/api/v1/` index
- **MCP tools:**
  - `arc_ecosystem` ("Arc ecosystem: directory"): filter by category, status or a name query
  - `arc_entity` ("Arc project: detail")
  - both free, with use-when descriptions
- **Sitemap and IndexNow:** the directory, the category pages and every entity page, with lastmod = `last_reviewed`.
- **llms.txt:** directory and category links.

## Drafting the entries (how Claude fills the file)

1. **Merge the seed sources:** `scripts/ecosystem-seed.ts` merges them into `data/arc-ecosystem/draft.json` with dedup by name, domain and member id. It records where each candidate came from.
2. **Draft each entry from its sources**, in batches by category:
   - the summary, status with evidence, links, dates and contracts
   - the press release, docs, explorer and the project site
   - a fact with no source is left out
3. **Validation:** tests fail the build on:
   - duplicate slugs
   - an entry without sources or status evidence
   - "live" without a mainnet evidence link
   - a summary over 280 characters, or one with a verdict word (`VERDICT_WORDS`)
   - non-https links
   - unknown categories
4. **Spot-check:** the owner checks a sample per batch in the PR diff before deploy.

## Phases

- **A. Platform plus about 60 entries.** Model, validation, entity, directory and category pages, redirects, API, MCP, sitemap. Seeded with the 41 index members and the tracker's live and deployed entries.
- **B. Fill to full coverage.** The remaining tracker "announced" entries, DefiLlama and arc.io. About 250–300 entries.
- **C. Corrections and submissions.** A form that opens a review item in admin. Kept until A and B are live.

## Success measure

The citation panel is re-run every two weeks with unchanged questions. Targets proposed by Claude, to be re-set after phase A:
- ecosystem group: ≥ 20% cited on ChatGPT and ≥ 10% on Claude and Gemini by mid-January
- entity group: ≥ 15% cited across engines

## Risks

- **Wrong facts about real companies.** Mitigation: every claim has a source, the review date is shown, correction and removal links are on every page, and nothing is inferred beyond the source.
- **"Announced" entries go stale.** Mitigation: `last_reviewed` is shown, and a monthly re-check script flags announced entries older than 90 days.
- **Thin pages for announced-only partners.** Mitigation: each still carries the announcement facts and sources. Pages with no source are not published.
- **Bundle and CPU limits.** Mitigation: entities live as a static asset read with `ASSETS.fetch` and are edge-cached; a page renders one entity.
