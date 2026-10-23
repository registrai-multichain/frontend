# Methodology Page and 7-Day Attributed Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** This plan does two things.
- **The page:** publish `/methodology/`, a versioned glossary, sources, attributed-share, limits and changelog page.
  It reads the index's own parameters.
- **The share:** replace every single-day "share attributed" with a labelled 7-day share and its daily range, on
  `/arc/`, `/apps/` and the API.

**Architecture:** a pure `share7d(snapshots)` over the existing `arc_daily` snapshots feeds three places:
- the `/arc/` share row, which already has 30 snapshots;
- the `/apps/` note, whose route reads 7;
- `/api/v1/arc`, which adds `attributed_share_7d`.

`renderMethodology` is a pure renderer of the AEI `params`, its `live.base_window`/`base_scale`, the 7-day share and
`data_until`. A Pages Function at `/methodology/` serves it.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), D1, KV, vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-methodology-page-design.md`

## Global Constraints

- **Copy:**
  - plain labels, no slogans;
  - each section opens with a one-sentence definition;
  - every number on the methodology page comes from live data at render time, with its "as of".
- **Share labels:**
  - "7 days" only when 7 usable snapshots exist;
  - otherwise "24 h" (1 snapshot) or "last {n} days" (2–6);
  - "Not available right now" when there are none;
  - no page shows an unlabelled share.
- **Usable snapshot:** `activity_24h.app_usd` and `activity_24h.usdc_moved_usd_est` are both finite numbers, and the
  latter is > 0.
- **Rounding:** `pct = sum(app_usd) / sum(usdc_moved_usd_est) × 100`. `daily_min` and `daily_max` are the min and max of
  each day's own share. All are rounded to 2 dp.
- **`/methodology/` route:**
  - GET and HEAD only;
  - `/methodology` → 301;
  - subpaths → 404;
  - edge-cached for 600 s.
- **Version and date:** `"1"` and `"2026-10-22"`.
- **No change to how the indices compute.**
- **Ruling, planned:** the spec says the `ArcNumbers` type gains `attributed_share_7d`. `ArcNumbers` is also the shape of
  each stored daily snapshot, and of `/api/v1/arc/daily` items. Adding the field there would make every stored snapshot
  "invalid" against the OpenAPI schema. So `attributed_share_7d` is added only to the `/api/v1/arc` response, in
  `handleArc`, with its own OpenAPI schema, `ArcNow`. `ArcDaily` is unchanged. The spec's requirement is that the API
  gains the field and the 24 h field stays; both hold.
- **Workers runtime:** no `process`. Deploys only from `abi-deploy`, and production only with the owner's OK.

## Review Focus

1. **Short history:**
   - 0 snapshots → null → "Not available right now";
   - 1 → "24 h";
   - 2–6 → "last {n} days";
   - 7 → "7 days".

   Test: Task 1, Task 2.
2. **A snapshot with a 0 or null denominator, or null `app_usd`:** skipped, never NaN or Infinity. Test: Task 1.
3. **AEI file missing (params null):** glossary sentences drop the numbers and stay grammatical, with no "undefined" or
   "NaN" in the HTML. Test: Task 3.
4. **Anchors:**
   - glossary ids are unique;
   - every `/methodology/#…` link emitted by `/apps/`, `/arc/` and the question pages points to an id that exists.

   Test: Task 3.
5. **No unlabelled share anywhere:** the rendered `/apps/` and `/arc/` contain no "% of the estimated … in the same
   24 h" sentence from before. Test: Task 2.

---

### Task 1: `share7d`

**Files:**
- Create: `builders-site/lib/arc-share.ts` and `builders-site/test/arc-share.test.ts`

**Interfaces:**
- **Produces:**
  - `type Share7d = { window_days: number; until: string; pct: number; daily_min: number; daily_max: number; complete: boolean }`
  - `share7d(days: ArcNumbers[]): Share7d | null`. Input is newest first (as `readArcDaily` returns it); at most 7
    usable snapshots are used.
  - `shareLabel(s: Share7d): string`, which returns "7 days", "24 h" or "last {n} days"
  - `shareText(s: Share7d | null): string`. With a share it returns "{pct}% over {label} to {d} (daily {min}–{max}%)".
    The "(daily …)" part is omitted when `window_days === 1`. Without one it returns "Not available right now". `{d}` is
    the `until` date as "22 Oct 2026".

- [ ] **Step 1: Write the failing test**

```ts
// builders-site/test/arc-share.test.ts
import { describe, expect, test } from "vitest";
import { share7d, shareLabel, shareText } from "../lib/arc-share";

const snap = (day: string, app: number | null, moved: number | null) =>
  ({ generated_at: `${day}T00:02:00.000Z`, activity_24h: { data_until: `${day}T00:00:00Z`, app_usd: app, usdc_moved_usd_est: moved } }) as never;

describe("share7d", () => {
  test("seven usable days: sums, daily range, complete", () => {
    const days = [snap("2026-10-28", 10, 100), snap("2026-10-27", 1, 100), snap("2026-10-26", 34, 100), snap("2026-10-25", 5, 100),
      snap("2026-10-24", 5, 100), snap("2026-10-23", 5, 100), snap("2026-10-22", 5, 100), snap("2026-10-21", 99, 100)];
    expect(share7d(days)).toEqual({ window_days: 7, until: "2026-10-28T00:00:00Z", pct: 9.29, daily_min: 1, daily_max: 34, complete: true });
  });
  test("skips unusable days (null, zero or missing denominator); never NaN", () => {
    const s = share7d([snap("2026-10-23", 5, 0), snap("2026-10-22", null, 100), snap("2026-10-21", 2, 100)])!;
    expect(s).toEqual({ window_days: 1, until: "2026-10-21T00:00:00Z", pct: 2, daily_min: 2, daily_max: 2, complete: false });
    expect(share7d([snap("2026-10-23", 5, 0)])).toBeNull();
    expect(share7d([])).toBeNull();
  });
  test("labels and text", () => {
    const one = share7d([snap("2026-10-22", 5, 100)])!;
    const three = share7d([snap("2026-10-23", 1, 100), snap("2026-10-22", 3, 100), snap("2026-10-21", 5, 100)])!;
    expect(shareLabel(one)).toBe("24 h");
    expect(shareLabel(three)).toBe("last 3 days");
    expect(shareText(one)).toBe("5.00% over 24 h to 22 Oct 2026");
    expect(shareText(three)).toBe("3.00% over last 3 days to 23 Oct 2026 (daily 1.00–5.00%)");
    expect(shareText(null)).toBe("Not available right now");
  });
});
```

- [ ] **Step 2: Run it, expecting failure**

Run: `npx vitest run builders-site/test/arc-share.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// builders-site/lib/arc-share.ts
/** The 7-day attributed share (spec docs/superpowers/specs/2026-10-22-methodology-page-design.md §2): app USD ÷ estimated
 *  USDC moved on Arc, summed over the newest 7 usable daily snapshots, with each day's own share as the range. */
import type { ArcNumbers } from "./arc-numbers";

export type Share7d = { window_days: number; until: string; pct: number; daily_min: number; daily_max: number; complete: boolean };
const WINDOW = 7;
const round2 = (x: number) => Math.round(x * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function share7d(days: ArcNumbers[]): Share7d | null {
  const use = days.filter((d) => finite(d?.activity_24h?.app_usd) && finite(d?.activity_24h?.usdc_moved_usd_est) && d.activity_24h.usdc_moved_usd_est! > 0).slice(0, WINDOW);
  if (!use.length) return null;
  const app = use.reduce((s, d) => s + d.activity_24h.app_usd!, 0), moved = use.reduce((s, d) => s + d.activity_24h.usdc_moved_usd_est!, 0);
  const daily = use.map((d) => (100 * d.activity_24h.app_usd!) / d.activity_24h.usdc_moved_usd_est!);
  return { window_days: use.length, until: use[0].activity_24h.data_until ?? use[0].generated_at, pct: round2((100 * app) / moved),
    daily_min: round2(Math.min(...daily)), daily_max: round2(Math.max(...daily)), complete: use.length === WINDOW };
}

export const shareLabel = (s: Share7d) => (s.complete ? "7 days" : s.window_days === 1 ? "24 h" : `last ${s.window_days} days`);
export function shareText(s: Share7d | null): string {
  if (!s) return "Not available right now";
  const range = s.window_days > 1 ? ` (daily ${s.daily_min.toFixed(2)}–${s.daily_max.toFixed(2)}%)` : "";
  return `${s.pct.toFixed(2)}% over ${shareLabel(s)} to ${day(s.until)}${range}`;
}
```

- [ ] **Step 4: Run it, expecting a pass**

Run: `npx vitest run builders-site/test/arc-share.test.ts`
Expected: PASS. Check the arithmetic in the first case: (10+1+34+5+5+5+5)/700 = 65/700 = 9.2857 → 9.29.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/arc-share.ts builders-site/test/arc-share.test.ts
git commit -m "methodology: 7-day attributed share from daily snapshots (share7d)"
```

### Task 2: Labelled share on `/arc/`, `/apps/` and `/api/v1/arc`

**Files:**
- Modify:
  - `builders-site/lib/arc-pages.ts`
  - `builders-site/lib/apps-pages.ts`
  - `builders-site/functions/apps/[[path]].ts`
  - `builders-site/lib/data-api-arc.ts`
  - `src/lib/data-api-openapi.ts`
  - `docs/superpowers/specs/data-api-v1-fixtures/arc.json`, unchanged. Add a new fixture `arc-now.json` holding
    `arc.json` plus `attributed_share_7d`.
- Test:
  - `builders-site/test/arc-pages.test.ts`
  - `builders-site/test/apps-pages.test.ts`
  - `builders-site/test/arc-share.test.ts`, with an API describe appended

**Interfaces:**
- **Consumes:** `share7d`, `shareText` and `Share7d` (Task 1); `readArcDaily(db, days)`.
- **Produces:**
  - `renderAppList(l: AppList, sort: Sort, share?: Share7d | null): string`. The third argument is optional, so
    existing callers compile.
  - `/api/v1/arc` → `{ ...ArcNumbers, attributed_share_7d: Share7d | null }`

- [ ] **Step 1: Write the failing tests**

`builders-site/test/arc-pages.test.ts`:
- Replace the I2-era expectation for the share row, if one asserts `2.97%`.
- Add a test (below). It uses the file's `full()` helper. Each history entry's `activity_24h` has `app_usd: 12810996.76`
  and `usdc_moved_usd_est: 430908916.2`, so its share is 2.97.

```ts
test("share row: labelled window from the snapshots; the 24 h history column is labelled 24 h", async () => {
  const { renderArc } = await import("../lib/arc-pages");
  const hist = ["2026-10-22", "2026-10-21", "2026-10-20"].map((d) => full({ generated_at: `${d}T00:02:00.000Z`, activity_24h: { ...full().activity_24h, data_until: `${d}T00:00:00Z` } }));
  const h = renderArc(full(), hist);
  expect(h).toContain("Share attributed to apps");
  expect(h).toContain("2.97% over last 3 days to 22 Oct 2026 (daily 2.97–2.97%)");
  expect(h).toContain('href="/methodology/#attributed-share"');
  expect(h).toContain("<th class=\"n\">Attributed to apps, 24 h</th>");
  expect(renderArc(full(), [])).toMatch(/Share attributed to apps<\/td><td[^>]*>Not available right now/);
});
```

Check `row()`'s real markup in `arc-pages.ts` first, and fit the regex to it. The point of the test is that the share
cell says "Not available right now".

`builders-site/test/apps-pages.test.ts`:

```ts
test("the note's share is labelled with its window, and the old unlabelled 24 h sentence is gone", async () => {
  const { renderAppList } = await import("../lib/apps-pages");
  const s = { window_days: 7, until: "2026-10-28T00:00:00Z", pct: 5.01, daily_min: 1, daily_max: 34, complete: true };
  const h = renderAppList(list(), "payments", s);
  expect(h).toContain("About 5.01% of the estimated USDC moved on Arc over 7 days to 28 Oct 2026 (daily 1.00–34.00%) went to these apps.");
  expect(h).toContain('href="/methodology/#attributed-share"');
  expect(h).not.toContain("in the same 24 h");
  expect(renderAppList(list(), "payments")).not.toMatch(/\d% of the estimated/);
});
```

Append to `builders-site/test/arc-share.test.ts`:

```ts
describe("API", () => {
  test("/api/v1/arc carries attributed_share_7d from the daily table (null without DATA_DB)", async () => {
    const { resolve } = await import("node:path");
    const { DATA_MIGRATIONS } = await import("../lib/data-api-ingest");
    const { MemoryD1 } = await import("./memory-d1");
    const { MemoryKV } = await import("./memory-kv");
    const { storeArcDaily } = await import("../lib/arc-daily");
    const { handleArc } = await import("../lib/data-api-arc");
    const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
    await storeArcDaily(db as never, "2026-10-22", snap("2026-10-22", 5, 100));
    const offline = (async () => { throw new Error("offline"); }) as never;
    const req = new Request("https://builder.registrai.cc/api/v1/arc");
    const withDb = await (await handleArc(req, { INVITES: new MemoryKV(), DATA_DB: db } as never, { cache: null }, [], offline)).json() as { attributed_share_7d: unknown };
    expect(withDb.attributed_share_7d).toMatchObject({ window_days: 1, pct: 5 });
    const noDb = await (await handleArc(req, { INVITES: new MemoryKV() } as never, { cache: null }, [], offline)).json() as { attributed_share_7d: unknown };
    expect(noDb.attributed_share_7d).toBeNull();
  });
});
```

`handleArc` gains an optional fifth parameter `fetcher: typeof fetch = fetch`, passed to `collectArcNumbers`, so the
test runs offline.

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run builders-site/test/arc-pages.test.ts builders-site/test/apps-pages.test.ts builders-site/test/arc-share.test.ts`
Expected: FAIL. The share row still shows the 24 h `2.97%`, the note has the old sentence, and the API has no field.

- [ ] **Step 3: Implement**

`builders-site/lib/arc-pages.ts`:
- Import `share7d` and `shareText` from `./arc-share`.
- In `renderArc`, after `const a = …`, add:
  `const share = share7d(history);`
- Replace the share row with:

```ts
${row("Share attributed to apps", `${esc(shareText(share))} <a href="/methodology/#attributed-share">Method</a>`)}
```

Read `row()`. If `row` escapes its second argument, add a variant or pass trusted HTML the way other rows with links
do; the result must keep the link clickable.

- In the history table header, change `<th class="n">Attributed to apps</th>` to
  `<th class="n">Attributed to apps, 24 h</th>`.

`builders-site/lib/apps-pages.ts`:
- `import type { Share7d } from "./arc-share"; import { shareText } from "./arc-share";`
- Change the signature to `renderAppList(l: AppList, sort: Sort, share: Share7d | null = null)`.
- Replace the `const share = …` line with:

```ts
  const shareSentence = share ? ` About ${shareText(share).replace(/^([\d.]+%) over /, "$1 of the estimated USDC moved on Arc over ")} went to these apps. ` : " ";
```

- Inside the `<details>`, replace `${esc(share)}` with
  `${esc(shareSentence)}<a href="/methodology/#attributed-share">Method</a>`.
- The produced sentence, for the test case, must read exactly: "About 5.01% of the estimated USDC moved on Arc over
  7 days to 28 Oct 2026 (daily 1.00–34.00%) went to these apps."

`builders-site/functions/apps/[[path]].ts`:
- Import `readArcDaily` and `share7d`.
- In the list branch, compute the share alongside the list:

```ts
      const [l, days] = await Promise.all([loadAppList(ctx.env, deps), ctx.env.DATA_DB ? readArcDaily(ctx.env.DATA_DB, 7).catch(() => []) : Promise.resolve([])]);
      return l ? html(renderAppList(l, sort, share7d(days))) : html(renderUnavailable(), 503);
```

`builders-site/lib/data-api-arc.ts`:
- Import `readArcDaily` (already imported) and `share7d`.
- Change the signature to
  `handleArc(req: Request, env: Env, deps: EdgeCacheDeps, parts: string[], fetcher: typeof fetch = fetch)`.
- Change the live branch:

```ts
  if (parts.length === 0) return cached(req, deps, "arc", async () => {
    const [n, days] = await Promise.all([collectArcNumbers(env, fetcher), env.DATA_DB ? readArcDaily(env.DATA_DB, 7).catch(() => []) : Promise.resolve([])]);
    return v1Json(req, { ...n, attributed_share_7d: share7d(days) }, 600);
  }, 600);
```

`docs/superpowers/specs/data-api-v1-fixtures/arc-now.json`: a copy of `arc.json` plus
`"attributed_share_7d": { "window_days": 7, "until": "2026-10-28T00:00:00Z", "pct": 5.01, "daily_min": 1.02, "daily_max": 34.01, "complete": true }`.

`src/lib/data-api-openapi.ts`:
- Import `arcNowFull from …/arc-now.json`.
- Add the schema
  `ArcNow: nullable(arcSchema(schemaOf(arcNowFull)), ["attributed_share_7d"])`.
- Point the `/arc` path's response at `"ArcNow"` instead of `"ArcNumbers"`.
- Keep `ArcNumbers` for `ArcDaily`.

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run builders-site/test/arc-pages.test.ts builders-site/test/apps-pages.test.ts builders-site/test/arc-share.test.ts builders-site/test/apps-routes.test.ts src/lib/data-api-openapi.test.ts src/lib/data-api-docs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/arc-pages.ts builders-site/lib/apps-pages.ts builders-site/functions/apps builders-site/lib/data-api-arc.ts src/lib/data-api-openapi.ts docs/superpowers/specs/data-api-v1-fixtures/arc-now.json builders-site/test
git commit -m "methodology: labelled 7-day attributed share on /arc/, /apps/ and /api/v1/arc"
```

### Task 3: `/methodology/`

**Files:**
- Create:
  - `builders-site/lib/methodology-page.ts`
  - `builders-site/functions/methodology/[[path]].ts`
  - `builders-site/test/methodology-page.test.ts`
- Modify:
  - `builders-site/lib/apps-pages.ts` (`METHOD_URL`)
  - `builders-site/lib/arc-question-pages.ts` ("i" link)
  - `builders-site/lib/sitemap-urls.ts`
  - `builders-site/functions/llms.txt.ts`
  - `public/llms.txt`
  - `scripts/build-builders-site.sh`, only if Pages Functions need a copied static dir. They don't, so no change is
    expected.

**Interfaces:**
- **Consumes:** `Share7d` and `shareText` (Task 1); `indexFile(env, "aei")`; `readArcDaily`; `share7d`.
- **Produces:**
  - `METHODOLOGY_VERSION = "1"`, `METHODOLOGY_DATE = "2026-10-22"`
  - `GLOSSARY_IDS: readonly string[]`, used by tests and the anchor check
  - `renderMethodology(m: { params: Record<string, number> | null; share: Share7d | null; until: string | null }): string`

- [ ] **Step 1: Write the failing test**

```ts
// builders-site/test/methodology-page.test.ts
import { describe, expect, test } from "vitest";

const P = { half_life_days: 21, decay_per_hour_pct: 0.137, cap_per_wallet_hour_usdc: 10000, volume_usdc_per_point: 100, new_payer_points: 1,
  new_payer_min_usdc: 10, new_payer_max_per_hour: 25, base_window: 240, base_scale: 30 };
const S = { window_days: 7, until: "2026-10-28T00:00:00Z", pct: 5.01, daily_min: 1, daily_max: 34, complete: true };

describe("/methodology/", () => {
  test("sections, version, live parameters with as-of, the share, JSON-LD", async () => {
    const { renderMethodology } = await import("../lib/methodology-page");
    const h = renderMethodology({ params: P, share: S, until: "2026-10-22T18:00:00Z" });
    expect(h).toContain("<h1>Methodology</h1>");
    expect(h).toContain("Version 1 · 22 Oct 2026 · Data until 22 Oct 2026, 18:00 UTC");
    for (const id of ["glossary", "sources", "attributed-share", "limits", "changelog"]) expect(h, id).toContain(`id="${id}"`);
    expect(h).toContain("half-life of 21 days");
    expect(h).toContain("$10,000");
    expect(h).toContain("first 240 blocks of each hour, scaled ×30");
    expect(h).toContain("5.01% over 7 days to 28 Oct 2026 (daily 1.00–34.00%)");
    expect(h).toContain("v1 (22 Oct 2026): first published version.");
    expect(h).toContain('"@type":"DefinedTermSet"');
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/methodology/">');
  });
  test("glossary ids are unique and include every linked anchor", async () => {
    const { renderMethodology, GLOSSARY_IDS } = await import("../lib/methodology-page");
    const h = renderMethodology({ params: P, share: S, until: null });
    const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ["payment", "paying-wallet", "new-paying-wallet", "received-usd", "attributed-contract", "index-member", "index-points", "data-until", "window", "statuses", "attributed-share"]) expect(ids, a).toContain(a);
    expect(GLOSSARY_IDS.length).toBeGreaterThanOrEqual(10);
  });
  test("no params and no share: numbers dropped, stays grammatical", async () => {
    const { renderMethodology } = await import("../lib/methodology-page");
    const h = renderMethodology({ params: null, share: null, until: null });
    expect(h).not.toMatch(/undefined|NaN|null/);
    expect(h).toContain("up to a per-wallet hourly cap");
    expect(h).toContain("Not available right now");
  });
  test("route: 200, slash 301, subpath 404, HEAD empty; links elsewhere point at real anchors", async () => {
    const { onRequest } = await import("../functions/methodology/[[path]]");
    const call = (path: string, method = "GET") => { const u = new URL(`https://builder.registrai.cc${path}`);
      return onRequest({ request: new Request(u, { method }), env: { INVITES: { get: async () => null } }, params: { path: u.pathname.replace(/^\/methodology\/?/, "").split("/").filter(Boolean) }, waitUntil: () => undefined } as never); };
    expect((await call("/methodology/")).status).toBe(200);
    expect((await call("/methodology")).status).toBe(301);
    expect((await call("/methodology/x/")).status).toBe(404);
    expect(await (await call("/methodology/", "HEAD")).text()).toBe("");
    const { renderMethodology } = await import("../lib/methodology-page");
    const ids = new Set([...renderMethodology({ params: P, share: S, until: null }).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const f of ["../lib/apps-pages.ts", "../lib/arc-pages.ts", "../lib/arc-question-pages.ts"]) {
      for (const m of readFileSync(resolve(__dirname, f), "utf8").matchAll(/\/methodology\/#([a-z-]+)/g)) expect(ids, `${f} → #${m[1]}`).toContain(m[1]);
    }
  });
  test("footer Method link, sitemap and llms.txt", async () => {
    const { page } = await import("../lib/apps-pages");
    expect(page({ title: "t", canonical: "https://x/", description: "d", body: "" })).toContain('href="/methodology/">Method</a>');
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    expect(readFileSync(resolve(__dirname, "../../public/llms.txt"), "utf8")).toContain("https://builder.registrai.cc/methodology/");
    expect(readFileSync(resolve(__dirname, "../lib/sitemap-urls.ts"), "utf8")).toContain('"/methodology/"');
  });
});
```

- [ ] **Step 2: Run it, expecting failure**

Run: `npx vitest run builders-site/test/methodology-page.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

```ts
// builders-site/lib/methodology-page.ts
/** /methodology/ (spec docs/superpowers/specs/2026-10-22-methodology-page-design.md): definitions, sources, the attributed
 *  share, limits and changelog. Parameter values come from the AEI file's published params at render time. */
import { esc, page } from "./apps-pages";
import { shareText, type Share7d } from "./arc-share";

export const METHODOLOGY_VERSION = "1";
export const METHODOLOGY_DATE = "2026-10-22";
const SITE = "https://builder.registrai.cc";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const at = (iso: string) => { const d = new Date(iso); return `${dayOf(iso)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };
const N = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

type Input = { params: Record<string, number> | null; share: Share7d | null; until: string | null };
type Term = { id: string; name: string; text: (p: (k: string) => number | null) => string };
const money = (x: number) => `$${N.format(x)}`;

const TERMS: Term[] = [
  { id: "payment", name: "Payment", text: () => "A transfer of USDC or another registered stablecoin into one of an app's attributed contracts on Arc mainnet, counted by the index method." },
  { id: "paying-wallet", name: "Paying wallet", text: () => "A distinct wallet that made at least one payment to the app within the period." },
  { id: "new-paying-wallet", name: "New paying wallet", text: (p) => {
    const min = p("new_payer_min_usdc"), max = p("new_payer_max_per_hour");
    return `A wallet paying the app for the first time${min !== null ? `, with at least ${money(min)}` : ""}${max !== null ? `; at most ${N.format(max)} count per app per hour` : ""}.`; } },
  { id: "received-usd", name: "Received (USD)", text: (p) => {
    const cap = p("cap_per_wallet_hour_usdc");
    return `The USD value of payments; other stablecoins are converted at the ECB reference rate for their currency. Each wallet counts ${cap !== null ? `up to ${money(cap)} per hour` : "up to a per-wallet hourly cap"}.`; } },
  { id: "attributed-contract", name: "Attributed contract", text: () => "A contract Registrai assigns to an app: its own deployments, pools created by its factories, or a reviewed integration list." },
  { id: "index-member", name: "Index member", text: () => "An app included in an index: the Arc Builders Index (verified builders), the Arc Integrations Index (integrations) or the Arc Ecosystem Index (all)." },
  { id: "index-points", name: "Index points", text: (p) => {
    const hl = p("half_life_days"), dh = p("decay_per_hour_pct"), per = p("volume_usdc_per_point"), np = p("new_payer_points");
    return `Activity points that decay${hl !== null ? ` with a half-life of ${N.format(hl)} days` : ""}${dh !== null ? ` (about ${N.format(dh)}% an hour)` : ""}: ${per !== null ? `one point per ${money(per)} received` : "points for USD received"}${np !== null ? `, plus ${N.format(np)} per new paying wallet` : ", plus points per new paying wallet"}.`; } },
  { id: "data-until", name: "Closed hour, data until", text: () => "Figures cover hours that have ended; \"data until\" is the end of the last closed hour (UTC)." },
  { id: "window", name: "7-day window", text: () => "The 168 closed hours ending at \"data until\"." },
  { id: "statuses", name: "Directory statuses", text: () => "Live: evidence of use on Arc mainnet (contracts, an index id, an explorer link or the project's own mainnet support page). Deployed: contracts on Arc without evidence of use. Announced: an announcement only." },
  { id: "attributed-share-term", name: "Attributed share", text: () => "See the attributed share section below." },
];
export const GLOSSARY_IDS = TERMS.map((t) => t.id);

export function renderMethodology(m: Input): string {
  const p = (k: string) => (m.params && typeof m.params[k] === "number" && Number.isFinite(m.params[k]) ? m.params[k] : null);
  const bw = p("base_window"), bs = p("base_scale");
  const asOf = m.until ? ` Values as of ${esc(at(m.until))}.` : "";
  const glossary = `<h2 id="glossary">Glossary</h2>\n<p class="muted">Parameter values are read from the method parameters the indices publish.${asOf}</p>\n<dl>${TERMS.map((t) => `<dt id="${t.id}">${esc(t.name)}</dt><dd>${esc(t.text(p))}</dd>`).join("")}</dl>`;
  const sources = `<h2 id="sources">Sources</h2>
<p>Where each figure comes from, and how often it is refreshed.</p>
<div class="wrap"><table><thead><tr><th>Source</th><th>What we take</th><th>How often</th></tr></thead><tbody>
<tr><td>Arc RPC (Blockdaemon, then rpc.mainnet.arc.io)</td><td>Blocks, token supplies, transfer logs</td><td>Live (Arc in numbers); hourly (indices)</td></tr>
<tr><td>Registrai indices (ABI, AII, AEI)</td><td>Per-app payments, wallets, USD</td><td>Hourly</td></tr>
<tr><td>DefiLlama</td><td>Arc TVL and stablecoins, always labelled "Source: DefiLlama"</td><td>Live, cached 10 min</td></tr>
<tr><td>Arc ecosystem directory</td><td>Project facts, each with its sources and evidence</td><td>Reviewed by hand; the review date is on each page</td></tr>
</tbody></table></div>`;
  const sample = bw !== null && bs !== null ? `the first ${N.format(bw)} blocks of each hour, scaled ×${N.format(bs)}` : "a sample of blocks in each hour, scaled up";
  const share = `<h2 id="attributed-share">The attributed share</h2>
<p>The share of USDC moved on Arc that went into apps the index attributes contracts to: received (USD) by all index members ÷ the estimated USD value of all USDC transfers on Arc, over the same period.</p>
<p>The all-USDC total is estimated from ${esc(sample)}, so one large transfer moves a one-day figure a lot; over 7 days it is steadier.</p>
<p><b>Now:</b> ${esc(shareText(m.share))}.</p>`;
  const limits = `<h2 id="limits">Known limits</h2>
<ul><li>The all-USDC total is an estimate from sampled blocks.</li>
<li>Payments to contracts we have not attributed are not counted for any app.</li>
<li>An hour the keeper misses is filled from the chain at the next close; if it cannot be, totals for that window are lower.</li>
<li>Directory facts are as current as their review date; corrections are public at <a href="/ecosystem/corrections/">/ecosystem/corrections/</a>.</li>
<li>Other stablecoins are converted to USD, so "Received (USD)" is not USDC only.</li></ul>`;
  const changelog = `<h2 id="changelog">Changelog</h2>\n<ul><li>v1 (${esc(dayOf(`${METHODOLOGY_DATE}T00:00:00Z`))}): first published version.</li></ul>`;
  const body = `<h1>Methodology</h1>
<p class="muted">Version ${METHODOLOGY_VERSION} · ${esc(dayOf(`${METHODOLOGY_DATE}T00:00:00Z`))}${m.until ? ` · Data until ${esc(at(m.until))}` : ""}</p>
<p>How Registrai defines and measures the figures on this site. Publishing principles: <a href="/how-we-publish/">How we publish</a>. The indices: <a href="/builders-index/">Indices</a>. API fields: <a href="/data-api/">Data API</a>.</p>
${glossary}\n${sources}\n${share}\n${limits}\n${changelog}`;
  const url = `${SITE}/methodology/`;
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "DefinedTermSet", name: "Registrai Arc data glossary", url, hasDefinedTerm: TERMS.map((t) => ({ "@type": "DefinedTerm", name: t.name, description: t.text(p), url: `${url}#${t.id}` })) },
    { "@type": "Article", headline: "Methodology", url, dateModified: METHODOLOGY_DATE, version: METHODOLOGY_VERSION } ] };
  return page({ title: "Methodology · Registrai", canonical: url, description: "How Registrai defines and measures the Arc figures on this site: glossary, sources, the attributed share, limits and changelog.", body, ld });
}
```

The glossary entry for the attributed share has the id `attributed-share-term`, so it doesn't collide with the
section id `attributed-share`. The anchor test requires `attributed-share` to exist, and it does as the section.

`builders-site/functions/methodology/[[path]].ts`:

```ts
import type { PagesFunction } from "../../lib/env";
import { readArcDaily } from "../../lib/arc-daily";
import { share7d } from "../../lib/arc-share";
import { indexFile } from "../../lib/data-api";
import { renderEcosystemNotFound } from "../../lib/ecosystem-pages";
import { edgeCachedGet } from "../../lib/http";
import { renderMethodology } from "../../lib/methodology-page";

/** GET /methodology/ (spec 2026-10-22-methodology-page-design.md), edge-cached 10 min. */
const html = (body: string, status = 200, head = false) =>
  new Response(head ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=600" : "no-store" } });

export const onRequest: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const head = m === "HEAD";
  if (([] as string[]).concat(ctx.params.path ?? []).filter(Boolean).length) return html(renderEcosystemNotFound(), 404, head);
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const res = await edgeCachedGet(new Request(`${url.origin}/methodology/`), deps, async () => {
    const [aei, days] = await Promise.all([indexFile(ctx.env, "aei").catch(() => null), ctx.env.DATA_DB ? readArcDaily(ctx.env.DATA_DB, 7).catch(() => []) : Promise.resolve([])]);
    const f = aei as { params?: Record<string, number>; live?: { base_window?: number; base_scale?: number }; data_until?: string } | null;
    const params = f?.params ? { ...f.params, ...(f.live?.base_window !== undefined ? { base_window: f.live.base_window } : {}), ...(f.live?.base_scale !== undefined ? { base_scale: f.live.base_scale } : {}) } : null;
    return html(renderMethodology({ params, share: share7d(days), until: f?.data_until ?? null }));
  }, 600, "methodology");
  return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
};
```

**Links:**
- **`apps-pages.ts`:** `const METHOD_URL = "/methodology/";`. The nav label "Indices" also uses `METHOD_URL` today.
  Change the nav's "Indices" link to the literal `/builders-index/`, so "Indices" still goes to the indices and the
  footer "Method" goes to `/methodology/`.
- **`arc-question-pages.ts`:** at the end of `source(w)`'s details text, after `${esc(METHOD)}`, add
  ` <a href="/methodology/#received-usd">Method</a>`.
- **`sitemap-urls.ts`:** add `"/methodology/"` to `STATIC`.
- **Both llms.txt files:** after the "Arc in numbers" line, add:
  `- [Methodology](https://builder.registrai.cc/methodology/): definitions of every figure (payments, paying wallets, received USD, index points, the 7-day window, directory statuses), sources, the attributed share and known limits`

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run builders-site/test/methodology-page.test.ts builders-site/test/apps-pages.test.ts builders-site/test/arc-question-pages.test.ts builders-site/test/sitemap-urls.test.ts builders-site/test/apps-routes.test.ts`
Expected: PASS. If an existing test asserts the footer or nav "Method"/"Indices" href, update it to the new targets and
ledger it.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/methodology-page.ts builders-site/functions/methodology builders-site/lib/apps-pages.ts builders-site/lib/arc-question-pages.ts builders-site/lib/sitemap-urls.ts builders-site/functions/llms.txt.ts public/llms.txt builders-site/test
git commit -m "methodology: /methodology/ page (glossary from published params, sources, attributed share, limits, changelog) and links"
```

### Task 4: Full suite, preview, production

- [ ] **Step 1: Full verification**

Run: `npx vitest run > /tmp/meth-suite.txt 2>&1; tail -6 /tmp/meth-suite.txt; npm run typecheck; npm run lint`
Expected: all pass except the known `src/lib/drafts.test.ts`; typecheck is clean; lint shows only the existing warning.

- [ ] **Step 2: Preview**

In `.worktrees/abi-deploy`:
```
git checkout -q --detach <head>
npm run build
bash scripts/build-builders-site.sh
```
Then, from `builders-site`, with `CLOUDFLARE_ACCOUNT_ID=a86f3fc238f9db2d41b52e2dddb80372`:
```
npx wrangler pages deploy ../dist-builders --project-name=registrai-builders --branch=methodology --commit-dirty=true
```

Check:
- `/methodology/` shows live parameter values ($10,000 cap, 21-day half-life, 240 blocks ×30);
- `/arc/` and `/apps/` show "… over last 2 days …" (2 snapshots exist on 22 Oct);
- `/api/v1/arc` has `attributed_share_7d`;
- the footer "Method" link goes to `/methodology/`.

- [ ] **Step 3: Production**, with the owner's OK

Run `bash scripts/deploy-builders-site.sh` from `abi-deploy`. Recheck. Ping IndexNow for `/methodology/`, `/arc/` and
`/apps/`. Push `feat/abi-pilot`.
