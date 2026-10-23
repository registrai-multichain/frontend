# Machine-readable copies: Markdown pages, llms-full.txt, one credit line: design

**Date:** 2026-10-23. **Status:** approved in chat 2026-10-23 (owner: "Go build it"); written spec awaiting review.

## Purpose

Make every reference page easy for agents and crawlers to read and quote:
- **Markdown copies** of the reference pages;
- **one file with the whole reference** (`/llms-full.txt`, as llmstxt.org describes);
- **one exact credit line** on every page, every API response and every MCP reply.

The daily CSV is already published by `registrai-multichain/arc-ecosystem`.

**Success:**
- An agent can fetch any reference page as Markdown with the same facts as the HTML.
- `/llms-full.txt` holds every project.
- The string "Registrai, builder.registrai.cc, CC BY 4.0" appears on every page, in every `/api/v1` JSON body and in every
  MCP tool result.

**Out of scope:**
- Markdown for `/apps/…` app pages, which redirect to entity pages when claimed;
- Markdown for `/project/…` pages;
- the daily CSV (already in the data repo).

## 1. Markdown copies

**URL rule:** the HTML page URL plus `index.md`.

| HTML | Markdown |
|---|---|
| `/ecosystem/` | `/ecosystem/index.md` |
| `/ecosystem/<category>/` | `/ecosystem/<category>/index.md` |
| `/ecosystem/<slug>/` | `/ecosystem/<slug>/index.md` |
| `/ecosystem/corrections/` | `/ecosystem/corrections/index.md` |
| `/arc/` | `/arc/index.md` |
| `/arc/<question>/` | `/arc/<question>/index.md` |
| `/methodology/` | `/methodology/index.md` |

**Routing:**
- The `.md` path is served by the same Pages Function as its page, exempt from the trailing-slash 301.
- **Response:** `content-type: text/markdown; charset=utf-8`, `x-content-type-options: nosniff`.
- **Caching:** the same edge TTL as the HTML page.
- **Errors:** 404 when the page would answer 404, and 410 for a removed entity.
- **Methods:** GET and HEAD only.

**Content:** each Markdown file comes from the same data as its HTML renderer, in one new module per area. Every file:
- **opens** with `# <page h1>`, then the page's dated first sentence (data pages) or its status line (entity pages);
- **ends with** "Source: <canonical HTML URL> · Registrai, builder.registrai.cc, CC BY 4.0 · Updated <date>".

**Per-page content:**
- **Entity:**
  - status;
  - category and tags;
  - last reviewed date;
  - summary;
  - links (website, X, GitHub, docs);
  - first announced and first live dates;
  - status evidence (links);
  - contracts on Arc (role, address, source);
  - sources (numbered);
  - the correction count line when there is one.

  The activity and facts blocks of the HTML page are left out; they live on the HTML page.
- **Directory and category:** the counts line, then a Markdown table with Project, Category, Status and Live since.
  Project links point to the HTML pages.
- **Corrections log:** a Markdown table with the same columns as the HTML.
- **`/arc/`:** each section as a two-column table with figure and value, with source and as-of. Then the timeline. The
  history table is left out (it's in the API).
- **Question pages:** the opening sentence, then the tables as Markdown, with the source line.
- **Methodology:** the glossary as `**Term**: definition` lines, then sources, attributed share, limits and changelog.

**HTML link:** each of these HTML pages gains, in `<head>`,
`<link rel="alternate" type="text/markdown" href="<path>index.md">`. It is added through a new optional `markdown` field
of `page()`.

## 2. `/llms-full.txt`

**Route:** a Pages Function, `functions/llms-full.txt.ts`.
- `text/plain; charset=utf-8`
- edge-cached for 3600 s
- GET and HEAD only

**Content, in order:**
1. **Header:** "# Registrai: Arc ecosystem data (full reference)", the credit line, "Updated <date>", and a pointer to
   `/llms.txt` and the data repo.
2. **Methodology:** the Markdown copy, with the share line.
3. **Arc in numbers:** the Markdown copy, live, using the same collector as `/arc/`. If it fails, the section says "Not
   available right now".
4. **The four question pages:** their Markdown copies.
5. **Projects:** one line per entity, sorted by name:
   `- **<name>** (<category>, <status>): <summary> <website> — https://builder.registrai.cc/ecosystem/<slug>/`

**Size target:** under 300 KB. A test checks the size with the real 258-entry file.

**Discoverability:** `/llms.txt` (the function and `public/llms.txt`) gains the line
`- [Full reference](https://builder.registrai.cc/llms-full.txt): every project, the method, Arc in numbers and the question pages in one file`.

## 3. One credit line

**Constant:** `ATTRIBUTION = "Registrai, builder.registrai.cc, CC BY 4.0"` in `builders-site/lib/attribution.ts`.

**Where it appears:**
- **Pages:** the `page()` footer's "Data: Registrai, CC BY 4.0" becomes `Data: ${ATTRIBUTION}`.
- **API:**
  - `v1Json` adds `attribution: ATTRIBUTION` to every 200 JSON body, after `version`.
  - Errors (`v1Error`) are unchanged.
  - The ETag covers the new body.
- **OpenAPI:** every 200 schema gains a required `attribution` string. It is added centrally where `op()` builds
  responses, or by adding the field to every fixture. The fixtures are updated so the shape tests stay exact.
- **MCP:** tool results come through `viaApi`, so they carry `attribution` already. Tool results built outside
  `viaApi` (`arc_app`, `arc_apps`) gain it explicitly.

**Compatibility:** an added field only. No existing field changes.

## Files

- **New:**
  - `builders-site/lib/attribution.ts`
  - `builders-site/lib/markdown-pages.ts`: entity, directory, category, corrections, arc, question pages, methodology,
    built by calling the existing data helpers
  - `builders-site/functions/llms-full.txt.ts`
  - `builders-site/lib/llms-full.ts`
  - tests `builders-site/test/markdown-pages.test.ts`, `builders-site/test/llms-full.test.ts` and
    `builders-site/test/attribution.test.ts`
- **Changed:**
  - `functions/ecosystem/[[path]].ts`, `functions/arc/[[path]].ts` and `functions/methodology/[[path]].ts`: the `.md`
    branch and the slash exemption
  - `lib/apps-pages.ts`: `page()` gains the `markdown` field, and the footer uses the credit line
  - the renderers that call `page()`: pass `markdown`
  - `lib/data-api.ts`: `v1Json`
  - `lib/mcp.ts`
  - `src/lib/data-api-openapi.ts` and the fixtures
  - both `llms.txt` files

## Review focus

1. **Every `alternate` link resolves.** For each page type, a test fetches the linked `.md` through the route and gets
   200 `text/markdown`.
2. **Same facts, no escaping bugs.** Markdown copies hold no raw HTML. An entity name containing `|` or `*` doesn't
   break a table or turn into bold: Markdown special characters in table cells are escaped.
3. **404 and 410 parity:** an unknown slug's `.md` is 404, and a removed slug's `.md` is 410.
4. **The API shape tests stay exact** with `attribution` in every fixture. 304 and ETag still work.
5. **`llms-full.txt` size and CPU:**
   - built once per hour per colo (edge cache);
   - the live `/arc/` collection inside it has its own 10 s deadline;
   - a failure there never fails the file.
