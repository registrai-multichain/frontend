# Agent Reference (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Registrai's Arc app facts readable by crawlers and agents:
- server-rendered `/apps/` pages;
- a sitemap;
- an opened robots.txt;
- `llms.txt`;
- an OpenAPI description;
- a read-only MCP server at `/api/mcp`.

**Architecture:**
- **Pages Functions** on builder.registrai.cc render HTML strings from the same KV index files and D1 history that
  `/api/v1` reads. A shared loader (`apps-data.ts`) feeds both the HTML (`apps-pages.ts`) and the MCP tools.
- **MCP tools** call the existing v1 handlers in-process, so tool output equals API output.
- **Static text** (`robots.txt`) comes from the build script.
- **Generated text** (`sitemap.xml`, `llms.txt`, `openapi.json`) comes from functions.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), KV, D1, vitest with MemoryKV/MemoryD1/MemoryCache.

**Spec:** `docs/superpowers/specs/2026-10-15-agent-reference-design.md` (approved 2026-10-15, "go").

## Global Constraints

- Pages read only what `/api/v1` reads. No new metrics.
- No payment changes a page, an order or a number. Sorting is by a stated metric only.
- Plain labels. The list page title is "Stablecoin apps on Arc". No ratings or adjectives about apps; a cold app
  shows its metric.
- Every page shows "Data until <date, HH:00 UTC>", the source, "Data: Registrai, CC BY 4.0", and links to the method
  and the API.
- HTML works with JavaScript off. Responses carry `cache-control: public, max-age=300` and are edge-cached with
  `edgeCachedGet`, 300 s, with a variant from validated params.
- Public data only: ids, names, metrics, contract counts, verified status.
- **CPU:** the free plan's Worker CPU limit is 10 ms per request. Never parse the contracts map (about 3 MB) in a
  page request. App pages show `projects[].contracts` (the count) and link to `/api/index/aei/contracts` for the
  addresses. This changes the spec's "up to 50 addresses" (Ruling A).
- URLs:
  - member id `<prefix>:<rest>` ↔ path `/apps/<prefix>/<rest>/`;
  - `<rest>` keeps its `/`, with each segment URL-encoded;
  - an unknown id returns 404 HTML with a link to `/apps/`.
- MCP is mounted at `/api/mcp`, so the existing `/api/` rate-limit rule covers it. It is POST JSON-RPC 2.0:
  `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. GET returns 405.
- Workers have no `process`. `builders-site/test/worker-imports.test.ts` must stay green.
- The full suite may fail only on `src/lib/drafts.test.ts`. Lint must be clean.
- Deploy the builder site only with `npm run build`, then `bash scripts/build-builders-site.sh`, then
  `bash scripts/deploy-builders-site.sh`, from `.worktrees/abi-deploy` at a committed HEAD.

## Review Focus

1. **A member name with HTML or quotes** (`<script>`, `"`, `&`) is escaped everywhere: HTML text, attributes,
   JSON-LD, and the SVG `<title>`. Pinned in Task 2.
2. **Ids with characters that need encoding:**
   - `github:owner/repo` round-trips to `/apps/github/owner/repo/`;
   - `domain:archery.wtf` maps to `/apps/domain/archery.wtf/`;
   - an encoded path like `/apps/domain/arch%65ry.wtf/` resolves to the same id.

   Pinned in Task 1.
3. **No D1 history yet for a new member:** the app page renders with "no hourly history yet", not a 500. Pinned in
   Task 2.
4. **`?sort=` with an unknown value** falls back to the default sort, and the canonical link stays `/apps/`. Pinned
   in Task 3.
5. **MCP `tools/call` errors:** an unknown tool or bad arguments return a JSON-RPC error with `isError: true`
   content, never an HTTP 500. A notification (no `id`) returns 202 with no body. Pinned in Task 5.

---

## File structure

```
builders-site/lib/apps-data.ts            ids ↔ paths; loadAppList(env, deps) and loadApp(env, deps, id): KV files + D1 rows
builders-site/lib/apps-pages.ts           pure renderers: renderAppList(model, sort), renderApp(model), renderNotFound(), esc()
builders-site/functions/apps/[[path]].ts  GET /apps/ and /apps/<prefix>/<rest>/
builders-site/functions/sitemap.xml.ts    GET /sitemap.xml
builders-site/functions/llms.txt.ts       GET /llms.txt
src/lib/data-api-openapi.ts               OPENAPI (OpenAPI 3.1 object)
builders-site/functions/api/v1/openapi.json.ts
builders-site/lib/mcp.ts                  handleMcp(req, env, deps)
builders-site/functions/api/mcp.ts
scripts/build-builders-site.sh            robots.txt
src/lib/public-site.ts                    "apps" in BUILDERS_SITE_ROUTES (registrai.cc/apps redirects to the builder site)
tests: builders-site/test/apps-data.test.ts, apps-pages.test.ts, apps-routes.test.ts, mcp.test.ts; src/lib/data-api-openapi.test.ts
```

---

### Task 1: App data loader and id ↔ path mapping

**Files:**
- Create: `builders-site/lib/apps-data.ts`
- Modify: `builders-site/lib/data-api.ts`. Export `indexFile` and `firstHours`, which already exist (add `export`).
- Test: `builders-site/test/apps-data.test.ts`

**Interfaces:**
- Consumes:
  - from `data-api.ts`: `indexFile(env, id)`, `dataUntil(db, index)` and `firstHours(db, index)`;
  - `verifiedIds(env, deps)` from `data-api-verified.ts`;
  - `isoHour` from `data-api-rows.ts`;
  - the KV key `facts:<source>` (`FACTS_PREFIX` from `lib/facts.ts`).
- Produces:
  - `idToPath(id: string): string | null`, e.g. `"domain:archery.wtf"` → `"/apps/domain/archery.wtf/"`;
  - `pathToId(segments: string[]): string | null`, which decodes each segment;
  - `type AppRow = { id; name; kind: "builder"|"integration"|"base"; verified: boolean; points: number; share: number; first_hour: string; last_24h: { points_earned: number; payments: number; usdc: number }; contracts: number; indices: ("abi"|"aii"|"aei")[] }`;
  - `type AppList = { data_until: string; rows: AppRow[]; totals: { apps: number; payments_24h: number; usdc_24h: number; arc_usdc_24h_est: number } }`;
  - `type AppDetail = AppRow & { hourly: { hour_close: string; points: number; points_earned: number; payments: number; wallets: number; new_payers: number; usdc: number }[]; facts_url: string | null; data_until: string }`;
  - `loadAppList(env, deps): Promise<AppList | null>`, built from AEI, with memberships from the abi and aii files;
  - `loadApp(env, deps, id): Promise<AppDetail | null | "unknown">`, which returns the last 168 AEI hourly rows from
    D1.

- [ ] **Step 1: Failing tests**

```ts
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { idToPath, loadApp, loadAppList, pathToId } from "../lib/apps-data";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { ABI_INDICES, type AbiData } from "../../src/lib/builders-index";
import { indexFixture } from "../../src/lib/builders-index-fixture";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

vi.mock("../lib/data-api-verified", async (orig) => ({ ...(await orig<typeof import("../lib/data-api-verified")>()), verifiedIds: async () => new Set(["domain:archery.wtf"]) }));
const H = (s: string) => Date.parse(s) / 3600e3;

describe("ids ↔ paths", () => {
  test("round-trips, keeps slashes in the rest, decodes encoded segments", () => {
    expect(idToPath("domain:archery.wtf")).toBe("/apps/domain/archery.wtf/");
    expect(idToPath("github:owner/repo")).toBe("/apps/github/owner/repo/");
    expect(idToPath("integration:0x")).toBe("/apps/integration/0x/");
    expect(idToPath("no-colon")).toBeNull();
    expect(pathToId(["domain", "archery.wtf"])).toBe("domain:archery.wtf");
    expect(pathToId(["github", "owner", "repo"])).toBe("github:owner/repo");
    expect(pathToId(["domain", "arch%65ry.wtf"])).toBe("domain:archery.wtf");
    expect(pathToId(["domain"])).toBeNull();
    expect(pathToId(["domain", "%E0%A4%A"])).toBeNull();
  });
});

async function seeded() {
  const kv = new MemoryKV();
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  const f = indexFixture() as unknown as AbiData;
  const projects = [
    { ...f.projects[0], source: "domain:archery.wtf", name: "Archery", kind: "project", share: 2, contracts: 3, pts_24h: 10, pay_24h: 5, usdc_24h: 50 },
    { ...f.projects[0], source: "integration:uniswap", name: "Uniswap", kind: "integration", share: 9, contracts: 900, pts_24h: 99, pay_24h: 50, usdc_24h: 5000 },
  ];
  const P = { "domain:archery.wtf": 9.2, "integration:uniswap": 4000 };
  const file = (ps: typeof projects) => JSON.stringify({ ...f, data_until: "2026-10-14T21:00:00Z", projects: ps, live: { P },
    volume_24h: { USDC: { members_usd: 5050, members_payments: 55, base_usd_est: 500000, base_transfers_est: 900 } } });
  await kv.put(ABI_INDICES.aei.key, file(projects));
  await kv.put(ABI_INDICES.abi.key, file([projects[0]]));
  await kv.put(ABI_INDICES.aii.key, file([projects[1]]));
  await kv.put("facts:domain:archery.wtf", JSON.stringify({ source: "domain:archery.wtf", facts: [] }));
  db.sqlite.prepare("INSERT INTO index_hour VALUES ('aei', ?, 990)").all(H("2026-10-14T21:00:00Z"));
  db.sqlite.prepare("INSERT INTO member_hour VALUES ('aei', 'domain:archery.wtf', ?, 9.2, 11, 5, 3, 1, 50)").all(H("2026-10-14T21:00:00Z"));
  db.sqlite.prepare("INSERT INTO member_first VALUES ('aei', 'domain:archery.wtf', ?)").all(H("2026-10-11T19:00:00Z"));
  return { env: { INVITES: kv, DATA_DB: db } as never };
}

describe("loaders", () => {
  test("loadAppList: AEI rows with memberships, verified, contracts count and totals", async () => {
    const { env } = await seeded();
    const l = (await loadAppList(env, {}))!;
    expect(l.data_until).toBe("2026-10-14T21:00:00Z");
    const a = l.rows.find((r) => r.id === "domain:archery.wtf")!;
    expect(a).toMatchObject({ name: "Archery", kind: "builder", verified: true, points: 9.2, contracts: 3, indices: ["abi", "aei"], first_hour: "2026-10-11T19:00:00Z" });
    expect(l.rows.find((r) => r.id === "integration:uniswap")!.indices).toEqual(["aii", "aei"]);
    expect(l.totals).toEqual({ apps: 2, payments_24h: 55, usdc_24h: 5050, arc_usdc_24h_est: 500000 });
  });
  test("loadApp: hourly rows, facts link; unknown id; new member without history", async () => {
    const { env } = await seeded();
    const a = await loadApp(env, {}, "domain:archery.wtf");
    expect(a).not.toBe("unknown");
    expect((a as { hourly: unknown[] }).hourly).toHaveLength(1);
    expect((a as { facts_url: string }).facts_url).toBe("/project/?source=domain%3Aarchery.wtf");
    expect(await loadApp(env, {}, "domain:nope.example")).toBe("unknown");
    const u = await loadApp(env, {}, "integration:uniswap");
    expect((u as { hourly: unknown[]; facts_url: null }).hourly).toEqual([]);
    expect((u as { facts_url: null }).facts_url).toBeNull();
  });
  test("no DB or no index file: null (the route answers 503)", async () => {
    expect(await loadAppList({ INVITES: new MemoryKV() } as never, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run builders-site/test/apps-data.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/** /apps pages and the MCP tools: one loader over the same KV index files and D1 history as /api/v1 (spec 2026-10-15-agent-reference-design.md). */
import type { AbiData } from "../../src/lib/builders-index";
import { projectHref } from "../../src/lib/project-page";
import { dataUntil, firstHours, indexFile } from "./data-api";
import { isoHour, type IndexId } from "./data-api-rows";
import { verifiedIds } from "./data-api-verified";
import type { Env } from "./env";
import { FACTS_PREFIX } from "./facts";
import type { EdgeCacheDeps } from "./http";

const KIND: Record<string, "builder" | "integration" | "base"> = { project: "builder", integration: "integration", base: "base" };
export type AppRow = { id: string; name: string; kind: "builder" | "integration" | "base"; verified: boolean; points: number; share: number; first_hour: string;
  last_24h: { points_earned: number; payments: number; usdc: number }; contracts: number; indices: IndexId[] };
export type AppList = { data_until: string; rows: AppRow[]; totals: { apps: number; payments_24h: number; usdc_24h: number; arc_usdc_24h_est: number } };
export type HourRow = { hour_close: string; points: number; points_earned: number; payments: number; wallets: number; new_payers: number; usdc: number };
export type AppDetail = AppRow & { hourly: HourRow[]; facts_url: string | null; data_until: string };

export function idToPath(id: string): string | null {
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) return null;
  const rest = id.slice(i + 1).split("/").map(encodeURIComponent).join("/");
  return `/apps/${encodeURIComponent(id.slice(0, i))}/${rest}/`;
}

export function pathToId(segments: string[]): string | null {
  const s = segments.filter(Boolean);
  if (s.length < 2) return null;
  try {
    const d = s.map((x) => decodeURIComponent(x));
    return `${d[0]}:${d.slice(1).join("/")}`;
  } catch { return null; }
}

const membersOf = (f: AbiData | null) => new Set((f?.projects ?? []).map((p) => p.source));

export async function loadAppList(env: Env, deps: EdgeCacheDeps): Promise<AppList | null> {
  const db = env.DATA_DB;
  const [aei, abi, aii] = await Promise.all([indexFile(env, "aei"), indexFile(env, "abi"), indexFile(env, "aii")]);
  if (!db || !aei?.live?.P) return null;
  const until = await dataUntil(db, "aei");
  if (until === null) return null;
  const [first, verified] = await Promise.all([firstHours(db, "aei"), verifiedIds(env, deps)]);
  const inAbi = membersOf(abi), inAii = membersOf(aii), P = aei.live.P;
  const rows: AppRow[] = aei.projects.filter((p) => typeof P[p.source] === "number").map((p) => ({
    id: p.source, name: p.name, kind: KIND[p.kind] ?? "builder", verified: verified.has(p.source), points: P[p.source], share: p.share,
    first_hour: isoHour(first.get(p.source) ?? until),
    last_24h: { points_earned: p.pts_24h ?? 0, payments: p.pay_24h ?? 0, usdc: p.usdc_24h ?? 0 },
    contracts: p.contracts ?? 0,
    indices: [...(inAbi.has(p.source) ? ["abi" as const] : []), ...(inAii.has(p.source) ? ["aii" as const] : []), "aei" as const],
  }));
  const usdc = (aei as { volume_24h?: Record<string, { members_usd: number; members_payments: number; base_usd_est: number }> }).volume_24h?.USDC;
  return { data_until: isoHour(until), rows, totals: {
    apps: rows.length,
    payments_24h: usdc?.members_payments ?? rows.reduce((a, r) => a + r.last_24h.payments, 0),
    usdc_24h: usdc?.members_usd ?? rows.reduce((a, r) => a + r.last_24h.usdc, 0),
    arc_usdc_24h_est: usdc?.base_usd_est ?? 0,
  } };
}

export async function loadApp(env: Env, deps: EdgeCacheDeps, id: string): Promise<AppDetail | null | "unknown"> {
  const list = await loadAppList(env, deps);
  if (!list) return null;
  const row = list.rows.find((r) => r.id === id);
  if (!row) return "unknown";
  const db = env.DATA_DB!, to = Date.parse(list.data_until) / 3600e3;
  const hourly = (await db.prepare("SELECT hour, points, points_earned, payments, wallets, new_payers, usdc FROM member_hour WHERE idx = 'aei' AND id = ? AND hour BETWEEN ? AND ? ORDER BY hour")
    .bind(id, to - 167, to).all<{ hour: number } & Omit<HourRow, "hour_close">>()).results
    .map(({ hour, ...r }) => ({ hour_close: isoHour(hour), ...r }));
  const facts = await env.INVITES.get(`${FACTS_PREFIX}${id}`);
  return { ...row, hourly, facts_url: facts ? projectHref(id) : null, data_until: list.data_until };
}
```

Add `export` to `async function indexFile` and `async function firstHours` in `builders-site/lib/data-api.ts`.
If `projectHref` pulls in a module that reads `process` (the worker-imports guard catches it), inline
`` (s: string) => `/project/?source=${encodeURIComponent(s)}` `` instead, and record that as a ruling.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run builders-site/test/apps-data.test.ts builders-site/test/worker-imports.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "Agent reference: app data loader and id↔path mapping"`

---

### Task 2: HTML renderers

**Files:**
- Create: `builders-site/lib/apps-pages.ts`
- Test: `builders-site/test/apps-pages.test.ts`

**Interfaces:**
- Consumes: `AppList`, `AppDetail` and `idToPath` from Task 1.
- Produces:
  - `esc(s: string): string`;
  - `type Sort = "payments" | "usdc" | "points" | "first_seen"`;
  - `parseSort(v: string | null): Sort`, which falls back to `"payments"`;
  - `renderAppList(l: AppList, sort: Sort): string`;
  - `renderApp(a: AppDetail): string`;
  - `renderNotFound(): string`;
  - `renderUnavailable(): string`.

**Page content:**
- `/apps/`:
  - `<title>Stablecoin apps on Arc · Registrai</title>`, `<h1>Stablecoin apps on Arc</h1>`;
  - the line "Data until 14 Oct 2026, 21:00 UTC";
  - a totals line;
  - an "i" bubble made with `<details><summary>i</summary>…</details>`, so it works without JS. It reads
    "Payments to these N apps; Arc-wide stablecoin volume in the same 24 h was about $X (estimate)";
  - the sort line "Sorted by 24 h payments", with links for each other sort;
  - a table (app link, kind, verified "✓"/"–", 24 h payments, 24 h USD, share %, first seen);
  - a footer: "Data: Registrai, CC BY 4.0 · Method · Data API".
  - The canonical link is always `https://builder.registrai.cc/apps/`.
- App page:
  - `<title><name> on Arc · Registrai</title>`, `<h1><name></h1>`;
  - a facts line: kind, indices, verified, first seen;
  - a "Last 24 h" table, a 7-day SVG (points stock) and a daily-sums table;
  - "Contracts: N", linking to `/api/index/aei/contracts`;
  - links: the facts page (if any), `/api/v1/members/<enc id>/hourly?index=aei`, the method, `/data-api/`;
  - a JSON-LD `Dataset`;
  - "no hourly history yet" when `hourly` is empty.
- Styling: one `<style>` block, system fonts, max width 960px, readable tables. No external assets, no scripts.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test } from "vitest";
import { esc, parseSort, renderApp, renderAppList, renderNotFound } from "../lib/apps-pages";
import type { AppDetail, AppList } from "../lib/apps-data";

const row = (o: Partial<AppDetail> = {}) => ({ id: "domain:archery.wtf", name: "Archery", kind: "builder", verified: true, points: 9.2, share: 2, first_hour: "2026-10-11T19:00:00Z",
  last_24h: { points_earned: 1174.9, payments: 158, usdc: 24725.94 }, contracts: 3, indices: ["abi", "aei"], ...o }) as AppDetail;
const list = (rows = [row(), row({ id: "integration:uniswap", name: "Uniswap", kind: "integration", last_24h: { points_earned: 1, payments: 9999, usdc: 1 } })]): AppList =>
  ({ data_until: "2026-10-14T21:00:00Z", rows, totals: { apps: rows.length, payments_24h: 10157, usdc_24h: 24726.94, arc_usdc_24h_est: 508515262 } });

describe("renderers", () => {
  test("list: title, data-until, sort default by payments, numbers in plain HTML, licence, canonical", () => {
    const h = renderAppList(list(), "payments");
    expect(h).toContain("<title>Stablecoin apps on Arc · Registrai</title>");
    expect(h).toContain("Data until 14 Oct 2026, 21:00 UTC");
    expect(h.indexOf("Uniswap")).toBeLessThan(h.indexOf("Archery"));
    expect(h).toContain("9,999");
    expect(h).toContain('href="/apps/domain/archery.wtf/"');
    expect(h).toContain("CC BY 4.0");
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/apps/">');
    expect(h).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });
  test("unknown sort falls back to payments", () => {
    expect(parseSort("evil")).toBe("payments");
    expect(parseSort("usdc")).toBe("usdc");
  });
  test("hostile names are escaped in text, attributes, JSON-LD and SVG", () => {
    const evil = `<script>alert(1)</script>"&'`;
    const a = renderApp({ ...row({ name: evil }), hourly: [{ hour_close: "2026-10-14T21:00:00Z", points: 9.2, points_earned: 1, payments: 1, wallets: 1, new_payers: 0, usdc: 1 }], facts_url: null, data_until: "2026-10-14T21:00:00Z" });
    expect(a).not.toContain("<script>alert");
    expect(a).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const ld = a.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1];
    expect(ld).not.toContain("</script");
    expect(JSON.parse(ld)["@type"]).toBe("Dataset");
    expect(renderAppList(list([row({ name: evil })]), "payments")).not.toContain("<script>alert");
    expect(esc(`a<b>"c"&'d'`)).toBe("a&lt;b&gt;&quot;c&quot;&amp;&#39;d&#39;");
  });
  test("app page: last 24 h, contracts link, API link; empty history says so", () => {
    const a = renderApp({ ...row(), hourly: [], facts_url: "/project/?source=domain%3Aarchery.wtf", data_until: "2026-10-14T21:00:00Z" });
    expect(a).toContain("<h1>Archery</h1>");
    expect(a).toContain("no hourly history yet");
    expect(a).toContain("/api/v1/members/domain%3Aarchery.wtf/hourly?index=aei");
    expect(a).toContain("/project/?source=domain%3Aarchery.wtf");
    expect(a).toContain("1,174.9");
    expect(a).toContain("Contracts: 3");
  });
  test("404 page links back to the list", () => {
    expect(renderNotFound()).toContain('href="/apps/"');
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run builders-site/test/apps-pages.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`apps-pages.ts`:
- `esc` replaces `& < > " '`.
- Numbers are formatted with `toLocaleString("en-US", { maximumFractionDigits: 2 })`.
- Dates are formatted as `d MMM yyyy, HH:00 UTC` from the ISO string, in UTC, with English month abbreviations.
- JSON-LD is written with `JSON.stringify(obj).replace(/</g, "\\u003c")`.
- The SVG polyline is built from `hourly.points`, the same way as the landing's `sparkPath`: 600×120 with a
  `<title>`.
- The `Dataset` JSON-LD is
  `{ "@context": "https://schema.org", "@type": "Dataset", name: "<name> hourly activity on Arc", url, license: "https://creativecommons.org/licenses/by/4.0/", creator: { "@type": "Organization", name: "Registrai", url: "https://registrai.cc" }, temporalCoverage: "<first>/<data_until>", variableMeasured: ["points", "payments", "paying wallets", "stablecoin volume (USD)"], distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: <API URL> }] }`.
- The list sort comparators:
  - `payments`: `last_24h.payments` descending;
  - `usdc`: `last_24h.usdc` descending;
  - `points`: `points` descending;
  - `first_seen`: `first_hour` descending.
  Ties are broken by id ascending, so the order is stable.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run builders-site/test/apps-pages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "Agent reference: server-rendered app list and app page HTML"`

---

### Task 3: Routes: /apps, sitemap.xml, llms.txt, robots.txt, registrai.cc redirect

**Files:**
- Create: `builders-site/functions/apps/[[path]].ts`, `builders-site/functions/sitemap.xml.ts`,
  `builders-site/functions/llms.txt.ts`
- Modify:
  - `scripts/build-builders-site.sh` (robots.txt line);
  - `src/lib/public-site.ts` (add `"apps"` to `BUILDERS_SITE_ROUTES`);
  - `builders-site/test/release-scripts.test.ts` (robots assertion).
- Test: `builders-site/test/apps-routes.test.ts`

**Behaviour:**
- `/apps/` and `/apps/<…>/`:
  - GET only, otherwise 405;
  - `edgeCachedGet` with 300 s and a variant of `list:<sort>` or `app:<id>`;
  - 200 `text/html; charset=utf-8`;
  - 404 HTML for an unknown id or a bad path;
  - 503 HTML (`renderUnavailable`) when the loader returns null;
  - `/apps` without a trailing slash redirects 301 to `/apps/`, and so does an app path without one.
- `/sitemap.xml`: `application/xml`, cached 300 s. It lists `/apps/`, every app page, and the static paths
  `/builders/`, `/builders-index/`, `/data-api/`, `/how-we-publish/`, `/track-record/` and `/verify/`.
- `/llms.txt`: `text/plain; charset=utf-8`. The text is:

```
# Registrai

> Hourly data on stablecoin apps on Arc: per-app stablecoin payments, paying wallets and volume, the Arc Builders, Integrations and Ecosystem indices, and verified builders. Every number links to the chain.

## Data
- [Stablecoin apps on Arc](https://builder.registrai.cc/apps/): every app with its last 24 h, sorted by payments
- [Arc indices](https://builder.registrai.cc/builders-index/): ABI, AII, AEI, hourly
- [Data API v1](https://builder.registrai.cc/data-api/): public JSON API, no key, CC BY 4.0
- [OpenAPI](https://builder.registrai.cc/api/v1/openapi.json)
- [MCP server](https://builder.registrai.cc/api/mcp): read-only tools over the same data (Streamable HTTP)

## Method
- [How we publish](https://builder.registrai.cc/how-we-publish/)

Licence: CC BY 4.0, attribution "Data: Registrai".
```

- `robots.txt` (build script):
  `printf "User-agent: *\nAllow: /\nAllow: /api/v1/\nDisallow: /api/\nSitemap: https://builder.registrai.cc/sitemap.xml\n"`.

- [ ] **Step 1: Failing tests** (`apps-routes.test.ts`). Use the `seeded()` setup from Task 1's test: copy it, and
  mock `data-api-verified` the same way. Call each route's `onRequest` with the
  `{ request, env, params, waitUntil }` ctx and `cache` off, by mocking `edgeCachedGet` deps: pass
  `{ waitUntil }` and stub `globalThis.caches` as `undefined`.

```ts
test("/apps/ 200 HTML with numbers; ?sort=evil same as default; /apps redirects; unknown app 404; POST 405", async () => {
  const { onRequest } = await import("../functions/apps/[[path]]");
  const { env } = await seeded();
  const ctx = (path: string, params: string[], method = "GET") => ({ request: new Request(`https://builder.registrai.cc${path}`, { method }), env, params: { path: params }, waitUntil: () => undefined }) as never;
  const r = await onRequest(ctx("/apps/", []));
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toContain("text/html");
  const html = await r.text();
  expect(html).toContain("Archery");
  expect(await (await onRequest(ctx("/apps/?sort=evil", []))).text()).toBe(html);
  expect((await onRequest(ctx("/apps", []))).status).toBe(301);
  expect((await onRequest(ctx("/apps/domain/nope.example/", ["domain", "nope.example"]))).status).toBe(404);
  expect((await onRequest(ctx("/apps/domain/archery.wtf/", ["domain", "archery.wtf"]))).status).toBe(200);
  expect((await onRequest(ctx("/apps/", [], "POST"))).status).toBe(405);
});
test("sitemap lists every app page; llms.txt names the API and MCP", async () => {
  const { onRequest: sm } = await import("../functions/sitemap.xml");
  const { onRequest: llms } = await import("../functions/llms.txt");
  const { env } = await seeded();
  const ctx = (p: string) => ({ request: new Request(`https://builder.registrai.cc${p}`), env, params: {}, waitUntil: () => undefined }) as never;
  const xml = await (await sm(ctx("/sitemap.xml"))).text();
  expect(xml).toContain("<loc>https://builder.registrai.cc/apps/domain/archery.wtf/</loc>");
  expect(xml).toContain("<loc>https://builder.registrai.cc/apps/</loc>");
  const t = await (await llms(ctx("/llms.txt"))).text();
  expect(t).toContain("https://builder.registrai.cc/api/v1/openapi.json");
  expect(t).toContain("https://builder.registrai.cc/api/mcp");
});
```

In `release-scripts.test.ts`, inside "deploys a fresh dist-builders…", after the build, add:
`expect(readFileSync(join(t.dir, "dist-builders/robots.txt"), "utf8")).toBe("User-agent: *\nAllow: /\nAllow: /api/v1/\nDisallow: /api/\nSitemap: https://builder.registrai.cc/sitemap.xml\n");`

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run builders-site/test/apps-routes.test.ts builders-site/test/release-scripts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the three functions, the robots line and the route list entry.** If the `public-site`
  "every app route is decided" test complains, `apps` is a function route, not a Next route. In that case add it to
  whatever list that test reads, and record that as a ruling.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run builders-site/test/apps-routes.test.ts builders-site/test/release-scripts.test.ts src/lib/public-site.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "Agent reference: /apps routes, sitemap.xml, llms.txt, robots opens /api/v1/"`

---

### Task 4: OpenAPI 3.1 for /api/v1

**Files:**
- Create: `src/lib/data-api-openapi.ts`, `builders-site/functions/api/v1/openapi.json.ts`
- Test: `src/lib/data-api-openapi.test.ts`

**Interfaces:**
- Consumes: `ENDPOINTS`, `DATA_API_BASE` and `LIMITS` from `src/lib/data-api-docs.ts`; the fixtures in
  `docs/superpowers/specs/data-api-v1-fixtures/`.
- Produces: `OPENAPI`, an OpenAPI 3.1 document object.

The document has:
- `info` (title "Registrai Data API", version "1", license CC BY 4.0);
- `servers` [{ url: DATA_API_BASE }];
- `paths` for the 7 endpoints, with parameters (`index` enum, `from`/`to`/`since`/`hour`
  `format: date-time`, path `id`);
- one response schema per endpoint under `components.schemas`, built by a small `schemaOf(fixture)` helper that
  derives `type` and `properties` from a fixture value (numbers → `number`, strings → `string`, booleans →
  `boolean`, arrays from their first item, objects recursively, every key required);
- `components.responses.Error`, a schema `{ error: string }` used for 400, 404, 405, 429 and 503.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { OPENAPI } from "./data-api-openapi";
import { ENDPOINTS } from "./data-api-docs";
import indices from "../../docs/superpowers/specs/data-api-v1-fixtures/indices.json";

describe("OpenAPI", () => {
  it("documents exactly the endpoints the docs list, under the v1 server", () => {
    expect(OPENAPI.openapi).toBe("3.1.0");
    expect(OPENAPI.servers[0].url).toBe("https://builder.registrai.cc/api/v1");
    expect(Object.keys(OPENAPI.paths).sort()).toEqual(ENDPOINTS.map((e) => e.path).sort());
  });
  it("response schemas follow the contract fixtures", () => {
    const s = OPENAPI.components.schemas.Indices;
    expect(Object.keys(s.properties).sort()).toEqual(Object.keys(indices).sort());
    expect(s.required.sort()).toEqual(Object.keys(indices).sort());
  });
  it("every path answers JSON errors as documented", () => {
    for (const p of Object.values(OPENAPI.paths)) expect(Object.keys(p.get.responses)).toEqual(expect.arrayContaining(["200", "400", "429", "503"]));
  });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run src/lib/data-api-openapi.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** the module and route. The route is GET → `JSON.stringify(OPENAPI)` with CORS `*` and
  `cache-control: public, max-age=3600`. Link it in `src/app/data-api/page.tsx` under "Base URL" as "OpenAPI:
  /api/v1/openapi.json".

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run src/lib/data-api-openapi.test.ts src/lib/data-api-docs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "Agent reference: OpenAPI 3.1 description of Data API v1"`

---

### Task 5: Read-only MCP server at /api/mcp

**Files:**
- Create: `builders-site/lib/mcp.ts`, `builders-site/functions/api/mcp.ts`
- Test: `builders-site/test/mcp.test.ts`

**Interfaces:**
- Consumes:
  - from `data-api.ts`: `handleIndices`, `handleIndexHourly`, `handleMemberHourly`, `handleMembersNew` and
    `parseIndex`;
  - `handleVerified` from `data-api-verified.ts`;
  - `loadAppList`, `loadApp` and `idToPath` from Task 1;
  - `parseSort` from Task 2.
- Produces: `handleMcp(req: Request, env: Env, deps: EdgeCacheDeps): Promise<Response>`, and `MCP_TOOLS`, an array
  of `{ name, description, inputSchema }`.

**Protocol:**
- POST only (405 otherwise). The body is a JSON-RPC 2.0 object; batches are not supported (−32600). Malformed JSON
  is −32700.
- `initialize` returns `{ protocolVersion: <the client's if one of ["2025-06-18","2025-03-26"], else "2025-06-18">, capabilities: { tools: {} }, serverInfo: { name: "registrai-arc-data", version: "1.0.0" }, instructions: "Read-only Arc stablecoin app data from Registrai. Cite source_url." }`.
- A notification (no `id`) returns 202 with an empty body.
- `ping` returns `{}`.
- `tools/list` returns `{ tools: MCP_TOOLS }`.
- `tools/call`:
  - it runs the tool and returns
    `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }`;
  - `data` includes a `source_url` (an `/apps/…` page or the API URL);
  - a tool failure (a 4xx from the handler, or an unknown id) returns `isError: true` content with the error
    sentence;
  - an unknown tool name is JSON-RPC error −32602.
- An unknown method is −32601.
- Every response has `content-type: application/json` and CORS `*`.

**Tools** (each input schema is a JSON Schema object with `additionalProperties: false`):
- `arc_indices` {}
- `arc_index_history` { index: enum, from?, to? }
- `arc_apps` { sort?: enum payments|usdc|points|first_seen }
- `arc_app` { id: string }
- `arc_app_history` { id, index: enum, from?, to? }
- `arc_new_apps` { index: enum, since: string }
- `arc_verified` {}

API-backed tools build an internal `Request` to `https://builder.registrai.cc/api/v1/...` and call the handler with
`{ cache: null }`. They return its JSON, and a non-200 becomes an `isError` result.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, test, vi } from "vitest";
import { handleMcp, MCP_TOOLS } from "../lib/mcp";
vi.mock("../lib/data-api-verified", async (orig) => ({ ...(await orig<typeof import("../lib/data-api-verified")>()), verifiedIds: async () => new Set<string>(), handleVerified: async () => new Response(JSON.stringify({ version: 1, updated: "x", verified: [] }), { status: 200 }) }));
// seeded(): same as apps-data.test.ts (copy it)

const rpc = (env: unknown, body: unknown) => handleMcp(new Request("https://builder.registrai.cc/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env as never, { cache: null });

describe("MCP", () => {
  test("initialize, tools/list (7 tools), notification 202, ping", async () => {
    const { env } = await seeded();
    const init = await (await rpc(env, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } })).json();
    expect(init.result.serverInfo.name).toBe("registrai-arc-data");
    expect(init.result.capabilities).toEqual({ tools: {} });
    const list = await (await rpc(env, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    expect(list.result.tools).toHaveLength(7);
    const n = await rpc(env, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(n.status).toBe(202);
    expect((await (await rpc(env, { jsonrpc: "2.0", id: 3, method: "ping" })).json()).result).toEqual({});
  });
  test("tools/call arc_apps and arc_app return data with source_url; unknown app is isError", async () => {
    const { env } = await seeded();
    const apps = await (await rpc(env, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "arc_apps", arguments: {} } })).json();
    expect(apps.result.structuredContent.source_url).toBe("https://builder.registrai.cc/apps/");
    expect(apps.result.structuredContent.rows.length).toBeGreaterThan(0);
    const one = await (await rpc(env, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "arc_app", arguments: { id: "domain:archery.wtf" } } })).json();
    expect(one.result.structuredContent.source_url).toBe("https://builder.registrai.cc/apps/domain/archery.wtf/");
    const bad = await (await rpc(env, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "arc_app", arguments: { id: "domain:nope.example" } } })).json();
    expect(bad.result.isError).toBe(true);
  });
  test("errors: unknown tool -32602, unknown method -32601, bad JSON -32700, GET 405, batch -32600", async () => {
    const { env } = await seeded();
    expect((await (await rpc(env, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nope", arguments: {} } })).json()).error.code).toBe(-32602);
    expect((await (await rpc(env, { jsonrpc: "2.0", id: 8, method: "nope" })).json()).error.code).toBe(-32601);
    const raw = await handleMcp(new Request("https://builder.registrai.cc/api/mcp", { method: "POST", body: "{" }), env as never, { cache: null });
    expect((await raw.json()).error.code).toBe(-32700);
    expect((await handleMcp(new Request("https://builder.registrai.cc/api/mcp"), env as never, { cache: null })).status).toBe(405);
    expect((await (await rpc(env, [{ jsonrpc: "2.0", id: 9, method: "ping" }])).json()).error.code).toBe(-32600);
  });
  test("an API-backed tool returns exactly the API's JSON (plus source_url)", async () => {
    const { env } = await seeded();
    const r = await (await rpc(env, { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "arc_index_history", arguments: { index: "aei" } } })).json();
    expect(r.result.structuredContent).toMatchObject({ version: 1, index: "aei" });
    expect(r.result.structuredContent.source_url).toContain("/api/v1/indices/aei/hourly");
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run builders-site/test/mcp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `mcp.ts` per the protocol above, and the route
  (`export const onRequest = (ctx) => handleMcp(ctx.request, ctx.env, { waitUntil: … })`).

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run builders-site/test/mcp.test.ts builders-site/test/worker-imports.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "Agent reference: read-only MCP server at /api/mcp (7 tools over the Data API)"`

---

### Task 6: Go live and check bot access

- [ ] **Step 1:** Run the full suite (`npx vitest run`; only `drafts.test.ts` may fail) and `npm run lint`.
- [ ] **Step 2:** Run the final whole-branch review: a fresh reviewer on the most capable model, then one fix pass.
- [ ] **Step 3:** Deploy the builder site from `.worktrees/abi-deploy` at HEAD (an allowed command).
- [ ] **Step 4: Live checks.**
  - `curl -A "GPTBot/1.1" https://builder.registrai.cc/apps/` returns 200, and the HTML contains numbers and
    "Data until".
  - An app page returns 200.
  - `/sitemap.xml` lists every app.
  - `/llms.txt` returns 200.
  - `/robots.txt` matches the new text.
  - `/api/v1/openapi.json` parses.
  - The MCP server answers `initialize` and `tools/list` via curl, and `tools/call arc_apps` works.
  - `registrai.cc/apps/` redirects 302 to the builder site.
- [ ] **Step 5: Bot access check** in the browser, on the Cloudflare dashboard:
  - read AI Crawl Control → Metrics for the "Unsuccessful" requests by AI bots: status codes and paths;
  - fix anything that is ours (stale paths → redirects);
  - report any Cloudflare setting to the owner.
- [ ] **Step 6:** Tell the owner the result and the steps that are theirs: listing in the MCP registry (DNS TXT via
  `mcp-publisher`), and links from Arc/Circle resources.
