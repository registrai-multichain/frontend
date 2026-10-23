# Machine-Readable Copies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Markdown copies (`<page>index.md`) of the reference pages;
- `/llms-full.txt`;
- one credit line, "Registrai, builder.registrai.cc, CC BY 4.0", in every page footer, every `/api/v1` 200 body and every
  MCP tool result.

**Architecture:**
- **Converter:** `htmlToMarkdown(html)` turns the `<main>` of any page we render into Markdown. Our pages use a small,
  known tag set.
  - **Ruling, planned:** the spec asked for one Markdown module per area. A single converter over the real HTML
    guarantees "same facts as the HTML" by construction, with far less code. The Markdown is therefore a superset: it
    also contains the activity and facts blocks the spec meant to leave out. That costs a larger file, not wrong facts.
- **Routes:** the three page functions (`ecosystem`, `arc`, `methodology`) answer `…/index.md` by rendering the HTML as
  they do now and converting it, with the same status codes.
- **Discovery:** `page()` adds the `alternate` link.
- **Credit line:** `v1Json` adds `attribution`.
- **`/llms-full.txt`:** concatenates converted pages plus one line per project.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-machine-readable-copies-design.md`

## Global Constraints

- **Credit line:** `ATTRIBUTION = "Registrai, builder.registrai.cc, CC BY 4.0"`.
- **Markdown responses:**
  - `content-type: text/markdown; charset=utf-8`;
  - `x-content-type-options: nosniff`;
  - the same cache TTL and status as the HTML;
  - GET and HEAD only;
  - `…/index.md` is exempt from the trailing-slash 301.
- **Every Markdown file:**
  - starts with `# <h1>`;
  - ends with `Source: <canonical URL> · ${ATTRIBUTION}`.
- **`/llms-full.txt`:** `text/plain; charset=utf-8`, cached for 3600 s, under 300 KB with the real data. Its live
  `/arc/` section has a 10 s deadline and never fails the file.
- **API:** `attribution` is added after `version` in every 200 body from `v1Json`. Errors are unchanged. The fixtures
  gain the field, and the shape tests stay exact.
- **Markdown escaping:** in text, escape `\ * _ [ ] |` (and `` ` ``). Decode HTML entities first. No raw HTML in the
  output.
- **Deploys:** only from `abi-deploy`. Production only with the owner's OK.

## Review Focus

1. Every `alternate` link resolves (200 `text/markdown`). Test: Task 3.
2. A name with `|` or `*` doesn't break a table or turn into bold. Test: Task 2.
3. 404 and 410 parity for `.md`. Test: Task 3.
4. Shape tests stay exact with `attribution`, and 304/ETag still work. Test: Task 1.
5. `llms-full.txt` is under 300 KB with the real 258 entries, and an `/arc/` failure doesn't fail it. Test: Task 4.

---

### Task 1: The credit line (footer, API, MCP)

**Files:**
- Create: `builders-site/lib/attribution.ts`
- Modify:
  - `builders-site/lib/data-api.ts` (`v1Json`)
  - `builders-site/lib/apps-pages.ts` (footer)
  - `builders-site/lib/mcp.ts`: tool results built outside `viaApi` gain `attribution`
  - every JSON fixture in `docs/superpowers/specs/data-api-v1-fixtures/` except `error-503.json`: add
    `"attribution": "Registrai, builder.registrai.cc, CC BY 4.0"` after `"version"`
- Test: `builders-site/test/attribution.test.ts`

**Steps:**
1. **Test:**
   - `v1Json` body has `attribution` (exactly the constant), and a second request with the returned ETag gets 304;
   - `v1Error` bodies have no `attribution`;
   - `page()` HTML contains `Data: Registrai, builder.registrai.cc, CC BY 4.0`;
   - the MCP `tools/call` for `arc_numbers` and for `arc_apps` (built outside `viaApi`) returns
     `structuredContent.attribution`, or the JSON text contains it.
2. **Run:** FAIL.
3. **Implement:**
   - `export const ATTRIBUTION = "Registrai, builder.registrai.cc, CC BY 4.0";`
   - in `v1Json`: `JSON.stringify({ version: 1, attribution: ATTRIBUTION, ...body })`. A body that already has `version`
     keeps its own value, as today.
   - footer `Data: ${esc(ATTRIBUTION)}`;
   - MCP: add `attribution: ATTRIBUTION` where `arc_app` and `arc_apps` build `data`.
   - fixtures: a one-off script that inserts the key after `version`.
4. **Run:**
   ```
   npx vitest run builders-site/test/attribution.test.ts builders-site/test/data-api*.test.ts builders-site/test/mcp.test.ts src/lib/data-api-openapi.test.ts src/lib/data-api-docs.test.ts
   ```
   PASS. Then the full suite. Any shape test that compares keys with a fixture passes because the fixture has the key.
5. **Commit:** "attribution: one credit line in the footer, every v1 body and MCP results".

### Task 2: `htmlToMarkdown`

**Files:**
- Create: `builders-site/lib/markdown.ts` and `builders-site/test/markdown.test.ts`

**Interfaces:**
- **Produces:** `htmlToMarkdown(html: string, canonical: string): string`
  - takes a full page from `page()`;
  - converts only `<main>`, without `<nav>` and `<footer>`;
  - appends `\n\nSource: <canonical> · ${ATTRIBUTION}\n`.

**Rules,** applied by a small tokenizer over our own HTML (no external parser):

| HTML | Markdown |
|---|---|
| `<h1>`…`<h3>` | `#`…`###` with a blank line after |
| `<p>` | a paragraph with a blank line after |
| `<br>` | a newline |
| `<a href>` | `[text](href)`; a relative href becomes absolute on `https://builder.registrai.cc` |
| `<ul>/<ol><li>` | `- ` and `1. ` lines |
| `<table>` | a pipe table. The header comes from `<thead><th>`, or from the first row. `\|` inside cells is escaped, and newlines in a cell become spaces |
| `<dl><dt><dd>` | `**term**: definition` lines |
| `<details><summary>i</summary>X</details>` | `(i: X)` inline |
| `<code>` | `` `x` `` |
| `<b>/<strong>` | `**x**` |

**Dropped:**
- `<script>`, `<style>`, `<form>`, `<svg>`, `<nav>` and `<footer>`;
- every other tag (its text is kept).

**Text handling:**
- HTML entities are decoded (`&amp; &lt; &gt; &quot; &#39; &nbsp;`, numeric).
- Markdown specials in text nodes are escaped.
- Runs of 3 or more blank lines collapse to 2.

**Steps:**
1. **Test** with a fixture page built by `page()`:
   - h1/h2;
   - a paragraph with a link (relative → absolute);
   - a table whose name cell is `A|B *bold*` → `A\|B \*bold\*`;
   - a list;
   - a `dl`;
   - an "i" details note;
   - a `<script>` and the nav and footer absent;
   - `&amp;` → `&`;
   - it ends with the Source line;
   - no `<` tag survives (`/<[a-z]/i` doesn't match).
2. **Run:** FAIL.
3. **Implement** a regex tokenizer: split into tags and text; keep a stack for list or table state; build strings.
4. **Run:** `npx vitest run builders-site/test/markdown.test.ts`, PASS.
5. **Commit:** "markdown: htmlToMarkdown for our own pages".

### Task 3: `…/index.md` routes and the `alternate` link

**Files:**
- Modify:
  - `builders-site/lib/apps-pages.ts`: `page()` gains an optional `markdown?: string` (a path), emitting
    `<link rel="alternate" type="text/markdown" href="…">`
  - the renderers that render reference pages pass it:
    - `renderEntity`, `renderDirectory`, `renderCategory`;
    - `renderCorrectionsLog`;
    - `renderArc` and the four question renderers;
    - `renderMethodology`
  - `builders-site/functions/ecosystem/[[path]].ts`, `functions/arc/[[path]].ts` and
    `functions/methodology/[[path]].ts`
- Test: `builders-site/test/markdown-routes.test.ts`

**Route change, the same in all three functions:**
- **Before the trailing-slash 301,** detect `url.pathname.endsWith("/index.md")`.
- **If it is a Markdown request:**
  1. Strip `index.md` from the path parts.
  2. Run the existing HTML path, without the HEAD body.
  3. Take the HTML response's status and body.
  4. If the status is 200, 404 or 410, answer with the same status and body
     `htmlToMarkdown(body, canonical-from-path)`, `text/markdown`, and the HTML response's cache-control. Otherwise pass
     it through.
- **Edge cache:** the Markdown variant uses its own variant key (`md:` prefix) so HTML and Markdown never collide.
- **Directory status filter:** `/ecosystem/index.md?status=live` keeps working (the query passes through).

**Steps:**
1. **Test,** with mocked `ECOSYSTEM`/`CORRECTIONS` like the existing route tests:
   - `/ecosystem/index.md`, `/ecosystem/dexs/index.md`, `/ecosystem/aave/index.md`,
     `/ecosystem/corrections/index.md`, `/arc/index.md`, `/arc/get-usdc/index.md` and `/methodology/index.md` each give
     200, `text/markdown`, and start with `# `;
   - each HTML page contains `rel="alternate" type="text/markdown" href="<its path>index.md"`, and that path resolves to
     200;
   - `/ecosystem/nobody/index.md` gives 404 and `/ecosystem/<removed>/index.md` gives 410;
   - `/arc/index.md` with fetch stubbed offline still gives 200;
   - HEAD gives an empty body.
2. **Run:** FAIL.
3. **Implement.**
4. **Run:**
   ```
   npx vitest run builders-site/test/markdown-routes.test.ts builders-site/test/ecosystem-route.test.ts builders-site/test/corrections-*.test.ts builders-site/test/arc-*.test.ts builders-site/test/methodology-page.test.ts
   ```
   PASS.
5. **Commit:** "markdown: <page>index.md copies of the reference pages, linked as alternate".

### Task 4: `/llms-full.txt`

**Files:**
- Create:
  - `builders-site/lib/llms-full.ts`: `buildLlmsFull(env, deps, now): Promise<string>`
  - `builders-site/functions/llms-full.txt.ts`
  - `builders-site/test/llms-full.test.ts`
- Modify: `builders-site/functions/llms.txt.ts` and `public/llms.txt` (one line)

**Content:**
1. **Header:** `# Registrai: Arc ecosystem data (full reference)`, `${ATTRIBUTION}`, `Updated <YYYY-MM-DD HH:MM UTC>`, and
   pointers to `/llms.txt` and `https://github.com/registrai-multichain/arc-ecosystem`.
2. **Methodology:** `htmlToMarkdown(renderMethodology(...))`, with the AEI params and the share as in its route.
3. **Arc in numbers:** `htmlToMarkdown(renderArc(collectArcNumbers(env, fetch, now, {deadlineMs: 10_000}), history7))`.
   On any throw, `## Arc in numbers\n\nNot available right now.`
4. **The four question pages,** converted, using `loadArcWeek`.
5. **`## Projects`:** one line per entity sorted by name:
   `- **<name>** (<category name>, <status label>): <summary> <website?> — https://builder.registrai.cc/ecosystem/<slug>/`,
   with Markdown specials escaped.

**Route:** GET and HEAD only, edge-cached for 3600 s, `text/plain; charset=utf-8`.

**Steps:**
1. **Test:**
   - with mocked data: the header and attribution are present, all mocked projects are listed, and the `/arc/` section
     says "Not available right now" when the collector throws;
   - with the real `ECOSYSTEM` (no mock, in a separate test file section): the length is under 300,000 bytes and there
     are 258 project lines;
   - `llms.txt` and `public/llms.txt` contain `https://builder.registrai.cc/llms-full.txt`.
2. **Run:** FAIL.
3. **Implement.**
4. **Run:** `npx vitest run builders-site/test/llms-full.test.ts builders-site/test/apps-routes.test.ts`, PASS.
5. **Commit:** "llms-full.txt: the full reference in one file".

### Task 5: Full suite, preview, production

- **Full suite:**
  - `npx vitest run` passes, apart from the known drafts test;
  - typecheck is clean;
  - lint shows only the existing warning.
- **Preview** (branch `markdown`). Check:
  - `/ecosystem/aave/index.md`, `/arc/index.md` and `/methodology/index.md` read well;
  - `/llms-full.txt` is under 300 KB;
  - `/api/v1/arc` has `attribution`.
- **Production,** with the owner's OK. Then:
  - IndexNow ping for `/llms-full.txt`;
  - push to PR #1.
