# AI-search gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/arc/` answers chain questions in dated, sourced sentences (with a stablecoin table and a sampled daily-transactions figure); directory launch dates and statuses come only from sources; every `/ecosystem/` page names "Arc, Circle's blockchain" and category pages open with a one-line answer.

**Architecture:** A reviewed data file (`src/data/arc-chain-facts.json`) holds static chain facts, RPC/explorer and the stablecoin list; the existing collector (`arc-numbers.ts`) adds two batched RPC reads (token supplies, a 240-block transaction sample); `renderArc` turns facts plus live figures into sentences. Directory data changes go through a reviewable JSON file applied by a small pure function that also writes corrections-log entries (`from: "review"`). Category pages take the 7-day app data to name the most used apps.

**Tech Stack:** TypeScript, Cloudflare Pages Functions (free plan, 10 ms CPU), vitest, the Arc JSON-RPC (Blockdaemon + public), D1 snapshots.

**Spec:** `docs/superpowers/specs/2026-10-23-ai-search-gaps-design.md`

## Global Constraints

- Every fact sentence, date and status change traces to an https source that says exactly that; no source → leave it out.
- Fact sentences ≤ 200 characters; correction `change` lines 5–200 characters.
- Tx sample: 240 blocks, three batches of 80, Blockdaemon RPC only (`https://rpc.blockdaemon.mainnet.arc.io`, batch limit 100); null when Blockdaemon fails, `block_time_s` is null or fewer than 200 samples answer; estimate rounded to the nearest 1,000.
- Token supply batch ≤ 25 calls, Blockdaemon first, public RPC (`https://rpc.mainnet.arc.io`) as fallback.
- `ArcNumbers` changes are additive only; old snapshots without new fields must still render and serve.
- Copy: plain labels, no slogans (owner CLAUDE.md). Titles: `"{label}, Circle's blockchain · Registrai"`.
- `first_live` is set only when a `status_evidence` or `sources` item has `date === first_live`.
- Never write to `/Users/tobiasd/Desktop/arc/frontend`, never touch `research/`. Deploys only from `.worktrees/abi-deploy`; production only on the owner's OK.

## Review Focus

1. **A sourced claim that its source doesn't make** (a fact sentence, launch date or "live" status) — a reader expects every claim to be checkable; Task 5's test pins date↔source, the reviewer samples sources.
2. **Some RPC calls in a batch fail or are rate-limited** (`{"error":{"code":-32005}}` items) — the page shows the other tokens' supplies and drops only the failed sentence; Task 2 tests a batch with error items.
3. **An old daily snapshot without the new fields** — `/arc/` history and `/api/v1/arc/daily` still render; Task 3 tests a history row without `transactions_est`.
4. **A category with no measured apps or one project** — the answer line reads correctly ("1 project listed", no "Most used" sentence); Task 6 tests both.
5. **The week loader failing on a category page** — the page renders with the count sentence only; Task 6 tests `week = null`.

---

### Task 1: Chain facts file and validator

**Files:**
- Create: `src/lib/arc-chain-facts.ts`, `src/data/arc-chain-facts.json`, `src/lib/arc-chain-facts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChainFact = { id: string; text: string; source: string; date: string };
  export type StableToken = { symbol: string; name: string; issuer: string; address: string | null; decimals: number; source: string };
  export type ChainFacts = { reviewed: string; facts: ChainFact[];
    network: { rpc_url: string; rpc_source: string; explorer_url: string; explorer_source: string }; stablecoins: StableToken[] };
  export function validateChainFacts(x: unknown): { ok: true; facts: ChainFacts } | { ok: false; errors: string[] };
  export const CHAIN_FACTS: ChainFacts;   // the validated file; throws at import if invalid
  ```

- [ ] **Step 1: Write the failing test** (`src/lib/arc-chain-facts.test.ts`)

```ts
import { describe, expect, test } from "vitest";
import raw from "../data/arc-chain-facts.json";
import { validateChainFacts } from "./arc-chain-facts";

const good = {
  reviewed: "2026-10-23",
  facts: [{ id: "mainnet", text: "Arc mainnet launched on 16 September 2026.", source: "https://www.arc.io/x", date: "2026-09-16" }],
  network: { rpc_url: "https://rpc.mainnet.arc.io", rpc_source: "https://docs.arc.io/a", explorer_url: "https://explorer.arc.io", explorer_source: "https://docs.arc.io/b" },
  stablecoins: [{ symbol: "USDC", name: "USD Coin", issuer: "Circle", address: "0x3600000000000000000000000000000000000000", decimals: 6, source: "https://docs.arc.io/c" },
    { symbol: "XYZ", name: "X", issuer: "Y", address: null, decimals: 6, source: "https://www.arc.io/x" }],
};

describe("chain facts", () => {
  test("a good file passes", () => expect(validateChainFacts(good).ok).toBe(true));
  test("rejects http sources, bad dates, long sentences, duplicate ids and symbols, bad addresses and decimals", () => {
    const bad = structuredClone(good) as typeof good;
    bad.facts.push({ id: "mainnet", text: "x".repeat(201), source: "http://a.b/", date: "16 Sep" });
    bad.stablecoins.push({ symbol: "USDC", name: "", issuer: "", address: "0x12", decimals: 99, source: "ftp://x" });
    const r = validateChainFacts(bad);
    expect(r.ok).toBe(false);
    const errs = (r as { errors: string[] }).errors.join("\n");
    for (const m of ["duplicate id", "200 characters", "https", "YYYY-MM-DD", "duplicate symbol", "address", "decimals"]) expect(errs).toContain(m);
  });
  test("the published file is valid, has the five required facts, USDC and EURC with addresses", () => {
    const r = validateChainFacts(raw);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const f = (r as { facts: { facts: { id: string }[]; stablecoins: { symbol: string; address: string | null }[] } }).facts;
    expect(f.facts.map((x) => x.id)).toEqual(expect.arrayContaining(["mainnet", "gas", "evm", "validators", "token"]));
    for (const s of ["USDC", "EURC"]) expect(f.stablecoins.find((t) => t.symbol === s)?.address).toMatch(/^0x[0-9a-f]{40}$/);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/lib/arc-chain-facts.test.ts` — Expected: FAIL (module/file not found).

- [ ] **Step 3: Implement the validator** (`src/lib/arc-chain-facts.ts`)

```ts
/** Static, sourced facts about the Arc chain for /arc/ (spec 2026-10-23-ai-search-gaps-design.md §1). Every sentence states what its source says. */
import raw from "../data/arc-chain-facts.json";

export type ChainFact = { id: string; text: string; source: string; date: string };
export type StableToken = { symbol: string; name: string; issuer: string; address: string | null; decimals: number; source: string };
export type ChainFacts = { reviewed: string; facts: ChainFact[];
  network: { rpc_url: string; rpc_source: string; explorer_url: string; explorer_source: string }; stablecoins: StableToken[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/, ADDR = /^0x[0-9a-f]{40}$/;
const https = (u: unknown) => { if (typeof u !== "string") return false; try { const x = new URL(u); return x.protocol === "https:" && !x.username; } catch { return false; } };
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export function validateChainFacts(x: unknown): { ok: true; facts: ChainFacts } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const f = (x ?? {}) as Partial<ChainFacts>;
  if (typeof f.reviewed !== "string" || !DAY.test(f.reviewed)) errors.push("reviewed must be YYYY-MM-DD");
  const ids = new Set<string>();
  for (const [i, c] of (Array.isArray(f.facts) ? f.facts : []).entries()) {
    const e = (m: string) => errors.push(`fact #${i} ${c?.id ?? "?"}: ${m}`);
    if (!str(c?.id)) e("id is required"); else if (ids.has(c.id)) e("duplicate id"); else ids.add(c.id);
    if (!str(c?.text) || c.text.length > 200) e("text must be 1-200 characters");
    if (!https(c?.source)) e("source must be an https URL");
    if (typeof c?.date !== "string" || !DAY.test(c.date)) e("date must be YYYY-MM-DD");
  }
  if (!Array.isArray(f.facts) || !f.facts.length) errors.push("facts are required");
  const n = f.network;
  if (!n || !https(n.rpc_url) || !https(n.rpc_source) || !https(n.explorer_url) || !https(n.explorer_source)) errors.push("network: rpc_url, rpc_source, explorer_url, explorer_source must be https URLs");
  const syms = new Set<string>();
  for (const [i, t] of (Array.isArray(f.stablecoins) ? f.stablecoins : []).entries()) {
    const e = (m: string) => errors.push(`stablecoin #${i} ${t?.symbol ?? "?"}: ${m}`);
    if (!str(t?.symbol)) e("symbol is required"); else if (syms.has(t.symbol)) e("duplicate symbol"); else syms.add(t.symbol);
    if (!str(t?.name) || !str(t?.issuer)) e("name and issuer are required");
    if (t?.address !== null && (typeof t?.address !== "string" || !ADDR.test(t.address))) e("address must be null or 0x + 40 lower-case hex");
    if (!Number.isInteger(t?.decimals) || t.decimals < 0 || t.decimals > 36) e("decimals must be 0-36");
    if (!https(t?.source)) e("source must be an https URL");
  }
  return errors.length ? { ok: false, errors } : { ok: true, facts: f as ChainFacts };
}

const checked = validateChainFacts(raw);
if (!checked.ok) throw new Error(`arc-chain-facts.json is invalid:\n${checked.errors.join("\n")}`);
export const CHAIN_FACTS: ChainFacts = checked.facts;
```

- [ ] **Step 4: Research and write the data file** (`src/data/arc-chain-facts.json`). Dispatch one research agent (general-purpose, read-only web) with this brief: "For Arc mainnet (Circle's L1, chain 5042), find from official sources (arc.io, docs.arc.io, circle.com, the Arc asset portal, issuer pages): (1) one sentence each, quoting only what the source says, with the source URL and its date, for ids `mainnet` (launch date), `gas` (USDC is the gas token; native balance 18 decimals vs the ERC-20 interface 6 decimals), `evm` (EVM compatibility, hard fork if stated), `validators` (founding validators count + names source, Circle, consensus type, PoS plan and year as stated), `token` (the ARC token status as stated by Circle); (2) the official RPC URL and explorer URL with the doc pages stating them; (3) every stablecoin Circle/arc.io list as available on Arc with issuer, Arc mainnet contract address (lower-case) and decimals, each with the URL that states the address; a token whose address no source states gets `address: null`. Return JSON in the ChainFacts shape plus a note per item if anything was uncertain. Never guess an address." Verify 3 random addresses yourself with `eth_call` `decimals()` (`0x313ce567`) on `https://rpc.mainnet.arc.io`; drop any that fail. USDC is `0x3600000000000000000000000000000000000000` (decimals 6), EURC `0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1` (as in `arc-numbers.ts`).

- [ ] **Step 5: Run it** — `npx vitest run src/lib/arc-chain-facts.test.ts` — Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add src/lib/arc-chain-facts.ts src/lib/arc-chain-facts.test.ts src/data/arc-chain-facts.json
git commit -m "arc: sourced chain facts file (facts, RPC/explorer, stablecoins) with validator"
```

### Task 2: Collector — token supplies, network links, transaction sample

**Files:**
- Modify: `builders-site/lib/arc-numbers.ts`
- Test: `builders-site/test/arc-tx-sample.test.ts`; update `builders-site/test/arc-numbers.test.ts` (fake fetch learns batches)

**Interfaces:**
- Consumes: `CHAIN_FACTS` (Task 1).
- Produces (exported from `arc-numbers.ts`):
  ```ts
  export const RPC_BLOCKDAEMON = "https://rpc.blockdaemon.mainnet.arc.io";
  export async function rpcBatch(fetcher: Fetcher, url: string, calls: { method: string; params: unknown[] }[]): Promise<(unknown | null)[]>;  // per-call result or null (error item / missing)
  export async function sampleTransactions(fetcher: Fetcher, head: number, blockTimeS: number): Promise<{ estimate: number; blocks: number; from_block: number; to_block: number } | null>;
  export async function tokenSupplies(fetcher: Fetcher, tokens: { address: string | null; decimals: number }[]): Promise<(number | null)[]>;
  // ArcNumbers additions:
  network.rpc_url: string; network.explorer_url: string;
  stablecoins.tokens: { symbol: string; issuer: string; address: string | null; supply: number | null }[];
  activity_24h.transactions_est: number | null; activity_24h.tx_sample: { blocks: number; from_block: number; to_block: number } | null;
  ```

- [ ] **Step 1: Write the failing test** (`builders-site/test/arc-tx-sample.test.ts`)

```ts
import { describe, expect, test, vi } from "vitest";

const batchFetch = (handler: (call: { method: string; params: unknown[] }, url: string) => unknown) =>
  vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }[] | { id: number; method: string; params: unknown[] };
    const one = (c: { id: number; method: string; params: unknown[] }) => { const r = handler(c, String(url)); return r instanceof Error ? { jsonrpc: "2.0", id: c.id, error: { code: -32005, message: r.message } } : { jsonrpc: "2.0", id: c.id, result: r }; };
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)));
  });

describe("transaction sample", () => {
  test("240 blocks over 24 h in three Blockdaemon batches of 80; estimate = mean × blocks in 24 h, to the nearest 1,000", async () => {
    const { sampleTransactions, RPC_BLOCKDAEMON } = await import("../lib/arc-numbers");
    const f = batchFetch(() => "0x2");   // 2 tx per block
    const r = await sampleTransactions(f as never, 1_000_000, 0.5);
    expect(f).toHaveBeenCalledTimes(3);
    for (const c of f.mock.calls) { expect(String(c[0])).toBe(RPC_BLOCKDAEMON); expect(JSON.parse(String(c[1]!.body))).toHaveLength(80); }
    expect(r).toEqual({ estimate: 346_000, blocks: 240, from_block: 1_000_000 - 172_800 + 720, to_block: 1_000_000 });
  });
  test("error items are skipped; fewer than 200 answers → null; Blockdaemon down → null (never the public RPC)", async () => {
    const { sampleTransactions } = await import("../lib/arc-numbers");
    let n = 0;
    expect((await sampleTransactions(batchFetch(() => (n++ % 10 === 0 ? new Error("rate limit exceeded") : "0x1")) as never, 1_000_000, 0.5))?.blocks).toBe(216);
    n = 0;
    expect(await sampleTransactions(batchFetch(() => (n++ % 4 === 0 ? new Error("rate limit exceeded") : "0x1")) as never, 1_000_000, 0.5)).toBeNull();
    const down = vi.fn(async () => { throw new Error("down"); });
    expect(await sampleTransactions(down as never, 1_000_000, 0.5)).toBeNull();
    expect(down.mock.calls.every((c) => !String(c[0]).includes("rpc.mainnet.arc.io") || String(c[0]).includes("blockdaemon"))).toBe(true);
  });
  test("token supplies: one batch, divided by decimals; a failed item or a null address is null; falls back to the public RPC", async () => {
    const { tokenSupplies } = await import("../lib/arc-numbers");
    const f = batchFetch((c, url) => (url.includes("blockdaemon") ? new Error("down") : (c.params[0] as { to: string }).to.endsWith("1") ? "0xf4240" : new Error("rate limit exceeded")));
    const s = await tokenSupplies(f as never, [{ address: "0x0000000000000000000000000000000000000001", decimals: 6 }, { address: "0x0000000000000000000000000000000000000002", decimals: 6 }, { address: null, decimals: 6 }]);
    expect(s).toEqual([1, null, null]);
  });
});
```

Add to `builders-site/test/arc-numbers.test.ts` one test: with the fake fetch extended to answer batch bodies (`eth_getBlockTransactionCountByNumber` → `"0x3"`, `eth_call` totalSupply per address), `collectArcNumbers` returns `network.rpc_url`/`explorer_url` from `CHAIN_FACTS`, `stablecoins.tokens` with one entry per `CHAIN_FACTS.stablecoins` (USDC supply equal to the existing `usdc_supply`), and `activity_24h.transactions_est` not null; with `rpcDown`, `tokens` supplies are null, `transactions_est` and `tx_sample` are null and `errors` names "rpc token supplies".

- [ ] **Step 2: Run** — `npx vitest run builders-site/test/arc-tx-sample.test.ts builders-site/test/arc-numbers.test.ts` — Expected: FAIL (`sampleTransactions` not exported).

- [ ] **Step 3: Implement** in `arc-numbers.ts`:

```ts
import { CHAIN_FACTS } from "../../src/lib/arc-chain-facts";
export const RPC_BLOCKDAEMON = RPCS[0];
const SAMPLE = 240, SAMPLE_BATCH = 80, SAMPLE_MIN = 200;

/** One JSON-RPC batch to one endpoint: each call's result, or null for an error item or a missing answer. */
export async function rpcBatch(fetcher: Fetcher, url: string, calls: { method: string; params: unknown[] }[]): Promise<(unknown | null)[]> {
  const r = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, ...c }))), signal: AbortSignal.timeout(TIMEOUT_MS) });
  const j = (await r.json()) as { id: number; result?: unknown }[] | unknown;
  const out: (unknown | null)[] = calls.map(() => null);
  if (Array.isArray(j)) for (const x of j as { id: number; result?: unknown }[]) if (Number.isInteger(x?.id) && x.id < out.length && x.result !== undefined && x.result !== null) out[x.id] = x.result;
  return out;
}

/** Transactions in the last 24 h, estimated from 240 evenly spaced blocks (Blockdaemon only: the public RPC rate-limits batches). */
export async function sampleTransactions(fetcher: Fetcher, head: number, blockTimeS: number) {
  const span = Math.round(86400 / blockTimeS), step = span / SAMPLE;
  const nums = Array.from({ length: SAMPLE }, (_, i) => head - Math.round(i * step));
  const counts: number[] = [];
  try {
    for (let k = 0; k < SAMPLE; k += SAMPLE_BATCH) {
      const res = await rpcBatch(fetcher, RPC_BLOCKDAEMON, nums.slice(k, k + SAMPLE_BATCH).map((n) => ({ method: "eth_getBlockTransactionCountByNumber", params: [`0x${n.toString(16)}`] })));
      for (const x of res) if (typeof x === "string") counts.push(parseInt(x, 16));
    }
  } catch { return null; }
  if (counts.length < SAMPLE_MIN) return null;
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  return { estimate: Math.round((mean * span) / 1000) * 1000, blocks: counts.length, from_block: nums[nums.length - 1], to_block: head };
}

/** totalSupply of each token with an address, in one batch (Blockdaemon, then the public RPC); null where it fails. */
export async function tokenSupplies(fetcher: Fetcher, tokens: { address: string | null; decimals: number }[]): Promise<(number | null)[]> {
  const idx = tokens.map((t, i) => (t.address ? i : -1)).filter((i) => i >= 0);
  const calls = idx.map((i) => ({ method: "eth_call", params: [{ to: tokens[i].address, data: "0x18160ddd" }, "latest"] }));
  let best: (unknown | null)[] = calls.map(() => null);
  for (const url of RPCS) {
    try { best = await rpcBatch(fetcher, url, calls); } catch { continue; }
    if (best.some((x) => x !== null)) break;
  }
  const out: (number | null)[] = tokens.map(() => null);
  idx.forEach((i, k) => { const v = best[k]; if (typeof v === "string" && /^0x[0-9a-f]+$/i.test(v)) out[i] = Number(BigInt(v)) / 10 ** tokens[i].decimals; });
  return out;
}
```

In `collectArcNumbers`, after the existing `Promise.all`, add (each under `caught` so failures are named in `errors`):

```ts
  const [supplies, sample] = await Promise.all([
    caught("rpc token supplies", tokenSupplies(fetcher, CHAIN_FACTS.stablecoins)),
    c.block_height !== null && c.block_time_s ? caught("rpc tx sample", sampleTransactions(fetcher, c.block_height, c.block_time_s).then((s) => s ?? Promise.reject(new Error("too few samples")))) : Promise.resolve(null),
  ]);
```

and in the returned object: `network: { …, rpc_url: CHAIN_FACTS.network.rpc_url, explorer_url: CHAIN_FACTS.network.explorer_url }`; `stablecoins: { …, tokens: CHAIN_FACTS.stablecoins.map((t, i) => ({ symbol: t.symbol, issuer: t.issuer, address: t.address, supply: supplies?.[i] ?? null })) }`; `activity_24h: { …, transactions_est: sample?.estimate ?? null, tx_sample: sample ? { blocks: sample.blocks, from_block: sample.from_block, to_block: sample.to_block } : null }`. Extend the `ArcNumbers` type accordingly (new fields optional-free in the type; readers of old snapshots use `?.`/`?? null`).

- [ ] **Step 4: Run** — same command — Expected: PASS.

- [ ] **Step 5: Commit** — `git add builders-site/lib/arc-numbers.ts builders-site/test/arc-tx-sample.test.ts builders-site/test/arc-numbers.test.ts && git commit -m "arc numbers: stablecoin supplies, RPC/explorer, sampled daily transactions"`

### Task 3: `/arc/` page in sentences, API fixtures and OpenAPI

**Files:**
- Modify: `builders-site/lib/arc-pages.ts`; fixtures `docs/superpowers/specs/data-api-v1-fixtures/arc.json`, `arc-now.json`, `arc-daily.json`; `src/lib/data-api-openapi.ts`
- Test: `builders-site/test/arc-facts-page.test.ts`

**Interfaces:**
- Consumes: `CHAIN_FACTS`; `ArcNumbers` additions (Task 2).
- Produces: `renderArc(n: ArcNumbers, history: ArcNumbers[]): string` (signature unchanged).

- [ ] **Step 1: Write the failing test** (`builders-site/test/arc-facts-page.test.ts`): build an `ArcNumbers` from `docs/superpowers/specs/data-api-v1-fixtures/arc.json` plus the new fields (`tokens` with USDC supply 819428662.4 and one token with `supply: null`; `transactions_est: 342000`; `tx_sample`), and assert on `renderArc(n, [old])` where `old` is a copy with `transactions_est`/`tx_sample`/`tokens` deleted:
  - contains `<h2>Facts</h2>` and every `CHAIN_FACTS.facts[].text` (escaped), each followed by a link to its `source`;
  - contains "Arc held 819,428,662 USDC on" and "About 342,000 transactions in the last 24 h, estimated from 240 sampled blocks";
  - with `transactions_est: null` the "About … transactions" sentence is absent and the Activity table row shows "Not available right now";
  - Network table has "RPC" with `CHAIN_FACTS.network.rpc_url` and "Explorer" rows;
  - the "Stablecoins on Arc" table has one row per token, the null-supply token shows "Not available right now", a null-address token shows "Address not published";
  - the history table renders the old snapshot with "–" in "Transactions, 24 h (est.)";
  - `htmlToMarkdown(renderArc(...))` contains "Arc mainnet launched" and no `<`.
- [ ] **Step 2: Run** — `npx vitest run builders-site/test/arc-facts-page.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** in `arc-pages.ts`:
  - `const factsHtml = (n) => <h2>Facts</h2><ul>` + `CHAIN_FACTS.facts.map((f) => <li>${esc(f.text)} (<a href=${esc(f.source)} rel="noreferrer">source</a>, ${esc(day(f.date+"T00:00:00Z"))})</li>)` + live `<li>`s, each only when its figure is non-null: USDC held (`amt(...)`, `at(as_of)`, source Arc RPC), TVL (`usd(tvl)`, DefiLlama date), transactions (`N0.format(est)` + `<details><summary>i</summary> Blocks ${from}–${to}, one in every ${Math.round((to-from)/(blocks-1))}; count per block × blocks in 24 h.</details>`), app payments (`usd(app_usd)`, "Apps tracked by Registrai received … in stablecoin payments in the last 24 h.").
  - Insert after the opening `<p class="muted">`.
  - Network rows: `row("RPC", n.network.rpc_url ?? CHAIN_FACTS.network.rpc_url, "Arc docs")`, `row("Explorer", …, "Arc docs")`.
  - Replace the USDC/EURC rows by a `<table>` with `<thead>` Token/Issuer/Contract/Supply on Arc/Source, rows from `n.stablecoins.tokens ?? []` (fall back to USDC/EURC rows from `usdc_supply`/`eurc_supply` when `tokens` is missing), contract as `<a href="${explorer}/address/${addr}"><code>${addr}</code></a>`; keep the DefiLlama rows in their own small table below.
  - Activity: `row("Transactions (estimate)", int(a.transactions_est ?? null), "Arc RPC, sampled blocks")`.
  - History: add column "Transactions, 24 h (est.)" with `h.activity_24h.transactions_est == null ? "–" : N0.format(...)`.
- [ ] **Step 4: Fixtures + OpenAPI.** Add the new fields to `arc.json` and `arc-now.json` (textual insertion, keep formatting: `rpc_url`, `explorer_url` in `network`; `tokens` array with two entries in `stablecoins`; `transactions_est` and `tx_sample` in `activity_24h`), and to each day item in `arc-daily.json`. In `data-api-openapi.ts` `arcSchema`, mark nullable: `["stablecoins","tokens","*"]` is an array — add `nullableItems(s, ["stablecoins","tokens"], ["address","supply"])` helper that sets those item props to `[type,"null"]`, plus `nullable(out, ["activity_24h","transactions_est"])`, `nullable(out, ["activity_24h","tx_sample"])`. Run `npx vitest run src/lib/data-api-openapi.test.ts builders-site/test/data-api-arc.test.ts` — Expected: PASS after fixture edits (fix any exact-shape test by adding the fields to its fixture only).
- [ ] **Step 5: Run** — `npx vitest run builders-site/test/arc-facts-page.test.ts builders-site/test/arc-pages.test.ts src/lib/data-api-openapi.test.ts builders-site/test/data-api-arc.test.ts` — Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -am "arc page: sourced facts as sentences, stablecoin table, RPC/explorer, transactions; API fields"` (plus `git add` of the new test).

### Task 4: Seed date rule and `review` corrections

**Files:**
- Modify: `src/lib/arc-ecosystem-seed.ts:75`, `src/lib/arc-ecosystem-corrections.ts`, `builders-site/lib/corrections-pages.ts:8`
- Test: `src/lib/arc-ecosystem-seed.test.ts` (existing; add a case), `src/lib/arc-ecosystem-corrections.test.ts` (add a case)

**Interfaces:**
- Produces: `CorrectionEntry.from: "project" | "reader" | "review"`; `FROM.review = "Registrai review"`.

- [ ] **Step 1: Failing tests**
  - seed: `mergeCandidates({ tracker: [], members: [{ id: "domain:x.io", name: "X", kind: "app", first_hour: "2026-10-10T05:00:00Z" }], llama: [] })` → the candidate is `live` and `first_live` is `undefined`.
  - corrections: `validateCorrections([{ id: 1, date: "2026-10-23", slug: "a", field: "dates", change: "Live since 2026-09-16, from the launch post", source: "https://x.y/", from: "review" }], new Set(["a"]))` is ok; `renderCorrectionsLog` of that entry contains "Registrai review".
- [ ] **Step 2: Run** — `npx vitest run src/lib/arc-ecosystem-seed.test.ts src/lib/arc-ecosystem-corrections.test.ts builders-site/test/corrections-log.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement:** delete `c.first_live ??= m.first_hour.slice(0, 10);`; in the validator `if (c.from !== "project" && c.from !== "reader" && c.from !== "review") err("from must be project, reader or review")`; type `from: "project" | "reader" | "review"`; `FROM = { project: "From the project", reader: "From a reader", review: "Registrai review" }`.
- [ ] **Step 4: Run** — same — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "directory: launch dates never from the index's first-seen hour; corrections log accepts Registrai review"`

### Task 5: Directory review — apply script, research, data

**Files:**
- Create: `src/lib/arc-ecosystem-review.ts`, `src/lib/arc-ecosystem-review.test.ts`, `scripts/ecosystem-review.ts`, `docs/ecosystem-review/2026-10-23.json`
- Modify: `src/data/arc-ecosystem/entities.json`, `src/data/arc-ecosystem/corrections.json`; `src/lib/arc-ecosystem-data.test.ts` (date rule)

**Interfaces:**
- Produces:
  ```ts
  export type ReviewItem = { slug: string; field: "dates" | "status" | "category";
    set: { first_live?: string | null; status?: EntityStatus; category?: CategoryId; add_tags?: CategoryId[] };
    evidence?: Source;           // added to status_evidence (must carry `date` when set.first_live is a date)
    change: string; source: string };
  export function applyReview(entities: ArcEntity[], corrections: CorrectionEntry[], items: ReviewItem[], day: string): { entities: ArcEntity[]; corrections: CorrectionEntry[] };
  ```

- [ ] **Step 1: Failing tests** (`src/lib/arc-ecosystem-review.test.ts`):
  - applying `{ slug: "a", field: "dates", set: { first_live: "2026-09-16" }, evidence: { url: "https://arc.io/p", title: "Launch post", date: "2026-09-16" }, change: "Live since 2026-09-16, from the Arc launch post", source: "https://arc.io/p" }` sets `first_live`, appends the evidence once (idempotent on re-apply), sets `last_reviewed` to `day`, and appends one correction `{ id: max+1, date: day, slug: "a", field: "dates", change, source, from: "review" }`;
  - `set: { first_live: null }` deletes `first_live`;
  - a status item `announced → live` without evidence throws "status needs evidence";
  - a dates item whose evidence has no `date` equal to `first_live` throws "date must match its evidence";
  - an unknown slug throws; the result passes `validateEntities` and `validateCorrections`.
  - In `arc-ecosystem-data.test.ts` add: every entity with `first_live` has an item in `status_evidence` or `sources` with `date === first_live` (this test FAILS on today's data: 39 of 49 dates are unbacked).
- [ ] **Step 2: Run** — `npx vitest run src/lib/arc-ecosystem-review.test.ts src/lib/arc-ecosystem-data.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `applyReview`** (pure; clone entities; for each item: find the entity or throw `unknown slug ${slug}`; if `set.status` and no `evidence` → throw `status needs evidence`; if `set.first_live` is a string and `evidence?.date !== set.first_live` and no existing evidence/source has that date → throw `date must match its evidence`; apply `first_live` (null → delete), `status`, `category`, `add_tags` (dedupe, never equal to category); push `evidence` into `status_evidence` unless a same-URL item exists (then set its `date`/`title` if missing); `last_reviewed = day`; append the correction). And `scripts/ecosystem-review.ts --file docs/ecosystem-review/2026-10-23.json`: read the two data files and the items, `applyReview`, validate both with `validateEntities`/`validateCorrections`, write both files with `JSON.stringify(x, null, 2) + "\n"`, print a one-line count per field.
- [ ] **Step 4: Run** the review tests — Expected: PASS (the data test still FAILS until Step 6).
- [ ] **Step 5: Research** (the slow part). Dispatch research agents (general-purpose, read-only web), in batches of about 20 entries each, run in parallel (4–5 agents). Each gets: the entity JSON objects of its batch (slug, name, status, first_live, status_evidence, sources, website, contracts) and this brief: "For each Arc mainnet project, find the date it went live on Arc mainnet (chain 5042, mainnet since 2026-09-16) from: the project's own announcement or docs, an official arc.io/circle.com post naming it live at launch, or the creation date of its first mainnet contract on explorer.arc.io (give the tx/contract URL and its timestamp's UTC date). Return for each slug either `{ slug, first_live, evidence: { url, title, date }, why }` where `evidence.date === first_live` and the source states or shows that date, or `{ slug, first_live: null, why }` when no source shows a date. Never infer a date from an article that only mentions the project. For exchanges and wallets, also report whether arc.io's post https://www.arc.io/blog/arc-economic-os-internet or Circle's mainnet press release states it is live / works from day one (quote the sentence)." Batches: (a) all 38 live entries with `first_live` 2026-10-10/11; (b) 35 live entries without `first_live`; (c) the 11 entries with a date not backed by a dated source; (d) exchanges and wallets with status announced; (e) BlackRock and SBI Group (validator cohort post) and the 9 off-category entries named in the spec (their own site → category).
- [ ] **Step 6: Write `docs/ecosystem-review/2026-10-23.json`** from the agents' answers: one `ReviewItem` per change, `change` lines in the form "Live since 2026-09-16, from <source title>" / "Announced → Live on mainnet, per <source title>" / "Moved from DEXs to <category>, per its site" / "Also listed under Validators, per the founding validator post". Entries whose date has no source get `{ field: "dates", set: { first_live: null }, change: "Launch date removed: no source states it", source: <the entry's own website> }`. Spot-check 10 items yourself by opening the source. Run `npx tsx scripts/ecosystem-review.ts --file docs/ecosystem-review/2026-10-23.json`.
- [ ] **Step 7: Run** — `npx vitest run src/lib/arc-ecosystem-review.test.ts src/lib/arc-ecosystem-data.test.ts src/lib && npx tsx scripts/ecosystem-validate.ts` — Expected: PASS, validate OK.
- [ ] **Step 8: Commit** — `git add` the five files — `git commit -m "directory review 2026-10-23: launch dates from sources, statuses per arc.io/Circle, validators, categories (corrections log)"`

### Task 6: Category answers and Circle's Arc in titles

**Files:**
- Modify: `builders-site/lib/ecosystem-pages.ts` (`renderDirectory`, `renderCategory`, `renderEntity` title), `builders-site/functions/ecosystem/[[path]].ts`
- Test: `builders-site/test/ecosystem-answers.test.ts`

**Interfaces:**
- Consumes: `ArcWeek`, `loadArcWeek` (`builders-site/lib/arc-week.ts`).
- Produces: `renderCategory(cat: Category, all: ArcEntity[], week: ArcWeek | null = null): string`; `export function categoryAnswer(cat: Category, all: ArcEntity[], week: ArcWeek | null): string` (HTML, two sentences at most).

- [ ] **Step 1: Failing test** (`builders-site/test/ecosystem-answers.test.ts`), with three DEX entities (2 live with `index_ids` `["domain:a.io"]`, `["domain:b.io"]`, 1 announced) and a lending entity:
  - `categoryAnswer(dexs, all, week)` with week apps `[{ id: "domain:b.io", usd: 9 }, { id: "domain:a.io", usd: 5 }, { id: "domain:z.io", usd: 99 }]` → contains "3 DEXs listed on Arc, Circle's blockchain: 2 live on mainnet, 0 deployed, 1 announced." and "Most used over the last 7 days, by stablecoin payments received: <a href=\"/ecosystem/b/\">B</a> and <a href=\"/ecosystem/a/\">A</a>." (z.io is not in the category);
  - `week = null` → only the first sentence; a category with one project → "1 project listed" wording per the label rule below;
  - `renderCategory` title is "DEXs on Arc, Circle's blockchain · Registrai" and the description starts "DEXs on Arc, the blockchain by Circle: 3 listed, 2 live on mainnet";
  - `renderDirectory` contains "Registrai's Arc ecosystem directory lists 4 projects on Circle's Arc blockchain" and its title is "Arc ecosystem: projects on Circle's blockchain · Registrai";
  - `renderEntity` title is "A on Arc, Circle's blockchain · Registrai".
- [ ] **Step 2: Run** — `npx vitest run builders-site/test/ecosystem-answers.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Noun per category: use `cat.name` lower-cased except acronyms (`DEXs`, `AI agents`, `RWA`): `const noun = (c, n) => n === 1 ? "project" : /^[A-Z]{2,}/.test(c.name) ? c.name : c.name.toLowerCase();` — for counts other than 1 the sentence is `${n} ${noun} listed on Arc, Circle's blockchain: …`; for 1: `1 project listed on Arc, Circle's blockchain: …`. Most used: map `app.id` → entity via `all.find((e) => e.index_ids?.includes(app.id))`, keep those `inCategory(cat, e)` with `usd > 0`, sort by `usd` desc, top 3, dedupe by slug, join with ", " and " and ". Replace the `<p class="muted">{n} projects…` line with `<p>${categoryAnswer(...)}</p><p class="muted"><a href="/ecosystem/">All categories</a></p>`. Titles/descriptions per the spec. Directory: add the opening `<p>` sentence before the existing muted counts line (keep the `i` note).
- [ ] **Step 4: Wire the function:** category pages become `edgeCachedGet(new Request(url.toString()), deps, async () => html(renderCategory(cat, all, await loadArcWeek(ctx.env, deps).catch(() => null))), 300, \`cat:${cat.id}\`)` (drop the per-isolate memo for categories only; directory keeps it). Add to the test: the function answers `/ecosystem/dexs/` 200 with the week loader throwing.
- [ ] **Step 5: Run** — `npx vitest run builders-site/test/ecosystem-answers.test.ts builders-site/test/ecosystem-pages.test.ts builders-site/test/ecosystem-memo.test.ts builders-site/test/ecosystem-route.test.ts builders-site/test/markdown-routes.test.ts` — Expected: PASS.
- [ ] **Step 6: Commit** — `git commit -am "ecosystem: one-line answers per category, Circle's Arc in titles and descriptions"` (plus the new test).

---

## After the tasks

Full suite (`npx vitest run builders-site/test src/lib`), typecheck, lint. Final whole-branch review (fresh opus reviewer), one fix pass, preview from `.worktrees/abi-deploy` (branch `gaps`), check `/arc/`, `/arc/index.md`, `/ecosystem/dexs/`, `/ecosystem/corrections/`, `/api/v1/arc`; production on the owner's OK; IndexNow ping for `/arc/`, `/ecosystem/` and every category page.
