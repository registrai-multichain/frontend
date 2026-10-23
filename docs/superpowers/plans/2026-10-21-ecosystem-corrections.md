# Ecosystem Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can suggest a correction to an Arc ecosystem entry from its page. The owner approves it in
`/admin`. Approved corrections are applied to the data file and listed in a public log.

**Architecture:**
- **The log:** `src/data/arc-ecosystem/corrections.json` is the public log. It is bundled into the Functions and
  validated in the build, like `entities.json`.
- **Submissions:** they arrive through a plain HTML form on `/ecosystem/<slug>/correct/`. The POST checks fields,
  rate limits (KV) and Cloudflare Turnstile, then stores the correction in a new D1 table, `corrections`
  (`registrai-data`).
- **Review:** the admin API (session-gated) lists and decides corrections.
- **Applying:** a local script lists approved ones for the engineer to apply by hand, and marks them applied after
  the deploy.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), D1, KV, Turnstile, vitest, Next.js static admin (React +
SWR).

**Spec:** `docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md`

## Global Constraints

- **Copy:** plain labels, no slogans.
- **Disclosure:** visible inline next to the submit button, exactly: "We use your email only to reply about this
  correction. Approved corrections are published without your name or email."
- **Success page:** says "Received" and "We review corrections within 7 days.", then links back to the project.
- **Fields:** `field` ∈ `summary | status | links | category | contracts | dates | sources | removal | other`.
  - `text`: 10–1,000 characters after trimming.
  - `source_url`: optional `https` with no credentials, up to 500 characters. Required for `status`, `contracts` and
    `dates`.
  - `email`: required, a simple shape check, up to 254 characters.
  - `name`: optional, up to 100 characters.
- **Limits:**
  - body ≤ 4 KB;
  - 5 per IP-hash per hour;
  - 3 per email per day;
  - check order: fields (400), then rate limits (429), then Turnstile (400).
- **Turnstile:** the form exists only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` are set (and `DATA_DB` is
  bound). Otherwise:
  - the pages show the `mailto:contact@registrai.cc` links;
  - the API answers 503.
- **Error redirects** carry a code (`?error=<code>`), never user input.
- **Privacy:**
  - `email`, `name` and `ip_hash` never appear in any public response.
  - They are cleared 30 days after `decided_at`.
  - Open items are never cleared.
- **Admin rights:** both roles see the queue; only role `admin` can decide. Approval needs a `public_note` of 5–200
  characters, and a decided item answers 409.
- **Log entries:** `{ id, date, slug, field, change, source?, from }`.
  - `from` ∈ `project | reader`.
  - `change`: 5–200 characters.
  - `date`: `YYYY-MM-DD`.
- **`corrections`** becomes a reserved entity slug.
- **Workers runtime:** no `process`. Deploys only from `.worktrees/abi-deploy`. The production deploy and the remote
  D1 migration only with the owner's OK.

## Review Focus

1. **No Turnstile keys, or no `DATA_DB`:** the project page and the form page show the `mailto:` links, and the POST
   answers 503. Nothing 500s. Tests: Task 3, Task 4.
2. **Hostile input:**
   - `<script>` in `text` or `name` is escaped on the admin list (React) and in the log page (`esc`);
   - `javascript:` or `http:` in `source_url` → 400;
   - a body over 4 KB → 400.

   Tests: Task 2 (log escaping), Task 3 (parse).
3. **Cross-site form post:** a POST whose `Origin` isn't the site → 403. A non-form content type → 415. Test: Task 3.
4. **Deciding twice, or by an onboarder:** 409 and 403. Test: Task 5.
5. **Removed entity:** `/ecosystem/<slug>/` answers 410, linking the log entry. It's dropped from the sitemap, and
   `/apps/` falls back. Test: Task 2.

---

### Task 1: The corrections log file, its validation and the reserved slug

**Files:**
- Create:
  - `src/lib/arc-ecosystem-corrections.ts`
  - `src/lib/arc-ecosystem-corrections.test.ts`
  - `src/data/arc-ecosystem/corrections.json`
- Modify:
  - `src/lib/arc-ecosystem.ts` (`RESERVED`)
  - `src/lib/arc-ecosystem-data.ts`
  - `src/lib/arc-ecosystem-data.test.ts`
  - `scripts/ecosystem-validate.ts`
  - `scripts/build-builders-site.sh`

**Interfaces:**
- **Produces:**
  - `type CorrectionEntry = { id: number; date: string; slug: string; field: CorrectionField; change: string; source?: string; from: "project" | "reader" }`
  - `CORRECTION_FIELDS: readonly ["summary","status","links","category","contracts","dates","sources","removal","other"]`
  - `type CorrectionField`
  - `validateCorrections(list: unknown, slugs: ReadonlySet<string>): { ok: true; corrections: CorrectionEntry[] } | { ok: false; errors: string[] }`
  - `indexCorrections(l: CorrectionEntry[]): { all: CorrectionEntry[]; bySlug: Map<string, CorrectionEntry[]>; removed: Map<string, CorrectionEntry> }`, with `all` newest first by `date`, then `id` descending
  - from `arc-ecosystem-data.ts`: `CORRECTIONS` (the result of `indexCorrections` on the file)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/arc-ecosystem-corrections.test.ts
import { describe, expect, test } from "vitest";
import { indexCorrections, validateCorrections } from "./arc-ecosystem-corrections";
import { validateEntities } from "./arc-ecosystem";

const ok = { id: 1, date: "2026-10-22", slug: "visa", field: "summary", change: "Summary now says the pilot settles in USDC.", source: "https://visa.com/x", from: "project" };
const slugs = new Set(["visa", "aave"]);

describe("corrections log", () => {
  test("a valid entry passes; an empty log passes", () => {
    expect(validateCorrections([ok], slugs)).toMatchObject({ ok: true });
    expect(validateCorrections([], slugs)).toMatchObject({ ok: true });
  });
  test("each rule", () => {
    const bad = (o: Record<string, unknown>) => { const r = validateCorrections([{ ...ok, ...o }], slugs); return r.ok ? [] : r.errors; };
    expect(bad({ date: "22-10-2026" }).join()).toMatch(/date/);
    expect(bad({ field: "price" }).join()).toMatch(/field/);
    expect(bad({ change: "abc" }).join()).toMatch(/change/);
    expect(bad({ change: "x".repeat(201) }).join()).toMatch(/change/);
    expect(bad({ source: "http://visa.com" }).join()).toMatch(/source/);
    expect(bad({ source: "javascript:alert(1)" }).join()).toMatch(/source/);
    expect(bad({ from: "someone" }).join()).toMatch(/from/);
    expect(bad({ slug: "nobody" }).join()).toMatch(/slug/);
    expect(bad({ extra: 1 }).join()).toMatch(/unknown field/);
    const dup = validateCorrections([ok, { ...ok }], slugs);
    expect(dup.ok ? [] : dup.errors.join()).toMatch(/duplicate id/);
  });
  test("a removed slug is allowed only with a removal entry", () => {
    const rm = { ...ok, id: 2, slug: "gone", field: "removal", change: "Removed at the project's request." };
    expect(validateCorrections([rm], slugs)).toMatchObject({ ok: true });
    expect(validateCorrections([{ ...rm, id: 3, field: "summary" }], slugs).ok).toBe(false);
    expect(validateCorrections([rm, { ...ok, id: 4, slug: "gone" }], slugs)).toMatchObject({ ok: true });
  });
  test("index: newest first, by slug, removed", () => {
    const a = { ...ok, id: 1, date: "2026-10-22" }, b = { ...ok, id: 2, date: "2026-10-23" }, c = { ...ok, id: 3, slug: "gone", field: "removal" as const, date: "2026-10-23" };
    const ix = indexCorrections([a, b, c] as never);
    expect(ix.all.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(ix.bySlug.get("visa")!.map((x) => x.id)).toEqual([2, 1]);
    expect(ix.removed.get("gone")!.id).toBe(3);
  });
  test("'corrections' is a reserved entity slug", () => {
    const e = { slug: "corrections", name: "X", category: "dexs", status: "announced", summary: "x", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://x.y/" }], last_reviewed: "2026-10-21" };
    const r = validateEntities([e]);
    expect(r.ok ? [] : r.errors.join()).toMatch(/reserved/);
  });
});
```

Add to `src/lib/arc-ecosystem-data.test.ts`:

```ts
import corrRaw from "../data/arc-ecosystem/corrections.json";
import { validateCorrections } from "./arc-ecosystem-corrections";
// …inside the describe:
  test("the corrections log passes validation against the published slugs", () => {
    const r = validateCorrections(corrRaw, new Set(ECOSYSTEM.entities.map((e) => e.slug)));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
```

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run src/lib/arc-ecosystem-corrections.test.ts src/lib/arc-ecosystem-data.test.ts`
Expected: FAIL (module `./arc-ecosystem-corrections` and `corrections.json` missing).

- [ ] **Step 3: Implement**

`src/data/arc-ecosystem/corrections.json`:

```json
[]
```

`src/lib/arc-ecosystem-corrections.ts`:

```ts
/** The public corrections log of the Arc ecosystem directory (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md). */
export const CORRECTION_FIELDS = ["summary", "status", "links", "category", "contracts", "dates", "sources", "removal", "other"] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];
export type CorrectionEntry = { id: number; date: string; slug: string; field: CorrectionField; change: string; source?: string; from: "project" | "reader" };
export const FIELD_LABEL: Record<CorrectionField, string> = {
  summary: "Summary", status: "Status", links: "Website or links", category: "Category", contracts: "Contracts",
  dates: "Dates", sources: "Sources", removal: "Remove this listing", other: "Other",
};

const KEYS = new Set(["id", "date", "slug", "field", "change", "source", "from"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isField = (f: unknown): f is CorrectionField => typeof f === "string" && (CORRECTION_FIELDS as readonly string[]).includes(f);
const httpsUrl = (u: unknown) => { if (typeof u !== "string") return false; try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password; } catch { return false; } };

export function validateCorrections(list: unknown, slugs: ReadonlySet<string>): { ok: true; corrections: CorrectionEntry[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(list)) return { ok: false, errors: ["expected an array of corrections"] };
  const errors: string[] = [], ids = new Set<number>();
  const removed = new Set(list.filter((c) => c && typeof c === "object" && (c as CorrectionEntry).field === "removal").map((c) => (c as CorrectionEntry).slug));
  list.forEach((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const err = (m: string) => errors.push(`#${i} ${typeof c.id === "number" ? c.id : "?"}: ${m}`);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return err("not an object");
    for (const k of Object.keys(c)) if (!KEYS.has(k)) err(`unknown field ${k}`);
    if (typeof c.id !== "number" || !Number.isInteger(c.id) || c.id < 1) err("id must be a positive integer");
    else if (ids.has(c.id)) err("duplicate id"); else ids.add(c.id);
    if (typeof c.date !== "string" || !DAY.test(c.date)) err("date must be YYYY-MM-DD");
    if (!isField(c.field)) err("field must be one of " + CORRECTION_FIELDS.join(", "));
    if (typeof c.change !== "string" || c.change.trim().length < 5 || c.change.length > 200) err("change must be 5-200 characters");
    if (c.source !== undefined && !httpsUrl(c.source)) err("source must be an https URL");
    if (c.from !== "project" && c.from !== "reader") err("from must be project or reader");
    if (typeof c.slug !== "string" || !(slugs.has(c.slug) || removed.has(c.slug))) err("slug must be a published entity or a removed one with a removal entry");
  });
  return errors.length ? { ok: false, errors } : { ok: true, corrections: list as CorrectionEntry[] };
}

export function indexCorrections(l: CorrectionEntry[]) {
  const all = [...l].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
  const bySlug = new Map<string, CorrectionEntry[]>(), removed = new Map<string, CorrectionEntry>();
  for (const c of all) {
    bySlug.set(c.slug, [...(bySlug.get(c.slug) ?? []), c]);
    if (c.field === "removal" && !removed.has(c.slug)) removed.set(c.slug, c);
  }
  return { all, bySlug, removed };
}
```

In `src/lib/arc-ecosystem.ts`, add `"corrections"` to `RESERVED`:

```ts
const RESERVED = new Set(["api", "category", "categories", "entities", "status", "search", "index", "all", "corrections"]);
```

`src/lib/arc-ecosystem-data.ts` becomes:

```ts
import raw from "../data/arc-ecosystem/entities.json";
import corrRaw from "../data/arc-ecosystem/corrections.json";
import { indexEntities, type ArcEntity } from "./arc-ecosystem";
import { indexCorrections, type CorrectionEntry } from "./arc-ecosystem-corrections";

/** The published directory. arc-ecosystem-data.test.ts validates the file, so a bad entry fails the build, never the site. */
export const ECOSYSTEM = indexEntities(raw as unknown as ArcEntity[]);
/** The public corrections log (validated in the same test and in the build). */
export const CORRECTIONS = indexCorrections(corrRaw as unknown as CorrectionEntry[]);
```

`scripts/ecosystem-validate.ts`: also validate `corrections.json` when it sits next to the given file.

```ts
/** Validate a file of ecosystem entries (the published file or a draft batch): npx tsx scripts/ecosystem-validate.ts <file.json>
 *  With the published file, corrections.json next to it is validated against its slugs too. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateEntities } from "../src/lib/arc-ecosystem";
import { validateCorrections } from "../src/lib/arc-ecosystem-corrections";

const file = process.argv[2];
if (!file) { console.error("usage: npx tsx scripts/ecosystem-validate.ts <file.json>"); process.exit(1); }
const r = validateEntities(JSON.parse(readFileSync(file, "utf8")));
if (!r.ok) { for (const e of r.errors) console.log(e); process.exit(1); }
console.log(`${r.entities.length} entries valid`);
const log = join(dirname(file), "corrections.json");
if (existsSync(log)) {
  const c = validateCorrections(JSON.parse(readFileSync(log, "utf8")), new Set(r.entities.map((e) => e.slug)));
  if (!c.ok) { for (const e of c.errors) console.log(`corrections.json ${e}`); process.exit(1); }
  console.log(`${c.corrections.length} corrections valid`);
}
```

`scripts/build-builders-site.sh` already runs this script on `entities.json`, so the build now checks the log too.
Change only its error message:
`… has invalid entries (npx tsx scripts/ecosystem-validate.ts …)` → `… or corrections.json has invalid entries (…)`.

- [ ] **Step 4: Run, expecting a pass**

Run:
```
npx vitest run src/lib/arc-ecosystem-corrections.test.ts src/lib/arc-ecosystem-data.test.ts src/lib/arc-ecosystem.test.ts
npx tsx scripts/ecosystem-validate.ts src/data/arc-ecosystem/entities.json
```
Expected: PASS. The script prints "258 entries valid" and "0 corrections valid".

- [ ] **Step 5: Commit**

```bash
git add src/lib/arc-ecosystem-corrections.ts src/lib/arc-ecosystem-corrections.test.ts src/data/arc-ecosystem/corrections.json src/lib/arc-ecosystem.ts src/lib/arc-ecosystem-data.ts src/lib/arc-ecosystem-data.test.ts scripts/ecosystem-validate.ts scripts/build-builders-site.sh
git commit -m "corrections: public log file, validation in tests and build, 'corrections' reserved"
```

### Task 2: The public log (page, API, project-page line, 410, sitemap, docs)

**Files:**
- Create:
  - `builders-site/lib/corrections-pages.ts`: `renderCorrectionsLog`, `renderRemoved`
  - `builders-site/test/corrections-log.test.ts`
  - `docs/superpowers/specs/data-api-v1-fixtures/ecosystem-corrections.json`
- Modify:
  - `builders-site/functions/ecosystem/[[path]].ts`
  - `builders-site/lib/ecosystem-pages.ts` (the count line)
  - `builders-site/lib/data-api-ecosystem.ts`
  - `builders-site/lib/sitemap-urls.ts`
  - `src/lib/data-api-docs.ts` and its test
  - `src/lib/data-api-openapi.ts`

**Interfaces:**
- **Consumes:** `CORRECTIONS`, `CorrectionEntry`, `FIELD_LABEL` (Task 1); `page`, `esc` from `./apps-pages`.
- **Produces:**
  - `renderCorrectionsLog(all: CorrectionEntry[], names: Map<string, string>): string`
  - `renderRemoved(c: CorrectionEntry): string`
  - `correctionsLine(slug: string): string`, exported from `ecosystem-pages.ts`. It returns `""` when there are none.
  - `GET /api/v1/ecosystem/corrections` → `{ version: 1, corrections: CorrectionEntry[] }`

- [ ] **Step 1: Write the failing tests**

```ts
// builders-site/test/corrections-log.test.ts
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { indexCorrections } from "../../src/lib/arc-ecosystem-corrections";

const E: ArcEntity[] = [
  { slug: "aave", name: "Aave", category: "lending", status: "announced", summary: "Lending.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://aave.com/" }], last_reviewed: "2026-10-20" },
];
const C = [
  { id: 1, date: "2026-10-22", slug: "aave", field: "summary", change: "Summary <b>fixed</b>.", source: "https://aave.com/x", from: "project" },
  { id: 2, date: "2026-10-23", slug: "gone", field: "removal", change: "Removed at the project's request.", from: "project" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: indexCorrections(C as never) }));
vi.mock("../lib/apps-data", async (orig) => ({ ...(await orig<typeof import("../lib/apps-data")>()), loadApp: async () => "unknown" }));

const route = async (path: string) => {
  const { onRequest } = await import("../functions/ecosystem/[[path]]");
  const u = new URL(`https://builder.registrai.cc${path}`);
  const parts = u.pathname.replace(/^\/ecosystem\/?/, "").split("/").filter(Boolean);
  return onRequest({ request: new Request(u), env: { INVITES: { get: async () => null } }, params: { path: parts }, waitUntil: () => undefined } as never);
};

describe("corrections log", () => {
  test("/ecosystem/corrections/: newest first, escaped, linked, ItemList", async () => {
    const h = await (await route("/ecosystem/corrections/")).text();
    expect(h).toContain("<h1>Corrections</h1>");
    expect(h.indexOf("2026-10-23")).toBeLessThan(h.indexOf("2026-10-22"));
    expect(h).toContain("Summary &lt;b&gt;fixed&lt;/b&gt;.");
    expect(h).toContain('<a href="/ecosystem/aave/">Aave</a>');
    expect(h).toContain('id="aave"');
    expect(h).toContain('"@type":"ItemList"');
    expect(h).toContain("From the project");
  });
  test("a removed slug answers 410 with its log entry; an unknown one 404", async () => {
    const r = await route("/ecosystem/gone/");
    expect(r.status).toBe(410);
    expect(await r.text()).toContain('href="/ecosystem/corrections/#gone"');
    expect((await route("/ecosystem/nobody/")).status).toBe(404);
  });
  test("project page shows 'Corrected 1 time · latest …'", async () => {
    const h = await (await route("/ecosystem/aave/")).text();
    expect(h).toContain('<a href="/ecosystem/corrections/#aave">Corrected 1 time · latest 2026-10-22</a>');
  });
  test("API: /api/v1/ecosystem/corrections lists the log newest first", async () => {
    const { handleEcosystem } = await import("../lib/data-api-ecosystem");
    const r = await handleEcosystem(new Request("https://builder.registrai.cc/api/v1/ecosystem/corrections"), { cache: null }, ["corrections"]);
    const b = await r.json() as { version: number; corrections: { id: number }[] };
    expect(b.version).toBe(1);
    expect(b.corrections.map((c) => c.id)).toEqual([2, 1]);
  });
});
```

Add to `builders-site/test/sitemap-urls.test.ts` an assertion that the sitemap URL list contains
`https://builder.registrai.cc/ecosystem/corrections/`. Follow the existing test that checks `/ecosystem/` is listed.
For a removed slug, `sitemapUrls` already lists only `ECOSYSTEM.entities`, so nothing extra is needed.

In `src/lib/data-api-docs.test.ts`, change the expected path list to:

```ts
["/indices", "/indices/{index}/hourly", "/members", "/members/{id}/hourly", "/members/hourly", "/members/new", "/verified", "/ecosystem", "/ecosystem/{slug}", "/ecosystem/corrections", "/arc", "/arc/daily"]
```

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run builders-site/test/corrections-log.test.ts src/lib/data-api-docs.test.ts`
Expected: FAIL. The log page doesn't exist, `/ecosystem/gone/` answers 404, and the docs list is shorter.

- [ ] **Step 3: Implement**

`builders-site/lib/corrections-pages.ts` (the log part; Task 4 adds the form):

```ts
/** /ecosystem/corrections/ and the 410 page of a removed entry (spec 2026-10-21-ecosystem-corrections-design.md). */
import { FIELD_LABEL, type CorrectionEntry } from "../../src/lib/arc-ecosystem-corrections";
import { esc, page } from "./apps-pages";

const SITE = "https://builder.registrai.cc";
const FROM = { project: "From the project", reader: "From a reader" } as const;

export function renderCorrectionsLog(all: CorrectionEntry[], names: Map<string, string>): string {
  const firstOf = new Set<number>(); const seen = new Set<string>();
  for (const c of all) if (!seen.has(c.slug)) { seen.add(c.slug); firstOf.add(c.id); }
  const rows = all.map((c) => {
    const name = names.get(c.slug);
    const who = name ? `<a href="/ecosystem/${esc(c.slug)}/">${esc(name)}</a>` : esc(c.slug);
    return `<tr${firstOf.has(c.id) ? ` id="${esc(c.slug)}"` : ""}><td>${esc(c.date)}</td><td>${who}</td><td>${esc(FIELD_LABEL[c.field])}</td><td>${esc(c.change)}</td><td>${c.source ? `<a href="${esc(c.source)}" rel="noreferrer">Source</a>` : "–"}</td><td>${FROM[c.from]}</td></tr>`;
  }).join("\n");
  const body = `<h1>Corrections</h1>
<p>Corrections to the Arc ecosystem directory, newest first. Suggest one from any project page.</p>
<p class="muted"><a href="/api/v1/ecosystem/corrections">JSON</a> · <a href="/ecosystem/">Arc ecosystem</a></p>
${all.length ? `<div class="wrap"><table><thead><tr><th>Date</th><th>Project</th><th>Field</th><th>Change</th><th>Source</th><th>From</th></tr></thead><tbody>
${rows}
</tbody></table></div>` : "<p>No corrections yet.</p>"}`;
  const ld = { "@context": "https://schema.org", "@type": "ItemList", name: "Arc ecosystem directory corrections", url: `${SITE}/ecosystem/corrections/`,
    itemListElement: all.slice(0, 100).map((c, i) => ({ "@type": "ListItem", position: i + 1, name: `${c.date} ${c.slug}: ${c.change}` })) };
  return page({ title: "Corrections · Arc ecosystem · Registrai", canonical: `${SITE}/ecosystem/corrections/`, description: "Every correction to the Arc ecosystem directory, with its date and source.", body, ld });
}

export function renderRemoved(c: CorrectionEntry): string {
  return page({ title: "Removed · Arc ecosystem · Registrai", canonical: `${SITE}/ecosystem/corrections/`, description: "This listing was removed from the Arc ecosystem directory.", noindex: true,
    body: `<h1>Removed</h1><p>This listing was removed on ${esc(c.date)}: ${esc(c.change)}</p><p><a href="/ecosystem/corrections/#${esc(c.slug)}">Corrections log</a> · <a href="/ecosystem/">Arc ecosystem</a></p>` });
}
```

`builders-site/lib/ecosystem-pages.ts`:
- Import `CORRECTIONS` from `../../src/lib/arc-ecosystem-data`.
- Add the exported helper below.
- In `renderEntity`, insert `${correctionsLine(e.slug)}` right after the closing `</ol>` of Sources, before the
  "Report an error" paragraph.

```ts
/** "Corrected N times · latest DATE", linked to the log; empty when the entry has none. */
export function correctionsLine(slug: string): string {
  const l = CORRECTIONS.bySlug.get(slug);
  if (!l?.length) return "";
  return `<p class="muted"><a href="/ecosystem/corrections/#${esc(slug)}">Corrected ${l.length} time${l.length === 1 ? "" : "s"} · latest ${esc(l[0].date)}</a></p>`;
}
```

`builders-site/functions/ecosystem/[[path]].ts`:
- Import `CORRECTIONS` and the two renderers.
- Before `const cat = categoryOf(parts[0]);`, add:

```ts
  if (parts[0] === "corrections") return html(once("corrections", () => renderCorrectionsLog(CORRECTIONS.all, new Map(all.map((e) => [e.slug, e.name])))), 200, head);
```

- Replace `if (!e) return html(renderEcosystemNotFound(), 404, head);` with:

```ts
  if (!e) {
    const gone = CORRECTIONS.removed.get(parts[0]);
    return gone ? html(renderRemoved(gone), 410, head) : html(renderEcosystemNotFound(), 404, head);
  }
```

`builders-site/lib/data-api-ecosystem.ts`:
- Import `CORRECTIONS`.
- As the first branch for `parts.length === 1`:

```ts
    if (parts[0] === "corrections") return cached(req, deps, "eco-corrections", () => v1Json(req, { version: 1, corrections: CORRECTIONS.all }, 300), 300);
```

`builders-site/lib/sitemap-urls.ts`: in the `ecoUrls` array, add
`at("/ecosystem/corrections/", CORRECTIONS.all[0]?.date ?? ecoMod)` after `at("/ecosystem/", ecoMod)`, and import
`CORRECTIONS`.

`src/lib/data-api-docs.ts`: after the `/ecosystem/{slug}` entry, add:

```ts
  { method: "GET", path: "/ecosystem/corrections", params: "none", returns: "Every correction to the Arc ecosystem directory, newest first: date, project, field, what changed, source, and whether it came from the project or a reader.",
    example: curl("/ecosystem/corrections") },
```

Then append `{ date: "2026-10-21", text: "Directory corrections log: /ecosystem/corrections." }` to `CHANGELOG`.

`docs/superpowers/specs/data-api-v1-fixtures/ecosystem-corrections.json`:

```json
{ "version": 1, "corrections": [ { "id": 1, "date": "2026-10-22", "slug": "aave", "field": "summary", "change": "Summary now names the Arc market.", "source": "https://aave.com/", "from": "project" } ] }
```

`src/lib/data-api-openapi.ts`:
- Import the fixture as `ecosystemCorrections`.
- Add a path entry before `"/ecosystem/{slug}"`.
- Add a component schema. `source` is optional, so drop it from `required`.

```ts
    "/ecosystem/corrections": op("listEcosystemCorrections", "Every correction to the Arc ecosystem directory, newest first", "EcosystemCorrections"),
```
```ts
      EcosystemCorrections: (() => { const s = schemaOf(ecosystemCorrections); const it = s.properties!.corrections.items!; it.required = (it.required ?? []).filter((k) => k !== "source"); return s; })(),
```

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run builders-site/test/corrections-log.test.ts builders-site/test/ecosystem-route.test.ts builders-site/test/ecosystem-pages.test.ts builders-site/test/sitemap-urls.test.ts builders-site/test/data-api-ecosystem.test.ts src/lib/data-api-docs.test.ts src/lib/data-api-openapi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/corrections-pages.ts builders-site/test/corrections-log.test.ts builders-site/functions/ecosystem builders-site/lib/ecosystem-pages.ts builders-site/lib/data-api-ecosystem.ts builders-site/lib/sitemap-urls.ts builders-site/test/sitemap-urls.test.ts src/lib/data-api-docs.ts src/lib/data-api-docs.test.ts src/lib/data-api-openapi.ts docs/superpowers/specs/data-api-v1-fixtures/ecosystem-corrections.json
git commit -m "corrections: public log page and API, project-page count, 410 for removed entries, sitemap, docs"
```

### Task 3: Submissions (D1 table, parsing, limits, Turnstile, POST route)

**Files:**
- Create:
  - `builders-site/migrations-data/0004_corrections.sql`
  - `builders-site/lib/corrections.ts`
  - `builders-site/functions/api/ecosystem/corrections.ts`
  - `builders-site/test/corrections-submit.test.ts`
- Modify:
  - `builders-site/lib/env.ts` (`TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET?: string;`)
  - `builders-site/lib/data-api-ingest.ts` (`DATA_MIGRATIONS` adds `"0004_corrections.sql"`)

**Interfaces:**
- **Consumes:** `CORRECTION_FIELDS`, `CorrectionField` (Task 1); `ECOSYSTEM`.
- **Produces:**
  - `type ErrorCode = "slug" | "field" | "text" | "source_required" | "source" | "email" | "name" | "too_large" | "rate" | "antibot"`
  - `ERROR_TEXT: Record<ErrorCode, string>`
  - `parseCorrection(form: URLSearchParams, slugs: ReadonlySet<string>): { ok: true; value: CorrectionInput } | { ok: false; code: ErrorCode }`
  - `type CorrectionInput = { slug: string; field: CorrectionField; text: string; source_url: string | null; email: string; name: string | null }`
  - `domainMatch(email: string, website?: string): boolean`
  - `correctionsOpen(env: Env): boolean`
  - `handleCorrectionPost(req: Request, env: Env, fetcher?: typeof fetch, now?: number): Promise<Response>`

- [ ] **Step 1: Write the failing tests**

```ts
// builders-site/test/corrections-submit.test.ts
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { MemoryD1 } from "./memory-d1";
import { MemoryKV } from "./memory-kv";

const E: ArcEntity[] = [
  { slug: "visa", name: "Visa", category: "payments", status: "announced", summary: "Payments.", website: "https://www.visa.com/", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://visa.com/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

const ORIGIN = "https://builder.registrai.cc";
const db = () => new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
const env = (o: Record<string, unknown> = {}) => ({ INVITES: new MemoryKV(), DATA_DB: db(), SITE_ORIGIN: ORIGIN, NONCE_SECRET: "s", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "secret", ...o }) as never;
const good = { slug: "visa", field: "summary", text: "The summary should say the pilot is live.", source_url: "https://visa.com/news", email: "ana@visa.com", name: "Ana, comms", "cf-turnstile-response": "tok" };
const post = (fields: Record<string, string> = good, h: Record<string, string> = {}) => new Request(`${ORIGIN}/api/ecosystem/corrections`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "cf-connecting-ip": "1.2.3.4", ...h }, body: new URLSearchParams(fields).toString() });
const turnstile = (success: boolean) => vi.fn(async () => new Response(JSON.stringify({ success })));

describe("parseCorrection", () => {
  test("rules", async () => {
    const { parseCorrection } = await import("../lib/corrections");
    const slugs = new Set(["visa"]);
    const p = (o: Record<string, string>) => parseCorrection(new URLSearchParams({ ...good, ...o }), slugs);
    expect(p({})).toMatchObject({ ok: true, value: { slug: "visa", field: "summary", email: "ana@visa.com", name: "Ana, comms" } });
    expect(p({ slug: "nobody" })).toEqual({ ok: false, code: "slug" });
    expect(p({ field: "price" })).toEqual({ ok: false, code: "field" });
    expect(p({ text: "short" })).toEqual({ ok: false, code: "text" });
    expect(p({ text: "x".repeat(1001) })).toEqual({ ok: false, code: "text" });
    expect(p({ field: "status", source_url: "" })).toEqual({ ok: false, code: "source_required" });
    expect(p({ source_url: "javascript:alert(1)" })).toEqual({ ok: false, code: "source" });
    expect(p({ source_url: "http://visa.com" })).toEqual({ ok: false, code: "source" });
    expect(p({ email: "not-an-email" })).toEqual({ ok: false, code: "email" });
    expect(p({ name: "n".repeat(101) })).toEqual({ ok: false, code: "name" });
    expect(p({ source_url: "", name: "" })).toMatchObject({ ok: true, value: { source_url: null, name: null } });
  });
  test("domainMatch: same host, www, subdomain; not a lookalike", async () => {
    const { domainMatch } = await import("../lib/corrections");
    expect(domainMatch("a@visa.com", "https://www.visa.com/")).toBe(true);
    expect(domainMatch("a@eu.visa.com", "https://visa.com/")).toBe(true);
    expect(domainMatch("a@notvisa.com", "https://visa.com/")).toBe(false);
    expect(domainMatch("a@visa.com", undefined)).toBe(false);
  });
});

describe("POST /api/ecosystem/corrections", () => {
  test("stores one open row with domain_match, a hashed IP and no raw IP; 303 to ?sent=1", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    const e = env(), f = turnstile(true);
    const r = await handleCorrectionPost(post(), e, f as never, 1_800_000_000_000);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/ecosystem/visa/correct/?sent=1");
    const rows = (e as { DATA_DB: MemoryD1 }).DATA_DB.q<Record<string, unknown>>("SELECT * FROM corrections");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slug: "visa", field: "summary", status: "open", domain_match: 1, email: "ana@visa.com", created_at: 1_800_000_000 });
    expect(String(rows[0].ip_hash)).not.toContain("1.2.3.4");
    expect(f).toHaveBeenCalledTimes(1);
  });
  test("Accept: application/json gets 201 {id}", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    const r = await handleCorrectionPost(post(good, { accept: "application/json" }), env(), turnstile(true) as never);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id: 1 });
  });
  test("bad field → 303 ?error=field before Turnstile is called; failed Turnstile → ?error=antibot", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    const f = turnstile(true);
    const r = await handleCorrectionPost(post({ ...good, field: "price" }), env(), f as never);
    expect(r.headers.get("location")).toBe("/ecosystem/visa/correct/?error=field");
    expect(f).not.toHaveBeenCalled();
    const r2 = await handleCorrectionPost(post(), env(), turnstile(false) as never);
    expect(r2.headers.get("location")).toBe("/ecosystem/visa/correct/?error=antibot");
  });
  test("unknown slug → 400 (nowhere to redirect); body over 4 KB → 400", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    expect((await handleCorrectionPost(post({ ...good, slug: "nobody" }), env(), turnstile(true) as never)).status).toBe(400);
    expect((await handleCorrectionPost(post({ ...good, text: "x".repeat(5000) }), env(), turnstile(true) as never)).status).toBe(400);
  });
  test("rate limits: 6th from one IP in an hour and 4th from one email in a day → ?error=rate", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    const e = env(), f = turnstile(true), t = 1_800_000_000_000;
    for (let i = 0; i < 3; i++) expect((await handleCorrectionPost(post(), e, f as never, t)).headers.get("location")).toMatch(/sent=1/);
    expect((await handleCorrectionPost(post(), e, f as never, t)).headers.get("location")).toMatch(/error=rate/);   // email: 3 a day
    for (let i = 0; i < 2; i++) await handleCorrectionPost(post({ ...good, email: `b${i}@x.com` }), e, f as never, t);
    expect((await handleCorrectionPost(post({ ...good, email: "c@x.com" }), e, f as never, t)).headers.get("location")).toMatch(/error=rate/);   // IP: 5 an hour
  });
  test("cross-origin → 403; JSON or other content type → 415; GET → 405", async () => {
    const { handleCorrectionPost } = await import("../lib/corrections");
    expect((await handleCorrectionPost(post(good, { origin: "https://evil.example" }), env(), turnstile(true) as never)).status).toBe(403);
    expect((await handleCorrectionPost(post(good, { "content-type": "application/json" }), env(), turnstile(true) as never)).status).toBe(415);
    expect((await handleCorrectionPost(new Request(`${ORIGIN}/api/ecosystem/corrections`), env(), turnstile(true) as never)).status).toBe(405);
  });
  test("no Turnstile keys or no DATA_DB → 503 and nothing stored", async () => {
    const { handleCorrectionPost, correctionsOpen } = await import("../lib/corrections");
    expect(correctionsOpen(env({ TURNSTILE_SECRET: undefined }))).toBe(false);
    expect(correctionsOpen(env({ DATA_DB: undefined }))).toBe(false);
    expect((await handleCorrectionPost(post(), env({ TURNSTILE_SITE_KEY: undefined }), turnstile(true) as never)).status).toBe(503);
  });
});
```

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run builders-site/test/corrections-submit.test.ts`
Expected: FAIL. The module `../lib/corrections` and migration 0004 don't exist yet.

- [ ] **Step 3: Implement**

`builders-site/migrations-data/0004_corrections.sql`:

```sql
-- Ecosystem corrections (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md)
CREATE TABLE corrections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL,
  field         TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  source_url    TEXT,
  email         TEXT,                -- NULL 30 days after the decision
  name          TEXT,
  domain_match  INTEGER NOT NULL,    -- 1: the email's domain is the website's host or a subdomain of it (a hint, never confirmed)
  ip_hash       TEXT    NOT NULL,    -- keyed hash, for rate limits; '' after the retention period
  status        TEXT    NOT NULL DEFAULT 'open',   -- open | approved | rejected | applied
  public_note   TEXT,
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_by    TEXT,
  applied_at    INTEGER
);
CREATE INDEX corrections_status ON corrections(status, created_at);
```

`builders-site/lib/corrections.ts`:

```ts
/**
 * Ecosystem corrections (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md).
 *
 *   POST /api/ecosystem/corrections   public HTML form (x-www-form-urlencoded, same origin), Turnstile, rate-limited
 *
 * Checks run in this order: fields (400 / ?error=), rate limits (429 / ?error=rate), Turnstile (?error=antibot). Error
 * redirects carry a code, never user input. Emails and IP hashes are never returned by any public route.
 */
import { CORRECTION_FIELDS, type CorrectionField } from "../../src/lib/arc-ecosystem-corrections";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import type { Env } from "./env";
import { siteOrigin } from "./http";

export const CORRECT_MAX_BODY = 4096;
export const RATE_IP_HOURLY = 5;
export const RATE_EMAIL_DAILY = 3;
export const RETAIN_S = 30 * 24 * 3600;
const NEEDS_SOURCE: ReadonlySet<CorrectionField> = new Set(["status", "contracts", "dates"]);
const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type ErrorCode = "slug" | "field" | "text" | "source_required" | "source" | "email" | "name" | "too_large" | "rate" | "antibot";
export const ERROR_TEXT: Record<ErrorCode, string> = {
  slug: "Unknown project.", field: "Choose what is wrong.", text: "The correction must be 10 to 1,000 characters.",
  source_required: "Add a source link for status, contract and date corrections.", source: "The source must be an https link.",
  email: "Enter a valid email address.", name: "Name and role can be at most 100 characters.", too_large: "The correction is too long.",
  rate: "Too many corrections from you today. Try again later.", antibot: "Anti-bot check failed, try again.",
};
export type CorrectionInput = { slug: string; field: CorrectionField; text: string; source_url: string | null; email: string; name: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const httpsUrl = (u: string) => { try { const x = new URL(u); return x.protocol === "https:" && !x.username && !x.password; } catch { return false; } };

export function parseCorrection(form: URLSearchParams, slugs: ReadonlySet<string>): { ok: true; value: CorrectionInput } | { ok: false; code: ErrorCode } {
  const g = (k: string) => (form.get(k) ?? "").trim();
  const slug = g("slug"), field = g("field"), text = g("text"), source = g("source_url"), email = g("email").toLowerCase(), name = g("name");
  if (!slugs.has(slug)) return { ok: false, code: "slug" };
  if (!(CORRECTION_FIELDS as readonly string[]).includes(field)) return { ok: false, code: "field" };
  if (text.length < 10 || text.length > 1000) return { ok: false, code: "text" };
  if (!source && NEEDS_SOURCE.has(field as CorrectionField)) return { ok: false, code: "source_required" };
  if (source && (source.length > 500 || !httpsUrl(source))) return { ok: false, code: "source" };
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, code: "email" };
  if (name.length > 100) return { ok: false, code: "name" };
  return { ok: true, value: { slug, field: field as CorrectionField, text, source_url: source || null, email, name: name || null } };
}

export function domainMatch(email: string, website?: string): boolean {
  if (!website) return false;
  let host: string;
  try { host = new URL(website).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  return d === host || d.endsWith(`.${host}`);
}

export const correctionsOpen = (env: Env) => !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET && env.DATA_DB);

async function hmacHex(secret: string, msg: string, bytes = 12): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return Array.from(mac.slice(0, bytes), (x) => x.toString(16).padStart(2, "0")).join("");
}
const ipOf = (req: Request) => req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

/** One counter per window in KV; false once the window already holds `max`. */
async function underLimit(kv: Env["INVITES"], key: string, max: number, ttl: number): Promise<boolean> {
  const n = Number((await kv.get(key)) ?? "0") || 0;
  if (n >= max) return false;
  await kv.put(key, String(n + 1), { expirationTtl: Math.max(60, ttl) });
  return true;
}

async function turnstileOk(secret: string, token: string, ip: string, fetcher: typeof fetch): Promise<boolean> {
  if (!token) return false;
  try {
    const r = await fetcher(TURNSTILE_VERIFY, { method: "POST", body: new URLSearchParams({ secret, response: token, remoteip: ip }), signal: AbortSignal.timeout(8000) });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch { return false; }
}

const text = (body: string, status: number, extra: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra } });

export async function handleCorrectionPost(req: Request, env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  if (req.method.toUpperCase() !== "POST") return text("Only POST is supported.", 405, { allow: "POST" });
  if (!correctionsOpen(env)) return text("Corrections are not open yet. Email contact@registrai.cc.", 503);
  const origin = siteOrigin(env);
  if (!origin || req.headers.get("origin") !== origin) return text("Cross-origin request refused.", 403);
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return text("Send the form.", 415);
  const raw = await req.text();
  if (raw.length > CORRECT_MAX_BODY) return text(ERROR_TEXT.too_large, 400);
  const form = new URLSearchParams(raw);
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  const slugs = new Set(ECOSYSTEM.entities.map((e) => e.slug));
  const slug = (form.get("slug") ?? "").trim();
  const fail = (code: ErrorCode, status: number) => wantsJson || !slugs.has(slug)
    ? new Response(JSON.stringify({ error: code, message: ERROR_TEXT[code] }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
    : new Response(null, { status: 303, headers: { location: `/ecosystem/${slug}/correct/?error=${code}`, "cache-control": "no-store" } });
  const p = parseCorrection(form, slugs);
  if (!p.ok) return fail(p.code, 400);
  const v = p.value, ip = ipOf(req), secret = env.NONCE_SECRET ?? "registrai-corrections";
  const ipHash = await hmacHex(secret, `correct:${ip}`);
  const emailHash = await hmacHex(secret, `correct-email:${v.email}`);
  const hour = Math.floor(now / 3600e3), day = Math.floor(now / 86400e3);
  if (!(await underLimit(env.INVITES, `correct-rl:${ipHash}:${hour}`, RATE_IP_HOURLY, 3600))) return fail("rate", 429);
  if (!(await underLimit(env.INVITES, `correct-em:${emailHash}:${day}`, RATE_EMAIL_DAILY, 86400))) return fail("rate", 429);
  if (!(await turnstileOk(env.TURNSTILE_SECRET!, form.get("cf-turnstile-response") ?? "", ip, fetcher))) return fail("antibot", 400);
  const website = ECOSYSTEM.bySlug.get(v.slug)?.website;
  const row = await env.DATA_DB!.prepare(`INSERT INTO corrections (slug, field, text, source_url, email, name, domain_match, ip_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(v.slug, v.field, v.text, v.source_url, v.email, v.name, domainMatch(v.email, website) ? 1 : 0, ipHash, Math.floor(now / 1000)).first<{ id: number }>();
  if (wantsJson) return new Response(JSON.stringify({ id: row?.id ?? null }), { status: 201, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  return new Response(null, { status: 303, headers: { location: `/ecosystem/${v.slug}/correct/?sent=1`, "cache-control": "no-store" } });
}
```

Notes:
- The redirect for a `fail` is a 303 for form posts, whatever the status argument. The status only applies to JSON
  callers.
- The 429 test reads `location`, which matches the 303.

`builders-site/functions/api/ecosystem/corrections.ts`:

```ts
import type { PagesFunction } from "../../../lib/env";
import { handleCorrectionPost } from "../../../lib/corrections";

/** POST /api/ecosystem/corrections: the public corrections form (spec 2026-10-21-ecosystem-corrections-design.md). */
export const onRequest: PagesFunction = ({ request, env }) => handleCorrectionPost(request, env);
```

`builders-site/lib/env.ts`: in the `Env` interface, next to the other optional strings, add:

```ts
  /** Cloudflare Turnstile for the corrections form: both set → the form is open (spec 2026-10-21-ecosystem-corrections-design.md). */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
```

`builders-site/lib/data-api-ingest.ts`:

```ts
export const DATA_MIGRATIONS = ["0001_data_api.sql", "0002_x402.sql", "0003_arc_daily.sql", "0004_corrections.sql"];
```

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run builders-site/test/corrections-submit.test.ts builders-site/test/arc-daily.test.ts`
Expected: PASS. `arc-daily` still passes with the new migration in the list.

- [ ] **Step 5: Commit**

```bash
git add builders-site/migrations-data/0004_corrections.sql builders-site/lib/corrections.ts builders-site/functions/api/ecosystem/corrections.ts builders-site/test/corrections-submit.test.ts builders-site/lib/env.ts builders-site/lib/data-api-ingest.ts
git commit -m "corrections: D1 table 0004, POST /api/ecosystem/corrections (fields, rate limits, Turnstile)"
```

### Task 4: The form page and the project-page link

**Files:**
- Modify:
  - `builders-site/lib/corrections-pages.ts` (adds `renderCorrectionForm`)
  - `builders-site/functions/ecosystem/[[path]].ts`
  - `builders-site/lib/ecosystem-pages.ts`
  - `builders-site/lib/ecosystem-load.ts`
- Test: `builders-site/test/corrections-form.test.ts`

**Interfaces:**
- **Consumes:** `correctionsOpen`, `ERROR_TEXT`, `ErrorCode` (Task 3); `FIELD_LABEL` and `CORRECTION_FIELDS`
  (Task 1).
- **Produces:**
  - `renderCorrectionForm(e: ArcEntity, o: { siteKey: string | null; sent: boolean; error: ErrorCode | null }): string`
  - `EntityView` gains `correctionsOpen: boolean`, set by `loadEntityView` from `correctionsOpen(env)`.

- [ ] **Step 1: Write the failing tests**

```ts
// builders-site/test/corrections-form.test.ts
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

const E: ArcEntity[] = [
  { slug: "aave", name: "Aave", category: "lending", status: "announced", summary: "Lending.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://aave.com/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));
vi.mock("../lib/apps-data", async (orig) => ({ ...(await orig<typeof import("../lib/apps-data")>()), loadApp: async () => "unknown" }));

const OPEN = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET: "s", DATA_DB: {} };
const route = async (path: string, env: Record<string, unknown> = {}) => {
  const { onRequest } = await import("../functions/ecosystem/[[path]]");
  const u = new URL(`https://builder.registrai.cc${path}`);
  const parts = u.pathname.replace(/^\/ecosystem\/?/, "").split("/").filter(Boolean);
  return onRequest({ request: new Request(u), env: { INVITES: { get: async () => null }, ...env }, params: { path: parts }, waitUntil: () => undefined } as never);
};

describe("correction form", () => {
  test("open: the form posts to the API with every field, Turnstile and the disclosure", async () => {
    const r = await route("/ecosystem/aave/correct/", OPEN);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const h = await r.text();
    expect(h).toContain('<form method="post" action="/api/ecosystem/corrections">');
    for (const n of ['name="slug" value="aave"', 'name="field"', 'name="text"', 'name="source_url"', 'name="email"', 'name="name"']) expect(h, n).toContain(n);
    expect(h).toContain('<option value="removal">Remove this listing</option>');
    expect(h).toContain('class="cf-turnstile" data-sitekey="site-key"');
    expect(h).toContain("https://challenges.cloudflare.com/turnstile/v0/api.js");
    expect(h).toContain("We use your email only to reply about this correction. Approved corrections are published without your name or email.");
    expect(h).toContain('<meta name="robots" content="noindex">');
  });
  test("?sent=1 → Received; ?error=rate → its fixed message; unknown codes are ignored", async () => {
    const sent = await (await route("/ecosystem/aave/correct/?sent=1", OPEN)).text();
    expect(sent).toContain("<h1>Received</h1>");
    expect(sent).toContain("We review corrections within 7 days.");
    expect(sent).toContain('href="/ecosystem/aave/"');
    expect(await (await route("/ecosystem/aave/correct/?error=rate", OPEN)).text()).toContain("Too many corrections from you today.");
    expect(await (await route("/ecosystem/aave/correct/?error=%3Cscript%3E", OPEN)).text()).not.toContain("<script>alert");
  });
  test("closed (no keys): mailto fallback, no form; the project page keeps both mailto links", async () => {
    const h = await (await route("/ecosystem/aave/correct/")).text();
    expect(h).not.toContain("<form");
    expect(h).toContain("mailto:contact@registrai.cc");
    const p = await (await route("/ecosystem/aave/")).text();
    expect(p).toContain(">Report an error</a>");
    expect(p).toContain(">Ask for removal</a>");
  });
  test("open: the project page links the form instead of the mailto links", async () => {
    const p = await (await route("/ecosystem/aave/", OPEN)).text();
    expect(p).toContain('<a href="/ecosystem/aave/correct/">Suggest a correction</a>');
    expect(p).not.toContain("Ask for removal");
  });
  test("unknown slug → 404; /correct without slash → 301", async () => {
    expect((await route("/ecosystem/nobody/correct/", OPEN)).status).toBe(404);
    expect((await route("/ecosystem/aave/correct", OPEN)).status).toBe(301);
  });
});
```

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run builders-site/test/corrections-form.test.ts`
Expected: FAIL. `/ecosystem/aave/correct/` answers 404, since the route takes one path part only.

- [ ] **Step 3: Implement**

Append to `builders-site/lib/corrections-pages.ts`:

```ts
import type { ArcEntity } from "../../src/lib/arc-ecosystem";
import { CORRECTION_FIELDS } from "../../src/lib/arc-ecosystem-corrections";
import { ERROR_TEXT, type ErrorCode } from "./corrections";

const DISCLOSURE = "We use your email only to reply about this correction. Approved corrections are published without your name or email.";
const mailto = (slug: string) => `mailto:contact@registrai.cc?subject=${encodeURIComponent(`Registrai ecosystem: ${slug}`)}`;

export function renderCorrectionForm(e: ArcEntity, o: { siteKey: string | null; sent: boolean; error: ErrorCode | null }): string {
  const back = `/ecosystem/${esc(e.slug)}/`, canonical = `${SITE}/ecosystem/${e.slug}/correct/`;
  const title = `Suggest a correction: ${e.name} · Registrai`;
  if (o.sent) return page({ title, canonical, description: `Correction received for ${e.name}.`, noindex: true,
    body: `<h1>Received</h1><p>We review corrections within 7 days.</p><p><a href="${back}">Back to ${esc(e.name)}</a></p>` });
  if (!o.siteKey) return page({ title, canonical, description: `Suggest a correction to ${e.name}.`, noindex: true,
    body: `<h1>Suggest a correction</h1><p>Email <a href="${esc(mailto(e.slug))}">contact@registrai.cc</a> with what is wrong on <a href="${back}">${esc(e.name)}</a> and a source.</p>` });
  const options = CORRECTION_FIELDS.map((f) => `<option value="${f}">${esc(FIELD_LABEL[f])}</option>`).join("");
  const body = `<h1>Suggest a correction</h1>
<p class="muted">For <a href="${back}">${esc(e.name)}</a>. Nothing changes until we review it.</p>
${o.error ? `<p class="error" role="alert">${esc(ERROR_TEXT[o.error])}</p>` : ""}
<form method="post" action="/api/ecosystem/corrections">
<input type="hidden" name="slug" value="${esc(e.slug)}">
<p><label>What is wrong<br><select name="field" required><option value="">Choose…</option>${options}</select></label></p>
<p><label>Correction<br><textarea name="text" required minlength="10" maxlength="1000" rows="6"></textarea></label></p>
<p><label>Source link (required for status, contracts and dates)<br><input type="url" name="source_url" maxlength="500" placeholder="https://"></label></p>
<p><label>Email<br><input type="email" name="email" required maxlength="254"></label></p>
<p><label>Name and role (optional)<br><input type="text" name="name" maxlength="100"></label></p>
<div class="cf-turnstile" data-sitekey="${esc(o.siteKey)}"></div>
<p class="muted">${DISCLOSURE}</p>
<p><button type="submit">Send correction</button></p>
</form>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
  return page({ title, canonical, description: `Suggest a correction to ${e.name}.`, noindex: true, body });
}
```

(`SITE`, `esc`, `page` and `FIELD_LABEL` are already imported at the top of the file from Task 2. Merge the imports
there rather than repeating them.)

Ruling, planned in advance: the Turnstile script tag has no `integrity` attribute. Cloudflare updates `api.js` in
place and documents it as unpinnable, so an SRI hash would break the form on its next update. It loads only on the
noindex form page.

`builders-site/functions/ecosystem/[[path]].ts`:
- Allow two parts when the second is `correct`.
- Replace `if (parts.length !== 1) return html(renderEcosystemNotFound(), 404, head);` with the block below.
- Import `correctionsOpen`, `ERROR_TEXT` and `renderCorrectionForm`.

```ts
  if (parts.length === 2 && parts[1] === "correct") {
    const target = ECOSYSTEM.bySlug.get(parts[0]);
    if (!target) return html(renderEcosystemNotFound(), 404, head);
    const code = url.searchParams.get("error");
    const error = code && code in ERROR_TEXT ? (code as keyof typeof ERROR_TEXT) : null;
    const h = renderCorrectionForm(target, { siteKey: correctionsOpen(ctx.env) ? ctx.env.TURNSTILE_SITE_KEY! : null, sent: url.searchParams.get("sent") === "1", error });
    return new Response(head ? null : h, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" } });
  }
  if (parts.length !== 1) return html(renderEcosystemNotFound(), 404, head);
```

`builders-site/lib/ecosystem-load.ts`:
- Import `correctionsOpen` from `./corrections`.
- Return `{ entity: e, app, facts, correctionsOpen: correctionsOpen(env) }`.

`builders-site/lib/ecosystem-pages.ts`:
- Add `correctionsOpen?: boolean` to `EntityView`.
- Replace the last paragraph's two `mailto` links:

```ts
const errorLinks = v.correctionsOpen
  ? `<a href="/ecosystem/${esc(e.slug)}/correct/">Suggest a correction</a>`
  : `<a href="${esc(mail(`Registrai ecosystem: ${e.slug}`))}">Report an error</a> · <a href="${esc(mail(`Removal: ${e.slug}`))}">Ask for removal</a>`;
```

Use `${errorLinks}` in place of those two links.

The entity response is edge-cached under the variant `entity:<slug>`. Make the variant
`` `entity:${e.slug}:${correctionsOpen(ctx.env) ? "c" : "m"}` ``, so setting the keys doesn't serve a stale cached
page for 5 minutes with the wrong link.

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run builders-site/test/corrections-form.test.ts builders-site/test/ecosystem-route.test.ts builders-site/test/ecosystem-pages.test.ts builders-site/test/ecosystem-memo.test.ts`
Expected: PASS. If an existing `ecosystem-pages` test asserts "Report an error", it still passes, because the
default view has no `correctionsOpen`.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/corrections-pages.ts builders-site/functions/ecosystem builders-site/lib/ecosystem-pages.ts builders-site/lib/ecosystem-load.ts builders-site/test/corrections-form.test.ts
git commit -m "corrections: form page at /ecosystem/<slug>/correct/ (mailto fallback without Turnstile keys), project-page link"
```

### Task 5: Admin API (list, decide) and the 30-day purge

**Files:**
- Modify: `builders-site/lib/corrections.ts`, adding `handleAdminCorrections`, `purgeCorrections` and
  `type AdminCorrection`.
- Create:
  - `builders-site/functions/api/admin/corrections.ts`
  - `builders-site/test/corrections-admin.test.ts`
- Modify: `builders-site/lib/builders-index.ts`, calling the purge in the daily `later`.

**Interfaces:**
- **Consumes:** the table (Task 3); `Role` from `./auth`.
- **Produces:**
  - `type AdminCorrection = { id: number; slug: string; name: string; field: string; text: string; source_url: string | null; email: string | null; person: string | null; domain_match: boolean; status: "open" | "approved" | "rejected" | "applied"; public_note: string | null; created_at: number; decided_at: number | null; decided_by: string | null; applied_at: number | null }`
    - `name` is the entity name.
    - `person` is the sender's name and role.
  - `handleAdminCorrections(req: Request, env: Env, who: { address: string; role: Role }, now?: number): Promise<Response>`
    - `GET` → `{ open: AdminCorrection[]; decided: AdminCorrection[] }`
    - `POST {id, decision, public_note?}` → `{ correction: AdminCorrection }`
  - `purgeCorrections(db: D1Database, now?: number): Promise<number>` returns the rows cleared.

- [ ] **Step 1: Write the failing tests**

```ts
// builders-site/test/corrections-admin.test.ts
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import { DATA_MIGRATIONS } from "../lib/data-api-ingest";
import { MemoryD1 } from "./memory-d1";

const E: ArcEntity[] = [
  { slug: "visa", name: "Visa", category: "payments", status: "announced", summary: "Payments.", status_evidence: [{ url: "https://www.arc.io/x" }], sources: [{ url: "https://visa.com/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E), CORRECTIONS: { all: [], bySlug: new Map(), removed: new Map() } }));

const ADMIN = { address: "0xadmin", role: "admin" as const }, ONB = { address: "0xonb", role: "onboarder" as const };
function seeded() {
  const db = new MemoryD1(DATA_MIGRATIONS.map((f) => resolve(__dirname, "../migrations-data", f)));
  db.q("INSERT INTO corrections (slug, field, text, email, name, domain_match, ip_hash, created_at) VALUES ('visa','summary','Fix <b>it</b> please now','a@visa.com','Ana',1,'h1',100)");
  db.q("INSERT INTO corrections (slug, field, text, email, domain_match, ip_hash, created_at) VALUES ('visa','other','Second one here','b@x.com',0,'h2',200)");
  return db;
}
const req = (body?: unknown) => new Request("https://builder.registrai.cc/api/admin/corrections", body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("admin corrections", () => {
  test("GET: open items oldest first, with the entity name and domain hint; never the IP hash", async () => {
    const { handleAdminCorrections } = await import("../lib/corrections");
    const b = await (await handleAdminCorrections(req(), { DATA_DB: seeded() } as never, ONB)).json() as { open: Record<string, unknown>[]; decided: unknown[] };
    expect(b.open.map((c) => c.id)).toEqual([1, 2]);
    expect(b.open[0]).toMatchObject({ slug: "visa", name: "Visa", domain_match: true, email: "a@visa.com", person: "Ana", status: "open" });
    expect(JSON.stringify(b)).not.toContain("ip_hash");
    expect(b.decided).toEqual([]);
  });
  test("POST approve needs a 5-200 char note; reject needs none; deciding twice → 409; unknown → 404", async () => {
    const { handleAdminCorrections } = await import("../lib/corrections");
    const env = { DATA_DB: seeded() } as never;
    expect((await handleAdminCorrections(req({ id: 1, decision: "approve", public_note: "abc" }), env, ADMIN)).status).toBe(400);
    const r = await handleAdminCorrections(req({ id: 1, decision: "approve", public_note: "Summary now says the pilot is live." }), env, ADMIN, 5_000_000);
    expect(r.status).toBe(200);
    expect((await r.json() as { correction: Record<string, unknown> }).correction).toMatchObject({ status: "approved", public_note: "Summary now says the pilot is live.", decided_by: "0xadmin", decided_at: 5000 });
    expect((await handleAdminCorrections(req({ id: 1, decision: "reject" }), env, ADMIN)).status).toBe(409);
    expect((await handleAdminCorrections(req({ id: 2, decision: "reject" }), env, ADMIN)).status).toBe(200);
    expect((await handleAdminCorrections(req({ id: 99, decision: "reject" }), env, ADMIN)).status).toBe(404);
    expect((await handleAdminCorrections(req({ id: 1, decision: "maybe" }), env, ADMIN)).status).toBe(400);
  });
  test("an onboarder can read but not decide (403)", async () => {
    const { handleAdminCorrections } = await import("../lib/corrections");
    expect((await handleAdminCorrections(req({ id: 1, decision: "reject" }), { DATA_DB: seeded() } as never, ONB)).status).toBe(403);
  });
  test("no DATA_DB → 503", async () => {
    const { handleAdminCorrections } = await import("../lib/corrections");
    expect((await handleAdminCorrections(req(), {} as never, ADMIN)).status).toBe(503);
  });
  test("purge: clears email, name and IP hash 30 days after the decision; open items untouched", async () => {
    const { purgeCorrections, RETAIN_S } = await import("../lib/corrections");
    const db = seeded();
    db.q("UPDATE corrections SET status='rejected', decided_at=1000 WHERE id=1");
    expect(await purgeCorrections(db as never, (1000 + RETAIN_S - 1) * 1000)).toBe(0);
    expect(await purgeCorrections(db as never, (1000 + RETAIN_S + 1) * 1000)).toBe(1);
    expect(db.q("SELECT id, email, name, ip_hash FROM corrections ORDER BY id")).toEqual([
      { id: 1, email: null, name: null, ip_hash: "" }, { id: 2, email: "b@x.com", name: null, ip_hash: "h2" }]);
  });
});
```

Add to `builders-site/test/arc-daily.test.ts`, in the 00:00 push test after the snapshot assertion:

```ts
      d.sqlite.exec("INSERT INTO corrections (slug, field, text, email, domain_match, ip_hash, created_at, status, decided_at) VALUES ('x','other','old one here','o@x.com',0,'h',1,'rejected',1)");
      expect((await handlePushIndex(post(withHour("2026-10-23T00:00:00Z")), env, "aei")).status).toBe(200);
      expect(d.sqlite.prepare("SELECT email FROM corrections").all()[0]).toEqual({ email: null });   // purged in the daily job
```

Put this before the `broken` env lines.

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run builders-site/test/corrections-admin.test.ts builders-site/test/arc-daily.test.ts`
Expected: FAIL. `handleAdminCorrections` and `purgeCorrections` aren't exported, and the email isn't purged.

- [ ] **Step 3: Implement**

Append to `builders-site/lib/corrections.ts`:

```ts
import type { Role } from "./auth";
import type { D1Database } from "./env";
import { json } from "./http";

export type AdminCorrection = { id: number; slug: string; name: string; field: string; text: string; source_url: string | null; email: string | null; person: string | null;
  domain_match: boolean; status: "open" | "approved" | "rejected" | "applied"; public_note: string | null; created_at: number; decided_at: number | null; decided_by: string | null; applied_at: number | null };
const COLS = "id, slug, field, text, source_url, email, name, domain_match, status, public_note, created_at, decided_at, decided_by, applied_at";
const toAdmin = (r: Record<string, unknown>): AdminCorrection => ({
  id: Number(r.id), slug: String(r.slug), name: ECOSYSTEM.bySlug.get(String(r.slug))?.name ?? String(r.slug), field: String(r.field), text: String(r.text),
  source_url: (r.source_url as string | null) ?? null, email: (r.email as string | null) ?? null, person: (r.name as string | null) ?? null, domain_match: Number(r.domain_match) === 1,
  status: r.status as AdminCorrection["status"], public_note: (r.public_note as string | null) ?? null, created_at: Number(r.created_at),
  decided_at: r.decided_at == null ? null : Number(r.decided_at), decided_by: (r.decided_by as string | null) ?? null, applied_at: r.applied_at == null ? null : Number(r.applied_at),
});

export async function handleAdminCorrections(req: Request, env: Env, who: { address: string; role: Role }, now = Date.now()): Promise<Response> {
  const db = env.DATA_DB;
  if (!db) return json({ error: "DATA_DB is not bound" }, 503);
  const m = req.method.toUpperCase();
  if (m === "GET") {
    const open = (await db.prepare(`SELECT ${COLS} FROM corrections WHERE status = 'open' ORDER BY created_at, id`).all()).results.map(toAdmin);
    const decided = (await db.prepare(`SELECT ${COLS} FROM corrections WHERE status != 'open' ORDER BY decided_at DESC, id DESC LIMIT 50`).all()).results.map(toAdmin);
    return json({ open, decided });
  }
  if (m !== "POST") return json({ error: "Only GET and POST are supported." }, 405);
  if (who.role !== "admin") return json({ error: "Only the admin role can decide corrections." }, 403);
  const b = (await req.json().catch(() => null)) as { id?: unknown; decision?: unknown; public_note?: unknown } | null;
  const id = Number(b?.id), decision = b?.decision, note = typeof b?.public_note === "string" ? b.public_note.trim() : "";
  if (!Number.isInteger(id) || id < 1 || (decision !== "approve" && decision !== "reject")) return json({ error: "Send {id, decision: approve | reject, public_note}." }, 400);
  if (decision === "approve" && (note.length < 5 || note.length > 200)) return json({ error: "The public note must be 5-200 characters." }, 400);
  const res = await db.prepare(`UPDATE corrections SET status = ?, public_note = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'open'`)
    .bind(decision === "approve" ? "approved" : "rejected", decision === "approve" ? note : null, Math.floor(now / 1000), who.address, id).run();
  const row = await db.prepare(`SELECT ${COLS} FROM corrections WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) return json({ error: "No such correction." }, 404);
  if (!res.meta.changes) return json({ error: "This correction was already decided.", correction: toAdmin(row) }, 409);
  return json({ correction: toAdmin(row) });
}

/** Clears email, name and IP hash 30 days after the decision (spec: privacy). Open items are never cleared. */
export async function purgeCorrections(db: D1Database, now = Date.now()): Promise<number> {
  const r = await db.prepare(`UPDATE corrections SET email = NULL, name = NULL, ip_hash = '' WHERE decided_at IS NOT NULL AND decided_at < ? AND (email IS NOT NULL OR name IS NOT NULL OR ip_hash != '')`)
    .bind(Math.floor(now / 1000) - RETAIN_S).run();
  return r.meta.changes ?? 0;
}
```

Merge the imports into the file's import block at the top.

`builders-site/functions/api/admin/corrections.ts`:

```ts
import type { Role } from "../../../lib/auth";
import type { PagesFunction } from "../../../lib/env";
import { handleAdminCorrections } from "../../../lib/corrections";

/** GET / POST /api/admin/corrections (the middleware has checked the session and, for POST, CSRF). */
export const onRequest: PagesFunction<{ admin?: string; role?: Role }> = ({ request, env, data }) =>
  handleAdminCorrections(request, env, { address: data.admin ?? "", role: data.role ?? "onboarder" });
```

`builders-site/lib/builders-index.ts`:
- Import `purgeCorrections` from `./corrections`.
- Inside the `later` async block, after the `snapshotArcDaily` line:

```ts
          if (env.DATA_DB) await purgeCorrections(env.DATA_DB).catch(() => 0);   // corrections: 30-day privacy purge, once a day
```

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run builders-site/test/corrections-admin.test.ts builders-site/test/arc-daily.test.ts builders-site/test/corrections-submit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/corrections.ts builders-site/functions/api/admin/corrections.ts builders-site/test/corrections-admin.test.ts builders-site/lib/builders-index.ts builders-site/test/arc-daily.test.ts
git commit -m "corrections: admin list and decide (admin role only, 409 on re-decide), 30-day purge in the daily job"
```

### Task 6: The "Corrections" section in /admin

**Files:**
- Modify:
  - `src/lib/admin-sections.ts`
  - `src/lib/admin-sections.test.ts`
  - `src/components/admin/AdminApp.tsx`
- Test: `src/components/admin/CorrectionsSection.test.tsx` (new)

**Interfaces:**
- **Consumes:** `GET` and `POST /api/admin/corrections` (Task 5). `AdminCorrection`'s shape is re-declared in
  `src/lib/corrections-admin.ts`. The Next app can't import builders-site code, so this is a structural copy.
- **Produces:**
  - section id `"corrections"`, placed after `"suggestions"` in the rail;
  - `CorrectionsSection` and `CorrectionRow` components in `AdminApp.tsx`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/admin-sections.test.ts`, insert `"corrections"` after `"suggestions"` in the four expected arrays, at
lines 11, 15, 19 and 74. Then add:

```ts
  test("corrections: every role sees it; the onboarder gets the read-only lede", () => {
    const c = ADMIN_SECTIONS.find((s) => s.id === "corrections")!;
    expect(sectionLede(c, adminView("admin"))).toMatch(/approve/i);
    expect(sectionLede(c, adminView("onboarder"))).toMatch(/only the admin role/i);
  });
```

Create `src/lib/corrections-admin.ts`:

```ts
/** The admin view of a correction (mirror of builders-site/lib/corrections.ts AdminCorrection). */
export type AdminCorrection = { id: number; slug: string; name: string; field: string; text: string; source_url: string | null; email: string | null; person: string | null;
  domain_match: boolean; status: "open" | "approved" | "rejected" | "applied"; public_note: string | null; created_at: number; decided_at: number | null; decided_by: string | null; applied_at: number | null };
/** The approve box starts from the first 200 characters of the text, trimmed to a whole word. */
export function defaultNote(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= 200) return t;
  const cut = t.slice(0, 200);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 5));
}
```

`src/components/admin/CorrectionsSection.test.tsx`: copy the render helpers already used by
`AdminApp.roles.test.tsx` (its `render` wrapper and its fetch stub). Then:

```tsx
import { describe, expect, test } from "vitest";
import { defaultNote } from "@/lib/corrections-admin";

describe("defaultNote", () => {
  test("short text unchanged; long text cut at a word under 200", () => {
    expect(defaultNote("Fix the summary.")).toBe("Fix the summary.");
    const n = defaultNote("word ".repeat(80));
    expect(n.length).toBeLessThanOrEqual(200);
    expect(n.endsWith("word")).toBe(true);
  });
});
```

Then add a render test in the style of `AdminApp.roles.test.tsx`:
- Stub `fetch` so `/api/admin/corrections` returns one open item with `text: "<b>x</b> bad"` and
  `domain_match: true`.
- Render the admin app signed in as `admin`, then open `#corrections`.
- Assert that:
  - the text renders as literal `<b>x</b> bad`, with no `<b>` element;
  - the tag "domain matches project website (not confirmed)" is shown;
  - "approve" and "reject" buttons exist.
- Signed in as `onboarder`, assert that neither button exists.

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run src/lib/admin-sections.test.ts src/components/admin/CorrectionsSection.test.tsx`
Expected: FAIL. There's no `corrections` section, no `@/lib/corrections-admin`, and nothing rendered.

- [ ] **Step 3: Implement**

`src/lib/admin-sections.ts`:
- Add `| "corrections"` to `AdminSectionId`.
- After the `suggestions` entry in `ADMIN_SECTIONS`, add the entry below.
- In `adminSections`'s `shown` map, add `corrections: true,`.

```ts
  {
    id: "corrections",
    label: "Corrections",
    title: "Ecosystem corrections",
    lede: "Corrections the public sent from Arc ecosystem pages: approve with a public note, or reject. Approved ones go live with the next data deploy.",
    ledeReadOnly: "Corrections the public sent from Arc ecosystem pages. Only the admin role can approve or reject.",
  },
```

`src/components/admin/AdminApp.tsx`:
- After `SuggestionsSection`, add the component below.
- Render `<CorrectionsSection onSignedOut={onSignedOut} />` right after the `<SuggestionsSection … />` element
  (line ~542).
- Import `AdminCorrection` and `defaultNote` from `@/lib/corrections-admin`.

```tsx
// ───────────────────────────── ecosystem corrections ─────────────────────────────

function CorrectionsSection({ onSignedOut }: { onSignedOut: () => void }) {
  const view = useContext(ViewCtx);
  const list = useSWR<{ open: AdminCorrection[]; decided: AdminCorrection[] }>(
    "admin-corrections",
    async () => {
      const r = await call<{ open?: AdminCorrection[]; decided?: AdminCorrection[]; error?: string }>("/api/admin/corrections");
      if (r.status === 401) throw new SignedOut();
      if (r.status !== 200 || !r.body.open) throw new Error(r.body.error ?? `corrections (${r.status})`);
      return { open: r.body.open, decided: r.body.decided ?? [] };
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (list.error instanceof SignedOut) onSignedOut();
  }, [list.error, onSignedOut]);
  useRailCount("corrections", list.data?.open.length);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function decide(id: number, decision: "approve" | "reject", public_note?: string) {
    setMsg({});
    const r = await call<{ correction?: AdminCorrection; error?: string }>("/api/admin/corrections", { method: "POST", body: { id, decision, public_note } });
    if (r.status === 200) setMsg({ ok: decision === "approve" ? "Approved: it goes live with the next data deploy." : "Rejected." });
    else setMsg({ error: r.body.error ?? `could not decide (${r.status})` });
    await list.mutate();
  }

  return (
    <AdminPage id="corrections">
      <Section>
        {list.error && !(list.error instanceof SignedOut) ? (
          <p className={cx.error}>Could not read the corrections: {(list.error as Error).message}</p>
        ) : !list.data ? (
          <p className={cx.hint}>Reading corrections…</p>
        ) : list.data.open.length === 0 ? (
          <p className={cx.hint}>No open corrections.</p>
        ) : (
          <ul className={cx.rows}>
            {list.data.open.map((c) => <CorrectionRow key={c.id} c={c} canDecide={view.inviteForm} onDecide={decide} />)}
          </ul>
        )}
        {msg.ok && <p className={cx.ok}>{msg.ok}</p>}
        {msg.error && <p className={cx.error}>{msg.error}</p>}
      </Section>
      {list.data && list.data.decided.length > 0 && (
        <Section title="Decided (last 50)">
          <ul className={cx.rows}>
            {list.data.decided.map((c) => (
              <li key={c.id}>
                <b>{c.name}</b> <span className={cx.sub}>{c.field} · {c.status}{c.decided_at ? ` · ${isoDay(c.decided_at * 1000)}` : ""}</span>
                {c.public_note && <div className={cx.sub}>{c.public_note}</div>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </AdminPage>
  );
}

function CorrectionRow({ c, canDecide, onDecide }: { c: AdminCorrection; canDecide: boolean; onDecide: (id: number, d: "approve" | "reject", note?: string) => Promise<void> }) {
  const [note, setNote] = useState(() => defaultNote(c.text));
  const [busy, setBusy] = useState(false);
  const run = async (d: "approve" | "reject") => { setBusy(true); try { await onDecide(c.id, d, d === "approve" ? note : undefined); } finally { setBusy(false); } };
  return (
    <li>
      <b><a href={`/ecosystem/${c.slug}/`} target="_blank" rel="noreferrer noopener">{c.name}</a></b>{" "}
      <span className={cx.sub}>{c.field} · {isoDay(c.created_at * 1000)}</span>
      <div className={cx.sub}>{c.text}</div>
      {c.source_url && <div className={cx.sub}><a href={c.source_url} target="_blank" rel="noreferrer noopener">{c.source_url} ↗</a></div>}
      <div className={cx.sub}>
        {c.email ?? "email cleared"}{c.person ? ` · ${c.person}` : ""}{c.domain_match ? " · domain matches project website (not confirmed)" : ""}
      </div>
      {canDecide && (
        <span className={cx.rowActions}>
          <input aria-label="Public note" value={note} maxLength={200} onChange={(ev) => setNote(ev.target.value)} />
          <button type="button" className={cx.mini} disabled={busy || note.trim().length < 5} onClick={() => run("approve")}>approve</button>
          <button type="button" className={cx.miniDanger} disabled={busy} onClick={() => run("reject")}>reject</button>
        </span>
      )}
    </li>
  );
}
```

`view.inviteForm` is true only for the `admin` role (`adminView`). That matches the server rule: only `admin` can
decide. If `Section` has no `title` prop in this file, use a `<h2 className={cx.h2}>` inside a plain `Section` instead.
Match how other sections render a second heading.

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run src/lib/admin-sections.test.ts src/components/admin && npm run typecheck`
Expected: PASS, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-sections.ts src/lib/admin-sections.test.ts src/lib/corrections-admin.ts src/components/admin/AdminApp.tsx src/components/admin/CorrectionsSection.test.tsx
git commit -m "corrections: /admin section (open queue with domain hint, approve with public note, reject; read-only for onboarders)"
```

### Task 7: The apply script

**Files:**
- Create: `scripts/ecosystem-corrections.ts` and `scripts/ecosystem-corrections.test.ts`.

**Interfaces:**
- **Consumes:** the D1 table (Task 3), through `npx wrangler d1 execute registrai-data --remote --json --command …`,
  run from `builders-site/`.
- **Produces:**
  - CLI `npx tsx scripts/ecosystem-corrections.ts list | mark-applied <id…> | next-id`
  - pure helpers `listSql()`, `markAppliedSql(ids: number[], nowS: number)`, `nextLogId(log: { id: number }[]): number`,
    `formatRow(r): string`

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/ecosystem-corrections.test.ts
import { describe, expect, test } from "vitest";
import { formatRow, listSql, markAppliedSql, nextLogId } from "./ecosystem-corrections";

describe("ecosystem-corrections script helpers", () => {
  test("list reads approved, unapplied rows only, oldest first; never the IP hash", () => {
    expect(listSql()).toBe("SELECT id, slug, field, text, source_url, domain_match, public_note, decided_at FROM corrections WHERE status = 'approved' ORDER BY decided_at, id");
  });
  test("mark-applied only touches approved rows; ids must be integers", () => {
    expect(markAppliedSql([3, 5], 1000)).toBe("UPDATE corrections SET status = 'applied', applied_at = 1000 WHERE status = 'approved' AND id IN (3, 5)");
    expect(() => markAppliedSql([1.5], 1)).toThrow();
    expect(() => markAppliedSql([], 1)).toThrow();
  });
  test("next log id and a printable row with from=project|reader", () => {
    expect(nextLogId([])).toBe(1);
    expect(nextLogId([{ id: 4 }, { id: 9 }])).toBe(10);
    expect(formatRow({ id: 3, slug: "visa", field: "summary", text: "t", source_url: null, domain_match: 1, public_note: "n", decided_at: 1 })).toContain("from: project");
  });
});
```

- [ ] **Step 2: Run them, expecting failure**

Run: `npx vitest run scripts/ecosystem-corrections.test.ts`
Expected: FAIL (the module is missing). If the vitest config doesn't include `scripts/**`, add
`"scripts/**/*.test.ts"` to its `include`. Check `vitest.config.ts` first.

- [ ] **Step 3: Implement**

```ts
/**
 * Approved ecosystem corrections, for the engineer applying them (spec 2026-10-21-ecosystem-corrections-design.md §4).
 *   npx tsx scripts/ecosystem-corrections.ts list              approved, not yet applied (uses your wrangler login)
 *   npx tsx scripts/ecosystem-corrections.ts next-id           the next id for src/data/arc-ecosystem/corrections.json
 *   npx tsx scripts/ecosystem-corrections.ts mark-applied 3 5  after the deploy that contains them
 * Applying is an edit: change entities.json (and last_reviewed), add one log entry per correction, validate, test, commit, deploy.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Row = { id: number; slug: string; field: string; text: string; source_url: string | null; domain_match: number; public_note: string | null; decided_at: number };
export const listSql = () => "SELECT id, slug, field, text, source_url, domain_match, public_note, decided_at FROM corrections WHERE status = 'approved' ORDER BY decided_at, id";
export function markAppliedSql(ids: number[], nowS: number): string {
  if (!ids.length || ids.some((i) => !Number.isInteger(i) || i < 1)) throw new Error("ids must be positive integers");
  return `UPDATE corrections SET status = 'applied', applied_at = ${Math.floor(nowS)} WHERE status = 'approved' AND id IN (${ids.join(", ")})`;
}
export const nextLogId = (log: { id: number }[]) => log.reduce((m, c) => Math.max(m, c.id), 0) + 1;
export const formatRow = (r: Row) =>
  `#${r.id} ${r.slug} · ${r.field} · from: ${r.domain_match === 1 ? "project" : "reader"}\n  text: ${r.text}\n  source: ${r.source_url ?? "–"}\n  public note: ${r.public_note ?? "–"}`;

function d1(sql: string): unknown {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "registrai-data", "--remote", "--json", "--command", sql], { cwd: resolve(__dirname, "../builders-site"), encoding: "utf8" });
  return JSON.parse(out);
}

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "list") {
    const rows = ((d1(listSql()) as { results: Row[] }[])[0]?.results ?? []);
    console.log(rows.length ? rows.map(formatRow).join("\n\n") : "No approved corrections waiting.");
  } else if (cmd === "next-id") {
    console.log(nextLogId(JSON.parse(readFileSync(resolve(__dirname, "../src/data/arc-ecosystem/corrections.json"), "utf8"))));
  } else if (cmd === "mark-applied") {
    d1(markAppliedSql(args.map(Number), Date.now() / 1000));
    console.log(`marked applied: ${args.join(", ")}`);
  } else {
    console.error("usage: npx tsx scripts/ecosystem-corrections.ts list | next-id | mark-applied <id…>");
    process.exit(1);
  }
}
```

If the repo's scripts are ESM (no `require`), use
`if (import.meta.url === \`file://${process.argv[1]}\`)` and `fileURLToPath(new URL("..", import.meta.url))`
in place of `__dirname`. Match `scripts/ecosystem-seed.ts`.

- [ ] **Step 4: Run, expecting a pass**

Run: `npx vitest run scripts/ecosystem-corrections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ecosystem-corrections.ts scripts/ecosystem-corrections.test.ts
git commit -m "corrections: apply script (list approved, next log id, mark applied)"
```

### Task 8: Full suite, then ship (owner gates)

- [ ] **Step 1: Full verification**

Run: `npx vitest run > /tmp/corr-suite.txt 2>&1; tail -20 /tmp/corr-suite.txt; npm run typecheck; npm run lint`
Expected:
- everything passes except the pre-existing `src/lib/drafts.test.ts` "every draft arc-80 prepared passes", which reads
  a folder outside the worktree;
- typecheck and lint are clean.

- [ ] **Step 2: Preview**

This needs the owner's OK for the remote migration.

1. From `builders-site/`: `npx wrangler d1 migrations apply registrai-data --remote` (applies 0004).
2. In `.worktrees/abi-deploy`:
   ```
   git checkout -q --detach <head>
   npm run build
   bash scripts/build-builders-site.sh
   npx wrangler pages deploy ../dist-builders --project-name=registrai-builders --branch=corrections --commit-dirty=true
   ```
   Run the last command from `builders-site`.
3. Check, while there are no keys:
   - `/ecosystem/aave/` shows the mailto links;
   - `/ecosystem/aave/correct/` shows the mailto fallback;
   - `/ecosystem/corrections/` shows "No corrections yet.";
   - `/api/v1/ecosystem/corrections` returns `{"version":1,"corrections":[]}`;
   - POST answers 503.

- [ ] **Step 3: Owner steps, then production**

1. The owner creates the Turnstile widget (hostname `builder.registrai.cc`, Managed).
2. The owner sets the keys on the `registrai-builders` Pages project, production:
   - `TURNSTILE_SITE_KEY` as a variable;
   - `TURNSTILE_SECRET` as a secret.
3. Deploy production with `bash scripts/build-builders-site.sh && bash scripts/deploy-builders-site.sh` from
   `abi-deploy`, on the owner's OK.
4. Then check:
   - the form renders with Turnstile;
   - one real test correction from the owner's browser lands in `/admin` → Corrections;
   - reject it.
5. Report to the owner.
