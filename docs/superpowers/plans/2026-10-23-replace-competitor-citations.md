# Take the citation spots builtonarc.app holds: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/ecosystem/` answers "is there an Arc directory" with sections and an FAQ, every directory/category table shows what each project does on Arc, a new `/arc/arc-vs-ethereum-vs-solana/` page compares stablecoin payments with live sourced figures, and the citation panel reports builtonarc.app's share per topic.

**Architecture:** Pure renderers in `builders-site/lib/` get data in and return HTML (Markdown copies come free via `withMarkdown`). A new collector `chain-compare.ts` reads three RPCs and DefiLlama independently under one deadline; the page is a fifth question page served and cached through `arc-routes.ts`. Static comparison facts join `src/data/arc-chain-facts.json`.

**Tech Stack:** TypeScript, Cloudflare Pages Functions (free plan, 10 ms CPU), vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-replace-competitor-citations-design.md`

## Global Constraints

- Plain labels, no slogans (owner CLAUDE.md); facts only as stated by their sources.
- Titles: directory "Every project building on Arc, Circle's blockchain · Registrai"; comparison "Arc vs Ethereum vs Solana for stablecoin payments · Registrai".
- `whatItDoes`: first sentence of the summary, ≤ 140 characters, cut on a word boundary with "…".
- Comparison: each source its own 8 s timeout inside one 10 s deadline; failed source → "Not available right now" in its cells; page always renders; edge cache 3600 s.
- RPCs: Arc via existing `RPCS`; Ethereum `https://ethereum-rpc.publicnode.com`; Solana `https://api.mainnet-beta.solana.com`; prices `https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:solana`; stablecoins by chain `https://stablecoins.llama.fi/stablecoins?includePrices=false` (USDC entry, `chainCirculating`).
- FAQ JSON-LD text byte-identical to the visible answers.
- `COMPETITORS = ["builtonarc.app"]`.

## Review Focus

1. A summary whose first "sentence" ends at "0.5 s", "v4.", "e.g." or a URL — `whatItDoes` must not cut there (Task 1 test).
2. One comparison source failing (e.g. Solana RPC 429) — only its cells and sentence part drop (Task 3 test).
3. No week data on `/ecosystem/` — the "Measured activity" section and FAQ answer 2 drop cleanly, FAQ JSON-LD has 3 items (Task 2 test).
4. Fee formulas: Arc gas price is in USDC-wei (18 decimals), Ethereum gas price in wei × ETH price, Solana 5,000 lamports = 5e-6 SOL × SOL price (Task 3 test with fixed numbers).
5. A live entry whose summary starts "Announced" — data test fails (Task 1).

---

### Task 1: `whatItDoes`, table column, summary fixes

**Files:** Modify `src/lib/arc-ecosystem.ts`, `builders-site/lib/ecosystem-pages.ts` (`table`), `src/data/arc-ecosystem/entities.json`, `corrections.json`; Test `src/lib/arc-ecosystem.test.ts`, `src/lib/arc-ecosystem-data.test.ts`, `builders-site/test/ecosystem-answers.test.ts`.

**Interfaces:** Produces `export function whatItDoes(e: Pick<ArcEntity, "summary">): string`; `table(l, opts?: { category?: boolean })`.

- [ ] **Step 1: Failing tests**
```ts
// src/lib/arc-ecosystem.test.ts
describe("whatItDoes", () => {
  const w = (summary: string) => whatItDoes({ summary });
  test("first sentence; abbreviations, versions, decimals and URLs don't end it", () => {
    expect(w("Decentralized exchange protocol and app. Uniswap v2, v3, v4 went live.")).toBe("Decentralized exchange protocol and app.");
    expect(w("Blocks every 0.5 s on Arc. More.")).toBe("Blocks every 0.5 s on Arc.");
    expect(w("Wallets, e.g. Rabby, on Arc. More.")).toBe("Wallets, e.g. Rabby, on Arc.");
    expect(w("Docs at docs.arc.io describe it. More.")).toBe("Docs at docs.arc.io describe it.");
    expect(w("No full stop here")).toBe("No full stop here");
  });
  test("cut at 140 characters on a word boundary with …", () => {
    const r = w(`${"word ".repeat(40)}end.`);
    expect(r.length).toBeLessThanOrEqual(141);
    expect(r.endsWith("…")).toBe(true);
    expect(r).not.toMatch(/\s…$/);
  });
});
// src/lib/arc-ecosystem-data.test.ts
test("no live entry's summary starts with 'Announced'", () => {
  expect(ECOSYSTEM.entities.filter((e) => e.status === "live" && /^Announced/.test(e.summary)).map((e) => e.slug)).toEqual([]);
});
// builders-site/test/ecosystem-answers.test.ts
test("tables show what each project does on Arc; category pages drop the Category column", async () => {
  const { renderCategory, renderDirectory } = await import("../lib/ecosystem-pages");
  const c = renderCategory(dexs, ALL, null);
  expect(c).toContain("<th>What it does on Arc</th>");
  expect(c).not.toContain("<th>Category</th>");
  expect(c).toContain("a summary.");
  expect(renderDirectory(ALL, null)).toContain("<th>What it does on Arc</th>");
});
```
- [ ] **Step 2: Run** `npx vitest run src/lib/arc-ecosystem.test.ts src/lib/arc-ecosystem-data.test.ts builders-site/test/ecosystem-answers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**
```ts
// src/lib/arc-ecosystem.ts
/** The summary's first sentence, ≤ 140 characters, for "What it does on Arc" (spec 2026-10-23-replace-competitor-citations §2). */
export function whatItDoes(e: Pick<ArcEntity, "summary">): string {
  const s = e.summary.trim();
  // a sentence ends at ". " followed by a capital letter, not after an abbreviation like "e.g." or "i.e."
  const m = /^(.+?(?<!\b(?:e\.g|i\.e|etc|vs|approx))\.)\s+(?=[A-Z])/.exec(s);
  const first = m ? m[1] : s;
  if (first.length <= 140) return first;
  return `${first.slice(0, 140).replace(/\s+\S*$/, "")}…`;
}
```
In `ecosystem-pages.ts` `table(l, { category = true } = {})`: header `Project | What it does on Arc | Status | Live since`; the project cell is `<a …>name</a>` plus, when `category`, `<br><span class="muted">${catName}</span>`; the new cell `esc(whatItDoes(e))`. `renderCategory` calls `table(l, { category: false })`.
- [ ] **Step 4: Summary data fix.** For the 18 entries moved to live on 2026-10-23 whose summary starts "Announced", write a review file `docs/ecosystem-review/2026-10-23-summaries.json` of `{ slug, field: "summary", ... }` items and apply with a `summary` setter: extend `ReviewItem.set` with `summary?: string` (≤ 280 chars, `SUMMARY_MAX`) in `src/lib/arc-ecosystem-review.ts` (test-first: an item with `set.summary` replaces the summary and logs field `summary`). New summary form: "{Kind} {name} supports Arc mainnet; Arc's launch post lists it among {exchanges that are live on Arc | wallets that work from day one} (16 September 2026)." — only what the evidence says. Apply with `npx tsx scripts/ecosystem-review.ts --file docs/ecosystem-review/2026-10-23-summaries.json --day 2026-10-23`.
- [ ] **Step 5: Run** all three test files plus `src/lib/arc-ecosystem-review.test.ts` — Expected: PASS. **Commit.**

### Task 2: `/ecosystem/` as the directory answer, with FAQ

**Files:** Modify `builders-site/lib/ecosystem-pages.ts` (`renderDirectory`), `builders-site/functions/ecosystem/[[path]].ts`; Test `builders-site/test/ecosystem-answers.test.ts`, `builders-site/test/ecosystem-memo.test.ts` (directory memo keyed by hour).

**Interfaces:** `renderDirectory(all: ArcEntity[], status: EntityStatus | null, week: ArcWeek | null = null): string`; `export function directoryFaq(all: ArcEntity[], week: ArcWeek | null): { q: string; a: string }[]`.

- [ ] **Step 1: Failing tests**
```ts
test("directory: question title, three sections, four FAQs mirrored in FAQPage JSON-LD; no week → three", async () => {
  const { renderDirectory, directoryFaq } = await import("../lib/ecosystem-pages");
  const wk = week([{ id: "domain:b.io", usd: 9 }]);
  const h = renderDirectory(ALL, null, wk);
  expect(h).toContain("<title>Every project building on Arc, Circle&#39;s blockchain · Registrai</title>");
  expect(h).toContain("<h1>Every project building on Arc</h1>");
  for (const s of ["What counts as on Arc", "How a status is decided", "Measured activity", "Questions"]) expect(h).toContain(`<h2>${s}</h2>`);
  const faq = directoryFaq(ALL, wk);
  expect(faq.map((f) => f.q)).toEqual(["How many projects are building on Arc?", "Which apps on Arc are used the most?", "Is the data free to use?", "How do I add or correct a project?"]);
  const ld = JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);
  const faqLd = (ld["@graph"] ?? [ld]).find((x: { "@type": string }) => x["@type"] === "FAQPage");
  expect(faqLd.mainEntity.map((m: { acceptedAnswer: { text: string } }) => m.acceptedAnswer.text)).toEqual(faq.map((f) => f.a));
  expect(directoryFaq(ALL, null)).toHaveLength(3);
  expect(renderDirectory(ALL, null, null)).not.toContain("<h2>Measured activity</h2>");
  expect(h.match(/4 projects/g)!.length).toBeLessThanOrEqual(2);   // the repeated muted count line is gone
});
```
Memo test: two different week hours on `/ecosystem/` re-render, same hour reuses (copy of the category test, path `/ecosystem/`, spy `renderDirectory`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** FAQ answers (plain text, no HTML, so JSON-LD and page match; the page renders them escaped inside `<dl><dt>q</dt><dd>a</dd></dl>`):
  1. `${n} projects: ${live} live on mainnet, ${deployed} deployed, ${announced} announced (reviewed ${latest}).`
  2. (week) `By stablecoin payments received over the last 7 days: ${A}, ${B} and ${C}. The full ranking is at https://builder.registrai.cc/arc/most-used-apps/.` — top 3 apps of the week matched to entities (any category), via the same matching as `categoryAnswer`.
  3. `Yes. The directory is CC BY 4.0: JSON at https://builder.registrai.cc/api/v1/ecosystem, an MCP server at https://builder.registrai.cc/api/mcp and a daily dataset at https://github.com/registrai-multichain/arc-ecosystem.`
  4. `Each project page has a correction form; accepted changes are listed with their sources at https://builder.registrai.cc/ecosystem/corrections/.`
  Sections: "What counts as on Arc" (today's `i` note text), "How a status is decided" (three `<li>`: live on mainnet = contracts, an index id, the project's own mainnet docs or an official Arc post saying it is live; deployed = contracts on Arc without live use; announced = an official announcement only; then "Launch dates come only from a source dated that day. <a href=/methodology/>Method</a>"), "Measured activity" (week only: `${m} of these projects are measured in Registrai's hourly index; the most used over the last 7 days are …` where m = entities with `index_ids`). JSON-LD: `{"@context":"https://schema.org","@graph":[DataCatalog, FAQPage]}`. Remove the muted counts paragraph; keep the status filters line. Function: directory uses the week and a memo `{hour, html}` per status key, like categories.
- [ ] **Step 4: Run** ecosystem tests + `builders-site/test/markdown-routes.test.ts` — PASS. **Commit.**

### Task 3: Arc vs Ethereum vs Solana page

**Files:** Create `builders-site/lib/chain-compare.ts`, `builders-site/test/chain-compare.test.ts`; Modify `src/data/arc-chain-facts.json` + `src/lib/arc-chain-facts.ts` (`comparison`), `builders-site/lib/arc-question-pages.ts` (`QUESTION_PAGES` + `renderCompare`), `builders-site/lib/arc-routes.ts`, `builders-site/lib/sitemap-urls.ts`, `builders-site/lib/llms-full.ts`, `builders-site/functions/llms.txt.ts`, `public/llms.txt`.

**Interfaces:**
```ts
export type ChainFigures = { block_time_s: number | null; fee_usd: number | null; usdc_supply: number | null };
export type Compare = { generated_at: string; arc: ChainFigures & { apps_paying: number | null }; ethereum: ChainFigures; solana: ChainFigures;
  prices: { eth: number | null; sol: number | null }; usdc_date: string | null; errors: string[] };
export async function collectCompare(env: Env, fetcher?: typeof fetch, now?: number): Promise<Compare>;
export function renderCompare(c: Compare | null): string;          // in arc-question-pages.ts
// arc-chain-facts.json gains: "comparison": [{ "id": "fee-currency" | "finality-arc" | "finality-ethereum" | "finality-solana", "text": string, "source": https, "date": YYYY-MM-DD }]
```

- [ ] **Step 1: Failing tests** (`chain-compare.test.ts`), with a fake fetch answering by URL/method:
  - Arc `eth_blockNumber`/`eth_getBlockByNumber` (two blocks 10,000 apart, 5,100 s → 0.51 s), `eth_gasPrice` `0x4a817c800` (20 gwei-equivalent → 20e9 × 21000 / 1e18 = 0.00042 USDC);
  - Ethereum the same methods (10,000 blocks over 120,000 s → 12 s), `eth_gasPrice` 1e9 wei → 1e9 × 65000 / 1e18 × ETH 2400 = $0.156;
  - Solana `getRecentPerformanceSamples` (numSlots 150, samplePeriodSecs 60 → 0.4 s); fee 5000e-9 SOL × 100 = $0.0005;
  - prices `{coins:{"coingecko:ethereum":{price:2400},"coingecko:solana":{price:100}}}`; stablecoins `{peggedAssets:[{symbol:"USDC", chainCirculating:{Arc:{current:{peggedUSD:8e8}},Ethereum:{current:{peggedUSD:4e10}},Solana:{current:{peggedUSD:9e9}}}}]}`.
  Assertions: the figures above (fee_usd to 6 decimals), `errors` empty; with Solana RPC throwing: `solana.block_time_s` and `solana.fee_usd` null, others intact, errors name "solana"; with prices down: ethereum/solana `fee_usd` null, arc fee intact (USDC needs no price).
  `renderCompare`: title/H1, the five rows (Fee currency, Block time, Finality, Fee for a USDC transfer (estimate), USDC in circulation), each fee cell's `i` note with its formula, "Not available right now" for a null figure, opening sentence drops the Solana part when Solana is null; `renderCompare(null)` renders static rows and "Not available right now" for live ones.
- [ ] **Step 2: Run** `npx vitest run builders-site/test/chain-compare.test.ts` — FAIL.
- [ ] **Step 3: Implement** `collectCompare` with the existing `caught`-style deadline wrapper (copy the pattern from `collectArcNumbers`: `Promise.race` with a deadline per call, errors pushed as `${label}: ${message}`), one JSON-RPC helper taking a URL, `blockTime(url)` = (ts(head) − ts(head−10000)) / 10000, Solana `getRecentPerformanceSamples [5]` → Σ samplePeriodSecs / Σ numSlots, fees as in the formulas above, `apps_paying` = AEI members with USDC payments in the last 24 h from `indexFile(env,"aei")` (`projects.filter(p => (p.pay_24h ?? 0) > 0).length`). Facts file: add `comparison` (research the four sentences from arc.io/docs, ethereum.org, solana.com docs; validator: same rules as `facts`). `renderCompare` uses `shell()`-like layout: opening sentence, table `Measure | Arc | Ethereum | Solana | Source`, a muted sources line, `Dataset` JSON-LD. Add `{ path: "/arc/arc-vs-ethereum-vs-solana/", title: "Arc vs Ethereum vs Solana for stablecoin payments" }` to `QUESTION_PAGES`; `ARC_QUESTIONS["arc-vs-ethereum-vs-solana"] = async (env) => renderCompare(await collectCompare(env).catch(() => null))` with 3600 s cache (add a per-question TTL map in `arc-routes.ts`); sitemap, both `llms.txt`, and `llms-full.ts` question list.
- [ ] **Step 4: Run** the new test, `arc-question-pages`, `llms-full`, sitemap and markdown-route tests — PASS. Check the live sources once with a throwaway `npx tsx` script calling `collectCompare` (figures plausible, no errors). **Commit.**

### Task 4: Competitor share in the citation panel

**Files:** Modify `src/lib/citation-panel.ts`; Test `src/lib/citation-panel.test.ts`.

**Interfaces:** `export const COMPETITORS = ["builtonarc.app"] as const`; `topicGaps(...)[i].competitors: Record<string, number>` (pct); summary gains a column per competitor and a "Competitors" section.

- [ ] **Step 1: Failing test:** records in group ecosystem citing `builtonarc.app` in 1 of 2 answers (one also citing builder.registrai.cc) → `topicGaps` ecosystem `competitors["builtonarc.app"] === 50`; `renderSummary` contains `| builtonarc.app |` header in the topic table and "builtonarc.app: cited in 1 answers (openai 1); with Registrai also cited: 0".
- [ ] **Step 2–4:** implement, run `npx vitest run src/lib/citation-panel.test.ts`, re-score the baseline (`npx tsx scripts/citation-panel.ts --from docs/citation-panel/2026-10-19-runs.jsonl`) and check builtonarc.app shows 5 answers. **Commit.**

---

## After the tasks

Full suite, typecheck, lint; review package; fresh opus reviewer; one fix pass; preview from `.worktrees/abi-deploy` (branch `compare`); check `/ecosystem/`, `/ecosystem/dexs/`, `/arc/arc-vs-ethereum-vs-solana/` (+ `index.md`), `/llms-full.txt`; production on the owner's OK; IndexNow for the changed URLs.
