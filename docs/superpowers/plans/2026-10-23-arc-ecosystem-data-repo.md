# Public Data Repo `arc-ecosystem` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public GitHub repo, `registrai-multichain/arc-ecosystem`, that:
- holds daily-refreshed open data on the Arc ecosystem;
- has a README linking every builder.registrai.cc page;
- sits alongside an org profile and repo homepages that all point to the site, so GitHub links lead search engines (Brave
  in particular) to it.

**Architecture:**
- **Location:** a standalone repo built locally at `/Users/tobiasd/Desktop/arc/arc-ecosystem-data`.
- **Dependencies:** none; plain Node ES modules.
- **Code layout:**
  - `scripts/lib.mjs` holds the pure helpers: CSV, validators and the README renderer, all unit tested with
    `node --test`.
  - `scripts/refresh.mjs` fetches the public API, stages files in `tmp/`, validates, then replaces `data/` and
    `README.md`.
- **Schedule:** a GitHub Action runs it daily at 00:30 UTC and commits only changes.
- **Publishing:** anything public is the last task, gated on the owner.

**Tech Stack:** Node 20+ (local is v26), GitHub Actions, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-23-arc-ecosystem-data-repo-design.md`, in the frontend repo on
`feat/abi-pilot`.

## Global Constraints

- **Dependencies:** none. Node built-ins only (`node:fs`, `node:path`, `node:test`, `node:assert`, global `fetch`).
- **API base:** `https://builder.registrai.cc/api/v1`.
- **API shapes, as checked 2026-10-23:**
  - `/ecosystem` → `{version, updated, count, entities[]}`
  - `/ecosystem/{slug}` → `{version, entity}`
  - `/arc/daily?days=365` → `{version, days[]}`, newest first
- **Fetching:** user agent `registrai-arc-ecosystem-data`. Each fetch uses a 20 s timeout and up to 3 tries; entity
  fetches run 4 at a time.
- **Validation:**
  - entity count ≥ 100 and equal to the list count;
  - each entity has `slug`, `name`, `status` and `sources`;
  - `arc-numbers.json` has `version` and `network`;
  - `apps-7d.json` has an `apps` array;
  - each CSV has its header plus at least one row.
- **On failure:** exit 1 before touching `data/`.
- **Apps-week 503:** keep yesterday's `apps-7d.json` and `apps-7d.csv`, and log it.
- **CSV:**
  - RFC 4180 quoting with `\n` line endings;
  - text cells starting with `=`, `+`, `-` or `@` get a leading `'`, but only on string cells whose value isn't a plain
    number;
  - null and undefined become empty.
- **Determinism:** `JSON.stringify(x, null, 2) + "\n"`. Entities are sorted by `slug`, apps keep API order, and
  `arc-daily.csv` is oldest first.
- **Secrets:** none. The workflow uses only `GITHUB_TOKEN` with `permissions: contents: write`.
- **Copy:** plain, no slogans.
- **Licensing:** CC BY 4.0 for the data and README, MIT for `scripts/`.
- **Publishing:** nothing happens on GitHub (repo creation, push, org or description edits) without the owner's explicit
  OK in chat.

## Review Focus

1. **API partly down:** an entity fetch that fails 3 times → exit 1, and `data/` is unchanged. Test: Task 2 (with an
   injected fetcher).
2. **CSV injection and quoting:** a name `=HYPERLINK(...)` → `'=HYPERLINK(...)`; a value with a comma, quote or newline
   is quoted. Test: Task 1.
3. **README completeness:** every category in the data gets a link; the counts and date are present; no "undefined".
   Test: Task 1.
4. **Determinism:** two runs on the same inputs give byte-identical files. Test: Task 2.
5. **Apps-week 503:** the previous apps files are kept and the run still succeeds. Test: Task 2.

---

### Task 1: `lib.mjs` (CSV, validators, README) with tests

**Files:**
- Create:
  - `arc-ecosystem-data/scripts/lib.mjs`
  - `arc-ecosystem-data/scripts/lib.test.mjs`
  - `arc-ecosystem-data/package.json`, with `{"name":"arc-ecosystem-data","private":true,"type":"module","scripts":{"test":"node --test scripts/","refresh":"node scripts/refresh.mjs"}}`
  - `arc-ecosystem-data/.gitignore`, with `tmp/` and `node_modules/`

**Interfaces:**
- **Produces:**
  - `toCsv(header: string[], rows: unknown[][]): string`
  - `validateEcosystem(e: {count:number, entities:object[]}, listCount: number): string[]`, which returns a list of
    errors
  - `validateArcNumbers(x): string[]`
  - `validateApps(x): string[]`
  - `ecosystemCsvRows(entities)`
  - `appsCsvRows(apps)`
  - `arcDailyCsvRows(daysNewestFirst)`
  - `renderReadme({ count, live, deployed, announced, categories: {id,label,count}[], updated }): string`
  - `CATEGORY_LABELS: Record<string,string>`
  - `ECOSYSTEM_HEADER`, `APPS_HEADER`, `ARC_DAILY_HEADER`

- [ ] **Step 1: Write the failing test**

```js
// scripts/lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, validateEcosystem, validateArcNumbers, validateApps, ecosystemCsvRows, appsCsvRows, arcDailyCsvRows, renderReadme, ECOSYSTEM_HEADER, ARC_DAILY_HEADER } from "./lib.mjs";

test("toCsv: RFC 4180 quoting, nulls empty, formula guard on text only", () => {
  const csv = toCsv(["a", "b", "c"], [["x,y", 'say "hi"', "line1\nline2"], [null, undefined, 5], ["=HYPERLINK(1)", "-3", "@x"], ["+1", -2, "plain"]]);
  assert.equal(csv, 'a,b,c\n"x,y","say ""hi""","line1\nline2"\n,,5\n\'=HYPERLINK(1),-3,\'@x\n\'+1,-2,plain\n');
});

test("validators", () => {
  const ent = (o = {}) => ({ slug: "a", name: "A", status: "live", sources: [{ url: "https://a" }], ...o });
  const many = Array.from({ length: 120 }, (_, i) => ent({ slug: `s${i}` }));
  assert.deepEqual(validateEcosystem({ count: 120, entities: many }, 120), []);
  assert.match(validateEcosystem({ count: 50, entities: many.slice(0, 50) }, 50).join(), /at least 100/);
  assert.match(validateEcosystem({ count: 120, entities: many }, 121).join(), /list count/);
  assert.match(validateEcosystem({ count: 120, entities: [...many.slice(1), ent({ slug: "x", sources: undefined })] }, 120).join(), /sources/);
  assert.deepEqual(validateArcNumbers({ version: 1, network: {} }), []);
  assert.match(validateArcNumbers({ network: {} }).join(), /version/);
  assert.deepEqual(validateApps({ apps: [] }), []);
  assert.match(validateApps({}).join(), /apps/);
});

test("row builders", () => {
  assert.deepEqual(ECOSYSTEM_HEADER, ["slug", "name", "category", "status", "website", "first_live", "last_reviewed", "url"]);
  assert.deepEqual(ecosystemCsvRows([{ slug: "a", name: "A", category: "dexs", status: "live", url: "https://u", last_reviewed: "2026-10-20" }]),
    [["a", "A", "dexs", "live", null, null, "2026-10-20", "https://u"]]);
  assert.deepEqual(appsCsvRows([{ id: "i", name: "N", category: null, usd: 1.5, payments: 2, new_payers: 0, first_hour: "2026-10-10T00:00:00Z", url: "https://x" }]),
    [["i", "N", null, 1.5, 2, 0, "2026-10-10T00:00:00Z", "https://x"]]);
  assert.deepEqual(ARC_DAILY_HEADER, ["day", "usdc_supply", "eurc_supply", "all_stablecoins_usd", "tvl_usd", "usdc_moved_usd_est", "app_usd", "attributed_share_pct_24h"]);
  const d = (day, s) => ({ generated_at: `${day}T00:03:00.000Z`, stablecoins: { usdc_supply: s, eurc_supply: 1, all_stablecoins_usd: 2, tvl_usd: 3 }, activity_24h: { usdc_moved_usd_est: 4, app_usd: 5, attributed_share_pct: 6 } });
  assert.deepEqual(arcDailyCsvRows([d("2026-10-23", 10), d("2026-10-22", 9)]).map((r) => r.slice(0, 2)), [["2026-10-22", 9], ["2026-10-23", 10]]);
});

test("README: counts, date, every category link, page links, citation, no undefined", () => {
  const md = renderReadme({ count: 258, live: 83, deployed: 20, announced: 155, updated: "2026-10-23",
    categories: [{ id: "dexs", label: "DEXs on Arc", count: 25 }, { id: "payments", label: "Payment apps on Arc", count: 39 }] });
  assert.match(md, /^# Arc ecosystem data/m);
  assert.match(md, /258 projects with status and sources/);
  assert.match(md, /Updated 2026-10-23 UTC/);
  assert.match(md, /\[DEXs on Arc\]\(https:\/\/builder\.registrai\.cc\/ecosystem\/dexs\/\) \(25\)/);
  for (const p of ["/ecosystem/", "/arc/", "/arc/most-used-apps/", "/arc/apps-that-accept-usdc/", "/arc/new/", "/arc/get-usdc/", "/methodology/", "/ecosystem/corrections/", "/apps/", "/builders-index/", "/data-api/"])
    assert.ok(md.includes(`https://builder.registrai.cc${p}`), p);
  assert.ok(md.includes("https://builder.registrai.cc/api/mcp"));
  assert.ok(md.includes("cc.registrai/arc-data"));
  assert.match(md, /Registrai, Arc ecosystem data, builder\.registrai\.cc, CC BY 4\.0, retrieved 2026-10-23\./);
  assert.ok(!/undefined|NaN/.test(md));
});
```

- [ ] **Step 2: Run it, expecting failure**

Run: `cd /Users/tobiasd/Desktop/arc/arc-ecosystem-data && node --test scripts/`
Expected: FAIL (`lib.mjs` missing).

- [ ] **Step 3: Implement `scripts/lib.mjs`**

```js
// scripts/lib.mjs — pure helpers for the Arc ecosystem data repo (no dependencies).
export const SITE = "https://builder.registrai.cc";
export const ECOSYSTEM_HEADER = ["slug", "name", "category", "status", "website", "first_live", "last_reviewed", "url"];
export const APPS_HEADER = ["id", "name", "category", "usd", "payments", "new_payers", "first_hour", "url"];
export const ARC_DAILY_HEADER = ["day", "usdc_supply", "eurc_supply", "all_stablecoins_usd", "tvl_usd", "usdc_moved_usd_est", "app_usd", "attributed_share_pct_24h"];
/** The site's category labels (src/lib/arc-ecosystem.ts CATEGORIES); an unknown id falls back to the id. */
export const CATEGORY_LABELS = {
  payments: "Payment apps on Arc", wallets: "Wallets that support Arc", exchanges: "Exchanges that support Arc", banks: "Banks building on Arc",
  "stablecoin-issuers": "Stablecoin issuers on Arc", infrastructure: "Infrastructure for Arc", "developer-tools": "Developer tools for Arc", dexs: "DEXs on Arc",
  lending: "Lending on Arc", trading: "Trading on Arc", "market-makers": "Market makers on Arc", custody: "Custody on Arc", rwa: "Tokenization and RWA on Arc",
  bridges: "Bridges and cross-chain on Arc", "ai-agents": "AI agents on Arc", ramps: "On/off-ramps for Arc", consumer: "Games and consumer apps on Arc",
  launchpads: "Launchpads on Arc", validators: "Arc validators", "asset-managers": "Asset managers on Arc",
};

const NUMERIC = /^-?\d+(\.\d+)?$/;
function cell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;   // spreadsheet formula guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";

export function validateEcosystem(e, listCount) {
  const err = [];
  if (!e || !Array.isArray(e.entities)) return ["ecosystem: entities missing"];
  if (e.entities.length < 100) err.push(`ecosystem: ${e.entities.length} entities, expected at least 100`);
  if (e.entities.length !== listCount) err.push(`ecosystem: ${e.entities.length} entities, list count ${listCount}`);
  for (const x of e.entities) for (const k of ["slug", "name", "status", "sources"]) if (x?.[k] === undefined || x?.[k] === null) err.push(`ecosystem: ${x?.slug ?? "?"} missing ${k}`);
  return err;
}
export const validateArcNumbers = (x) => [...(x?.version === undefined ? ["arc-numbers: version missing"] : []), ...(x?.network ? [] : ["arc-numbers: network missing"])];
export const validateApps = (x) => (Array.isArray(x?.apps) ? [] : ["apps-7d: apps missing"]);

export const ecosystemCsvRows = (entities) => entities.map((e) => [e.slug, e.name, e.category ?? null, e.status, e.website ?? null, e.first_live ?? null, e.last_reviewed ?? null, e.url ?? null]);
export const appsCsvRows = (apps) => apps.map((a) => [a.id, a.name, a.category ?? null, a.usd, a.payments, a.new_payers, a.first_hour ?? null, a.url ?? null]);
export const arcDailyCsvRows = (days) => [...days].reverse().map((d) => [String(d.generated_at).slice(0, 10), d.stablecoins?.usdc_supply ?? null, d.stablecoins?.eurc_supply ?? null,
  d.stablecoins?.all_stablecoins_usd ?? null, d.stablecoins?.tvl_usd ?? null, d.activity_24h?.usdc_moved_usd_est ?? null, d.activity_24h?.app_usd ?? null, d.activity_24h?.attributed_share_pct ?? null]);

export function renderReadme({ count, live, deployed, announced, categories, updated }) {
  const cats = categories.map((c) => `- [${c.label}](${SITE}/ecosystem/${c.id}/) (${c.count})`).join("\n");
  return `# Arc ecosystem data

Open data on the Arc ecosystem from Registrai (registrai.cc): ${count} projects with status and sources, daily app activity and Arc chain figures. CC BY 4.0. Updated ${updated} UTC.

${count} projects: ${live} live on Arc mainnet, ${deployed} deployed, ${announced} announced. Each has a page with its status, the evidence for it, its sources and a review date.

## Pages

- [Arc ecosystem directory](${SITE}/ecosystem/)
- [Arc in numbers](${SITE}/arc/): chain and stablecoin figures with daily snapshots
- [Most-used apps on Arc, last 7 days](${SITE}/arc/most-used-apps/)
- [Apps that accept USDC on Arc](${SITE}/arc/apps-that-accept-usdc/)
- [New on Arc this week](${SITE}/arc/new/)
- [How to get USDC onto Arc](${SITE}/arc/get-usdc/)
- [Apps on Arc](${SITE}/apps/): hourly payments and volume per app
- [Indices](${SITE}/builders-index/): Arc Builders, Integrations and Ecosystem indices
- [Methodology](${SITE}/methodology/): definitions, sources and limits
- [Corrections log](${SITE}/ecosystem/corrections/)
- [Data API](${SITE}/data-api/): free JSON, no key
- MCP server for AI agents: ${SITE}/api/mcp (official MCP Registry: \`cc.registrai/arc-data\`)

### Categories

${cats}

## Files

| File | Contents | Source |
|---|---|---|
| \`data/ecosystem.json\` | Every project: status, evidence, sources, links, contracts | \`/api/v1/ecosystem/{slug}\` |
| \`data/ecosystem.csv\` | One row per project | same |
| \`data/corrections.json\` | Public corrections log | \`/api/v1/ecosystem/corrections\` |
| \`data/arc-numbers.json\` | Arc in numbers now | \`/api/v1/arc\` |
| \`data/arc-daily.csv\` | One row per day, oldest first | \`/api/v1/arc/daily\` |
| \`data/apps-7d.json\`, \`data/apps-7d.csv\` | Apps over the last 7 days | \`/api/v1/arc/apps-week\` |
| \`data/indices.json\` | The three Arc indices | \`/api/v1/indices\` |

API base: ${SITE}/api/v1. Definitions of every field: ${SITE}/methodology/.

## Cite

Registrai, Arc ecosystem data, builder.registrai.cc, CC BY 4.0, retrieved ${updated}.

## Schedule

Refreshed daily at 00:30 UTC by a GitHub Action from the public API; each day is one commit.

## Corrections

Suggest one from any project page on ${SITE}/ecosystem/. Approved corrections are listed in \`data/corrections.json\`.

## License

Data and this README: CC BY 4.0. Scripts: MIT. Registrai is independent and not affiliated with Circle or Arc.
`;
}
```

- [ ] **Step 4: Run, expecting a pass**

Run: `node --test scripts/`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/tobiasd/Desktop/arc/arc-ecosystem-data && git init -q -b main && git add -A && git commit -qm "lib: CSV, validators and README renderer with tests"
```

### Task 2: `refresh.mjs`

**Files:**
- Create: `scripts/refresh.mjs` and `scripts/refresh.test.mjs`

**Interfaces:**
- **Consumes:** everything from Task 1.
- **Produces:**
  - `refresh({ root: string, fetcher?: typeof fetch, today?: string, log?: (s:string)=>void }): Promise<void>`, which
    throws on failure without touching `data/`
  - a CLI entry: `node scripts/refresh.mjs` runs `refresh({ root: <repo root> })` and exits 1 on error

- [ ] **Step 1: Write the failing test**

```js
// scripts/refresh.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { refresh } from "./refresh.mjs";

const B = "https://builder.registrai.cc/api/v1";
const ent = (i) => ({ slug: `p${String(i).padStart(3, "0")}`, name: i === 0 ? "=EVIL()" : `P${i}`, category: i % 2 ? "dexs" : "payments", status: i < 10 ? "live" : "announced", sources: [{ url: "https://s" }], url: `https://builder.registrai.cc/ecosystem/p${i}/`, last_reviewed: "2026-10-20" });
function fake({ failSlug, appsDown } = {}) {
  const ents = Array.from({ length: 120 }, (_, i) => ent(i));
  const routes = {
    [`${B}/ecosystem`]: { version: 1, updated: "2026-10-20", count: 120, entities: ents.map(({ sources, ...e }) => e) },
    [`${B}/ecosystem/corrections`]: { version: 1, corrections: [] },
    [`${B}/arc`]: { version: 1, network: { chain_id: 5042 } },
    [`${B}/arc/daily?days=365`]: { version: 1, days: [{ generated_at: "2026-10-23T00:03:00Z", stablecoins: { usdc_supply: 1 }, activity_24h: { app_usd: 1 } }] },
    [`${B}/arc/apps-week`]: { version: 1, until: "2026-10-23T00:00:00Z", window_hours: 168, apps: [{ id: "a", name: "A", usd: 1, payments: 1, new_payers: 0, first_hour: null, url: "https://u" }] },
    [`${B}/indices`]: { version: 1, data_until: "2026-10-23T00:00:00Z", indices: {} },
  };
  for (const e of ents) routes[`${B}/ecosystem/${e.slug}`] = { version: 1, entity: e };
  return async (url) => {
    if (failSlug && url === `${B}/ecosystem/${failSlug}`) throw new Error("boom");
    if (appsDown && url === `${B}/arc/apps-week`) return new Response("{}", { status: 503 });
    const body = routes[url];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("nf", { status: 404 });
  };
}
const repo = () => { const r = mkdtempSync(join(tmpdir(), "aed-")); mkdirSync(join(r, "data")); return r; };

test("writes every file, README, deterministic across runs", async () => {
  const r = repo();
  await refresh({ root: r, fetcher: fake(), today: "2026-10-23", log: () => {} });
  for (const f of ["ecosystem.json", "ecosystem.csv", "corrections.json", "arc-numbers.json", "arc-daily.csv", "apps-7d.json", "apps-7d.csv", "indices.json"]) assert.ok(existsSync(join(r, "data", f)), f);
  const eco = JSON.parse(readFileSync(join(r, "data/ecosystem.json"), "utf8"));
  assert.equal(eco.count, 120);
  assert.deepEqual(eco.entities.map((e) => e.slug), [...eco.entities.map((e) => e.slug)].sort());
  assert.match(readFileSync(join(r, "data/ecosystem.csv"), "utf8"), /'=EVIL\(\)/);
  const md = readFileSync(join(r, "README.md"), "utf8");
  assert.match(md, /120 projects with status and sources/);
  assert.match(md, /\[DEXs on Arc\]/);
  const before = ["ecosystem.json", "ecosystem.csv", "README.md"].map((f) => readFileSync(join(r, f.startsWith("README") ? f : `data/${f}`), "utf8"));
  await refresh({ root: r, fetcher: fake(), today: "2026-10-23", log: () => {} });
  const after = ["ecosystem.json", "ecosystem.csv", "README.md"].map((f) => readFileSync(join(r, f.startsWith("README") ? f : `data/${f}`), "utf8"));
  assert.deepEqual(after, before);
});

test("a failing entity fetch throws and leaves data/ untouched", async () => {
  const r = repo();
  writeFileSync(join(r, "data/ecosystem.json"), "OLD");
  await assert.rejects(refresh({ root: r, fetcher: fake({ failSlug: "p005" }), today: "2026-10-23", log: () => {} }), /p005/);
  assert.equal(readFileSync(join(r, "data/ecosystem.json"), "utf8"), "OLD");
  assert.ok(!existsSync(join(r, "README.md")));
});

test("apps-week 503 keeps yesterday's apps files and the run succeeds", async () => {
  const r = repo();
  writeFileSync(join(r, "data/apps-7d.json"), "YESTERDAY-JSON");
  writeFileSync(join(r, "data/apps-7d.csv"), "YESTERDAY-CSV");
  await refresh({ root: r, fetcher: fake({ appsDown: true }), today: "2026-10-23", log: () => {} });
  assert.equal(readFileSync(join(r, "data/apps-7d.json"), "utf8"), "YESTERDAY-JSON");
  assert.equal(readFileSync(join(r, "data/apps-7d.csv"), "utf8"), "YESTERDAY-CSV");
  assert.ok(existsSync(join(r, "data/ecosystem.json")));
});
```

- [ ] **Step 2: Run it, expecting failure**

Run: `node --test scripts/`
Expected: FAIL (`refresh.mjs` missing).

- [ ] **Step 3: Implement `scripts/refresh.mjs`**

```js
// scripts/refresh.mjs — fetch the public API, stage in tmp/, validate, then replace data/ and README.md.
import { mkdirSync, rmSync, writeFileSync, renameSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APPS_HEADER, ARC_DAILY_HEADER, CATEGORY_LABELS, ECOSYSTEM_HEADER, appsCsvRows, arcDailyCsvRows, ecosystemCsvRows, renderReadme, toCsv, validateApps, validateArcNumbers, validateEcosystem } from "./lib.mjs";

const API = "https://builder.registrai.cc/api/v1";
const UA = "registrai-arc-ecosystem-data";
const json = (x) => JSON.stringify(x, null, 2) + "\n";

async function getJson(fetcher, url, { allow503 = false } = {}) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetcher(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (allow503 && r.status === 503) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e; }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

export async function refresh({ root, fetcher = fetch, today = new Date().toISOString().slice(0, 10), log = console.log }) {
  const list = await getJson(fetcher, `${API}/ecosystem`);
  const entities = (await pool(list.entities.map((e) => e.slug), 4, async (slug) => (await getJson(fetcher, `${API}/ecosystem/${slug}`)).entity))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const [corrections, arcNow, daily, apps, indices] = await Promise.all([
    getJson(fetcher, `${API}/ecosystem/corrections`), getJson(fetcher, `${API}/arc`), getJson(fetcher, `${API}/arc/daily?days=365`),
    getJson(fetcher, `${API}/arc/apps-week`, { allow503: true }), getJson(fetcher, `${API}/indices`),
  ]);
  const eco = { version: 1, updated: list.updated, count: entities.length, entities };
  const errors = [...validateEcosystem(eco, list.count), ...validateArcNumbers(arcNow), ...(apps ? validateApps(apps) : [])];
  const ecoCsv = toCsv(ECOSYSTEM_HEADER, ecosystemCsvRows(entities)), dailyCsv = toCsv(ARC_DAILY_HEADER, arcDailyCsvRows(daily.days ?? []));
  if (ecoCsv.split("\n").length < 3) errors.push("ecosystem.csv: no rows");
  if (dailyCsv.split("\n").length < 3) errors.push("arc-daily.csv: no rows");
  if (errors.length) throw new Error(`validation failed: ${errors.slice(0, 10).join("; ")}`);

  const tmp = join(root, "tmp"); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const files = { "ecosystem.json": json(eco), "ecosystem.csv": ecoCsv, "corrections.json": json(corrections), "arc-numbers.json": json(arcNow), "arc-daily.csv": dailyCsv, "indices.json": json(indices) };
  if (apps) { files["apps-7d.json"] = json(apps); files["apps-7d.csv"] = toCsv(APPS_HEADER, appsCsvRows(apps.apps)); }
  else log("apps-week: 503, keeping yesterday's apps-7d files");
  for (const [f, body] of Object.entries(files)) writeFileSync(join(tmp, f), body);

  const counts = { live: 0, deployed: 0, announced: 0 }; const byCat = new Map();
  for (const e of entities) { counts[e.status] = (counts[e.status] ?? 0) + 1; byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1); }
  const categories = [...byCat].map(([id, count]) => ({ id, label: CATEGORY_LABELS[id] ?? id, count })).sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  writeFileSync(join(tmp, "README.md"), renderReadme({ count: entities.length, ...counts, categories, updated: today }));

  mkdirSync(join(root, "data"), { recursive: true });
  for (const f of readdirSync(tmp)) renameSync(join(tmp, f), f === "README.md" ? join(root, f) : join(root, "data", f));
  rmSync(tmp, { recursive: true, force: true });
  log(`refreshed: ${entities.length} projects, ${Object.keys(files).length} data files`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  refresh({ root: resolve(dirname(fileURLToPath(import.meta.url)), "..") }).catch((e) => { console.error(e.message); process.exit(1); });
}
```

`copyFileSync` and `existsSync` are imported but not needed. Remove them when implementing if `node --check` or the
lint-free style requires it.

- [ ] **Step 4: Run, expecting a pass, then a dry run against the live API**

Run:
```
node --test scripts/
node scripts/refresh.mjs
ls data
head -5 data/ecosystem.csv
head -30 README.md
```
Expected:
- the tests pass;
- the live run prints "refreshed: 258 projects, 8 data files";
- `data/` has 8 files;
- the README lists 258 projects and 20 or fewer categories, each with a count.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -qm "refresh: fetch the public API, validate, then replace data/ and README; first data"
```

### Task 3: Workflow, LICENSE, CITATION.cff

**Files:**
- Create:
  - `.github/workflows/refresh.yml`
  - `LICENSE`
  - `CITATION.cff`
- Test: a structural check added to `scripts/lib.test.mjs`. It asserts that the workflow file has `cron: "30 0 * * *"`,
  `workflow_dispatch`, `contents: write`, runs `node --test scripts/` before the refresh, and contains no `secrets.`
  reference other than none at all.

- [ ] **Step 1: Write the failing test**

Append to `scripts/lib.test.mjs`:

```js
import { readFileSync, existsSync } from "node:fs";
test("workflow, license and citation are in place; no secrets in the workflow", () => {
  const wf = readFileSync(new URL("../.github/workflows/refresh.yml", import.meta.url), "utf8");
  assert.match(wf, /cron: "30 0 \* \* \*"/);
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /contents: write/);
  assert.ok(wf.indexOf("node --test scripts/") < wf.indexOf("node scripts/refresh.mjs"));
  assert.ok(!/secrets\./.test(wf));
  assert.match(readFileSync(new URL("../LICENSE", import.meta.url), "utf8"), /Creative Commons Attribution 4\.0[\s\S]*MIT License/);
  assert.match(readFileSync(new URL("../CITATION.cff", import.meta.url), "utf8"), /cff-version: 1\.2\.0[\s\S]*license: CC-BY-4\.0/);
});
```

- [ ] **Step 2: Run it, expecting failure**

Run: `node --test scripts/`
Expected: FAIL (the files are missing).

- [ ] **Step 3: Create the files**

`.github/workflows/refresh.yml`:

```yaml
name: Daily data refresh
on:
  schedule:
    - cron: "30 0 * * *"
  workflow_dispatch:
permissions:
  contents: write
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: node --test scripts/
      - run: node scripts/refresh.mjs
      - name: Commit if changed
        run: |
          if [ -n "$(git status --porcelain)" ]; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add -A data README.md
            git commit -m "data: $(date -u +%F) UTC refresh"
            git push
          else
            echo "no changes"
          fi
```

`LICENSE`: two sections.
- **Section 1:** "Data and documentation (data/, README.md): Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/ — attribution: Registrai, builder.registrai.cc".
- **Section 2:** "Scripts (scripts/, .github/): MIT License", followed by the standard MIT text with
  "Copyright (c) 2026 Registrai".

`CITATION.cff`:

```yaml
cff-version: 1.2.0
message: "If you use this data, please cite it as below."
title: "Arc ecosystem data (Registrai)"
authors:
  - name: "Registrai"
url: "https://builder.registrai.cc"
repository-code: "https://github.com/registrai-multichain/arc-ecosystem"
license: CC-BY-4.0
type: dataset
keywords: [Arc, USDC, stablecoins, open data, blockchain data]
```

- [ ] **Step 4: Run, expecting a pass**

Run: `node --test scripts/`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -qm "workflow: daily 00:30 UTC refresh; CC BY 4.0 + MIT license; CITATION.cff"
```

### Task 4: Publish (owner-gated)

**Stop before this task.** Report the local result to the owner:
- `README.md` rendered;
- the file list;
- `git log`;
- the exact commands below.

Wait for an explicit OK, then run them.

- [ ] **Step 1: Create the repo and push**

```bash
cd /Users/tobiasd/Desktop/arc/arc-ecosystem-data
gh repo create registrai-multichain/arc-ecosystem --public --source . --push \
  --description "Open data on the Arc ecosystem: projects with status and sources, daily app activity, Arc chain figures. CC BY 4.0. By Registrai (registrai.cc)." \
  --homepage https://builder.registrai.cc
gh repo edit registrai-multichain/arc-ecosystem --add-topic arc --add-topic usdc --add-topic stablecoins --add-topic open-data --add-topic blockchain-data --add-topic mcp
gh workflow run refresh.yml -R registrai-multichain/arc-ecosystem
```

Then confirm the run succeeds with `gh run list -R registrai-multichain/arc-ecosystem -L 1`.

- [ ] **Step 2: Org profile**

```bash
gh api -X PATCH orgs/registrai-multichain -f description="Registrai: Arc ecosystem data (directory, chain figures, app activity)." -f blog="https://builder.registrai.cc"
```

Create a public `registrai-multichain/.github` repo containing `profile/README.md`, with:
- one paragraph: "Registrai publishes sourced, dated data on the Arc ecosystem for people and AI agents.";
- links: the site, the Arc ecosystem directory, Arc in numbers, the methodology, the data repo, the Data API, the MCP
  server.

Push it with `gh repo create registrai-multichain/.github --public --source <dir> --push`.

- [ ] **Step 3: Repo homepages and the oracle-era descriptions**

```bash
for r in frontend contracts agent-sdk agent oracle-primitives; do gh repo edit registrai-multichain/$r --homepage https://builder.registrai.cc; done
gh repo edit registrai-multichain/agent-sdk --description "Registrai (Arc ecosystem data, builder.registrai.cc). TypeScript SDK for writing oracle agents on Registrai. Runtime-agnostic — Node, Cloudflare Workers, Phala TEE, any modern JS runtime."
gh repo edit registrai-multichain/agent --description "Registrai (Arc ecosystem data, builder.registrai.cc). Reference oracle agent + SDK + Cloudflare Worker template for Registrai. TypeScript / viem."
gh repo edit registrai-multichain/oracle-primitives --description "Registrai (Arc ecosystem data, builder.registrai.cc). Permissionless bonded oracle agents + verifiable rule-bytecode aggregation. Fork-and-ship infrastructure for any Arc app."
```

Verify with `gh repo list registrai-multichain --json name,homepageUrl,description`.
