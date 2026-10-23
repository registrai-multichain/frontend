# AI-search gaps: /arc/ in sentences, correct directory dates, category answers: design

**Date:** 2026-10-23. **Status:** design approved in chat 2026-10-23 (owner: "go all 3", then "a" = no chain-wide active
wallets in this build); written spec awaiting review.

**Source:** the gap audit `docs/citation-panel/2026-10-23-gap-audit.md` (items 1–3 of "What to change"; item 6 in part).

## Purpose

For the chain, directory and data questions in the citation panel, a page of ours states the answer in one dated
sentence with its source, and no date or status on our pages contradicts Circle or arc.io without newer evidence.

**Success:**
- `/arc/` answers c01–c03, c05–c07, v02, v03, d01–d03 in a sentence each (audit step 8).
- No directory entry shows the index's first-seen date as its launch date.
- Every `/ecosystem/` page names "Arc, Circle's blockchain" in its title or description, and every category page opens
  with a one-line answer.
- The 24 Oct citation re-run is the "before"; the next re-run measures the change.

**Out of scope** (audit items 4, 5, 7–10): entity page fills (Tolly roles, Peach, Argus, Arclight name), data product
opening sentences, the accept-USDC reframing, `/arc/new/` 30-day window, third-party listings, md 404s on
`/builders-index/`, `/data-api/`, `/apps/`. Chain-wide active wallets (needs a full-day scan; owner chose not now).

## 1. `/arc/` answers in sentences

### Chain facts file

`src/data/arc-chain-facts.json`, validated by `src/lib/arc-chain-facts.ts` (`validateChainFacts`), checked in CI by a test.

```json
{
  "reviewed": "2026-10-23",
  "facts": [
    { "id": "mainnet", "text": "Arc mainnet launched on 16 September 2026.", "source": "https://www.arc.io/pressroom/…", "date": "2026-09-16" },
    …
  ],
  "network": { "rpc_url": "https://rpc.mainnet.arc.io", "rpc_source": "https://docs.arc.io/…", "explorer_url": "https://explorer.arc.io", "explorer_source": "…" },
  "stablecoins": [
    { "symbol": "USDC", "name": "USD Coin", "issuer": "Circle", "address": "0x3600…", "decimals": 6, "source": "https://…" },
    …
  ]
}
```

- **Facts** (each one sentence, ≤ 200 characters, one https source, a date): mainnet date; USDC as gas, with 18 decimals as
  the native gas balance and 6 as the ERC-20; EVM compatible; validators (11 founding validators plus Circle,
  proof-of-authority, a move to proof-of-stake planned for 2027, as Circle states it); the ARC token (minted at genesis,
  not launched; fees stay in USDC). Every sentence states what the source says, no more. A fact without a source that
  says it is left out.
- **Stablecoins:** the tokens Circle and arc.io list as available on Arc, each with its contract address on Arc mainnet
  and the source that gives that address (Arc docs, the asset portal or the issuer). A token whose Arc address we cannot
  source is listed without an address and without a supply ("Address not published").
- **Validation:** https sources, `YYYY-MM-DD` dates, unique ids and symbols, addresses `0x` + 40 hex, decimals 0–36.

### New figures in the collector (`builders-site/lib/arc-numbers.ts`)

`ArcNumbers` gains (all additive; existing fields unchanged):
- `network.rpc_url`, `network.explorer_url` (from the facts file).
- `stablecoins.tokens: { symbol, issuer, address | null, supply | null }[]`: `totalSupply` of every listed token with an
  address, in one batched RPC call, divided by its `decimals`. A failed call leaves `supply: null` for that token and adds
  one line to `errors`.
- `activity_24h.transactions_est: number | null` and `activity_24h.tx_sample: { blocks: number; from_block: number;
  to_block: number } | null`: 240 blocks evenly spaced over the last 24 h (`86400 / block_time_s` blocks back from the
  head), `eth_getBlockTransactionCountByNumber` in three batches of 80 on the Blockdaemon RPC only (its batch limit is
  100; the public RPC rate-limits batches above ~30, so it is not a fallback for the sample: Blockdaemon down → null). Estimate = mean count per sampled block × blocks in 24 h, rounded to the nearest
  1,000. Null when `block_time_s` is null or fewer than 200 samples answer.

**Checked 2026-10-23:** a 240-block sample of one hour estimated 21,150 transactions against an exact count of 20,282
(+4%); 240 samples over 24 h estimated ~340,000/day. Third-party pages quoted 1.1–1.5M/day in late September; the page
states our figure with its method and date, nothing else.

**Cost:** two RPC requests more per collection (≈ 15 KB). The collection runs at most every 10 min (`/arc/` edge cache)
plus the daily snapshot.

### Page (`builders-site/lib/arc-pages.ts`)

- **Opening:** `# Arc in numbers`, then a "Facts" section: the facts file's sentences as a list, each ending with a
  source link and its date, followed by live sentences built from the collector:
  - "Arc held {usdc} USDC on {date, time} UTC." (source: Arc RPC)
  - "TVL on Arc was {usd} on {date}." (source: DefiLlama)
  - "About {n} transactions in the last 24 h, estimated from 240 sampled blocks." (source: Arc RPC, `i` note with the
    block range)
  - "Apps tracked by Registrai received {usd} in stablecoin payments in the last 24 h." (existing figure)

  A null figure drops its sentence (the table below still shows "Not available right now").
- **Network table:** adds "RPC" and "Explorer" rows with their sources.
- **"Stablecoins on Arc" table:** Token, Issuer, Contract (explorer link), Supply on Arc, Source. The existing USDC/EURC
  supply rows move into it; the DefiLlama "All stablecoins" and TVL rows stay below it.
- **Activity table:** adds "Transactions (estimate)".
- **History table:** adds "Transactions, 24 h (est.)" (older snapshots without it show "–").
- `/arc/index.md` and `/llms-full.txt` pick all of this up through the existing converter.

### API

`/api/v1/arc` and `/api/v1/arc/daily` carry the new fields. Fixtures `arc.json`, `arc-now.json` and `arc-daily.json`
gain them; the OpenAPI marks `supply`, `address`, `transactions_est` and `tx_sample` nullable. MCP `arc_numbers` returns
them through the API.

## 2. Directory launch dates and statuses

### Code

- `src/lib/arc-ecosystem-seed.ts`: delete the fallback `c.first_live ??= m.first_hour.slice(0, 10)`. An index member
  raises the status to live but never sets a date.
- The directory table header stays "Live since"; an entry without `first_live` shows "–".
- `src/lib/arc-ecosystem-corrections.ts`: `from` accepts `"review"` (Registrai's own review) besides `"project"` and
  `"reader"`; the corrections log shows it as "Registrai review".
- A test: no entity's `first_live` equals the `first_hour` date of its index member unless a source dated that day is
  in its `status_evidence` or `sources`.

### Data (`src/data/arc-ecosystem/entities.json` + `corrections.json`)

- **Dates:** every live entry whose `first_live` is 2026-10-10 or 2026-10-11 (38) and every live entry without one (35)
  is reviewed. `first_live` is set only from a source that states or shows the launch date: the project's announcement,
  an official Arc/Circle post naming it live at launch, or the deploy date of its first mainnet contract on the
  explorer. The source is added to `status_evidence`. No source → no date.
- **Statuses:** exchanges and wallets are re-checked against arc.io's 16 Sep post and Circle's mainnet press release. An
  entry the official post states "are live on Arc" / "work from day one" becomes live with that post as evidence and
  `first_live` 2026-09-16. "Coming soon" stays announced.
- **Validators:** BlackRock and SBI Group are tagged `validators` (BlackRock keeps `asset-managers` as its category),
  with the 5 Aug validator cohort post as evidence.
- **Categories:** entries in DEXs or Lending that are neither are re-categorised (audit: Fluid, Mercurifi, Symbiosis,
  ArcTools, Aster in DEXs; Galaxy, KPK, SolonPad, Kaleido in Lending), each to the category its own site supports.
- **Every change** gets a corrections entry: `from: "review"`, the field (`dates`, `status`, `category`), a ≤ 200-character
  change line ("Live since 2026-09-16, from the Arc mainnet launch post", "Announced → Live on mainnet") and the source.
  `last_reviewed` becomes the review day.

## 3. Category pages answer the question and name Circle's Arc

`builders-site/lib/ecosystem-pages.ts`:
- **Titles:** category `"{label}, Circle's blockchain · Registrai"` ("DEXs on Arc, Circle's blockchain · Registrai");
  entity `"{name} on Arc, Circle's blockchain · Registrai"`; directory `"Arc ecosystem: projects on Circle's blockchain ·
  Registrai"`.
- **Descriptions:** category `"{label}, the blockchain by Circle: {n} listed, {live} live on mainnet, with status and
  sources."`; directory likewise; entity descriptions stay the summary.
- **One-line answer** under each category h1 (the existing count line is replaced):
  "{n} {name, lower-case} listed on Arc, Circle's blockchain: {live} live on mainnet, {deployed} deployed,
  {announced} announced." Then, when the 7-day app data (`loadArcWeek`) has apps of this category with payments: "Most
  used over the last 7 days, by stablecoin payments received: A, B and C." (up to 3, entity links, matched through
  `index_ids`). No measured apps → no second sentence. Plural and singular forms are correct (1 listed).
- **Directory opening:** "Registrai's Arc ecosystem directory lists {n} projects on Circle's Arc blockchain with their
  status and evidence: {live} live on mainnet, {deployed} deployed, {announced} announced."
- `functions/ecosystem/[[path]].ts` passes the week (or null on failure) to `renderCategory`; the page stays
  edge-cached as now.

## Files

- **New:** `src/data/arc-chain-facts.json`, `src/lib/arc-chain-facts.ts`, tests `src/lib/arc-chain-facts.test.ts`,
  `builders-site/test/arc-facts-page.test.ts`, `builders-site/test/arc-tx-sample.test.ts`,
  `builders-site/test/ecosystem-answers.test.ts`.
- **Changed:** `builders-site/lib/arc-numbers.ts`, `arc-pages.ts`, `ecosystem-pages.ts`,
  `functions/ecosystem/[[path]].ts`; `src/lib/arc-ecosystem-seed.ts`, `arc-ecosystem-corrections.ts`,
  `builders-site/lib/corrections-pages.ts`; `src/data/arc-ecosystem/entities.json`, `corrections.json`; fixtures and
  `src/lib/data-api-openapi.ts`.

## Review focus

1. **A wrong fact is worse than none:** every sentence in the facts file and every new date or status traces to a source
   that says exactly that; a reviewer opens a sample of them.
2. **Partial RPC failure:** some token supplies or tx samples fail → their cells show "Not available right now", the
   sentence drops, the page still renders, `errors` names the source.
3. **Rate limits:** the three tx batches and the supply batch stay within Blockdaemon's 100-per-batch limit; the supply
   batch (≤ 25 calls) may fall back to the public RPC, the tx sample never does.
4. **Old snapshots:** `/api/v1/arc/daily` and the history table read snapshots without the new fields.
5. **CPU:** the collector's extra parsing stays small (≈ 15 KB JSON) on the free plan's 10 ms.
