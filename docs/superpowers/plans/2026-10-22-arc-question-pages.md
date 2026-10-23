# Arc Question Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four pages under `/arc/`, each answering a common question about Arc with a dated first sentence and a table
from Registrai's own data:
- most-used apps over 7 days;
- apps that accept USDC;
- what's new this week;
- how to get USDC onto Arc.

The same data is also available as an API endpoint and an MCP tool.

**Architecture:**
- **Loader:** `loadArcWeek` sums the last 168 closed AEI hours from D1 (`member_hour` plus `member_first`) and names
  each app from the directory or the AEI file. The result is edge-cached for 600 s under an internal key.
- **Renderers:** four pure functions turn an `ArcWeek | null` and the bundled directory into HTML.
- **Wiring:** the `/arc/[[path]]` route serves them, and `handleArc` serves the JSON.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), D1, KV, vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-arc-question-pages-design.md`

## Global Constraints

- **Copy:**
  - plain labels, no slogans;
  - the method sits behind `<details><summary>i</summary>…</details>`;
  - every table carries its source and its "as of" time, written like "22 Oct 2026, 16:00 UTC".
- **Money columns** are labelled "Received (USD)". The index counts USDC and other registered stablecoins, converted to
  USD.
- **Window:** the 168 closed hours ending at `dataUntil(db, "aei")`. In SQL: `hour > until - 168 AND hour <= until`.
- **Wallets:** only `new_payers` is summed. Hourly `wallets` are never summed.
- **No data:** pages 1–3 answer 200 with "Not available right now (source: Registrai index database)" in their data
  tables and "Data not available right now." as the opening sentence. Page 4 never touches D1. The API answers 503
  "Weekly data is not available right now."
- **Routes:**
  - `/arc/most-used-apps/`
  - `/arc/apps-that-accept-usdc/`
  - `/arc/new/`
  - `/arc/get-usdc/`

  A missing slash gets a 301. Only GET and HEAD are served, and other paths answer 404. Pages are edge-cached for 600 s.
- **Workers runtime:** no `process`. Deploys only from `abi-deploy`, and production only with the owner's OK.

## Review Focus

1. **No `DATA_DB` or no AEI file:** pages 1–3 answer 200 with the not-available text, and their directory tables still
   render. Page 4 is unaffected, and the API answers 503. Tests: Task 2, Task 3.
2. **Quiet week:**
   - no app with payments → "No measured app received payments in the 7 days to …" and no rows;
   - nothing new → "None this week".

   Test: Task 2.
3. **HTML in an app name from the AEI file:** escaped on every page. Test: Task 2.
4. **Window edge:** `first_hour === until - 168` is not new, and rows at `hour === until - 168` are outside the window.
   Test: Task 1.
5. **A member with rows only outside the window:** it isn't in `apps`, so it's absent from pages 1–3. Test: Task 1.

---

### Task 1: `loadArcWeek`

**Files:**
- Create: `builders-site/lib/arc-week.ts` and `builders-site/test/arc-week.test.ts`

**Interfaces:**
- **Produces:**
  - `type WeekApp = { id: string; name: string; href: string; category: string | null; usd: number; payments: number; new_payers: number; first_hour: number | null }`
  - `type ArcWeek = { until_hour: number; until: string; apps: WeekApp[] }`, with `apps` sorted by `usd` descending,
    then `name`
  - `computeArcWeek(env: Env): Promise<ArcWeek | null>`, uncached and never throwing
  - `loadArcWeek(env: Env, deps: EdgeCacheDeps): Promise<ArcWeek | null>`, edge-cached for 600 s under
    `https://builder.registrai.cc/__internal/arc-week`
  - `WINDOW_H = 168`

- [ ] **Step 1: Write the failing test**

```ts
// builders-site/test/arc-week.test.ts
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { ABI_INDICES } from "../../src/lib/builders-index";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

const E: ArcEntity[] = [
  { slug: "archery", name: "Archery", category: "dexs", status: "live", summary: "x", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://archery.wtf/" }], index_ids: ["domain:archery.wtf"], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

const U = 500_000;   // the AEI's last closed hour (unix hours)
async function setup() {
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  db.q("INSERT INTO index_hour (idx, hour, close) VALUES ('aei', ?, 1000)", U);
  const row = (id: string, hour: number, usdc: number, payments: number, newp: number) =>
    db.q("INSERT INTO member_hour (idx, id, hour, points, points_earned, payments, wallets, new_payers, usdc) VALUES ('aei', ?, ?, 1, 0, ?, 9, ?, ?)", id, hour, payments, newp, usdc);
  row("domain:archery.wtf", U, 100, 2, 1); row("domain:archery.wtf", U - 100, 50, 1, 1);
  row("domain:big.example", U - 1, 900, 3, 2);
  row("domain:old.example", U - 168, 5000, 9, 9);          // exactly at the edge: outside the window
  row("domain:quiet.example", U, 0, 0, 0);
  db.q("INSERT INTO member_first (idx, id, first_hour) VALUES ('aei','domain:archery.wtf',?), ('aei','domain:big.example',?), ('aei','domain:quiet.example',?)", U - 400, U - 10, U - 168);
  const kv = new MemoryKV();
  await kv.put(ABI_INDICES.aei.key, JSON.stringify({ data_until: "2026-10-22T16:00:00Z", projects: [
    { source: "domain:archery.wtf", name: "Archery" }, { source: "domain:big.example", name: "Big <b>App</b>" }, { source: "domain:quiet.example", name: "Quiet" }, { source: "domain:old.example", name: "Old" }] }));
  return { DATA_DB: db, INVITES: kv } as never;
}

describe("computeArcWeek", () => {
  test("sums the 168 hours ending at the last AEI close, sorted by USD; edge hour excluded; names from directory or AEI file", async () => {
    const { computeArcWeek } = await import("../lib/arc-week");
    const w = (await computeArcWeek(await setup()))!;
    expect(w.until_hour).toBe(U);
    expect(w.until).toBe(new Date(U * 3600e3).toISOString().replace(".000Z", "Z"));
    expect(w.apps.map((a) => a.id)).toEqual(["domain:big.example", "domain:archery.wtf", "domain:quiet.example"]);
    expect(w.apps[1]).toEqual({ id: "domain:archery.wtf", name: "Archery", href: "/ecosystem/archery/", category: "dexs", usd: 150, payments: 3, new_payers: 2, first_hour: U - 400 });
    expect(w.apps[0]).toMatchObject({ name: "Big <b>App</b>", category: null, usd: 900, first_hour: U - 10 });
    expect(w.apps.find((a) => a.id === "domain:old.example")).toBeUndefined();
  });
  test("no DATA_DB, no AEI close, or a D1 error → null (never throws)", async () => {
    const { computeArcWeek } = await import("../lib/arc-week");
    expect(await computeArcWeek({ INVITES: new MemoryKV() } as never)).toBeNull();
    const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
    expect(await computeArcWeek({ DATA_DB: db, INVITES: new MemoryKV() } as never)).toBeNull();
    expect(await computeArcWeek({ DATA_DB: { prepare: () => { throw new Error("d1 down"); } }, INVITES: new MemoryKV() } as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expecting failure**

Run: `npx vitest run builders-site/test/arc-week.test.ts`
Expected: FAIL (module `../lib/arc-week` missing).

- [ ] **Step 3: Implement**

```ts
// builders-site/lib/arc-week.ts
/**
 * Arc apps over the last 7 days (spec docs/superpowers/specs/2026-10-22-arc-question-pages-design.md): the 168 closed
 * AEI hours ending at the last close, summed per member. Only new_payers adds up across hours; hourly wallet counts are
 * never summed. Names and categories come from the directory when an entry claims the id, else from the AEI file.
 */
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { appHref } from "./app-href";
import { dataUntil, indexFile } from "./data-api";
import { isoHour } from "./data-api-rows";
import type { Env } from "./env";
import { edgeCache, type EdgeCacheDeps } from "./http";

export const WINDOW_H = 168;
export type WeekApp = { id: string; name: string; href: string; category: string | null; usd: number; payments: number; new_payers: number; first_hour: number | null };
export type ArcWeek = { until_hour: number; until: string; apps: WeekApp[] };
const KEY = "https://builder.registrai.cc/__internal/arc-week";
const TTL_S = 600;
const round2 = (x: number) => Math.round(x * 100) / 100;

export async function computeArcWeek(env: Env): Promise<ArcWeek | null> {
  const db = env.DATA_DB;
  if (!db) return null;
  try {
    const until = await dataUntil(db, "aei");
    if (until === null) return null;
    const [rows, aei] = await Promise.all([
      db.prepare(`SELECT m.id AS id, SUM(m.usdc) AS usd, SUM(m.payments) AS payments, SUM(m.new_payers) AS new_payers, f.first_hour AS first_hour
        FROM member_hour m LEFT JOIN member_first f ON f.idx = m.idx AND f.id = m.id
        WHERE m.idx = 'aei' AND m.hour > ?1 - ${WINDOW_H} AND m.hour <= ?1 GROUP BY m.id`).bind(until).all<{ id: string; usd: number; payments: number; new_payers: number; first_hour: number | null }>(),
      indexFile(env, "aei").catch(() => null),
    ]);
    const names = new Map((aei?.projects ?? []).map((p) => [p.source, p.name]));
    const apps = rows.results.map((r): WeekApp => {
      const e = ECOSYSTEM.byIndexId.get(r.id);
      return { id: r.id, name: e?.name ?? names.get(r.id) ?? r.id, href: appHref(r.id), category: e?.category ?? null,
        usd: round2(Number(r.usd) || 0), payments: Number(r.payments) || 0, new_payers: Number(r.new_payers) || 0, first_hour: r.first_hour == null ? null : Number(r.first_hour) };
    }).sort((a, b) => b.usd - a.usd || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { until_hour: until, until: isoHour(until), apps };
  } catch { return null; }
}

/** One computation shared by the four pages and the API, for 10 minutes. */
export async function loadArcWeek(env: Env, deps: EdgeCacheDeps): Promise<ArcWeek | null> {
  const cache = deps.cache === undefined ? edgeCache() : deps.cache;
  const key = new Request(KEY);
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return (await hit.json()) as ArcWeek;
  const w = await computeArcWeek(env);
  if (w && cache) {
    const put = cache.put(key, new Response(JSON.stringify(w), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${TTL_S}` } }));
    if (deps.waitUntil) deps.waitUntil(put); else await put;
  }
  return w;
}
```

If `indexFile`'s return type lacks `projects[].name`, read the names through
`(aei as { projects?: { source: string; name: string }[] } | null)?.projects`.

- [ ] **Step 4: Run it, expecting a pass**

Run: `npx vitest run builders-site/test/arc-week.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/arc-week.ts builders-site/test/arc-week.test.ts
git commit -m "arc questions: 7-day AEI totals per app (loadArcWeek)"
```

### Task 2: The four page renderers

**Files:**
- Create: `builders-site/lib/arc-question-pages.ts` and `builders-site/test/arc-question-pages.test.ts`

**Interfaces:**
- **Consumes:**
  - `ArcWeek` and `WeekApp` (Task 1);
  - `ECOSYSTEM` and `entityHref` from `src/lib/arc-ecosystem`;
  - `page` and `esc` from `./apps-pages`.
- **Produces:**
  - `renderMostUsed(w: ArcWeek | null): string`
  - `renderAcceptsUsdc(w: ArcWeek | null): string`
  - `renderNew(w: ArcWeek | null, today: string): string`. `today` is a `YYYY-MM-DD` string. When `w` is null, the
    "went live" window is the 7 days ending `today`.
  - `renderGetUsdc(): string`
  - `QUESTION_PAGES: { path: string; title: string }[]` in display order, reused by Task 3 for the `/arc/` list,
    the sitemap and llms.txt
  - `atHour(iso: string): string`, the date formatter ("22 Oct 2026, 16:00 UTC")

- [ ] **Step 1: Write the failing test**

```ts
// builders-site/test/arc-question-pages.test.ts
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

const ev = [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }];
const E = [
  { slug: "archery", name: "Archery", category: "dexs", status: "live", summary: "x", status_evidence: ev, sources: [{ url: "https://a.b/" }], index_ids: ["domain:archery.wtf"], first_live: "2026-10-20", last_reviewed: "2026-10-20" },
  { slug: "payco", name: "PayCo", category: "payments", status: "announced", summary: "x", status_evidence: [{ url: "https://payco.example/arc" }], sources: [{ url: "https://payco.example/" }], last_reviewed: "2026-10-20" },
  { slug: "rampx", name: "RampX", category: "ramps", status: "live", summary: "x", status_evidence: [{ url: "https://rampx.example/arc" }], sources: [{ url: "https://rampx.example/" }], last_reviewed: "2026-10-20" },
  { slug: "bridgy", name: "Bridgy", category: "bridges", status: "announced", summary: "x", status_evidence: [{ url: "https://bridgy.example/" }], sources: [{ url: "https://bridgy.example/" }], last_reviewed: "2026-10-20" },
] as ArcEntity[];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

const U = Date.parse("2026-10-22T16:00:00Z") / 3600e3;
const W = { until_hour: U, until: "2026-10-22T16:00:00Z", apps: [
  { id: "domain:big.example", name: "Big <b>App</b>", href: "/apps/big.example/", category: null, usd: 900.5, payments: 3, new_payers: 2, first_hour: U - 10 },
  { id: "domain:archery.wtf", name: "Archery", href: "/ecosystem/archery/", category: "dexs", usd: 150, payments: 3, new_payers: 2, first_hour: U - 400 },
  { id: "domain:quiet.example", name: "Quiet", href: "/apps/quiet.example/", category: null, usd: 0, payments: 0, new_payers: 0, first_hour: U - 168 },
] };
const ld = (h: string) => JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);

describe("question pages", () => {
  test("most used: dated first sentence, ranked by USD, escaped, source + i, ItemList", async () => {
    const { renderMostUsed } = await import("../lib/arc-question-pages");
    const h = renderMostUsed(W);
    expect(h).toContain("<h1>Most-used apps on Arc, last 7 days</h1>");
    expect(h).toContain("In the 7 days to 22 Oct 2026, 16:00 UTC, Big &lt;b&gt;App&lt;/b&gt; received the most in stablecoin payments of the 2 apps Registrai measures on Arc: $900.50.");
    expect(h.indexOf("Big &lt;b&gt;App")).toBeLessThan(h.indexOf(">Archery<"));
    expect(h).not.toContain(">Quiet<");
    expect(h).toContain("Received (USD)");
    expect(h).toContain("Source: Arc Ecosystem Index (Registrai), hourly, 7 days to 22 Oct 2026, 16:00 UTC.");
    expect(h).toMatch(/<details><summary>i<\/summary>[^<]*other registered stablecoins/);
    expect(ld(h)["@type"]).toBe("ItemList");
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/arc/most-used-apps/">');
  });
  test("quiet week and no data", async () => {
    const { renderMostUsed, renderNew } = await import("../lib/arc-question-pages");
    const quiet = { ...W, apps: [W.apps[2]] };
    expect(renderMostUsed(quiet)).toContain("No measured app received payments in the 7 days to 22 Oct 2026, 16:00 UTC.");
    const none = renderMostUsed(null);
    expect(none).toContain("Data not available right now.");
    expect(none).toContain("Not available right now (source: Registrai index database)");
    expect(renderNew({ ...W, apps: [W.apps[1]] }, "2026-10-22")).toContain("None this week");
  });
  test("accepts USDC: measured table, then listed-not-measured payment apps", async () => {
    const { renderAcceptsUsdc } = await import("../lib/arc-question-pages");
    const h = renderAcceptsUsdc(W);
    expect(h).toContain("2 apps on Arc received stablecoin payments in the 7 days to 22 Oct 2026, 16:00 UTC. 1 more payment apps list USDC on Arc but are not measured by Registrai.");
    expect(h.indexOf("<h2>Measured</h2>")).toBeLessThan(h.indexOf("<h2>Listed, not measured</h2>"));
    expect(h).toContain('href="/ecosystem/payco/"');
    expect(h).toContain('href="https://payco.example/arc"');
    const down = renderAcceptsUsdc(null);
    expect(down).toContain("Not available right now (source: Registrai index database)");
    expect(down).toContain('href="/ecosystem/payco/"');   // the directory part still renders
  });
  test("new: went live within 7 days, started receiving payments within the window (edge hour excluded)", async () => {
    const { renderNew } = await import("../lib/arc-question-pages");
    const h = renderNew(W, "2026-10-22");
    expect(h).toContain("In the 7 days to 22 Oct 2026, 16:00 UTC, 1 projects in the directory went live on Arc and 1 apps started receiving payments in Registrai's index.");
    expect(h).toContain('href="/ecosystem/archery/">Archery</a></td><td>DEXs</td><td>2026-10-20');
    expect(h).toContain("Big &lt;b&gt;App&lt;/b&gt;");
    expect(h).not.toContain(">Quiet<");     // first_hour === until - 168: not new
  });
  test("get USDC: three sections, live/deployed in the table, announced listed apart", async () => {
    const { renderGetUsdc } = await import("../lib/arc-question-pages");
    const h = renderGetUsdc();
    expect(h).toContain("USDC reaches Arc three ways: buy it through an on-ramp, withdraw it from an exchange that supports the Arc network, or bridge it from another chain.");
    for (const s of ["<h2>On-ramps</h2>", "<h2>Exchanges</h2>", "<h2>Bridges</h2>"]) expect(h).toContain(s);
    expect(h).toContain('href="/ecosystem/rampx/"');
    expect(h).toMatch(/Announced[^]*Bridgy/);
  });
});
```

- [ ] **Step 2: Run it, expecting failure**

Run: `npx vitest run builders-site/test/arc-question-pages.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// builders-site/lib/arc-question-pages.ts
/** The Arc question pages (spec docs/superpowers/specs/2026-10-22-arc-question-pages-design.md). Pure: data in, HTML out. */
import { STATUS_LABEL, categoryOf, entityHref, sortByName, type ArcEntity, type EntityStatus } from "../../src/lib/arc-ecosystem";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { esc, page } from "./apps-pages";
import { WINDOW_H, type ArcWeek, type WeekApp } from "./arc-week";

const SITE = "https://builder.registrai.cc";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const atHour = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };
const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (x: number) => x.toLocaleString("en-US");
const NA = `<p class="muted">Not available right now (source: Registrai index database).</p>`;
const METHOD = "Payments into each app's contracts in USDC and other registered stablecoins, converted to USD, as attributed by the Arc Ecosystem Index. New paying wallets: wallets paying the app for the first time.";
const catName = (id: string | null) => (id ? categoryOf(id)?.name ?? id : "–");
const appLink = (a: WeekApp) => `<a href="${esc(a.href)}">${esc(a.name)}</a>`;
const entLink = (e: ArcEntity) => `<a href="${entityHref(e.slug)}">${esc(e.name)}</a>`;
const evidence = (e: ArcEntity) => (e.status_evidence[0] ? `<a href="${esc(e.status_evidence[0].url)}" rel="noreferrer">Evidence</a>` : "–");
const source = (w: ArcWeek) => `<p class="muted">Source: Arc Ecosystem Index (Registrai), hourly, 7 days to ${esc(atHour(w.until))}. <details><summary>i</summary> ${esc(METHOD)}</details></p>`;
const table = (head: string[], rows: string[][]) => `<div class="wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n")}
</tbody></table></div>`;
const itemList = (path: string, name: string, items: string[]) => ({ "@context": "https://schema.org", "@type": "ItemList", name, url: `${SITE}${path}`,
  itemListElement: items.slice(0, 100).map((n, i) => ({ "@type": "ListItem", position: i + 1, name: n })) });
const STATUS_ORDER: Record<EntityStatus, number> = { live: 0, deployed: 1, announced: 2 };
const inCat = (e: ArcEntity, id: string) => e.category === id || (e.tags ?? []).includes(id as never);

export const QUESTION_PAGES = [
  { path: "/arc/most-used-apps/", title: "Most-used apps on Arc, last 7 days" },
  { path: "/arc/apps-that-accept-usdc/", title: "Apps that accept USDC on Arc" },
  { path: "/arc/new/", title: "New on Arc this week" },
  { path: "/arc/get-usdc/", title: "How to get USDC onto Arc" },
] as const;

function shell(path: string, title: string, first: string, body: string, items: string[]): string {
  return page({ title: `${title} · Registrai`, canonical: `${SITE}${path}`, description: first,
    body: `<h1>${esc(title)}</h1>\n<p>${esc(first)}</p>\n${body}\n<p class="muted"><a href="/arc/">Arc in numbers</a> · <a href="/ecosystem/">Arc ecosystem</a></p>`, ld: itemList(path, title, items) });
}

export function renderMostUsed(w: ArcWeek | null): string {
  const [path, title] = [QUESTION_PAGES[0].path, QUESTION_PAGES[0].title];
  if (!w) return shell(path, title, "Data not available right now.", NA, []);
  const paid = w.apps.filter((a) => a.payments > 0);
  const first = paid.length && paid[0].usd > 0
    ? `In the 7 days to ${atHour(w.until)}, ${paid[0].name} received the most in stablecoin payments of the ${paid.length} apps Registrai measures on Arc: ${usd(paid[0].usd)}.`
    : `No measured app received payments in the 7 days to ${atHour(w.until)}.`;
  const rows = paid.map((a, i) => [String(i + 1), appLink(a), esc(catName(a.category)), usd(a.usd), int(a.payments), int(a.new_payers)]);
  return shell(path, title, first, `${paid.length ? table(["#", "App", "Category", "Received (USD)", "Payments", "New paying wallets"], rows) : ""}\n${source(w)}`, paid.map((a) => a.name));
}

export function renderAcceptsUsdc(w: ArcWeek | null): string {
  const [path, title] = [QUESTION_PAGES[1].path, QUESTION_PAGES[1].title];
  const measuredIds = new Set((w?.apps ?? []).filter((a) => a.payments > 0).map((a) => a.id));
  const listed = ECOSYSTEM.entities.filter((e) => inCat(e, "payments") && !(e.index_ids ?? []).some((id) => measuredIds.has(id)))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.name < b.name ? -1 : 1));
  const listedHtml = `<h2>Listed, not measured</h2>\n${listed.length ? table(["Project", "Status", "Evidence"], listed.map((e) => [entLink(e), esc(STATUS_LABEL[e.status]), evidence(e)])) : "<p>None.</p>"}`;
  if (!w) return shell(path, title, "Data not available right now.", `<h2>Measured</h2>\n${NA}\n${listedHtml}`, listed.map((e) => e.name));
  const paid = w.apps.filter((a) => a.payments > 0);
  const first = `${paid.length} apps on Arc received stablecoin payments in the 7 days to ${atHour(w.until)}. ${listed.length} more payment apps list USDC on Arc but are not measured by Registrai.`;
  const measured = paid.length ? table(["App", "Category", "Payments (7 d)", "Received (USD, 7 d)"], paid.map((a) => [appLink(a), esc(catName(a.category)), int(a.payments), usd(a.usd)])) : "<p>None this week.</p>";
  return shell(path, title, first, `<h2>Measured</h2>\n${measured}\n${source(w)}\n${listedHtml}`, [...paid.map((a) => a.name), ...listed.map((e) => e.name)]);
}

const minusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);

export function renderNew(w: ArcWeek | null, today: string): string {
  const [path, title] = [QUESTION_PAGES[2].path, QUESTION_PAGES[2].title];
  const end = w ? w.until.slice(0, 10) : today, start = minusDays(end, 7);
  const live = sortByName(ECOSYSTEM.entities.filter((e) => e.first_live && e.first_live > start && e.first_live <= end));
  const liveHtml = `<h2>Went live</h2>\n${live.length ? table(["Project", "Category", "Live since"], live.map((e) => [entLink(e), esc(catName(e.category)), esc(e.first_live!)])) : "<p>None this week.</p>"}`;
  if (!w) return shell(path, title, "Data not available right now.", `${liveHtml}\n<h2>Started receiving payments</h2>\n${NA}`, live.map((e) => e.name));
  const fresh = w.apps.filter((a) => a.first_hour !== null && a.first_hour > w.until_hour - WINDOW_H && a.first_hour <= w.until_hour);
  const first = `In the 7 days to ${atHour(w.until)}, ${live.length} projects in the directory went live on Arc and ${fresh.length} apps started receiving payments in Registrai's index.`;
  const freshHtml = `<h2>Started receiving payments</h2>\n${fresh.length ? table(["App", "First payment hour", "Payments (7 d)"], fresh.map((a) => [appLink(a), esc(atHour(new Date(a.first_hour! * 3600e3).toISOString())), int(a.payments)])) : "<p>None this week.</p>"}\n${source(w)}`;
  return shell(path, title, first, `${liveHtml}\n${freshHtml}`, [...live.map((e) => e.name), ...fresh.map((a) => a.name)]);
}

export function renderGetUsdc(): string {
  const [path, title] = [QUESTION_PAGES[3].path, QUESTION_PAGES[3].title];
  const first = "USDC reaches Arc three ways: buy it through an on-ramp, withdraw it from an exchange that supports the Arc network, or bridge it from another chain.";
  const names: string[] = [];
  const section = (id: string, h: string) => {
    const all = sortByName(ECOSYSTEM.entities.filter((e) => inCat(e, id)));
    const main = all.filter((e) => e.status !== "announced"), ann = all.filter((e) => e.status === "announced");
    names.push(...main.map((e) => e.name));
    return `<h2>${h}</h2>\n${main.length ? table(["Project", "Status", "Evidence"], main.map((e) => [entLink(e), esc(STATUS_LABEL[e.status]), evidence(e)])) : "<p>None live yet.</p>"}${ann.length ? `\n<p class="muted">Announced: ${ann.map(entLink).join(", ")}</p>` : ""}`;
  };
  const body = [section("ramps", "On-ramps"), section("exchanges", "Exchanges"), section("bridges", "Bridges"),
    `<p class="muted">Source: Registrai Arc ecosystem directory; each status links its evidence. Last reviewed ${esc(ECOSYSTEM.entities.map((e) => e.last_reviewed).sort().pop() ?? "")}.</p>`].join("\n");
  return shell(path, title, first, body, names);
}
```

`STATUS_LABEL` and `sortByName` are already exported by `src/lib/arc-ecosystem.ts`. `categoryOf(id)?.name` is the
short category name ("DEXs").

The test for `renderNew` expects the row `href="/ecosystem/archery/">Archery</a></td><td>DEXs</td><td>2026-10-20`. If
the category name for `dexs` isn't "DEXs", use the real name in the test, since the test asserts `categoryOf("dexs").name`.

- [ ] **Step 4: Run it, expecting a pass**

Run: `npx vitest run builders-site/test/arc-question-pages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/arc-question-pages.ts builders-site/test/arc-question-pages.test.ts
git commit -m "arc questions: four page renderers (most used, accepts USDC, new, get USDC)"
```

### Task 3: Routes, the Questions list on `/arc/`, the sitemap and llms.txt

**Files:**
- Modify:
  - `builders-site/functions/arc/[[path]].ts`
  - `builders-site/lib/arc-pages.ts`
  - `builders-site/lib/sitemap-urls.ts`
  - `builders-site/functions/llms.txt.ts`
  - `public/llms.txt`
- Test:
  - `builders-site/test/arc-question-pages.test.ts`, with a route describe appended
  - `builders-site/test/arc-pages.test.ts`
  - `builders-site/test/sitemap-urls.test.ts`
  - the existing llms.txt test file. Find it with `grep -rln "llms" builders-site/test src/lib`.

**Interfaces:**
- **Consumes:** `loadArcWeek` (Task 1); the renderers and `QUESTION_PAGES` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `builders-site/test/arc-question-pages.test.ts`:

```ts
describe("question page routes", () => {
  const call = async (path: string, env: Record<string, unknown> = {}, method = "GET") => {
    const { onRequest } = await import("../functions/arc/[[path]]");
    const u = new URL(`https://builder.registrai.cc${path}`);
    return onRequest({ request: new Request(u, { method }), env: { INVITES: { get: async () => null }, ...env },
      params: { path: u.pathname.replace(/^\/arc\/?/, "").split("/").filter(Boolean) }, waitUntil: () => undefined } as never);
  };
  test("each page answers 200 even without DATA_DB; get-usdc never needs it; slash 301; unknown 404; HEAD empty", async () => {
    for (const p of ["/arc/most-used-apps/", "/arc/apps-that-accept-usdc/", "/arc/new/", "/arc/get-usdc/"]) {
      const r = await call(p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get("cache-control"), p).toBe("public, max-age=600");
    }
    expect(await (await call("/arc/most-used-apps/")).text()).toContain("Not available right now");
    expect(await (await call("/arc/get-usdc/")).text()).toContain("USDC reaches Arc three ways");
    expect((await call("/arc/new")).status).toBe(301);
    expect((await call("/arc/other/")).status).toBe(404);
    expect(await (await call("/arc/new/", {}, "HEAD")).text()).toBe("");
  });
});
```

In `builders-site/test/arc-pages.test.ts`, inside the first test, add:

```ts
    expect(h).toContain("<h2>Questions</h2>");
    expect(h).toContain('<a href="/arc/most-used-apps/">Most-used apps on Arc, last 7 days</a>');
```

In `builders-site/test/sitemap-urls.test.ts`, inside the "ecosystem in the sitemap" test, add:

```ts
    for (const p of ["most-used-apps", "apps-that-accept-usdc", "new", "get-usdc"]) expect(locs).toContain(`https://builder.registrai.cc/arc/${p}/`);
```

In the llms.txt test, add an assertion that both the function's output and `public/llms.txt` contain
`https://builder.registrai.cc/arc/most-used-apps/`. If there's no llms.txt test, add this to
`builders-site/test/arc-question-pages.test.ts`:

```ts
test("llms.txt lists the question pages", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  expect(readFileSync(resolve(__dirname, "../../public/llms.txt"), "utf8")).toContain("https://builder.registrai.cc/arc/most-used-apps/");
  const { onRequest } = await import("../functions/llms.txt");
  expect(await (await onRequest({ request: new Request("https://builder.registrai.cc/llms.txt"), env: {} } as never)).text()).toContain("https://builder.registrai.cc/arc/get-usdc/");
});
```

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run builders-site/test/arc-question-pages.test.ts builders-site/test/arc-pages.test.ts builders-site/test/sitemap-urls.test.ts`
Expected: FAIL. The routes answer 404, and the Questions list and sitemap URLs are missing.

- [ ] **Step 3: Implement**

`builders-site/functions/arc/[[path]].ts`: replace the single-path guard and the body with:

```ts
import { loadArcWeek } from "../../lib/arc-week";
import { renderAcceptsUsdc, renderGetUsdc, renderMostUsed, renderNew } from "../../lib/arc-question-pages";
// …
const QUESTIONS: Record<string, (env: Parameters<typeof loadArcWeek>[0], deps: Parameters<typeof loadArcWeek>[1]) => Promise<string>> = {
  "most-used-apps": async (env, deps) => renderMostUsed(await loadArcWeek(env, deps)),
  "apps-that-accept-usdc": async (env, deps) => renderAcceptsUsdc(await loadArcWeek(env, deps)),
  "new": async (env, deps) => renderNew(await loadArcWeek(env, deps), new Date().toISOString().slice(0, 10)),
  "get-usdc": async () => renderGetUsdc(),
};

export const onRequest: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const head = m === "HEAD";
  const asHead = (res: Response) => (head ? new Response(null, { status: res.status, headers: res.headers }) : res);
  if (parts.length === 1 && Object.hasOwn(QUESTIONS, parts[0])) {
    const q = parts[0];
    return asHead(await edgeCachedGet(new Request(`${url.origin}/arc/${q}/`), deps, async () => html(await QUESTIONS[q](ctx.env, deps)), 600, `arc-q:${q}`));
  }
  if (parts.length) return html(renderEcosystemNotFound(), 404, head);
  const res = await edgeCachedGet(new Request(`${url.origin}/arc/`), deps, async () => {
    const [n, history] = await Promise.all([collectArcNumbers(ctx.env), ctx.env.DATA_DB ? readArcDaily(ctx.env.DATA_DB, 30).catch(() => []) : Promise.resolve([])]);
    return html(renderArc(n, history));
  }, 600, "arc");
  return asHead(res);
};
```

`builders-site/lib/arc-pages.ts`:
- Import `QUESTION_PAGES` from `./arc-question-pages`.
- In `renderArc`'s body, insert this just before `<h2>History</h2>`:

```ts
<h2>Questions</h2>
<ul>${QUESTION_PAGES.map((q) => `<li><a href="${q.path}">${esc(q.title)}</a></li>`).join("")}</ul>
```

`builders-site/lib/sitemap-urls.ts`:
- Import `QUESTION_PAGES`.
- In `ecoUrls`, after `at("/arc/", mod ?? ecoMod)`, add
  `...QUESTION_PAGES.map((q) => at(q.path, q.path === "/arc/get-usdc/" ? ecoMod : mod ?? ecoMod))`.

`builders-site/functions/llms.txt.ts` and `public/llms.txt`: after the "Arc in numbers" line, add four lines in the
same format:

```
- [Most-used apps on Arc, last 7 days](https://builder.registrai.cc/arc/most-used-apps/): apps ranked by stablecoin payments received (USD), payments and new paying wallets; JSON at https://builder.registrai.cc/api/v1/arc/apps-week
- [Apps that accept USDC on Arc](https://builder.registrai.cc/arc/apps-that-accept-usdc/): apps measured receiving payments in the last 7 days, and payment apps listed but not measured
- [New on Arc this week](https://builder.registrai.cc/arc/new/): projects that went live and apps that started receiving payments in the last 7 days
- [How to get USDC onto Arc](https://builder.registrai.cc/arc/get-usdc/): on-ramps, exchanges and bridges for Arc, each with its evidence
```

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run builders-site/test/arc-question-pages.test.ts builders-site/test/arc-pages.test.ts builders-site/test/sitemap-urls.test.ts`
Then run the llms.txt test.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/functions/arc builders-site/lib/arc-pages.ts builders-site/lib/sitemap-urls.ts builders-site/functions/llms.txt.ts public/llms.txt builders-site/test
git commit -m "arc questions: routes under /arc/, Questions list on /arc/, sitemap and llms.txt"
```

### Task 4: API `/api/v1/arc/apps-week`, docs, OpenAPI, MCP `arc_apps_week`

**Files:**
- Modify:
  - `builders-site/lib/data-api-arc.ts`
  - `src/lib/data-api-docs.ts` and its test
  - `src/lib/data-api-openapi.ts`
  - `builders-site/lib/mcp.ts`
  - `builders-site/test/mcp.test.ts`
- Create: `docs/superpowers/specs/data-api-v1-fixtures/arc-apps-week.json`
- Test: `builders-site/test/arc-week.test.ts`, with an API describe appended

**Interfaces:**
- **Consumes:** `loadArcWeek` and `WINDOW_H` (Task 1).
- **Produces:** `GET /api/v1/arc/apps-week` → `{ version: 1, until, window_hours: 168, apps: WeekApp[] }`, or 503.

- [ ] **Step 1: Write the failing tests**

Append to `builders-site/test/arc-week.test.ts`:

```ts
describe("API /api/v1/arc/apps-week", () => {
  test("returns the week; 503 without data", async () => {
    const { handleArc } = await import("../lib/data-api-arc");
    const req = new Request("https://builder.registrai.cc/api/v1/arc/apps-week");
    const r = await handleArc(req, await setup(), { cache: null }, ["apps-week"]);
    expect(r.status).toBe(200);
    const b = await r.json() as { version: number; window_hours: number; apps: { id: string }[] };
    expect(b).toMatchObject({ version: 1, window_hours: 168 });
    expect(b.apps[0].id).toBe("domain:big.example");
    const none = await handleArc(req, { INVITES: new MemoryKV() } as never, { cache: null }, ["apps-week"]);
    expect(none.status).toBe(503);
  });
});
```

`src/lib/data-api-docs.test.ts`: the expected path list becomes

```ts
["/indices", "/indices/{index}/hourly", "/members", "/members/{id}/hourly", "/members/hourly", "/members/new", "/verified", "/ecosystem", "/ecosystem/{slug}", "/ecosystem/corrections", "/arc", "/arc/daily", "/arc/apps-week"]
```

`builders-site/test/mcp.test.ts`:
- Change both `toHaveLength(16)` to `toHaveLength(17)`, and the comment to `11 free + 6 paid (x402)`.
- Add a test that `tools/list` includes
  `{ name: "arc_apps_week", title: "Arc apps, last 7 days" }`. Follow the existing per-tool title assertion in that file.

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run builders-site/test/arc-week.test.ts builders-site/test/mcp.test.ts src/lib/data-api-docs.test.ts`
Expected: FAIL. The API answers 404, there are 16 tools, and the path list is short.

- [ ] **Step 3: Implement**

`builders-site/lib/data-api-arc.ts`:
- Import `loadArcWeek` and `WINDOW_H` from `./arc-week`.
- Before the final 404, add the block below.
- Change the 404 text to "Not found. Use /api/v1/arc, /api/v1/arc/daily or /api/v1/arc/apps-week."

```ts
  if (parts.length === 1 && parts[0] === "apps-week") {
    return cached(req, deps, "arc-apps-week", async () => {
      const w = await loadArcWeek(env, deps);
      return w ? v1Json(req, { version: 1, until: w.until, window_hours: WINDOW_H, apps: w.apps }, 600) : v1Error(503, "Weekly data is not available right now.");
    }, 600);
  }
```

`src/lib/data-api-docs.ts`:
- Add this after the `/arc/daily` entry:

```ts
  { method: "GET", path: "/arc/apps-week", params: "none", returns: "Apps on Arc over the last 7 days (168 closed hours of the Arc Ecosystem Index): stablecoin payments received in USD, payments, new paying wallets and the first hour each app received payments, ranked by USD.",
    example: curl("/arc/apps-week") },
```

- Append to `CHANGELOG`: `{ date: "2026-10-22", text: "Arc apps over 7 days: /arc/apps-week." }`.

`docs/superpowers/specs/data-api-v1-fixtures/arc-apps-week.json`:

```json
{ "version": 1, "until": "2026-10-22T16:00:00Z", "window_hours": 168, "apps": [
  { "id": "domain:archery.wtf", "name": "Archery", "href": "/ecosystem/archery/", "category": "dexs", "usd": 150, "payments": 3, "new_payers": 2, "first_hour": 499600 } ] }
```

`src/lib/data-api-openapi.ts`:
- Import the fixture as `arcAppsWeek`.
- Add a path after `"/arc/daily"` (below).
- Add the component schema below: `category` and `first_hour` are nullable.

```ts
    "/arc/apps-week": op("listArcAppsWeek", "Apps on Arc over the last 7 days", "ArcAppsWeek"),
```
```ts
      ArcAppsWeek: nullable(nullable(schemaOf(arcAppsWeek), ["apps", "category"]), ["apps", "first_hour"]),
```

`nullable` walks `properties`. For an array item path, read how `nullable` handles `items`. If it doesn't descend into
`items`, set the two item properties directly:

```ts
      ArcAppsWeek: (() => { const s = schemaOf(arcAppsWeek); const it = s.properties!.apps.items!; for (const k of ["category", "first_hour"]) it.properties![k] = { type: [it.properties![k].type, "null"] as unknown as string }; return s; })(),
```

`builders-site/lib/mcp.ts`:
- After the `arc_numbers` tool entry, add the tool entry below.
- In the call switch, add the case below.
- Import `handleArc` if it isn't already imported (it is, for `arc_numbers`).

```ts
  tool("arc_apps_week", "Arc apps, last 7 days", "Apps on Arc ranked by stablecoin payments received in the last 7 days (USD, payments, new paying wallets) and when each first received payments. Use this when asked which apps on Arc are most used, which accept USDC, or what is new on Arc.", obj({})),
```
```ts
    case "arc_apps_week": return viaApi(`${API}/arc/apps-week`, (q) => handleArc(q, env, d, ["apps-week"]));
```

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run builders-site/test/arc-week.test.ts builders-site/test/mcp.test.ts src/lib/data-api-docs.test.ts src/lib/data-api-openapi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/data-api-arc.ts builders-site/lib/mcp.ts builders-site/test src/lib/data-api-docs.ts src/lib/data-api-docs.test.ts src/lib/data-api-openapi.ts docs/superpowers/specs/data-api-v1-fixtures/arc-apps-week.json
git commit -m "arc questions: /api/v1/arc/apps-week, docs and OpenAPI, MCP arc_apps_week"
```

### Task 5: Full suite, preview, production

- [ ] **Step 1: Full verification**

Run: `npx vitest run > /tmp/arcq-suite.txt 2>&1; tail -6 /tmp/arcq-suite.txt; npm run typecheck; npm run lint`
Expected:
- all pass except the known `src/lib/drafts.test.ts` failure (a path outside the worktree);
- typecheck is clean;
- lint shows only the existing `arcDaily` warning.

- [ ] **Step 2: Preview**

In `.worktrees/abi-deploy`:
```
git checkout -q --detach <head>
npm run build
bash scripts/build-builders-site.sh
```
Then, from `builders-site`, with `CLOUDFLARE_ACCOUNT_ID=a86f3fc238f9db2d41b52e2dddb80372`:
```
npx wrangler pages deploy ../dist-builders --project-name=registrai-builders --branch=arc-questions --commit-dirty=true
```

Check:
- the four pages and `/api/v1/arc/apps-week` on `https://arc-questions.registrai-builders.pages.dev`;
- the first sentences carry today's data and the tables have rows;
- `/arc/` shows the Questions list.

- [ ] **Step 3: Production**, with the owner's OK

Run `bash scripts/deploy-builders-site.sh` from `abi-deploy`. Recheck the four pages on builder.registrai.cc. Then
ping IndexNow for the four URLs, using the existing `pingIndexNow` path or a one-off POST to
`https://api.indexnow.org/indexnow` with the site key.
