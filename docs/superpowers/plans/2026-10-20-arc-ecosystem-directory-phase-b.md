# Arc Ecosystem Directory (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (owner chose native execution, 2026-10-20). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the live directory from 73 to about 250–300 sourced entries. The new entries are:
- the tracker's announced partners
- DefiLlama-only Arc protocols
- arc.io's partner list

Also add a stale-entry check and stop empty category pages from being indexed.

**Architecture:** Phase A's tooling stays. The seed script learns arc.io's partner list (names plus the official `arc.io/ecosystem/<slug>` page; no copied descriptions). Entries are drafted in rounds by research agents following the phase A drafting rules, reviewed by Claude, validated and committed per round.

**Tech Stack:** as phase A.

**Spec:** `docs/superpowers/specs/2026-10-19-arc-ecosystem-directory-design.md`, phase B, plus the risks section (stale announced entries).

## Global Constraints

Phase A's Global Constraints apply unchanged: the copy rule, no verdict words, sourcing, excluded tracker fields, read-only `research/`, Workers runtime and CPU, deploys only from abi-deploy, a production deploy only with the owner's OK, and the commit trailer.

In addition:
- **arc.io:** take only partner names and the URL of each partner's arc.io page. Never copy arc.io's descriptions.
- **Previously skipped candidates** (agant, bvnk, argus, dyor-swap, mysphere): drafted only if a new source is found.

## Review Focus

1. **Duplicates across sources:** "Circle" vs "Circle Internet Group", "OKX" vs "OKX Wallet". Merge them when they are the same organisation and keep them apart when they are different products. Pinned in B1 (merge by normalised name) and in review.
2. **An announced partner whose only source is arc.io's own page:** status `announced`, with the arc.io page as evidence. It must never be marked live. Pinned by validation.
3. **Empty category pages:** they must not be indexable. Pinned in B3.

---

### Task B1: Seed from arc.io's partner list

**Files:** Modify `src/lib/arc-ecosystem-seed.ts` and `scripts/ecosystem-seed.ts`. Test: `src/lib/arc-ecosystem-seed.test.ts`.

**Interfaces:**
- Produces: `parseArcPartners(html: string): { name: string; url: string }[]`
- `mergeCandidates` input gains `arcio?: { name: string; url: string }[]`
- `Candidate.origins` may include `"arcio"`
- `Candidate.arcio_url?: string`

- [ ] **Step 1: Failing test** — append to `src/lib/arc-ecosystem-seed.test.ts`:
```ts
import { parseArcPartners } from "./arc-ecosystem-seed";
describe("arc.io partners", () => {
  const html = `<div data-check="Alcove" role="listitem" class="ecosystem-item w-dyn-item"><div class="u-hide"><a aria-label="ecosystem link" href="/ecosystem/alcove" class="w-inline-block"></a></div><p>Alcove</p></div>
<div data-check="Aave" role="listitem" class="ecosystem-item w-dyn-item"><div class="u-hide"><a aria-label="ecosystem link" href="/ecosystem/aave" class="w-inline-block"></a></div></div>
<div data-check="Bad &amp; Co" role="listitem" class="ecosystem-item"><a href="https://evil.example/x">x</a></div>`;
  test("names and arc.io page URLs, entities decoded, non-arc.io links dropped", () => {
    expect(parseArcPartners(html)).toEqual([{ name: "Alcove", url: "https://www.arc.io/ecosystem/alcove" }, { name: "Aave", url: "https://www.arc.io/ecosystem/aave" }]);
  });
  test("an arc.io partner merges into the same-name candidate; a new one is announced with its arc.io page", () => {
    const out = mergeCandidates({ tracker: [{ company: "Aave", category: "lending", status: "live" }], members: [], llama: [], arcio: [{ name: "Aave", url: "https://www.arc.io/ecosystem/aave" }, { name: "Alcove", url: "https://www.arc.io/ecosystem/alcove" }] });
    expect(out.find((c) => c.slug === "aave")).toMatchObject({ status: "live", arcio_url: "https://www.arc.io/ecosystem/aave" });
    expect(out.find((c) => c.slug === "aave")!.origins).toContain("arcio");
    expect(out.find((c) => c.slug === "alcove")).toMatchObject({ status: "announced", origins: ["arcio"], announcements: [{ url: "https://www.arc.io/ecosystem/alcove" }] });
  });
});
```
- [ ] **Step 2:** `npx vitest run src/lib/arc-ecosystem-seed.test.ts` → FAIL (`parseArcPartners` is not exported).
- [ ] **Step 3: Implement** in `src/lib/arc-ecosystem-seed.ts`:
```ts
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
/** arc.io/ecosystem cards: data-check="<name>" with an href="/ecosystem/<slug>" link. Names and links only. */
export function parseArcPartners(html: string): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = [];
  const re = /data-check="([^"]+)"[^>]*role="listitem"[\s\S]*?href="(\/ecosystem\/[a-z0-9-]+)"/g;
  for (let m: RegExpExecArray | null; (m = re.exec(html)); ) out.push({ name: decode(m[1]).trim(), url: `https://www.arc.io${m[2]}` });
  return out.filter((p, i) => out.findIndex((q) => q.url === p.url) === i);
}
```
- Add `"arcio"` to the `origins` union and `arcio_url?: string` to `Candidate`.
- Add `arcio?: { name: string; url: string }[]` to `mergeCandidates`' input.
- After the llama loop, add:
```ts
  for (const p of input.arcio ?? []) {
    const c = out.get(key(p.name)) ?? add(p.name);
    if (!c.origins.includes("arcio")) c.origins.push("arcio");
    c.arcio_url = p.url;
    if (!c.announcements.some((a) => a.url === p.url)) c.announcements.push({ url: p.url });
  }
```
- In `scripts/ecosystem-seed.ts`, fetch the page and pass `arcio`:
```ts
const arcio = parseArcPartners(await (await fetch("https://www.arc.io/ecosystem", { headers: { "user-agent": "Mozilla/5.0 (Registrai ecosystem seed)" } })).text());
const c = mergeCandidates({ tracker, members, llama, arcio });
```
- [ ] **Step 4:** run the test → PASS. Then run `npx tsx scripts/ecosystem-seed.ts` → it prints the candidate count (more than 279).
- [ ] **Step 5: Commit** with message `ecosystem seed: arc.io partner list (names and arc.io pages only)`.

### Task B2: Stale announced entries

**Files:** Modify `src/lib/arc-ecosystem.ts`. Create `scripts/ecosystem-stale.ts`. Test: `src/lib/arc-ecosystem.test.ts`.

**Interfaces:** Produces `staleEntries(l: ArcEntity[], today: string, days = 90): ArcEntity[]`, which returns the announced entries whose `last_reviewed` is more than `days` before `today`.

- [ ] **Step 1: Failing test** — append:
```ts
import { staleEntries } from "./arc-ecosystem";
test("stale: announced entries not reviewed for more than 90 days", () => {
  const l = [ok({ slug: "a", status: "announced", status_evidence: [{ url: "https://www.arc.io/x" }], last_reviewed: "2026-07-01" }), ok({ slug: "b", last_reviewed: "2026-07-01" }), ok({ slug: "c", status: "announced", status_evidence: [{ url: "https://www.arc.io/x" }], last_reviewed: "2026-10-01" })];
  expect(staleEntries(l, "2026-10-20").map((e) => e.slug)).toEqual(["a"]);
});
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement:**
```ts
/** Announced entries not re-checked for more than `days` (the spec's monthly re-check: they may have gone live, or quiet). */
export function staleEntries(l: ArcEntity[], today: string, days = 90): ArcEntity[] {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - days * 86400e3;
  return l.filter((e) => e.status === "announced" && Date.parse(`${e.last_reviewed}T00:00:00Z`) < cutoff);
}
```
`scripts/ecosystem-stale.ts`:
```ts
/** Monthly: list announced entries to re-check. npx tsx scripts/ecosystem-stale.ts [YYYY-MM-DD] */
import { readFileSync } from "node:fs";
import { staleEntries, type ArcEntity } from "../src/lib/arc-ecosystem";
const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const l = staleEntries(JSON.parse(readFileSync("src/data/arc-ecosystem/entities.json", "utf8")) as ArcEntity[], today);
console.log(`${l.length} announced entries to re-check`);
for (const e of l) console.log(`${e.slug}\tlast reviewed ${e.last_reviewed}`);
```
- [ ] **Step 4:** run the test → PASS. Then run `npx tsx scripts/ecosystem-stale.ts` → `0 announced entries to re-check`.
- [ ] **Step 5: Commit** with message `ecosystem: stale-entry check for announced projects`.

### Task B3: Empty category pages are noindex

**Files:** Modify `builders-site/lib/apps-pages.ts` (`page()` gains `noindex?: boolean`) and `builders-site/lib/ecosystem-pages.ts`. Test: `builders-site/test/ecosystem-pages.test.ts`.

- [ ] **Step 1: Failing test** — append:
```ts
test("an empty category page is noindex; a non-empty one is not", () => {
  expect(renderCategory(categoryOf("banks")!, [ent()])).toContain('<meta name="robots" content="noindex">');
  expect(renderCategory(categoryOf("consumer")!, [ent()])).not.toContain('name="robots"');
});
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement:**
- In `page()`, add `noindex?: boolean` to its options and emit `${o.noindex ? '<meta name="robots" content="noindex">' : ""}` after the canonical link.
- In `renderCategory`, pass `noindex: l.length === 0`.
- [ ] **Step 4:** `npx vitest run builders-site` → PASS.
- [ ] **Step 5: Commit** with message `ecosystem: empty category pages are noindex`.

### Task B4: Draft the remaining entries in rounds

**Inputs:** the regenerated `.superpowers/arc-ecosystem/draft.json`, minus every slug already in `entities.json`, minus the five skipped candidates unless they have a new source. Rules: phase A's `drafting-rules.md`, copied into this plan's workspace, plus two additions:
- **arc.io-only candidates:** status `announced`. `status_evidence` is the candidate's arc.io page. `first_announced` comes from a press release if one names it, else it is left out.
- **DefiLlama-only candidates:** status `deployed` unless a contract on Arc is confirmed (then `live`). The DefiLlama protocol page is a source.

- [ ] **Step 1:** list the remaining candidates and split them into batches of about 13. Run rounds of 6 batches in parallel.
- [ ] **Step 2:** after each round, Claude does the review:
  - merge the batches
  - read every summary: plain facts, nothing forward-looking or promotional, no research notes
  - check categories and statuses
  - run `npx tsx scripts/ecosystem-validate.ts`
- [ ] **Step 3:** append the round to `entities.json` sorted by slug, run `npx vitest run builders-site src/lib/arc-ecosystem-data.test.ts`, and commit as `ecosystem entries round N: <count> (<live>/<deployed>/<announced>)`.

### Task B5: Preview, owner OK, production

- [ ] **Step 1:** build and deploy a preview (branch `ecosystem`) from abi-deploy, then check the counts, 5 random new entity pages, the category pages, `/api/v1/ecosystem` and the sitemap.
- [ ] **Step 2:** report to the owner with 10 spot-check URLs, and wait for the OK.
- [ ] **Step 3:** after the OK, run `scripts/deploy-builders-site.sh` and `npm run deploy`, then re-check in production.
