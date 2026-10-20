# Arc Ecosystem Directory (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an Arc ecosystem directory on builder.registrai.cc. It has one page per project (`/ecosystem/<slug>/`), a directory and 20 category pages, a Data API endpoint and two MCP tools. It ships with about 60–70 sourced entries: the index members plus the tracker's live and deployed projects.

**Architecture:**
- **Source of truth:** a validated JSON file in the repo, `src/data/arc-ecosystem/entities.json`. It is imported into the Pages Functions bundle, and the indexes are built at module load.
- **Rendering:** server-rendered HTML in the existing `/apps` style, built from small pure renderers.
- **Old URLs:** `/apps/<kind>/<id>/` and `/project/<kind>/<id>/` 301 to the entity page when the entity claims that id.
- **Entries:** drafted by Claude from public sources; a seed script prepares the candidates.

**Tech Stack:** Cloudflare Pages Functions (TypeScript, Workers runtime), Next.js static export for the rest of the site, vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-10-19-arc-ecosystem-directory-design.md` (approved 2026-10-20). Phase A only. Phases B (fill to ~250–300) and C (corrections form) get their own plans.

## Deviations from the spec (rulings)

- **Location:** `src/data/arc-ecosystem/entities.json`, not `data/arc-ecosystem/`. Both tsconfigs then resolve the JSON import (`resolveJsonModule`), and `builders-site/lib` already imports from `../../src`.
- **Loading:** the JSON is imported into the Functions bundle instead of read with `env.ASSETS.fetch`. It is parsed once per isolate at startup, needs no subrequest, and is testable without mocks. About 300 entries come to roughly 450 KB raw, well inside the Workers bundle limit.
- **Download:** `GET /api/v1/ecosystem` replaces the static `dist-builders/ecosystem/entities.json`. `/ecosystem/*` is a Function catch-all, so a static file there would be shadowed.

## Global Constraints

- **Copy rule:** plain labels ("DEXs on Arc", "Wallets that support Arc"), no marketing slogans. Explanations go behind a small "i" (`<details><summary>i</summary>…</details>`), with the text in the HTML.
- **Summaries:** at most 280 characters, no verdict word (`hasVerdict` from `src/lib/facts.ts`), and only what a listed source says.
- **Sourcing:** every entry has ≥ 1 `sources` URL and ≥ 1 `status_evidence` URL, all `https:`. `status: "live"` needs mainnet evidence: a contract, an index id, or an `explorer.arc.io` link.
- **Excluded fields:** these tracker fields are never published: `revenue_kind`, `revenue_source`, `revenue_usd`, `wallets`, `wallets_attribution`, `research_notes`, `milestone_id`, `source`, `researched`. Validation rejects unknown fields.
- **`research/`:** read-only. The tracker is `/Users/tobiasd/Desktop/arc/research/arc-builders-index/integrations.json`; never write under `research/`.
- **Licence:** CC BY 4.0, attribution "Data: Registrai" (the existing footer).
- **Workers runtime:** no `process` in anything under `builders-site/functions` or `builders-site/lib` (the worker-imports guard test enforces it). Free plan: 10 ms CPU per request, so pages are edge-cached for 300 s and page views make no KV `list` call.
- **Index method:** no change to the ABI, AII or AEI method.
- **Deploys:** only from `/Users/tobiasd/Desktop/arc/.worktrees/abi-deploy` via `scripts/build-builders-site.sh` and `scripts/deploy-builders-site.sh`. A production deploy needs the owner's OK in chat.
- **Commit message trailer:**
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SPZp364Mvh2vy1uEkqMnpx
  ```

## Review Focus

1. **New index member with no directory entry:** a new app appears in the index hourly before anyone writes its entry. `/apps/<kind>/<id>/` must keep rendering (no redirect), the `/apps/` list must still link to it, and the sitemap must still list it. Pinned in Task 6.
2. **Slug that collides with a route:** an entity slugged like a category (`dexs`) or a reserved word (`api`, `category`) would make `/ecosystem/<x>/` ambiguous. Validation rejects it. Pinned in Task 1.
3. **Hostile or non-ASCII names:** `Société <Générale> & "Co"` must be escaped in HTML, attributes, JSON-LD and the mailto subject, and slugified to ASCII. Pinned in Tasks 2 and 4.
4. **Upstream data down:** if `loadApp` returns null or the facts KV throws, the entity page still answers 200 with the directory facts, just without the activity or facts block. It must not return 503. Pinned in Task 5.
5. **Junk input:**
   - `/ecosystem/?status=evil` lists everything
   - `/api/v1/ecosystem?status=evil` gives 400 with a sentence
   - `/ecosystem/dexs/extra/` gives 404
   - `HEAD` returns no body
   - a missing trailing slash gives 301

   Pinned in Tasks 5 and 7.

---

### Task 1: Entity model, taxonomy and validation

**Files:**
- Create: `src/lib/arc-ecosystem.ts`
- Create: `src/lib/arc-ecosystem-data.ts`
- Create: `src/data/arc-ecosystem/entities.json` (content `[]`)
- Test: `src/lib/arc-ecosystem.test.ts`
- Test: `src/lib/arc-ecosystem-data.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES: readonly { id: CategoryId; name: string; label: string }[]`
  - `type CategoryId`, `categoryOf(id: string): Category | null`
  - `type EntityStatus = "live" | "deployed" | "announced"`, `STATUS_LABEL`, `parseStatus(v: string | null): EntityStatus | null`
  - `type Source`, `type ArcEntity`, `SUMMARY_MAX = 280`
  - `validateEntities(list: unknown): { ok: true; entities: ArcEntity[] } | { ok: false; errors: string[] }`
  - `entityHref(slug: string): string` → `/ecosystem/<slug>/`, `categoryHref(id: CategoryId): string` → `/ecosystem/<id>/`
  - `type EcosystemIndex = { entities: ArcEntity[]; bySlug: Map<string, ArcEntity>; byIndexId: Map<string, ArcEntity>; byFactsSource: Map<string, ArcEntity> }`
  - `indexEntities(entities: ArcEntity[]): EcosystemIndex`
  - `sortByName(l: ArcEntity[]): ArcEntity[]`
  - from `arc-ecosystem-data.ts`: `ECOSYSTEM: EcosystemIndex`

- [ ] **Step 1: Write the failing tests**

`src/lib/arc-ecosystem.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { CATEGORIES, categoryHref, categoryOf, entityHref, indexEntities, parseStatus, sortByName, validateEntities, type ArcEntity } from "./arc-ecosystem";

const ok = (o: Partial<ArcEntity> = {}): ArcEntity => ({
  slug: "archery", name: "Archery", category: "consumer", status: "live",
  status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }],
  summary: "Archery is a game on Arc where players pay entry fees in USDC.",
  sources: [{ url: "https://archery.wtf/" }], last_reviewed: "2026-10-20", ...o,
});
const errs = (list: unknown) => { const r = validateEntities(list); return r.ok ? [] : r.errors; };

describe("taxonomy", () => {
  test("20 categories, kebab ids, unique, plain labels", () => {
    expect(CATEGORIES).toHaveLength(20);
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(20);
    for (const c of CATEGORIES) { expect(c.id).toMatch(/^[a-z]+(-[a-z]+)*$/); expect(c.label).toMatch(/Arc/); }
    expect(categoryOf("dexs")?.label).toBe("DEXs on Arc");
    expect(categoryOf("wallets")?.label).toBe("Wallets that support Arc");
    expect(categoryOf("nope")).toBeNull();
    expect(categoryHref("dexs")).toBe("/ecosystem/dexs/");
    expect(entityHref("aave")).toBe("/ecosystem/aave/");
  });
  test("parseStatus accepts the three statuses only", () => {
    expect(parseStatus("live")).toBe("live");
    expect(parseStatus("evil")).toBeNull();
    expect(parseStatus(null)).toBeNull();
  });
});

describe("validateEntities", () => {
  test("a complete entry passes", () => expect(errs([ok()])).toEqual([]));
  test("slug: kebab-case, unique, not a category id or reserved word", () => {
    expect(errs([ok({ slug: "Archery" })]).join()).toMatch(/kebab/);
    expect(errs([ok(), ok({ name: "B" })]).join()).toMatch(/duplicate slug/);
    expect(errs([ok({ slug: "dexs" })]).join()).toMatch(/category/);
    for (const s of ["api", "category", "entities", "status"]) expect(errs([ok({ slug: s })]).join(), s).toMatch(/reserved/);
  });
  test("sources and status evidence are required and https", () => {
    expect(errs([ok({ sources: [] })]).join()).toMatch(/sources are required/);
    expect(errs([ok({ status_evidence: [] })]).join()).toMatch(/status_evidence is required/);
    expect(errs([ok({ sources: [{ url: "http://x.y/" }] })]).join()).toMatch(/https/);
  });
  test("live needs mainnet evidence: a contract, an index id or an explorer.arc.io link", () => {
    expect(errs([ok({ status_evidence: [{ url: "https://archery.wtf/" }] })]).join()).toMatch(/mainnet evidence/);
    expect(errs([ok({ status_evidence: [{ url: "https://archery.wtf/" }], index_ids: ["domain:archery.wtf"] })])).toEqual([]);
    expect(errs([ok({ status: "announced", status_evidence: [{ url: "https://www.arc.io/pressroom/x" }] })])).toEqual([]);
  });
  test("summary: required, at most 280 characters, no verdict word", () => {
    expect(errs([ok({ summary: "x".repeat(281) })]).join()).toMatch(/280/);
    expect(errs([ok({ summary: "Archery is a scam on Arc." })]).join()).toMatch(/verdict/);
  });
  test("category, tags, dates, links, contracts, ids", () => {
    expect(errs([ok({ category: "games" as never })]).join()).toMatch(/unknown category/);
    expect(errs([ok({ tags: ["nope" as never] })]).join()).toMatch(/unknown tag/);
    expect(errs([ok({ first_live: "16 Sep 2026" })]).join()).toMatch(/YYYY-MM-DD/);
    expect(errs([ok({ website: "http://archery.wtf" })]).join()).toMatch(/website/);
    expect(errs([ok({ github: "https://gitlab.com/x" })]).join()).toMatch(/github/);
    expect(errs([ok({ x: "@archery" })]).join()).toMatch(/handle/);
    expect(errs([ok({ contracts: [{ address: "0xABC", role: "Game", source: "https://x.y/" }] })]).join()).toMatch(/address/);
    expect(errs([ok({ index_ids: ["archery"] })]).join()).toMatch(/index id/);
    expect(errs([ok({ index_ids: ["domain:a.b"] }), ok({ slug: "b", index_ids: ["domain:a.b"] })]).join()).toMatch(/also on archery/);
  });
  test("unknown fields are rejected (tracker revenue, wallets, notes never publish)", () => {
    expect(errs([{ ...ok(), revenue_usd: 5 }]).join()).toMatch(/unknown field revenue_usd/);
    expect(errs([{ ...ok(), wallets: [] }]).join()).toMatch(/unknown field wallets/);
  });
  test("not an array → one error", () => expect(errs({})).toEqual(["expected an array of entities"]));
});

describe("indexes", () => {
  test("by slug, index id and facts source; names sorted case-insensitively", () => {
    const ix = indexEntities([ok({ index_ids: ["domain:archery.wtf"], facts_source: "domain:archery.wtf" }), ok({ slug: "aave", name: "aave" })]);
    expect(ix.bySlug.get("aave")?.name).toBe("aave");
    expect(ix.byIndexId.get("domain:archery.wtf")?.slug).toBe("archery");
    expect(ix.byFactsSource.get("domain:archery.wtf")?.slug).toBe("archery");
    expect(sortByName(ix.entities).map((e) => e.slug)).toEqual(["aave", "archery"]);
  });
});
```

`src/lib/arc-ecosystem-data.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import raw from "../data/arc-ecosystem/entities.json";
import { validateEntities } from "./arc-ecosystem";
import { ECOSYSTEM } from "./arc-ecosystem-data";

describe("the published directory file", () => {
  test("every entry passes validation (a bad entry fails the build, never the site)", () => {
    const r = validateEntities(raw);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  test("ECOSYSTEM indexes every entry", () => expect(ECOSYSTEM.entities.length).toBe((raw as unknown[]).length));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/arc-ecosystem.test.ts src/lib/arc-ecosystem-data.test.ts`
Expected: FAIL with "Failed to load url ./arc-ecosystem".

- [ ] **Step 3: Write the implementation**

`src/data/arc-ecosystem/entities.json`:
```json
[]
```

`src/lib/arc-ecosystem.ts`:
```ts
/**
 * The Arc ecosystem directory (spec docs/superpowers/specs/2026-10-19-arc-ecosystem-directory-design.md): every project
 * with a public Arc link, one entry each, every claim sourced. Pure: taxonomy, the entry type, validation, lookups.
 * The published file is src/data/arc-ecosystem/entities.json (arc-ecosystem-data.ts).
 */
import { hasVerdict } from "./facts";

export const CATEGORIES = [
  { id: "payments", name: "Payments", label: "Payment apps on Arc" },
  { id: "wallets", name: "Wallets", label: "Wallets that support Arc" },
  { id: "exchanges", name: "Exchanges", label: "Exchanges that support Arc" },
  { id: "banks", name: "Banks", label: "Banks building on Arc" },
  { id: "stablecoin-issuers", name: "Stablecoin issuers", label: "Stablecoin issuers on Arc" },
  { id: "infrastructure", name: "Infrastructure", label: "Infrastructure for Arc" },
  { id: "developer-tools", name: "Developer tools", label: "Developer tools for Arc" },
  { id: "dexs", name: "DEXs", label: "DEXs on Arc" },
  { id: "lending", name: "Lending", label: "Lending on Arc" },
  { id: "trading", name: "Trading", label: "Trading on Arc" },
  { id: "market-makers", name: "Market makers", label: "Market makers on Arc" },
  { id: "custody", name: "Custody", label: "Custody on Arc" },
  { id: "rwa", name: "Tokenization and RWA", label: "Tokenization and RWA on Arc" },
  { id: "bridges", name: "Bridges and cross-chain", label: "Bridges and cross-chain on Arc" },
  { id: "ai-agents", name: "AI agents", label: "AI agents on Arc" },
  { id: "ramps", name: "On/off-ramps", label: "On/off-ramps for Arc" },
  { id: "consumer", name: "Games and consumer", label: "Games and consumer apps on Arc" },
  { id: "launchpads", name: "Launchpads", label: "Launchpads on Arc" },
  { id: "validators", name: "Validators", label: "Arc validators" },
  { id: "asset-managers", name: "Asset managers", label: "Asset managers on Arc" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type Category = (typeof CATEGORIES)[number];
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
export const categoryOf = (id: string): Category | null => CATEGORIES.find((c) => c.id === id) ?? null;

export type EntityStatus = "live" | "deployed" | "announced";
export const STATUS_LABEL: Record<EntityStatus, string> = { live: "Live on mainnet", deployed: "Deployed", announced: "Announced" };
export const parseStatus = (v: string | null): EntityStatus | null => (v === "live" || v === "deployed" || v === "announced" ? v : null);

export type Source = { url: string; title?: string; date?: string };
export type ArcEntity = {
  slug: string; name: string; aliases?: string[]; category: CategoryId; tags?: CategoryId[];
  status: EntityStatus; status_evidence: Source[]; summary: string;
  website?: string; x?: string; github?: string; docs?: string;
  first_announced?: string; first_live?: string;
  contracts?: { address: string; role: string; source: string }[];
  index_ids?: string[]; facts_source?: string; sources: Source[]; last_reviewed: string;
};
export const SUMMARY_MAX = 280;

const FIELDS = new Set(["slug", "name", "aliases", "category", "tags", "status", "status_evidence", "summary", "website", "x", "github", "docs",
  "first_announced", "first_live", "contracts", "index_ids", "facts_source", "sources", "last_reviewed"]);
/** Path words a slug may not take (they would read as routes or files under /ecosystem/). */
const RESERVED = new Set(["api", "category", "categories", "entities", "status", "search", "index", "all"]);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/, DAY = /^\d{4}-\d{2}-\d{2}$/, ADDR = /^0x[0-9a-f]{40}$/, ID = /^[a-z]+:\S+$/, HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const urlOf = (u: unknown): URL | null => { if (typeof u !== "string") return null; try { return new URL(u); } catch { return null; } };
const https = (u: unknown) => { const x = urlOf(u); return !!x && x.protocol === "https:" && !x.username && !x.password; };

export function validateEntities(list: unknown): { ok: true; entities: ArcEntity[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(list)) return { ok: false, errors: ["expected an array of entities"] };
  const errors: string[] = [], slugs = new Set<string>(), indexIds = new Map<string, string>(), factsSources = new Map<string, string>();
  list.forEach((raw, i) => {
    const e = (raw ?? {}) as Record<string, unknown> & Partial<ArcEntity>;
    const err = (m: string) => errors.push(`#${i} ${typeof e.slug === "string" ? e.slug : "?"}: ${m}`);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return err("not an object");
    for (const k of Object.keys(e)) if (!FIELDS.has(k)) err(`unknown field ${k}`);
    if (typeof e.slug !== "string" || !SLUG.test(e.slug)) err("slug must be kebab-case (a-z, 0-9, -)");
    else if (CATEGORY_IDS.has(e.slug)) err("slug is a category id");
    else if (RESERVED.has(e.slug)) err("slug is a reserved word");
    else if (slugs.has(e.slug)) err("duplicate slug");
    else slugs.add(e.slug);
    if (typeof e.name !== "string" || !e.name.trim()) err("name is required");
    if (!CATEGORY_IDS.has(String(e.category))) err(`unknown category ${String(e.category)}`);
    for (const t of e.tags ?? []) if (!CATEGORY_IDS.has(t)) err(`unknown tag ${t}`);
    if (!parseStatus(String(e.status))) err("status must be live, deployed or announced");
    if (!Array.isArray(e.status_evidence) || !e.status_evidence.length) err("status_evidence is required");
    if (!Array.isArray(e.sources) || !e.sources.length) err("sources are required");
    for (const s of [...(e.status_evidence ?? []), ...(e.sources ?? [])]) if (!https(s?.url)) err(`not an https URL: ${String(s?.url)}`);
    if (typeof e.summary !== "string" || !e.summary.trim()) err("summary is required");
    else {
      if (e.summary.length > SUMMARY_MAX) err(`summary is over ${SUMMARY_MAX} characters`);
      if (hasVerdict(e.summary)) err("summary has a verdict word");
    }
    for (const k of ["website", "docs"] as const) if (e[k] !== undefined && !https(e[k])) err(`${k} must be an https URL`);
    if (e.github !== undefined && !(https(e.github) && urlOf(e.github)!.hostname === "github.com")) err("github must be an https://github.com URL");
    if (e.x !== undefined && !HANDLE.test(e.x)) err("x must be a handle without @");
    for (const k of ["first_announced", "first_live"] as const) if (e[k] !== undefined && !DAY.test(e[k]!)) err(`${k} must be YYYY-MM-DD`);
    if (typeof e.last_reviewed !== "string" || !DAY.test(e.last_reviewed)) err("last_reviewed must be YYYY-MM-DD");
    for (const c of e.contracts ?? []) {
      if (!ADDR.test(String(c?.address))) err(`contract address must be lowercase 0x + 40 hex: ${String(c?.address)}`);
      if (!c?.role) err("contract role is required");
      if (!https(c?.source)) err("contract source must be an https URL");
    }
    for (const id of e.index_ids ?? []) {
      if (!ID.test(id)) err(`bad index id ${id}`);
      else if (indexIds.has(id)) err(`index id ${id} also on ${indexIds.get(id)}`);
      else indexIds.set(id, String(e.slug));
    }
    if (e.facts_source !== undefined) {
      if (!ID.test(e.facts_source)) err(`bad facts_source ${e.facts_source}`);
      else if (factsSources.has(e.facts_source)) err(`facts_source ${e.facts_source} also on ${factsSources.get(e.facts_source)}`);
      else factsSources.set(e.facts_source, String(e.slug));
    }
    const explorer = (e.status_evidence ?? []).some((s) => urlOf(s?.url)?.hostname === "explorer.arc.io");
    if (e.status === "live" && !(e.contracts?.length || e.index_ids?.length || explorer)) err("live needs mainnet evidence: a contract, an index id or an explorer.arc.io link");
  });
  return errors.length ? { ok: false, errors } : { ok: true, entities: list as ArcEntity[] };
}

export const entityHref = (slug: string) => `/ecosystem/${slug}/`;
export const categoryHref = (id: CategoryId) => `/ecosystem/${id}/`;
export const sortByName = (l: ArcEntity[]) => [...l].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.slug < b.slug ? -1 : 1));

export type EcosystemIndex = { entities: ArcEntity[]; bySlug: Map<string, ArcEntity>; byIndexId: Map<string, ArcEntity>; byFactsSource: Map<string, ArcEntity> };
export function indexEntities(entities: ArcEntity[]): EcosystemIndex {
  const bySlug = new Map<string, ArcEntity>(), byIndexId = new Map<string, ArcEntity>(), byFactsSource = new Map<string, ArcEntity>();
  for (const e of entities) {
    bySlug.set(e.slug, e);
    for (const id of e.index_ids ?? []) byIndexId.set(id, e);
    if (e.facts_source) byFactsSource.set(e.facts_source, e);
  }
  return { entities, bySlug, byIndexId, byFactsSource };
}
```

`src/lib/arc-ecosystem-data.ts`:
```ts
import raw from "../data/arc-ecosystem/entities.json";
import { indexEntities, type ArcEntity } from "./arc-ecosystem";

/** The published directory. arc-ecosystem-data.test.ts validates the file, so a bad entry fails the build, never the site. */
export const ECOSYSTEM = indexEntities(raw as unknown as ArcEntity[]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/arc-ecosystem.test.ts src/lib/arc-ecosystem-data.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/arc-ecosystem.ts src/lib/arc-ecosystem-data.ts src/lib/arc-ecosystem.test.ts src/lib/arc-ecosystem-data.test.ts src/data/arc-ecosystem/entities.json
git commit -m "ecosystem: entity model, 20 categories, validation (sources, mainnet evidence, no verdicts, no unknown fields)"
```

---

### Task 2: Seed candidates (merge tracker, index members, DefiLlama)

**Files:**
- Create: `src/lib/arc-ecosystem-seed.ts`
- Create: `scripts/ecosystem-seed.ts`
- Test: `src/lib/arc-ecosystem-seed.test.ts`

**Interfaces:**
- Consumes: `CategoryId`, `EntityStatus`, `Source` (Task 1)
- Produces:
  - `TRACKER_CATEGORY: Record<string, CategoryId>`
  - `slugify(name: string): string`
  - `type Candidate = { slug: string; name: string; category: CategoryId | null; tracker_category?: string; status: EntityStatus; origins: ("tracker" | "index" | "defillama")[]; index_ids: string[]; website?: string; announcements: Source[]; live_evidence: string[]; contracts: { address: string; role: string; source: string }[]; first_announced?: string; first_live?: string; defillama?: { slug: string; url?: string; category?: string } }`
  - `mergeCandidates(input: { tracker: TrackerItem[]; members: MemberItem[]; llama: LlamaItem[] }): Candidate[]`
  - `type TrackerItem`, `type MemberItem = { id: string; name: string; kind: string; first_hour: string }`, `type LlamaItem = { name: string; slug: string; url?: string; category?: string; chains: string[] }`
- The output file `.superpowers/arc-ecosystem/draft.json` is git-ignored. Task 10 reads it.

- [ ] **Step 1: Write the failing test**

`src/lib/arc-ecosystem-seed.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { TRACKER_CATEGORY, mergeCandidates, slugify } from "./arc-ecosystem-seed";
import { CATEGORIES } from "./arc-ecosystem";

describe("seed", () => {
  test("slugify: ASCII kebab, accents folded, symbols dropped, category ids avoided", () => {
    expect(slugify("Société <Générale> & \"Co\"")).toBe("societe-generale-co");
    expect(slugify("OKX DEX")).toBe("okx-dex");
    expect(slugify("DEXs")).toBe("dexs-project");
  });
  test("every tracker category maps to a known category", () => {
    const ids = new Set<string>(CATEGORIES.map((c) => c.id));
    for (const [k, v] of Object.entries(TRACKER_CATEGORY)) expect(ids.has(v), k).toBe(true);
    for (const k of ["payments", "wallet", "exchange", "bank", "stablecoin issuer", "DEX", "lending", "AI agents", "crosschain", "on/off-ramp", "validator"]) expect(TRACKER_CATEGORY[k], k).toBeDefined();
  });
  test("merges a tracker entry, its index member and its DefiLlama listing into one candidate; drops private fields", () => {
    const out = mergeCandidates({
      tracker: [{ company: "Aave", category: "lending", status: "live", member: "integration:aave", first_seen_live: "2026-10-10",
        announcements: [{ date: "2025-10-28", source: "https://www.arc.io/pressroom/a" }], live_evidence: ["https://github.com/aave-dao/x — AaveV4Arc"],
        arc_contracts: [{ address: "0x17288DFC86205301064577B98B02B81017E6F79C", role: "Core Hub", evidence: "https://github.com/aave-dao/x" }],
        revenue_usd: 9, wallets: ["0xabc"], research_notes: "private" }],
      members: [{ id: "integration:aave", name: "Aave", kind: "integration", first_hour: "2026-10-11T19:00:00Z" }, { id: "domain:archery.wtf", name: "Archery", kind: "builder", first_hour: "2026-10-10T00:00:00Z" }],
      llama: [{ name: "Aave V4", slug: "aave-v4", url: "https://aave.com", category: "Lending", chains: ["Ethereum", "Arc"] }, { name: "OffArc", slug: "x", chains: ["Base"] }],
    });
    expect(out.map((c) => c.slug)).toEqual(["aave", "archery"]);
    const aave = out[0];
    expect(aave).toMatchObject({ name: "Aave", category: "lending", status: "live", index_ids: ["integration:aave"], first_announced: "2025-10-28", first_live: "2026-10-10", website: "https://aave.com" });
    expect(aave.origins.sort()).toEqual(["defillama", "index", "tracker"]);
    expect(aave.contracts[0].address).toBe("0x17288dfc86205301064577b98b02b81017e6f79c");
    expect(JSON.stringify(aave)).not.toMatch(/revenue|wallets|private/);
    expect(out[1]).toMatchObject({ slug: "archery", status: "live", origins: ["index"], index_ids: ["domain:archery.wtf"], first_live: "2026-10-10", website: "https://archery.wtf/" });
  });
  test("DefiLlama-only Arc protocols become deployed candidates", () => {
    const [c] = mergeCandidates({ tracker: [], members: [], llama: [{ name: "Beefy", slug: "beefy", url: "https://beefy.com", category: "Yield", chains: ["Arc"] }] });
    expect(c).toMatchObject({ slug: "beefy", status: "deployed", origins: ["defillama"], category: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/arc-ecosystem-seed.test.ts`
Expected: FAIL with "Failed to load url ./arc-ecosystem-seed".

- [ ] **Step 3: Write the implementation**

`src/lib/arc-ecosystem-seed.ts`:
```ts
/** Seed candidates for the ecosystem directory: the owner's tracker (read-only), the index members and DefiLlama's Arc
 * protocols, merged by name and index id. Private tracker fields (revenue, wallets, notes) are never copied. Pure. */
import { CATEGORIES, type CategoryId, type EntityStatus, type Source } from "./arc-ecosystem";

export const TRACKER_CATEGORY: Record<string, CategoryId> = {
  payments: "payments", fintech: "payments", "e-commerce": "payments", wallet: "wallets", "wallet/custody": "wallets",
  exchange: "exchanges", bank: "banks", "stablecoin issuer": "stablecoin-issuers", infrastructure: "infrastructure", technology: "infrastructure",
  "developer tools": "developer-tools", DEX: "dexs", "DEX aggregator": "dexs", DeFi: "dexs", lending: "lending", credit: "lending",
  trading: "trading", "trading company": "trading", "market maker": "market-makers", custody: "custody", RWA: "rwa", "capital markets": "rwa",
  insurer: "rwa", crosschain: "bridges", "AI agents": "ai-agents", AI: "ai-agents", "on/off-ramp": "ramps", validator: "validators",
  "asset manager": "asset-managers", "capital allocator": "asset-managers",
};
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));

export function slugify(name: string): string {
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return CATEGORY_IDS.has(s) ? `${s}-project` : s || "project";
}
const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export type TrackerItem = { company: string; category?: string; status?: string; member?: string; first_seen_live?: string;
  announcements?: { date?: string; source?: string }[]; live_evidence?: string[];
  arc_contracts?: { address: string; role?: string; evidence?: string }[]; [private_: string]: unknown };
export type MemberItem = { id: string; name: string; kind: string; first_hour: string };
export type LlamaItem = { name: string; slug: string; url?: string; category?: string; chains: string[] };
export type Candidate = { slug: string; name: string; category: CategoryId | null; tracker_category?: string; status: EntityStatus;
  origins: ("tracker" | "index" | "defillama")[]; index_ids: string[]; website?: string; announcements: Source[]; live_evidence: string[];
  contracts: { address: string; role: string; source: string }[]; first_announced?: string; first_live?: string;
  defillama?: { slug: string; url?: string; category?: string } };

const httpsUrl = (u?: string) => { try { const x = new URL(u ?? ""); return x.protocol === "https:" ? x.toString() : undefined; } catch { return undefined; } };

export function mergeCandidates(input: { tracker: TrackerItem[]; members: MemberItem[]; llama: LlamaItem[] }): Candidate[] {
  const out = new Map<string, Candidate>(), byMember = new Map<string, Candidate>();
  const add = (name: string): Candidate => {
    const k = key(name);
    let c = out.get(k);
    if (!c) { c = { slug: slugify(name), name, category: null, status: "announced", origins: [], index_ids: [], announcements: [], live_evidence: [], contracts: [] }; out.set(k, c); }
    return c;
  };
  const rank: Record<EntityStatus, number> = { announced: 0, deployed: 1, live: 2 };
  const raise = (c: Candidate, s: EntityStatus) => { if (rank[s] > rank[c.status]) c.status = s; };
  for (const t of input.tracker) {
    const c = add(t.company);
    c.origins.push("tracker");
    c.tracker_category = t.category;
    c.category = (t.category && TRACKER_CATEGORY[t.category]) || null;
    raise(c, t.status === "live" ? "live" : t.status === "deployed" ? "deployed" : "announced");
    c.announcements = (t.announcements ?? []).filter((a) => httpsUrl(a.source)).map((a) => ({ url: a.source!, date: a.date }));
    c.first_announced = c.announcements.map((a) => a.date).filter(Boolean).sort()[0];
    if (t.first_seen_live) c.first_live = t.first_seen_live;
    c.live_evidence = [...(t.live_evidence ?? [])];
    c.contracts = (t.arc_contracts ?? []).filter((x) => /^0x[0-9a-fA-F]{40}$/.test(x.address) && httpsUrl(x.evidence))
      .map((x) => ({ address: x.address.toLowerCase(), role: x.role ?? "", source: x.evidence! }));
    if (t.member) { c.index_ids.push(t.member); byMember.set(t.member, c); }
  }
  for (const m of input.members) {
    const c = byMember.get(m.id) ?? add(m.name);
    if (!c.origins.includes("index")) c.origins.push("index");
    if (!c.index_ids.includes(m.id)) c.index_ids.push(m.id);
    raise(c, "live");
    c.first_live ??= m.first_hour.slice(0, 10);
    if (!c.website && m.id.startsWith("domain:")) c.website = `https://${m.id.slice(7)}/`;
  }
  for (const l of input.llama) {
    if (!l.chains.includes("Arc")) continue;
    const c = out.get(key(l.name)) ?? out.get(key(l.name.replace(/\s+v\d+$/i, ""))) ?? add(l.name);
    if (!c.origins.includes("defillama")) c.origins.push("defillama");
    c.defillama = { slug: l.slug, url: l.url, category: l.category };
    raise(c, "deployed");
    c.website ??= httpsUrl(l.url);
  }
  return [...out.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1));
}
```

`scripts/ecosystem-seed.ts`:
```ts
/**
 * Seed candidates for the Arc ecosystem directory (plan 2026-10-20-arc-ecosystem-directory.md, Task 2).
 * Reads the owner's tracker READ-ONLY, the live index members and DefiLlama's Arc protocols; writes a git-ignored draft.
 *   npx tsx scripts/ecosystem-seed.ts [--out .superpowers/arc-ecosystem/draft.json]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mergeCandidates, type LlamaItem, type MemberItem, type TrackerItem } from "../src/lib/arc-ecosystem-seed";

const TRACKER = "/Users/tobiasd/Desktop/arc/research/arc-builders-index/integrations.json";
(async () => {
  const i = process.argv.indexOf("--out");
  const out = resolve(i > 0 ? process.argv[i + 1] : ".superpowers/arc-ecosystem/draft.json");
  const tracker = JSON.parse(readFileSync(TRACKER, "utf8")) as TrackerItem[];
  const members = ((await (await fetch("https://builder.registrai.cc/api/v1/members?index=aei")).json()) as { members: MemberItem[] }).members
    .filter((m) => m.kind !== "base");
  const llama = (await (await fetch("https://api.llama.fi/protocols")).json()) as LlamaItem[];
  const c = mergeCandidates({ tracker, members, llama });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(c, null, 2));
  const by = (k: string) => c.filter((x) => x.status === k).length;
  console.log(`${c.length} candidates (${by("live")} live, ${by("deployed")} deployed, ${by("announced")} announced) → ${out}`);
})().catch((e) => { console.error("seed failed:", e instanceof Error ? e.message : e); process.exit(1); });
```

- [ ] **Step 4: Run the test, then the script**

Run: `npx vitest run src/lib/arc-ecosystem-seed.test.ts`
Expected: PASS.

Run: `git check-ignore .superpowers/arc-ecosystem/draft.json && npx tsx scripts/ecosystem-seed.ts`
Expected: the path is echoed (it is ignored), then a line like `2xx candidates (… live, … deployed, … announced) → …/draft.json`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/arc-ecosystem-seed.ts src/lib/arc-ecosystem-seed.test.ts scripts/ecosystem-seed.ts
git commit -m "ecosystem: seed candidates from the tracker (read-only), index members and DefiLlama Arc protocols"
```

---

### Task 3: Reusable page sections (refactor, no visible change)

**Files:**
- Modify: `builders-site/lib/apps-pages.ts`: export `page`, `day`, `num`, `usd` and `contractList`; extract `activityHtml`
- Modify: `builders-site/lib/project-ssr.ts`: extract `factsHtml`
- Test: `builders-site/test/apps-pages.test.ts`, `builders-site/test/project-ssr.test.ts`

**Interfaces:**
- Produces:
  - `page(o: { title: string; canonical: string; description: string; body: string; ld?: unknown }): string` (now exported)
  - `activityHtml(a: AppDetail): string`: the "Last 24 h" table plus the "Last 7 days" section, exactly as renderApp prints them today
  - `contractList(a: AppDetail): string` (now exported)
  - `day(iso: string): string`, `num(n: number): string`, `usd(n: number): string` (now exported)
  - `factsHtml(s: Ready): string`: the footprint, off-Arc line and topic groups that `renderProjectSummary` prints after its H1, summary and review lines

- [ ] **Step 1: Write the failing tests**

Append to `builders-site/test/apps-pages.test.ts`:
```ts
describe("sections reused by the ecosystem pages", () => {
  test("activityHtml is exactly the activity part of the app page", async () => {
    const { activityHtml } = await import("../lib/apps-pages");
    const a = { ...row(), hourly: [{ hour_close: "2026-10-14T21:00:00Z", points: 9.2, points_earned: 1, payments: 1, wallets: 1, new_payers: 0, usdc: 1 }], facts_url: null, data_until: "2026-10-14T21:00:00Z" } as AppDetail;
    const s = activityHtml(a);
    expect(s).toMatch(/^<h2>Last 24 h<\/h2>/);
    expect(s).toContain("<h2>Last 7 days</h2>");
    expect(renderApp(a)).toContain(s);
  });
});
```

Append to `builders-site/test/project-ssr.test.ts`:
```ts
describe("factsHtml", () => {
  test("the facts part of the summary, without the H1", async () => {
    const { factsHtml } = await import("../lib/project-ssr");
    const s = factsHtml(ready);
    expect(s).toContain("<h2>Who controls it</h2>");
    expect(s).not.toContain("<h1>");
    expect(renderProjectSummary("domain:www.myarcade.fun", ready)).toContain(s);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run builders-site/test/apps-pages.test.ts builders-site/test/project-ssr.test.ts`
Expected: FAIL with "activityHtml is not a function" and "factsHtml is not a function".

- [ ] **Step 3: Implement**

In `builders-site/lib/apps-pages.ts`:
- Prefix `export` on `function page(`, `const num =`, `const usd =`, `const day =` and `function contractList(`.
- Move the block from `<h2>Last 24 h</h2>` through the `Last 7 days` ternary into:
```ts
export function activityHtml(a: AppDetail): string {
  const last = a.hourly[a.hourly.length - 1];
  return `<h2>Last 24 h</h2>
<table><tbody>
<tr><th>Stablecoin payments</th><td class="n">${num(a.last_24h.payments)}</td></tr>
<tr><th>Stablecoin volume</th><td class="n">${esc(usd(a.last_24h.usdc))}</td></tr>
<tr><th>Points earned</th><td class="n">${num(a.last_24h.points_earned)}</td></tr>
<tr><th>Points (stock, AEI)</th><td class="n">${num(a.points)}</td></tr>
<tr><th>Share of the Arc Ecosystem Index</th><td class="n">${num(a.share)}%</td></tr>
${last ? `<tr><th>Paying wallets, last hour</th><td class="n">${num(last.wallets)}</td></tr><tr><th>New payers, last hour</th><td class="n">${num(last.new_payers)}</td></tr>` : ""}
</tbody></table>
<h2>Last 7 days</h2>
${a.hourly.length ? `${spark(a)}${daily(a)}` : `<p>There is no hourly history yet for this app.</p>`}`;
}
```
- In `renderApp`, replace that block with `${activityHtml(a)}` and delete the now-unused local `last`.

In `builders-site/lib/project-ssr.ts`, split `renderProjectSummary`:
```ts
/** Footprint, off-Arc line and topic groups (no H1): shared by the project page and the ecosystem entity page. */
export function factsHtml(s: Ready): string {
  const { profile, facts } = s;
  const parts: string[] = [];
  if (profile && (profile.contracts.length || profile.deployers.length || profile.token)) {
    parts.push(`<h2>On-chain footprint</h2>`);
    if (profile.deployers.length) parts.push(`<p>Deployers: ${profile.deployers.map((d) => link(d.address)).join(" ")}</p>`);
    if (profile.contracts.length) parts.push(`<ul>${profile.contracts.map((c) => `<li>${esc(c.label)}: ${link(c.address)}</li>`).join("")}</ul>`);
    if (profile.token) parts.push(`<p>Token: ${link(profile.token.address)}</p>`);
  }
  if (facts?.offArc?.length) parts.push(`<p>Also runs on: ${esc(facts.offArc.join(", "))}</p>`);
  for (const g of facts ? groupFacts(facts.facts) : []) {
    parts.push(`<h2>${esc(g.title)}</h2>`);
    if (g.current.length) parts.push(`<ul>${g.current.map((f) => factItem(f)).join("")}</ul>`);
    if (g.superseded.length) parts.push(`<details><summary>Earlier facts</summary><ul>${g.superseded.map((f) => factItem(f, true)).join("")}</ul></details>`);
  }
  return parts.join("\n");
}

export function renderProjectSummary(source: string, s: Ready): string {
  const { profile, facts } = s;
  const website = safeHttpsHref(profile?.website);
  const parts = [`<h1>${esc(projectName(source, s))}</h1>`, `<p><code>${esc(source)}</code>${website ? ` · <a href="${esc(website)}" rel="noreferrer">${esc(website)}</a>` : ""}</p>`];
  if (facts?.summary) parts.push(`<p>${esc(facts.summary)}</p>`);
  if (facts?.lastReviewedAt) parts.push(`<p>Last reviewed ${esc(day(facts.lastReviewedAt))} by ${esc(PUBLIC_REVIEWER)}</p>`);
  parts.push(factsHtml(s), `<p><a href="/how-we-publish/">How we publish</a></p>`);
  return parts.join("\n");
}
```
Also export the `Ready` type: `export type Ready = Extract<PageState, { kind: "ready" }>;`

- [ ] **Step 4: Run all builder tests**

Run: `npx vitest run builders-site`
Expected: PASS, including every existing apps-pages and project-ssr test unchanged.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/apps-pages.ts builders-site/lib/project-ssr.ts builders-site/test/apps-pages.test.ts builders-site/test/project-ssr.test.ts
git commit -m "refactor: export page sections (activity, contracts, facts) for the ecosystem pages"
```

---

### Task 4: Ecosystem renderers

**Files:**
- Create: `builders-site/lib/ecosystem-pages.ts`
- Test: `builders-site/test/ecosystem-pages.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ArcEntity`, `CATEGORIES`, `Category`, `STATUS_LABEL`, `EntityStatus`, `entityHref`, `categoryHref`, `sortByName`); Task 3 (`page`, `esc`, `day`, `activityHtml`, `contractList`, `factsHtml`, `Ready`); `AppDetail` from `apps-data`; `evidenceHref` from `src/lib/facts`
- Produces:
  - `type EntityView = { entity: ArcEntity; app: AppDetail | null; facts: Ready | null }`
  - `renderEntity(v: EntityView): string`
  - `renderDirectory(all: ArcEntity[], status: EntityStatus | null): string`
  - `renderCategory(cat: Category, all: ArcEntity[]): string`
  - `renderEcosystemNotFound(): string`
  - `ECO_SITE = "https://builder.registrai.cc"`

- [ ] **Step 1: Write the failing test**

`builders-site/test/ecosystem-pages.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { renderCategory, renderDirectory, renderEcosystemNotFound, renderEntity } from "../lib/ecosystem-pages";
import { categoryOf, type ArcEntity } from "../../src/lib/arc-ecosystem";
import type { AppDetail } from "../lib/apps-data";

const ent = (o: Partial<ArcEntity> = {}): ArcEntity => ({
  slug: "archery", name: "Archery", category: "consumer", status: "live", summary: "Archery is a game on Arc with USDC entry fees.",
  status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001", title: "Contract on Arc explorer" }],
  sources: [{ url: "https://archery.wtf/", title: "Archery website", date: "2026-10-20" }], website: "https://archery.wtf/", x: "archerywtf",
  first_live: "2026-10-10", contracts: [{ address: "0x0000000000000000000000000000000000000001", role: "Game", source: "https://archery.wtf/docs" }],
  index_ids: ["domain:archery.wtf"], last_reviewed: "2026-10-20", ...o,
});
const app = { id: "domain:archery.wtf", name: "Archery", kind: "builder", verified: true, points: 9, share: 2, first_hour: "2026-10-10T00:00:00Z",
  last_24h: { points_earned: 1, payments: 158, usdc: 24725.94 }, contracts: 3, indices: ["abi", "aei"], hourly: [], facts_url: null,
  data_until: "2026-10-20T10:00:00Z", contracts_sample: ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"] } as unknown as AppDetail;
const ld = (h: string) => JSON.parse(h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)![1]);

describe("entity page", () => {
  test("name, status, category link, summary, links, status evidence, sources, review date, correction links", () => {
    const h = renderEntity({ entity: ent(), app: null, facts: null });
    expect(h).toContain("<title>Archery on Arc · Registrai</title>");
    expect(h).toContain('<link rel="canonical" href="https://builder.registrai.cc/ecosystem/archery/">');
    expect(h).toContain("<h1>Archery</h1>");
    expect(h).toContain("Live on mainnet");
    expect(h).toContain('<a href="/ecosystem/consumer/">Games and consumer</a>');
    expect(h).toContain("Archery is a game on Arc with USDC entry fees.");
    expect(h).toContain('href="https://x.com/archerywtf"');
    expect(h).toContain("Live on Arc mainnet since 2026-10-10");
    expect(h).toContain("Contract on Arc explorer");
    expect(h).toMatch(/<h2>Sources<\/h2>\s*<ol><li><a href="https:\/\/archery.wtf\/"/);
    expect(h).toContain("Last reviewed 2026-10-20");
    expect(h).toContain("mailto:contact@registrai.cc?subject=Registrai%20ecosystem%3A%20archery");
    expect(h).not.toContain("<h2>Activity");
  });
  test("contracts: the hand-checked list, then index contracts not already listed", () => {
    const h = renderEntity({ entity: ent(), app, facts: null });
    expect(h.match(/0x0000000000000000000000000000000000000001/g)!.length).toBeGreaterThanOrEqual(1);
    expect(h).toContain("0x0000000000000000000000000000000000000002");
    expect(h).toContain("<h2>Last 24 h</h2>");
    expect(h).toContain("158");
  });
  test("JSON-LD: Organization, plus a Dataset for index members", () => {
    expect(ld(renderEntity({ entity: ent(), app: null, facts: null }))["@graph"].map((x: { "@type": string }) => x["@type"])).toEqual(["Organization"]);
    const g = ld(renderEntity({ entity: ent(), app, facts: null }))["@graph"];
    expect(g.map((x: { "@type": string }) => x["@type"])).toEqual(["Organization", "Dataset"]);
    expect(g[0]).toMatchObject({ name: "Archery", url: "https://archery.wtf/", sameAs: ["https://archery.wtf/", "https://x.com/archerywtf"] });
  });
  test("hostile names are escaped in text, attributes, JSON-LD and the mailto subject", () => {
    const evil = `Société <Générale> & "Co"`;
    const h = renderEntity({ entity: ent({ name: evil, slug: "societe-generale-co" }), app: null, facts: null });
    expect(h).not.toContain("<Générale>");
    expect(h).toContain("Société &lt;Générale&gt; &amp; &quot;Co&quot;");
    expect(h).not.toMatch(/<\/script>[^]*<\/script>[^]*<\/script>/);
    expect(ld(h)["@graph"][0].name).toBe(evil);
  });
});

describe("directory and category pages", () => {
  const all = [ent(), ent({ slug: "aave", name: "Aave", category: "lending", status: "announced", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], index_ids: [], contracts: [] }),
    ent({ slug: "uniswap", name: "Uniswap", category: "dexs", index_ids: ["integration:uniswap"] })];
  test("directory: counts by status, every category with a count, a table sorted by name, status filter links", () => {
    const h = renderDirectory(all, null);
    expect(h).toContain("<title>Arc ecosystem · Registrai</title>");
    expect(h).toContain("3 projects · 2 live on mainnet · 0 deployed · 1 announced");
    expect(h).toContain('<a href="/ecosystem/dexs/">DEXs on Arc</a> (1)');
    expect(h.indexOf(">Aave<")).toBeLessThan(h.indexOf(">Archery<"));
    expect(h).toContain('href="/ecosystem/?status=announced"');
    expect(ld(h)["@type"]).toBe("DataCatalog");
  });
  test("directory filtered by status lists only that status", () => {
    const h = renderDirectory(all, "announced");
    expect(h).toContain(">Aave<");
    expect(h).not.toContain(">Uniswap<");
  });
  test("category page: its label as H1, only its projects, tags count too, empty state", () => {
    const h = renderCategory(categoryOf("dexs")!, [...all, ent({ slug: "x", name: "X", category: "trading", tags: ["dexs"] })]);
    expect(h).toContain("<h1>DEXs on Arc</h1>");
    expect(h).toContain(">Uniswap<");
    expect(h).toContain(">X<");
    expect(h).not.toContain(">Aave<");
    expect(renderCategory(categoryOf("banks")!, all)).toContain("No projects in this category yet.");
  });
  test("not found page", () => expect(renderEcosystemNotFound()).toContain("<h1>Not in the Arc ecosystem directory</h1>"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run builders-site/test/ecosystem-pages.test.ts`
Expected: FAIL with "Failed to load url ../lib/ecosystem-pages".

- [ ] **Step 3: Implement**

`builders-site/lib/ecosystem-pages.ts`:
```ts
/**
 * Server-rendered Arc ecosystem pages (spec 2026-10-19-arc-ecosystem-directory-design.md): one page per project, the
 * directory and the category pages. Pure: data in, HTML out; every value goes through esc(); JSON-LD escapes "<" (page()).
 */
import { CATEGORIES, STATUS_LABEL, categoryHref, categoryOf, entityHref, sortByName, type ArcEntity, type Category, type EntityStatus } from "../../src/lib/arc-ecosystem";
import { evidenceHref } from "../../src/lib/facts";
import { activityHtml, contractList, esc, page } from "./apps-pages";
import { factsHtml, type Ready } from "./project-ssr";
import type { AppDetail } from "./apps-data";

export const ECO_SITE = "https://builder.registrai.cc";
export type EntityView = { entity: ArcEntity; app: AppDetail | null; facts: Ready | null };
const LICENSE = "https://creativecommons.org/licenses/by/4.0/";
const CREATOR = { "@type": "Organization", name: "Registrai", url: "https://registrai.cc/" };
const mail = (subject: string) => `mailto:contact@registrai.cc?subject=${encodeURIComponent(subject)}`;
const a = (href: string, text: string) => `<a href="${esc(href)}" rel="noreferrer">${esc(text)}</a>`;
const catName = (id: string) => categoryOf(id)?.name ?? id;

function links(e: ArcEntity): string {
  const l: string[] = [];
  if (e.website) l.push(a(e.website, "Website"));
  if (e.x) l.push(a(`https://x.com/${e.x}`, `X @${e.x}`));
  if (e.github) l.push(a(e.github, "GitHub"));
  if (e.docs) l.push(a(e.docs, "Docs"));
  return l.length ? `<p>${l.join(" · ")}</p>` : "";
}

function contractsHtml(e: ArcEntity, app: AppDetail | null): string {
  const own = e.contracts ?? [];
  const listed = new Set(own.map((c) => c.address));
  const extra = app ? { ...app, contracts_sample: (app.contracts_sample ?? []).filter((x) => !listed.has(x)), contracts: Math.max(0, app.contracts - listed.size) } : null;
  if (!own.length && !extra?.contracts_sample?.length) return "";
  const ownHtml = own.length ? `<ul>${own.map((c) => `<li>${esc(c.role)}: <a href="${esc(evidenceHref(c.address))}" rel="noreferrer"><code>${esc(c.address)}</code></a> (${a(c.source, "source")})</li>`).join("")}</ul>` : "";
  return `<h2>Contracts on Arc</h2>${ownHtml}${extra ? `${own.length ? "<p class=\"muted\">Also attributed by the Arc indices:</p>" : ""}${contractList(extra)}` : ""}`;
}

export function renderEntity(v: EntityView): string {
  const e = v.entity, url = `${ECO_SITE}${entityHref(e.slug)}`;
  const tags = (e.tags ?? []).map((t) => `<a href="${categoryHref(t)}">${esc(catName(t))}</a>`).join(", ");
  const dates = [e.first_announced ? `<li>First announced ${esc(e.first_announced)}</li>` : "", e.first_live ? `<li>Live on Arc mainnet since ${esc(e.first_live)}</li>` : ""].join("");
  const body = `<h1>${esc(e.name)}</h1>
<p class="muted">${esc(STATUS_LABEL[e.status])} · <a href="${categoryHref(e.category)}">${esc(catName(e.category))}</a>${tags ? ` · also ${tags}` : ""} · Last reviewed ${esc(e.last_reviewed)}</p>
<p>${esc(e.summary)}</p>
${links(e)}
<h2>Status</h2>
${dates ? `<ul>${dates}</ul>` : ""}<p>Evidence: ${e.status_evidence.map((s) => a(s.url, s.title ?? s.url)).join(" · ")}</p>
${contractsHtml(e, v.app)}
${v.app ? `<h2>Activity</h2>${activityHtml(v.app)}<p class="muted">Hourly data: <a href="/api/v1/members/${esc(encodeURIComponent(v.app.id))}/hourly?index=aei">JSON</a></p>` : ""}
${v.facts ? `<h2>Project facts</h2>${factsHtml(v.facts)}` : ""}
<h2>Sources</h2>
<ol>${e.sources.map((s) => `<li>${a(s.url, s.title ?? s.url)}${s.date ? ` (${esc(s.date)})` : ""}</li>`).join("")}</ol>
<p class="muted"><a href="${esc(mail(`Registrai ecosystem: ${e.slug}`))}">Report an error</a> · <a href="${esc(mail(`Removal: ${e.slug}`))}">Ask for removal</a> · <a href="/how-we-publish/">How we publish</a> · <a href="/ecosystem/">Arc ecosystem</a></p>`;
  const sameAs = [e.website, e.x ? `https://x.com/${e.x}` : undefined, e.github].filter((x): x is string => !!x);
  const graph: unknown[] = [{ "@type": "Organization", name: e.name, ...(e.aliases?.length ? { alternateName: e.aliases } : {}), url: e.website ?? url, ...(sameAs.length ? { sameAs } : {}), description: e.summary, mainEntityOfPage: url }];
  if (v.app) graph.push({ "@type": "Dataset", name: `${e.name} hourly activity on Arc`, url, description: `Hourly stablecoin payments, paying wallets, volume and index points for ${e.name} on Arc mainnet, from Registrai.`,
    license: LICENSE, creator: CREATOR, isAccessibleForFree: true, dateModified: v.app.data_until,
    distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${ECO_SITE}/api/v1/members/${encodeURIComponent(v.app.id)}/hourly?index=aei` }] });
  return page({ title: `${e.name} on Arc · Registrai`, canonical: url, description: e.summary, body, ld: { "@context": "https://schema.org", "@graph": graph } });
}

const inCategory = (c: Category, e: ArcEntity) => e.category === c.id || (e.tags ?? []).includes(c.id);
function table(l: ArcEntity[]): string {
  if (!l.length) return "<p>No projects in this category yet.</p>";
  return `<div class="wrap"><table><thead><tr><th>Project</th><th>Category</th><th>Status</th><th>Live since</th></tr></thead><tbody>
${sortByName(l).map((e) => `<tr><td><a href="${entityHref(e.slug)}">${esc(e.name)}</a></td><td>${esc(catName(e.category))}</td><td>${esc(STATUS_LABEL[e.status])}</td><td>${esc(e.first_live ?? "–")}</td></tr>`).join("\n")}
</tbody></table></div>`;
}
const latest = (l: ArcEntity[]) => l.map((e) => e.last_reviewed).sort().pop() ?? "";

export function renderDirectory(all: ArcEntity[], status: EntityStatus | null): string {
  const n = (s: EntityStatus) => all.filter((e) => e.status === s).length;
  const shown = status ? all.filter((e) => e.status === status) : all;
  const filters = [`<a href="/ecosystem/">All</a>`, ...(["live", "deployed", "announced"] as const).map((s) => `<a href="/ecosystem/?status=${s}">${esc(STATUS_LABEL[s])}</a>`)].join(" · ");
  const cats = CATEGORIES.map((c) => `<li><a href="${categoryHref(c.id)}">${esc(c.label)}</a> (${all.filter((e) => inCategory(c, e)).length})</li>`).join("");
  const body = `<h1>Arc ecosystem</h1>
<p class="muted">${all.length} projects · ${n("live")} live on mainnet · ${n("deployed")} deployed · ${n("announced")} announced. Last reviewed ${esc(latest(all))}.
<details><summary>i</summary> Every project with a public Arc link: contracts on Arc mainnet, a live integration, or an official announcement. Each status links to its evidence on the project page.</details></p>
<h2>By category</h2><ul>${cats}</ul>
<h2>${status ? esc(STATUS_LABEL[status]) : "All projects"}</h2><p class="muted">Show: ${filters}</p>
${table(shown)}
<p class="muted">The same data as JSON: <a href="/api/v1/ecosystem">/api/v1/ecosystem</a>.</p>`;
  const ld = { "@context": "https://schema.org", "@type": "DataCatalog", name: "Arc ecosystem", url: `${ECO_SITE}/ecosystem/`, dateModified: latest(all), license: LICENSE, creator: CREATOR,
    mainEntity: { "@type": "ItemList", numberOfItems: all.length, itemListElement: sortByName(all).map((e, k) => ({ "@type": "ListItem", position: k + 1, name: e.name, url: `${ECO_SITE}${entityHref(e.slug)}` })) } };
  return page({ title: "Arc ecosystem · Registrai", canonical: `${ECO_SITE}/ecosystem/`, description: `Every project on Arc with its category and status: ${n("live")} live on mainnet, ${n("deployed")} deployed, ${n("announced")} announced.`, body, ld });
}

export function renderCategory(cat: Category, all: ArcEntity[]): string {
  const l = all.filter((e) => inCategory(cat, e));
  const body = `<h1>${esc(cat.label)}</h1>
<p class="muted">${l.length} projects. <a href="/ecosystem/">All categories</a></p>
${table(l)}`;
  const ld = { "@context": "https://schema.org", "@type": "ItemList", name: cat.label, url: `${ECO_SITE}${categoryHref(cat.id)}`, numberOfItems: l.length,
    itemListElement: sortByName(l).map((e, k) => ({ "@type": "ListItem", position: k + 1, name: e.name, url: `${ECO_SITE}${entityHref(e.slug)}` })) };
  return page({ title: `${cat.label} · Registrai`, canonical: `${ECO_SITE}${categoryHref(cat.id)}`, description: `${cat.label}: ${l.length} projects with their status and sources.`, body, ld });
}

export const renderEcosystemNotFound = () =>
  page({ title: "Not found · Registrai", canonical: `${ECO_SITE}/ecosystem/`, description: "No project or category with this id in the Arc ecosystem directory.",
    body: `<h1>Not in the Arc ecosystem directory</h1><p>No project or category with this id. See the <a href="/ecosystem/">Arc ecosystem</a>.</p>` });
```

Also add `<a href="/ecosystem/">Arc ecosystem</a>` as the first link of the `<nav>` in `page()` in `apps-pages.ts`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run builders-site/test/ecosystem-pages.test.ts builders-site/test/apps-pages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/ecosystem-pages.ts builders-site/test/ecosystem-pages.test.ts builders-site/lib/apps-pages.ts
git commit -m "ecosystem: entity, directory and category renderers"
```

---

### Task 5: The /ecosystem route

**Files:**
- Create: `builders-site/functions/ecosystem/[[path]].ts`
- Create: `builders-site/lib/ecosystem-load.ts`
- Test: `builders-site/test/ecosystem-route.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ECOSYSTEM`, `categoryOf`, `parseStatus`); Task 4 (renderers); `loadApp` from `apps-data`; `handlePublicProject`, `handlePublicFacts`, `pageState`
- Produces: `loadEntityView(env: Env, deps: EdgeCacheDeps, e: ArcEntity, origin: string): Promise<EntityView>`. It never throws: missing data means `app: null` or `facts: null`.

- [ ] **Step 1: Write the failing test**

`builders-site/test/ecosystem-route.test.ts`:
```ts
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

const E: ArcEntity[] = [
  { slug: "archery", name: "Archery", category: "consumer", status: "live", summary: "A game on Arc.", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }],
    sources: [{ url: "https://archery.wtf/" }], index_ids: ["domain:archery.wtf"], facts_source: "domain:archery.wtf", last_reviewed: "2026-10-20" },
  { slug: "aave", name: "Aave", category: "lending", status: "announced", summary: "Lending.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://aave.com/" }], last_reviewed: "2026-10-20" },
];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E) }));
const loadApp = vi.fn();
vi.mock("../lib/apps-data", async (orig) => ({ ...(await orig<typeof import("../lib/apps-data")>()), loadApp: (...a: unknown[]) => loadApp(...a) }));

const call = async (path: string, method = "GET", env: Record<string, unknown> = {}) => {
  const { onRequest } = await import("../functions/ecosystem/[[path]]");
  const u = new URL(`https://builder.registrai.cc${path}`);
  const parts = u.pathname.replace(/^\/ecosystem\/?/, "").split("/").filter(Boolean);
  return onRequest({ request: new Request(u, { method }), env: { INVITES: { get: async () => null }, ...env }, params: { path: parts }, waitUntil: () => undefined } as never);
};

describe("/ecosystem route", () => {
  test("directory, filtered directory, category, entity, 404s", async () => {
    loadApp.mockResolvedValue("unknown");
    expect(await (await call("/ecosystem/")).text()).toContain("<h1>Arc ecosystem</h1>");
    const evil = await (await call("/ecosystem/?status=evil")).text();
    expect(evil).toContain(">Aave<"); expect(evil).toContain(">Archery<");
    expect(await (await call("/ecosystem/lending/")).text()).toContain("<h1>Lending on Arc</h1>");
    expect(await (await call("/ecosystem/aave/")).text()).toContain("<h1>Aave</h1>");
    expect((await call("/ecosystem/nobody/")).status).toBe(404);
    expect((await call("/ecosystem/dexs/extra/")).status).toBe(404);
  });
  test("missing slash 301s; POST 405; HEAD has no body", async () => {
    const r = await call("/ecosystem/aave");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://builder.registrai.cc/ecosystem/aave/");
    expect((await call("/ecosystem/", "POST")).status).toBe(405);
    expect(await (await call("/ecosystem/aave/", "HEAD")).text()).toBe("");
  });
  test("index data down or facts KV failing: the entity page still answers 200 without those blocks", async () => {
    loadApp.mockResolvedValue(null);
    const r = await call("/ecosystem/archery/", "GET", { INVITES: { get: async () => { throw new Error("kv down"); } } });
    expect(r.status).toBe(200);
    const h = await r.text();
    expect(h).toContain("<h1>Archery</h1>");
    expect(h).not.toContain("<h2>Activity</h2>");
    expect(h).not.toContain("<h2>Project facts</h2>");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run builders-site/test/ecosystem-route.test.ts`
Expected: FAIL with "Failed to load url ../functions/ecosystem/[[path]]".

- [ ] **Step 3: Implement**

`builders-site/lib/ecosystem-load.ts`:
```ts
import type { ArcEntity } from "../../src/lib/arc-ecosystem";
import { pageState } from "../../src/lib/project-page";
import { loadApp } from "./apps-data";
import { handlePublicFacts } from "./facts";
import { handlePublicProject } from "./projects";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";
import type { EntityView } from "./ecosystem-pages";

const read = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => ({})) });

/** The entity plus its index activity and Tabula facts when available; never throws (missing data → null blocks). */
export async function loadEntityView(env: Env, deps: EdgeCacheDeps, e: ArcEntity, origin: string): Promise<EntityView> {
  const id = e.index_ids?.[0];
  const app = id ? await loadApp(env, deps, id).then((a) => (a && a !== "unknown" ? a : null)).catch(() => null) : null;
  let facts: EntityView["facts"] = null;
  if (e.facts_source) {
    try {
      const enc = encodeURIComponent(e.facts_source);
      const [p, f] = await Promise.all([
        handlePublicProject(new Request(`${origin}/api/projects/${enc}`), env, e.facts_source, deps).then(read),
        handlePublicFacts(new Request(`${origin}/api/facts/${enc}`), env, e.facts_source, deps).then(read),
      ]);
      const s = pageState(p, f);
      facts = s.kind === "ready" ? s : null;
    } catch { facts = null; }
  }
  return { entity: e, app, facts };
}
```

`builders-site/functions/ecosystem/[[path]].ts`:
```ts
import type { PagesFunction } from "../../lib/env";
import { ECOSYSTEM } from "../../../src/lib/arc-ecosystem-data";
import { categoryOf, parseStatus } from "../../../src/lib/arc-ecosystem";
import { renderCategory, renderDirectory, renderEcosystemNotFound, renderEntity } from "../../lib/ecosystem-pages";
import { loadEntityView } from "../../lib/ecosystem-load";
import { edgeCachedGet } from "../../lib/http";

/** GET /ecosystem/, /ecosystem/<category>/, /ecosystem/<slug>/ (spec 2026-10-19-arc-ecosystem-directory-design.md). */
const html = (body: string, status = 200, head = false) =>
  new Response(head ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=300" : "no-store" } });

export const onRequest: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const head = m === "HEAD";
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  const all = ECOSYSTEM.entities;
  if (parts.length === 0) {
    const status = parseStatus(url.searchParams.get("status"));
    return html(renderDirectory(all, status), 200, head);
  }
  if (parts.length !== 1) return html(renderEcosystemNotFound(), 404, head);
  const cat = categoryOf(parts[0]);
  if (cat) return html(renderCategory(cat, all), 200, head);
  const e = ECOSYSTEM.bySlug.get(parts[0]);
  if (!e) return html(renderEcosystemNotFound(), 404, head);
  const res = await edgeCachedGet(new Request(url.toString()), deps, async () => html(renderEntity(await loadEntityView(ctx.env, deps, e, url.origin))), 300, `entity:${e.slug}`);
  return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
};
```

- [ ] **Step 4: Run the test and the builder suite**

Run: `npx vitest run builders-site`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builders-site/functions/ecosystem builders-site/lib/ecosystem-load.ts builders-site/test/ecosystem-route.test.ts
git commit -m "ecosystem: /ecosystem route (directory, categories, entity pages; data down never 503s)"
```

---

### Task 6: One page per project — redirects and links

**Files:**
- Create: `builders-site/lib/app-href.ts`
- Modify: `builders-site/functions/apps/[[path]].ts` (301 for mapped ids)
- Modify: `builders-site/functions/project/[[path]].ts` (301 for mapped facts sources)
- Modify: `builders-site/lib/apps-pages.ts` (list and ItemList links via `appHref`)
- Modify: `builders-site/lib/ssr-summary.ts` (top-apps links via `appHref`)
- Modify: `builders-site/lib/mcp.ts` (`arc_apps` row and `arc_app` `source_url` via `appHref`)
- Test: `builders-site/test/ecosystem-redirects.test.ts`

**Interfaces:**
- Consumes: `ECOSYSTEM` and `entityHref` (Task 1); `idToPath` from `apps-data`
- Produces: `appHref(id: string): string`, which returns `entityHref(slug)` when an entity claims the index id, else `idToPath(id) ?? "/apps/"`

- [ ] **Step 1: Write the failing test**

`builders-site/test/ecosystem-redirects.test.ts`:
```ts
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";

vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities([{ slug: "archery", name: "Archery", category: "consumer", status: "live", summary: "A game.",
  status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://archery.wtf/" }],
  index_ids: ["domain:archery.wtf"], facts_source: "domain:archery.wtf", last_reviewed: "2026-10-20" } as ArcEntity]) }));

const ctx = (path: string, parts: string[]) => ({ request: new Request(`https://builder.registrai.cc${path}`), env: { INVITES: { get: async () => null } }, params: { path: parts }, waitUntil: () => undefined,
  next: async () => new Response("STATIC", { headers: { "content-type": "text/html" } }) }) as never;

describe("one page per project", () => {
  test("appHref: entity page when claimed, the app page otherwise (a new index member keeps its page)", async () => {
    const { appHref } = await import("../lib/app-href");
    expect(appHref("domain:archery.wtf")).toBe("/ecosystem/archery/");
    expect(appHref("domain:brand-new.app")).toBe("/apps/domain/brand-new.app/");
  });
  test("/apps/<id>/ 301s to the entity page; an unclaimed id is not redirected", async () => {
    const { onRequest } = await import("../functions/apps/[[path]]");
    const r = await onRequest(ctx("/apps/domain/archery.wtf/", ["domain", "archery.wtf"]));
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://builder.registrai.cc/ecosystem/archery/");
    expect((await onRequest(ctx("/apps/domain/brand-new.app/", ["domain", "brand-new.app"]))).status).not.toBe(301);
  });
  test("/project/<id>/ 301s to the entity page when its facts source is claimed", async () => {
    const { onRequest } = await import("../functions/project/[[path]]");
    const r = await onRequest(ctx("/project/domain/archery.wtf/", ["domain", "archery.wtf"]));
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://builder.registrai.cc/ecosystem/archery/");
  });
  test("the /apps/ list links claimed apps to their entity page", async () => {
    const { renderAppList } = await import("../lib/apps-pages");
    const row = { id: "domain:archery.wtf", name: "Archery", kind: "builder", verified: true, points: 1, share: 1, first_hour: "2026-10-10T00:00:00Z", last_24h: { points_earned: 0, payments: 1, usdc: 1 }, contracts: 1, indices: ["aei"] };
    const h = renderAppList({ data_until: "2026-10-20T10:00:00Z", rows: [row as never, { ...row, id: "domain:brand-new.app", name: "New" } as never], totals: { apps: 2, payments_24h: 2, usdc_24h: 2, arc_usdc_24h_est: 0 } }, "payments");
    expect(h).toContain('href="/ecosystem/archery/"');
    expect(h).toContain('href="/apps/domain/brand-new.app/"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run builders-site/test/ecosystem-redirects.test.ts`
Expected: FAIL with "Failed to load url ../lib/app-href".

- [ ] **Step 3: Implement**

`builders-site/lib/app-href.ts`:
```ts
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { entityHref } from "../../src/lib/arc-ecosystem";
import { idToPath } from "./apps-data";

/** Where an index member's page is: its ecosystem entity page when an entry claims the id, else its /apps page. */
export const appHref = (id: string): string => {
  const e = ECOSYSTEM.byIndexId.get(id);
  return e ? entityHref(e.slug) : idToPath(id) ?? "/apps/";
};
```

In `builders-site/functions/apps/[[path]].ts`, right after `const id = pathToId(parts); if (!id) return html(renderNotFound(), 404);`, add:
```ts
  const claimed = ECOSYSTEM.byIndexId.get(id);
  if (claimed) return Response.redirect(`${url.origin}${entityHref(claimed.slug)}`, 301); // one page per project
```
Add the imports `import { ECOSYSTEM } from "../../../src/lib/arc-ecosystem-data";` and `import { entityHref } from "../../../src/lib/arc-ecosystem";`.

In `builders-site/functions/project/[[path]].ts`, right after `if (url.pathname !== projectHref(source)) return Response.redirect(...)`, add:
```ts
  const claimed = ECOSYSTEM.byFactsSource.get(source);
  if (claimed) return Response.redirect(`${url.origin}${entityHref(claimed.slug)}`, 301); // one page per project
```
Add the same two imports.

In `builders-site/lib/apps-pages.ts`, use `appHref(r.id)` instead of `idToPath(r.id) ?? "/apps/"` in the `renderAppList` row link and in the `ItemList` url (`${SITE}${appHref(r.id)}`). Import `appHref` from `./app-href`.
In `builders-site/lib/ssr-summary.ts`, replace `idToPath(r.id) ?? "/apps/"` with `appHref(r.id)`.
In `builders-site/lib/mcp.ts`, replace both `${SITE}${idToPath(...)}` uses with `${SITE}${appHref(...)}`.

- [ ] **Step 4: Run all builder tests**

Run: `npx vitest run builders-site`
Expected: PASS. The existing apps tests still see `/apps/…` links, because the real `entities.json` is still empty.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/app-href.ts builders-site/functions/apps builders-site/functions/project builders-site/lib/apps-pages.ts builders-site/lib/ssr-summary.ts builders-site/lib/mcp.ts builders-site/test/ecosystem-redirects.test.ts
git commit -m "ecosystem: one page per project — /apps and /project 301 to the entity page when claimed; lists link there"
```

---

### Task 7: Data API — /api/v1/ecosystem

**Files:**
- Create: `builders-site/lib/data-api-ecosystem.ts`
- Create: `builders-site/functions/api/v1/ecosystem/[[path]].ts`
- Create: `docs/superpowers/specs/data-api-v1-fixtures/ecosystem.json`
- Create: `docs/superpowers/specs/data-api-v1-fixtures/ecosystem-entity.json`
- Modify: `src/lib/data-api-docs.ts` (two `ENDPOINTS` entries, a `CHANGELOG` entry)
- Modify: `src/lib/data-api-openapi.ts` (two paths, two schemas)
- Test: `builders-site/test/data-api-ecosystem.test.ts`

**Interfaces:**
- Consumes: `ECOSYSTEM`, `parseStatus`, `categoryOf`, `entityHref` (Task 1); `v1Json`, `v1Error`, `cached` from `data-api.ts`
- Produces: `handleEcosystem(req: Request, deps: EdgeCacheDeps, parts: string[]): Promise<Response>`
  - `GET /api/v1/ecosystem?category=&status=&q=` → `{ version: 1, updated, count, entities: EntityListItem[] }`
  - `GET /api/v1/ecosystem/{slug}` → `{ version: 1, entity: ArcEntity & { url: string } }`
  - `EntityListItem = { slug, name, category, status, summary, website: string | null, first_live: string | null, url }`

- [ ] **Step 1: Write the failing test**

`builders-site/test/data-api-ecosystem.test.ts`:
```ts
import { describe, expect, test, vi } from "vitest";
import { indexEntities, type ArcEntity } from "../../src/lib/arc-ecosystem";
import listFixture from "../../docs/superpowers/specs/data-api-v1-fixtures/ecosystem.json";
import entityFixture from "../../docs/superpowers/specs/data-api-v1-fixtures/ecosystem-entity.json";

const E = [
  { slug: "aave", name: "Aave", aliases: ["Aave V4"], category: "lending", status: "live", summary: "Lending on Arc.", status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }],
    sources: [{ url: "https://aave.com/" }], website: "https://aave.com/", first_live: "2026-10-10", last_reviewed: "2026-10-20" },
  { slug: "circle-wallets", name: "Circle Wallets", category: "wallets", status: "announced", summary: "Wallets.", status_evidence: [{ url: "https://www.arc.io/pressroom/a" }], sources: [{ url: "https://www.circle.com/" }], last_reviewed: "2026-10-19" },
] as ArcEntity[];
vi.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: indexEntities(E) }));

const get = async (path: string) => {
  const { handleEcosystem } = await import("../lib/data-api-ecosystem");
  const u = new URL(`https://builder.registrai.cc/api/v1/ecosystem${path}`);
  return handleEcosystem(new Request(u), { cache: null }, u.pathname.replace(/^\/api\/v1\/ecosystem\/?/, "").split("/").filter(Boolean));
};

describe("/api/v1/ecosystem", () => {
  test("list: version, updated, count, items in the fixture's shape, sorted by name", async () => {
    const b = await (await get("")).json();
    expect(Object.keys(b).sort()).toEqual(Object.keys(listFixture).sort());
    expect(Object.keys(b.entities[0]).sort()).toEqual(Object.keys(listFixture.entities[0]).sort());
    expect(b).toMatchObject({ version: 1, updated: "2026-10-20", count: 2 });
    expect(b.entities.map((e: { slug: string }) => e.slug)).toEqual(["aave", "circle-wallets"]);
    expect(b.entities[0].url).toBe("https://builder.registrai.cc/ecosystem/aave/");
  });
  test("filters: category, status, q (name or alias, case-insensitive)", async () => {
    expect((await (await get("?category=wallets")).json()).count).toBe(1);
    expect((await (await get("?status=live")).json()).entities[0].slug).toBe("aave");
    expect((await (await get("?q=aave%20v4")).json()).count).toBe(1);
    expect((await (await get("?q=zzz")).json()).count).toBe(0);
  });
  test("bad filters → 400 with a sentence; unknown slug → 404; extra segments → 404", async () => {
    const r = await get("?status=evil");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/status must be/);
    expect((await get("?category=games")).status).toBe(400);
    expect((await get("/nobody")).status).toBe(404);
    expect((await get("/aave/x")).status).toBe(404);
  });
  test("one entity: the full entry plus its url, in the fixture's shape", async () => {
    const b = await (await get("/aave")).json();
    expect(Object.keys(b).sort()).toEqual(Object.keys(entityFixture).sort());
    expect(b.entity).toMatchObject({ slug: "aave", url: "https://builder.registrai.cc/ecosystem/aave/" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run builders-site/test/data-api-ecosystem.test.ts`
Expected: FAIL. The fixture JSON and `../lib/data-api-ecosystem` are missing.

- [ ] **Step 3: Implement**

`docs/superpowers/specs/data-api-v1-fixtures/ecosystem.json`:
```json
{ "version": 1, "updated": "2026-10-20", "count": 1,
  "entities": [{ "slug": "aave", "name": "Aave", "category": "lending", "status": "live", "summary": "Lending on Arc.", "website": "https://aave.com/", "first_live": "2026-10-10", "url": "https://builder.registrai.cc/ecosystem/aave/" }] }
```

`docs/superpowers/specs/data-api-v1-fixtures/ecosystem-entity.json`:
```json
{ "version": 1, "entity": { "slug": "aave", "name": "Aave", "category": "lending", "status": "live", "summary": "Lending on Arc.",
  "status_evidence": [{ "url": "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], "sources": [{ "url": "https://aave.com/" }],
  "last_reviewed": "2026-10-20", "url": "https://builder.registrai.cc/ecosystem/aave/" } }
```

`builders-site/lib/data-api-ecosystem.ts`:
```ts
/** GET /api/v1/ecosystem[/{slug}]: the Arc ecosystem directory as JSON (CC BY 4.0). Static data: cached 5 min. */
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { categoryOf, entityHref, parseStatus, sortByName } from "../../src/lib/arc-ecosystem";
import { cached, v1Error, v1Json } from "./data-api";
import type { EdgeCacheDeps } from "./http";

const SITE = "https://builder.registrai.cc";
export function handleEcosystem(req: Request, deps: EdgeCacheDeps, parts: string[]): Promise<Response> {
  const url = new URL(req.url);
  if (parts.length > 1) return Promise.resolve(v1Error(404, "Not found. Use /api/v1/ecosystem or /api/v1/ecosystem/{slug}."));
  if (parts.length === 1) {
    const e = ECOSYSTEM.bySlug.get(parts[0]);
    if (!e) return Promise.resolve(v1Error(404, `No project with slug ${parts[0]}. Use /api/v1/ecosystem for the list.`));
    return cached(req, deps, `eco:${e.slug}`, () => v1Json(req, { entity: { ...e, url: `${SITE}${entityHref(e.slug)}` } }, 300), 300);
  }
  const cat = url.searchParams.get("category"), st = url.searchParams.get("status"), q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (cat !== null && !categoryOf(cat)) return Promise.resolve(v1Error(400, "category must be one of the directory's category ids (see /ecosystem/)."));
  const status = st === null ? null : parseStatus(st);
  if (st !== null && !status) return Promise.resolve(v1Error(400, "status must be live, deployed or announced."));
  return cached(req, deps, `eco-list:${cat ?? ""}:${status ?? ""}:${q}`, () => {
    const l = sortByName(ECOSYSTEM.entities).filter((e) => (!cat || e.category === cat || (e.tags ?? []).includes(cat as never)) && (!status || e.status === status)
      && (!q || [e.name, ...(e.aliases ?? [])].some((n) => n.toLowerCase().includes(q))));
    return v1Json(req, {
      updated: ECOSYSTEM.entities.map((e) => e.last_reviewed).sort().pop() ?? null, count: l.length,
      entities: l.map((e) => ({ slug: e.slug, name: e.name, category: e.category, status: e.status, summary: e.summary, website: e.website ?? null, first_live: e.first_live ?? null, url: `${SITE}${entityHref(e.slug)}` })),
    }, 300);
  }, 300);
}
```

`builders-site/functions/api/v1/ecosystem/[[path]].ts`:
```ts
import type { PagesFunction } from "../../../../lib/env";
import { handleEcosystem } from "../../../../lib/data-api-ecosystem";

/** GET /api/v1/ecosystem and /api/v1/ecosystem/{slug}. */
export const onRequest: PagesFunction = (ctx) =>
  handleEcosystem(ctx.request, { waitUntil: (p) => ctx.waitUntil(p) }, ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean));
```

In `src/lib/data-api-docs.ts`, append to `ENDPOINTS`:
```ts
  { method: "GET", path: "/ecosystem", params: "category, status, q (optional)", returns: "Every project in the Arc ecosystem directory: category, status (live, deployed, announced), summary and page URL.",
    example: curl("/ecosystem?category=dexs") },
  { method: "GET", path: "/ecosystem/{slug}", params: "none", returns: "One project: summary, status with evidence, links, contracts on Arc, index ids and sources.",
    example: curl("/ecosystem/aave") },
```
Append to `CHANGELOG`: `{ date: "2026-10-20", text: "Arc ecosystem directory: /ecosystem and /ecosystem/{slug}." }`.

In `src/lib/data-api-openapi.ts`:
- Import both fixtures: `import ecosystem from "../../docs/superpowers/specs/data-api-v1-fixtures/ecosystem.json";` and `import ecosystemEntity from "../../docs/superpowers/specs/data-api-v1-fixtures/ecosystem-entity.json";`
- Add to `paths`:
```ts
    "/ecosystem": op("listEcosystem", "Every project in the Arc ecosystem directory", "Ecosystem", [
      { name: "category", in: "query", required: false, schema: { type: "string" } }, { name: "status", in: "query", required: false, schema: { type: "string", enum: ["live", "deployed", "announced"] } },
      { name: "q", in: "query", required: false, description: "Name or alias contains (case-insensitive).", schema: { type: "string" } }]),
    "/ecosystem/{slug}": op("getEcosystemEntity", "One project in the Arc ecosystem directory", "EcosystemEntity", [{ name: "slug", in: "path", required: true, schema: { type: "string" } }]),
```
- Add to `schemas`: `Ecosystem: nullable(schemaOf(ecosystem), ["entities", "website"]), EcosystemEntity: schemaOf(ecosystemEntity),`. Check that `nullable` reaches array items. If it does not, set `website` and `first_live` as `{ type: ["string", "null"] }` by hand on `Ecosystem.properties.entities.items.properties`.

- [ ] **Step 4: Run the API, OpenAPI and discovery tests**

Run: `npx vitest run builders-site/test/data-api-ecosystem.test.ts src/lib/data-api-openapi.test.ts src/lib/data-api-docs.test.ts builders-site/test/discovery.test.ts`
Expected: PASS. The discovery `/api/v1/` index lists the new paths automatically, since it is derived from `OPENAPI.paths`.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/data-api-ecosystem.ts builders-site/functions/api/v1/ecosystem builders-site/test/data-api-ecosystem.test.ts docs/superpowers/specs/data-api-v1-fixtures/ecosystem*.json src/lib/data-api-docs.ts src/lib/data-api-openapi.ts
git commit -m "Data API: /api/v1/ecosystem list (category, status, q filters) and /api/v1/ecosystem/{slug}"
```

---

### Task 8: MCP tools arc_ecosystem and arc_entity

**Files:**
- Modify: `builders-site/lib/mcp.ts`
- Test: `builders-site/test/mcp.test.ts`

**Interfaces:**
- Consumes: `handleEcosystem` (Task 7), `CATEGORIES` (Task 1)
- Produces: tools `arc_ecosystem({ category?, status?, q? })` and `arc_entity({ slug })`. Free tools go from 7 to 9, and the total from 13 to 15.

- [ ] **Step 1: Write the failing test**

In `builders-site/test/mcp.test.ts`, change the two counts `toHaveLength(13)` to `toHaveLength(15)` (and the comment to `// 9 free + 6 paid (x402)`). Then append:
```ts
describe("ecosystem tools", () => {
  test("arc_ecosystem and arc_entity are listed with titles and answer from the directory API", async () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["arc_ecosystem", "arc_entity"]));
    const t = MCP_TOOLS.find((x) => x.name === "arc_ecosystem")!;
    expect(t.title).toBe("Arc ecosystem: directory");
    expect(t.description).toMatch(/Use this when/);
    const r = await (await rpc({}, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "arc_ecosystem", arguments: { status: "evil" } } })).json();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/status must be/);
    const one = await (await rpc({}, { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "arc_entity", arguments: {} } })).json();
    expect(one.result.isError).toBe(true);
    expect(one.result.content[0].text).toMatch(/slug is required/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run builders-site/test/mcp.test.ts`
Expected: FAIL (13 tools; arc_ecosystem missing).

- [ ] **Step 3: Implement**

In `builders-site/lib/mcp.ts`:
- Import `handleEcosystem` from `./data-api-ecosystem` and `CATEGORIES` from `../../src/lib/arc-ecosystem`.
- In `MCP_TOOLS`, before `...paidTools()`, add:
```ts
  tool("arc_ecosystem", "Arc ecosystem: directory", "Every project in the Arc ecosystem directory (apps, wallets, exchanges, banks, infrastructure, partners) with category and status: live on mainnet, deployed or announced. Use this when asked what exists on Arc, which projects are in a category, or whether a company is on Arc. Not for token prices.",
    obj({ category: { type: "string", enum: CATEGORIES.map((c) => c.id) }, status: { type: "string", enum: ["live", "deployed", "announced"] }, q: { type: "string", description: "Name contains." } })),
  tool("arc_entity", "Arc project: detail", "One project in the Arc ecosystem directory by slug (slugs come from arc_ecosystem): summary, status with evidence, links, contracts on Arc and sources.", obj({ slug: { type: "string" } }, ["slug"])),
```
- In `callTool`'s switch, add:
```ts
    case "arc_ecosystem": return viaApi(`${API}/ecosystem${qs({ category: str(a, "category"), status: str(a, "status"), q: str(a, "q") })}`, (q) => handleEcosystem(q, d, []));
    case "arc_entity": { const slug = str(a, "slug", true)!; return viaApi(`${API}/ecosystem/${encodeURIComponent(slug)}`, (q) => handleEcosystem(q, d, [slug])); }
```
(`str(a, "slug", true)` throws `BadArgs("slug is required.")`, which the existing `tools/call` handler turns into `isError`.)

- [ ] **Step 4: Run the MCP and discovery tests**

Run: `npx vitest run builders-site/test/mcp.test.ts builders-site/test/discovery.test.ts`
Expected: PASS. The server card lists both new tools, because it maps over `MCP_TOOLS`.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/mcp.ts builders-site/test/mcp.test.ts
git commit -m "MCP: arc_ecosystem and arc_entity (free, read-only)"
```

---

### Task 9: Sitemap, IndexNow, llms.txt

**Files:**
- Modify: `builders-site/lib/sitemap-urls.ts`
- Modify: `builders-site/functions/llms.txt.ts`
- Modify: `public/llms.txt`
- Test: `builders-site/test/sitemap-urls.test.ts`

**Interfaces:**
- Consumes: `ECOSYSTEM`, `CATEGORIES`, `entityHref`, `categoryHref` (Task 1)
- Produces: `sitemapUrls` now also returns:
  - `/ecosystem/` (lastmod = latest `last_reviewed`)
  - every category with ≥ 1 project
  - every entity (lastmod = `last_reviewed`)

  It skips `/apps/<id>/` URLs whose id an entity claims. IndexNow uses the same list, so no extra change is needed.

- [ ] **Step 1: Write the failing test**

Append to `builders-site/test/sitemap-urls.test.ts`:
```ts
import { vi as vi2 } from "vitest";
import { indexEntities as ix } from "../../src/lib/arc-ecosystem";
vi2.mock("../../src/lib/arc-ecosystem-data", () => ({ ECOSYSTEM: ix([{ slug: "archery", name: "Archery", category: "consumer", status: "live", summary: "A game.",
  status_evidence: [{ url: "https://explorer.arc.io/address/0x0000000000000000000000000000000000000001" }], sources: [{ url: "https://archery.wtf/" }],
  index_ids: ["domain:archery.wtf"], last_reviewed: "2026-10-20" }]) }));

describe("ecosystem in the sitemap", () => {
  test("directory, non-empty categories and entity pages; claimed /apps pages are left out", async () => {
    const { sitemapUrls } = await import("../lib/sitemap-urls");
    const kv = new MemoryKV();
    const urls = await sitemapUrls({ INVITES: kv, DATA_DB: undefined } as never, { cache: null }, NOW);
    const locs = urls.map((u) => u.loc);
    expect(urls).toContainEqual({ loc: "https://builder.registrai.cc/ecosystem/", lastmod: "2026-10-20" });
    expect(locs).toContain("https://builder.registrai.cc/ecosystem/consumer/");
    expect(locs).not.toContain("https://builder.registrai.cc/ecosystem/banks/");
    expect(urls).toContainEqual({ loc: "https://builder.registrai.cc/ecosystem/archery/", lastmod: "2026-10-20" });
    expect(locs).not.toContain("https://builder.registrai.cc/apps/domain/archery.wtf/");
  });
});
```
Append to `builders-site/test/apps-routes.test.ts`, inside the `I1` test:
```ts
  expect(LLMS_TXT).toContain("https://builder.registrai.cc/ecosystem/");
  expect(LLMS_TXT).toContain("https://builder.registrai.cc/api/v1/ecosystem");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run builders-site/test/sitemap-urls.test.ts builders-site/test/apps-routes.test.ts`
Expected: FAIL (no /ecosystem URLs; llms.txt lacks them).

- [ ] **Step 3: Implement**

In `builders-site/lib/sitemap-urls.ts`, inside `sitemapUrls`, after `apps` is computed:
```ts
  const eco = ECOSYSTEM.entities;
  const ecoMod = eco.map((e) => e.last_reviewed).sort().pop();
  const claimed = (p: string) => eco.some((e) => (e.index_ids ?? []).some((id) => idToPath(id) === p));
  const cats = CATEGORIES.filter((c) => eco.some((e) => e.category === c.id || (e.tags ?? []).includes(c.id)));
  const ecoUrls = eco.length ? [at("/ecosystem/", ecoMod), ...cats.map((c) => at(categoryHref(c.id), ecoMod)), ...eco.map((e) => at(entityHref(e.slug), e.last_reviewed))] : [];
```
Change the return to:
```ts
  return [...DATA.map((p) => at(p, mod)), ...STATIC.map((p) => at(p)), ...ecoUrls, ...apps.filter((p) => !claimed(p)).map((p) => at(p, mod)), ...facts.map((f) => at(f.path, f.lastmod))];
```
Add the imports: `ECOSYSTEM` from `../../src/lib/arc-ecosystem-data`; `CATEGORIES`, `categoryHref` and `entityHref` from `../../src/lib/arc-ecosystem`.

In `builders-site/functions/llms.txt.ts`, add as the first line under `## Data`:
```
- [Arc ecosystem directory](https://builder.registrai.cc/ecosystem/): every project on Arc with category, status and sources; JSON at https://builder.registrai.cc/api/v1/ecosystem
```
In `public/llms.txt`, add the same line as the first item under `## Data`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run builders-site src/lib && npm run typecheck`
Expected: PASS, except the one known failure that predates this work (`validateDraft > every draft arc-80 prepared passes`, which reads a folder outside the worktree). typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add builders-site/lib/sitemap-urls.ts builders-site/functions/llms.txt.ts public/llms.txt builders-site/test/sitemap-urls.test.ts builders-site/test/apps-routes.test.ts
git commit -m "ecosystem: sitemap and IndexNow URLs, llms.txt links"
```

---

### Task 10: Draft the first entries (index members + tracker live/deployed)

**Files:**
- Modify: `src/data/arc-ecosystem/entities.json`
- Read-only inputs:
  - `.superpowers/arc-ecosystem/draft.json` (Task 2)
  - `/Users/tobiasd/Desktop/arc/research/arc-builders-index/integrations.json` (never write)
- Test: `src/lib/arc-ecosystem-data.test.ts` (from Task 1; validates the real file)

**Scope:** every draft candidate whose `origins` include `"index"`, plus every tracker candidate with `status` `live` or `deployed`. That is about 60–75 entries. The Arc base layer (`base:arc`) is not an entity.

- [ ] **Step 1: Regenerate candidates and list the batch**

Run:
```bash
npx tsx scripts/ecosystem-seed.ts && node -e '
const c=require("./.superpowers/arc-ecosystem/draft.json").filter(x=>x.origins.includes("index")||(x.origins.includes("tracker")&&x.status!=="announced"));
console.log(c.length); for (const x of c) console.log(x.slug, x.status, x.category??"?", x.index_ids.join(","));'
```
Expected: about 60–75 lines. Save the list as the batch to draft.

- [ ] **Step 2: Draft entries, 15 per batch, one batch at a time**

For each candidate, open its sources (WebFetch is fine; research subagents are fine for a batch) and write one entry following these rules:
- **slug and name:** `slug` from the candidate; `name` as the project writes it.
- **category:** must be one of the 20. The candidate's `category` is a suggestion; when it is `null`, pick from what the project does on Arc. Add `tags` only when a second category clearly applies.
- **status:** index members are `live`, with `index_ids` = the candidate's ids. Tracker `live` needs a contract or an `explorer.arc.io` link in `status_evidence`. `deployed` means contracts exist but no live use is shown.
- **status_evidence:** the explorer address link for one contract (`https://explorer.arc.io/address/<lowercase address>`), the tracker's live evidence, or the announcement.
- **summary:** one or two sentences on what the project does on Arc, built only from a source. No superlatives, no verdict words, no forward-looking claims.
- **links:** `website`, `x` (handle without @), `github`, `docs` only when the project publishes them.
- **dates:** `first_announced` (earliest announcement), `first_live` (tracker `first_seen_live`, or the index first hour date).
- **contracts:** at most 10 key contracts from the tracker's `arc_contracts`, with role and source. Lowercase addresses.
- **facts_source:** set only when a Tabula profile or facts exist for that source. Check `curl -s -o /dev/null -w '%{http_code}' https://builder.registrai.cc/api/projects/<encoded source>`; 200 means it exists.
- **sources:** every URL used, with a short `title` and the access date.
- **last_reviewed:** today's date (YYYY-MM-DD).
- **Excluded:** nothing from the tracker's revenue, wallets or notes fields. Validation rejects unknown fields anyway.
- **No source, no fact.** If no source supports a field, leave it out. If a candidate has no source at all, skip it and list it in the commit message.

After each batch, append the entries to `src/data/arc-ecosystem/entities.json`, keeping the array sorted by `slug`.

- [ ] **Step 3: Validate after each batch**

Run: `npx vitest run src/lib/arc-ecosystem-data.test.ts`
Expected: PASS. If it fails, fix the entries named in the error list. Never weaken validation.

- [ ] **Step 4: Commit each batch**

```bash
git add src/data/arc-ecosystem/entities.json
git commit -m "ecosystem entries batch N: <slugs>"
```

- [ ] **Step 5: Full suite after the last batch**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, except the known failure that predates this work. Some existing app tests read the real file; if any of them expected an `/apps/<id>/` link for an id that is now claimed, update the test to expect the entity link (`appHref`), not the data.

---

### Task 11: Preview, verify, production

**Files:** none (deploy only)

- [ ] **Step 1: Build and deploy a preview from the clean deploy worktree**

```bash
cd /Users/tobiasd/Desktop/arc/.worktrees/abi-deploy && git checkout -q --detach <HEAD of feat/abi-pilot> && npm run build >/dev/null 2>&1 \
  && bash scripts/build-builders-site.sh && cd builders-site \
  && npx wrangler pages deploy ../dist-builders --project-name=registrai-builders --branch=ecosystem --commit-dirty=true
```
Expected: "Deployment complete!" with a preview URL `P`.

- [ ] **Step 2: Verify on the preview**

Run, each with `B=<preview URL P>`:
```bash
curl -s $B/ecosystem/ | grep -o '<h1>[^<]*</h1>\|[0-9]* projects · [^<]*'
curl -s $B/ecosystem/dexs/ | grep -o '<h1>[^<]*</h1>'
curl -s $B/ecosystem/aave/ | grep -o '<title>[^<]*</title>\|<link rel="canonical" href="[^"]*"'
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' $B/apps/domain/archery.wtf/
curl -s "$B/api/v1/ecosystem?category=dexs" | head -c 300
curl -s -X POST $B/api/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"arc_ecosystem","arguments":{"category":"wallets"}}}' | head -c 300
curl -s "$B/sitemap.xml?v=1" | grep -c '/ecosystem/'
```
Expected:
- the directory H1 "Arc ecosystem" and counts
- "DEXs on Arc"
- the entity's own title and canonical
- `301 …/ecosystem/archery/` (if Archery is drafted)
- the JSON list
- an MCP result
- a sitemap count equal to 1 + non-empty categories + entities

- [ ] **Step 3: Ask the owner for the production go**

Report the counts and a spot-check list of 10 entity URLs on the preview. Wait for the owner's OK in chat.

- [ ] **Step 4: Production (after the OK)**

```bash
cd /Users/tobiasd/Desktop/arc/.worktrees/abi-deploy && bash scripts/deploy-builders-site.sh && npm run deploy
```
Expected: two "Deployment complete!" lines. Re-run the Step 2 checks against `https://builder.registrai.cc`.

- [ ] **Step 5: Re-run the citation panel two weeks after launch**

The owner runs `scripts/citation-panel.ts --runs 3` with the same questions. Compare the ecosystem and entity groups to the 2026-10-19 baseline.
