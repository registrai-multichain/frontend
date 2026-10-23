# Take the citation spots builtonarc.app holds: design

**Date:** 2026-10-23. **Status:** design approved in chat 2026-10-23 (owner: "Go"); written spec awaiting review.

## Purpose

In the 19 Oct citation baseline, builtonarc.app (an independent Arc directory, a direct competitor) was cited 5 times,
all by OpenAI, from 4 pages:
- `/guides/every-project-building-on-arc` for e11 ("Is there an Arc ecosystem directory or list of dapps?"), 2×
- `/category/exchanges-trading/dexs` and `/project/fluid` for e03 ("Which DEXs are on Arc?"), 2×
- `/guides/arc-vs-solana-for-payments` for c04 ("How is Arc different from Ethereum and Solana for payments?"), 1×

One of its pages was also in Claude's search results; none of ours were (Brave indexes them, not us yet). Their pages win
on form: a title phrased like the question, an opening definition, short sections, a "Questions" block, and a one-line
"what it builds on Arc" for every project.

**Success:**
- For e11, e03 and c04 we have a page whose title, first sentence and structure answer the question as asked, with
  data they don't have.
- The panel reports builtonarc.app's share per topic beside ours, so re-runs show whether we replace it.

**Out of scope:** paying for a listing there; other competitors; Brave indexing (separate, ongoing).

## 1. `/ecosystem/` answers "Is there an Arc ecosystem directory?"

`renderDirectory` (`builders-site/lib/ecosystem-pages.ts`):
- **Title:** "Every project building on Arc, Circle's blockchain · Registrai". **H1:** "Every project building on Arc".
- **Opening sentence** (exists): "Registrai's Arc ecosystem directory lists {n} projects on Circle's Arc blockchain with
  their status and evidence: …". The muted count line under it is removed (it repeats the sentence; review minor).
- **Three short sections** after the opening, plain text, each 1–3 sentences, built from data:
  - "What counts as on Arc": contracts on Arc mainnet, a live integration, or an official announcement; each status
    links to its evidence. (The text of today's `i` note, promoted.)
  - "How a status is decided": live on mainnet / deployed / announced, with one line each, and "launch dates come only
    from a source dated that day" with a link to `/methodology/`.
  - "Measured activity": "{m} of these apps are measured in Registrai's hourly index; the most used over the last
    7 days are A, B and C" (from `loadArcWeek`, as on category pages; omitted when the week is unavailable).
- **"Questions" block** (`<h2>Questions</h2>`, `<dl>` so the Markdown copy keeps `**Q**: A`), four questions with
  answers computed from the data:
  1. "How many projects are building on Arc?" → "{n} projects: {live} live on mainnet, {deployed} deployed,
     {announced} announced (reviewed {date})."
  2. "Which apps on Arc are used the most?" → the top 3 by 7-day stablecoin payments received, linking
     `/arc/most-used-apps/` (omitted with no week data).
  3. "Is the data free to use?" → "Yes, CC BY 4.0, as JSON at /api/v1/ecosystem, an MCP server and a daily dataset on
     GitHub."
  4. "How do I add or correct a project?" → the corrections form on each project page and the public log.
- **JSON-LD:** keep `DataCatalog`; add a `FAQPage` with the same four Q&As (text identical to the page).
- The directory function passes the week to `renderDirectory` (as for categories); the per-isolate memo is keyed by the
  week's hour, one entry per status filter (same pattern as category pages).

## 2. A "what it does on Arc" line per project

- New pure helper `whatItDoes(e: ArcEntity): string` in `src/lib/arc-ecosystem.ts`: the summary's first sentence
  (split on ". " followed by a capital letter, keeping abbreviations like "v4" intact), cut at 140 characters on a word
  boundary with "…".
- Directory and category tables: columns **Project | What it does on Arc | Status | Live since** (the Category column
  moves out of category pages, where it is redundant; it stays on the directory table as a muted second line under
  the project name).
- `/llms-full.txt` project lines already carry the summary; unchanged.
- **Data fix:** the 18 entries moved to live on 23 Oct whose summaries still begin "Announced as …" get summaries that
  state what they are and that they are live on Arc, from the same sources (corrections log, `from: "review"`, field
  `summary`). A test fails any live entry whose summary starts with "Announced".

## 3. `/arc/arc-vs-ethereum-vs-solana/`: stablecoin payments compared

A new question page under the `/arc/` function (same shell as the other question pages, edge-cached 1 h, Markdown
copy, in `QUESTION_PAGES`, the sitemap, `llms.txt` and `/llms-full.txt`).

- **Title / H1:** "Arc vs Ethereum vs Solana for stablecoin payments".
- **Opening sentence:** "Arc, Circle's layer-1, uses USDC as its gas token, so a USDC payment costs USDC and settles
  in {arc_block}s blocks with deterministic finality; Ethereum and Solana charge fees in ETH and SOL." (Only facts the
  page's sources state; live figures filled in, sentence dropped piece by piece when a figure is missing.)
- **Table** (one row per measure, columns Arc | Ethereum | Solana | Source):
  - Fee currency: USDC | ETH | SOL — static, sourced (chain docs).
  - Measured block / slot time, last 10,000 blocks (Arc, Ethereum) and last 10,000 slots (Solana, `getRecentPerformanceSamples`)
    — live RPC.
  - Finality — static, sourced from each chain's docs (Arc: deterministic, sub-second; Ethereum: finalized after 2
    epochs; Solana: per its docs).
  - Fee for a USDC transfer, in USD — live: Arc `eth_gasPrice` × 21,000 × 1e-18 USDC (native transfer; the ERC-20
    path is noted); Ethereum `eth_gasPrice` × 65,000 gas × ETH price; Solana base fee 5,000 lamports per signature ×
    SOL price (priority fees excluded, stated). Prices from DefiLlama `coins.llama.fi/prices/current`. Each cell says
    "estimate" with the formula behind an `i` note.
  - USDC in circulation on each chain — DefiLlama stablecoins by chain (one call), with date.
  - Apps measured paying in USDC (Arc only, from our index) — "Not measured by Registrai" for the others.
- **Sources line** and a `Dataset` JSON-LD, like the other question pages.
- **Failure:** each live source is independent with its own timeout (8 s) inside one 10 s deadline; a failed source
  shows "Not available right now" in its cells and drops its part of the opening sentence; the page always renders.
- **RPCs:** Arc via the existing Blockdaemon/public pair; Ethereum `https://ethereum-rpc.publicnode.com`; Solana
  `https://api.mainnet-beta.solana.com`. Static facts live in `src/data/arc-chain-facts.json` under a new
  `comparison` key, validated like the other facts (https source and date for each).

## 4. The competitor in the citation panel

`src/lib/citation-panel.ts`:
- `COMPETITORS = ["builtonarc.app"]`.
- The "Topic gaps" table gains one column per competitor: the share of the topic's answers citing it, beside
  "Registrai cited".
- A new "Competitors" line per engine: answers citing each competitor, and how many of those answers also cite
  Registrai.
- Re-scoring the baseline shows builtonarc.app at its 19 Oct values.

## Files

- **Changed:** `builders-site/lib/ecosystem-pages.ts`, `builders-site/functions/ecosystem/[[path]].ts`,
  `src/lib/arc-ecosystem.ts`, `src/data/arc-ecosystem/entities.json`, `corrections.json`,
  `builders-site/lib/arc-question-pages.ts`, `builders-site/functions/arc/[[path]].ts` (via `arc-routes.ts`),
  `src/data/arc-chain-facts.json`, `src/lib/arc-chain-facts.ts`, `builders-site/lib/llms-full.ts`, both `llms.txt`,
  the sitemap, `src/lib/citation-panel.ts`.
- **New:** `builders-site/lib/chain-compare.ts` (collector), tests for each part.

## Review focus

1. Every comparison figure is labelled as measured or estimated, with its formula and date; no claim beyond the sources.
2. Any of the 6 external sources failing (3 RPCs, 2 DefiLlama endpoints, our index) → the page still renders, only
   that cell and sentence part drop.
3. Free-plan CPU: the comparison page is built at most once an hour per colo; parsing stays small.
4. `whatItDoes` on odd summaries (decimals like "0.5 s", "v4", "e.g.", URLs, no full stop).
5. FAQ text in JSON-LD is byte-identical to the visible answers.
