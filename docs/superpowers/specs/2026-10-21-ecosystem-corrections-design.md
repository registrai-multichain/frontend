# Ecosystem corrections: design

**Date:** 2026-10-21. **Status:** approved in chat 2026-10-21 (owner: "Yes go"); written spec awaiting review.

## Purpose

Anyone, and in particular the 258 organisations listed in the Arc ecosystem directory, can report a wrong or
outdated fact on their `/ecosystem/<slug>/` page.

- Nothing changes until the owner approves.
- Approved corrections appear in a public log.

**Why it matters:**
- **Outreach:** the note to listed projects ("you're listed, here's your page, tell us if anything's wrong") needs
  somewhere to send people.
- **Trust:** each fix makes the directory more trustworthy.
- **A citable record:** a public log of fixes is itself something others can cite.

**Success:**
- A visitor without a wallet or an account can send a correction in under a minute.
- The owner sees it in `/admin`.
- An approved correction is live within the day.
- Every applied change is in git history and in the public log.

**Decisions taken in chat (2026-10-21):**
- **Sender check:** email plus Cloudflare Turnstile. No wallet signature; most listed organisations have no Arc wallet.
- **Email:** not confirmed. We send no email. The queue shows whether the email's domain matches the project's
  website, and the owner replies from contact@registrai.cc when it matters.
- **Publishing:** through the data file. An approved correction is applied to `src/data/arc-ecosystem/entities.json`,
  validated like every entry, logged in `src/data/arc-ecosystem/corrections.json`, and deployed. There is no runtime
  overlay.

**Out of scope:**
- confirmation emails;
- self-service edits that skip review;
- corrections to `/apps/` metrics or index data (method questions stay with the owner);
- notifications beyond the `/admin` count.

## Copy rules

- **Labels:** plain, with no slogans.
- **The disclosure** is visible inline next to the submit button, not hidden behind an "i":
  "We use your email only to reply about this correction. Approved corrections are published without your name or
  email."
- **Results:** the success page says "Received" and when to expect review ("We review corrections within 7 days."),
  then links back to the project.

## 1. The form

### Route and fallback

- **Page:** `GET /ecosystem/<slug>/correct/`, served by the existing `functions/ecosystem/[[path]].ts`. It returns 404
  for an unknown slug and 301s `/ecosystem/<slug>/correct` to the trailing-slash form.
- **The form** POSTs to `/api/ecosystem/corrections` as `application/x-www-form-urlencoded`, so it works without
  JavaScript.
- **Turnstile** is the only script: `https://challenges.cloudflare.com/turnstile/v0/api.js`, with the widget's site
  key from `TURNSTILE_SITE_KEY`.
- **If either `TURNSTILE_SITE_KEY` or `TURNSTILE_SECRET` is unset,** the page shows no form. It shows the existing
  `mailto:contact@registrai.cc?subject=…` link instead, and the API answers 503.

### Fields

| Field | Name | Rule |
|---|---|---|
| What's wrong | `field` | One of `summary`, `status`, `links` (website, X, GitHub, docs), `category`, `contracts`, `dates`, `sources`, `removal`, `other` |
| Correction | `text` | 10–1,000 characters after trimming |
| Source link | `source_url` | Optional `https` URL with no credentials, up to 500 characters. Required when `field` is `status`, `contracts` or `dates` |
| Email | `email` | Required. A simple shape check (`local@domain.tld`), up to 254 characters |
| Name and role | `name` | Optional, up to 100 characters |
| (hidden) | `slug` | Must be an existing entity slug |
| (Turnstile) | `cf-turnstile-response` | Required |

### Project page link

- **Replace** the project page's "Report an error" `mailto:` link with "Suggest a correction", pointing to
  `/ecosystem/<slug>/correct/`.
- **Remove** the "Ask for removal" link. Removal is the `removal` option in the form.
- **Keep both `mailto:` links** when Turnstile is not configured. The renderer gets a `correctionsOpen` flag.

## 2. The API and storage

### `POST /api/ecosystem/corrections`

**Request checks:**
- Same-origin only, using the existing `csrfFailure` check.
- Maximum body size: 4 KB.

**Validation, in this order:**
1. **Body and fields:** body size, then each field. Failure → 400.
2. **Rate limits:** failure → 429.
   - 5 per IP per hour, keyed by an HMAC of the IP. This reuses the suggestions pattern, `NONCE_SECRET`, with the
     prefix `correct:`.
   - 3 per email per day.
   - The limits use KV `INVITES` keys `correct-rl:<iphash>` and `correct-em:<sha256(email)>`, with TTL counters.
3. **Turnstile:** checked at `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `TURNSTILE_SECRET`,
   the token and the IP. Failure → 400 "Anti-bot check failed, try again."

**Success:**
- Insert one row and answer 303 to `/ecosystem/<slug>/correct/?sent=1`. That page shows "Received".
- A request with `Accept: application/json` gets `201 {id}` instead.

**Errors:**
- The form page shows the error message above the form, via a 303 to `?error=<code>`. Codes map to fixed messages.
  User input is never echoed in the URL.

**Other routes:**
- `GET /api/ecosystem/corrections` → 405.
- There is no public read of submissions.

### D1 table (migration `migrations-data/0004_corrections.sql`, database `registrai-data`)

```sql
CREATE TABLE corrections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL,
  field         TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  source_url    TEXT,
  email         TEXT,                -- NULL after the retention period
  name          TEXT,
  domain_match  INTEGER NOT NULL,    -- 1 if the email's domain is the website's registrable domain or a subdomain of it
  ip_hash       TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'open',   -- open | approved | rejected | applied
  public_note   TEXT,                -- the owner's one-line public description, set on approval
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_by    TEXT,                -- admin wallet address
  applied_at    INTEGER
);
CREATE INDEX corrections_status ON corrections(status, created_at);
```

### `domain_match`

- **Value 1** when the email's domain equals the entity `website` host, ignoring a leading `www.`, or ends with
  `.` + that host.
- **Value 0** when the entity has no website or the domains differ.
- **It is a hint, not proof.** The email is never confirmed.

### Retention

- **What gets cleared:** `email`, `name` and `ip_hash`.
- **When:** 30 days after `decided_at`. These are set to NULL and the empty string respectively.
- **How:** by the same daily `waitUntil` job that writes the Arc snapshot, after the 00:00 UTC AEI push. It runs best
  effort and never fails the push.
- **Open items are never purged.**

## 3. Review in `/admin`

**API:** `functions/api/admin/corrections.ts`, behind the existing `_middleware.ts` admin gate and its CSRF checks.
- **`GET`:** lists open items first, then the last 50 decided. Each item has every column except `ip_hash`.
- **`POST {id, decision: "approve" | "reject", public_note?}`:**
  - **Approve** needs `public_note`, 5–200 characters.
  - **A decided item can't be decided again.** Answer 409.
  - **Records:** `decided_at` and `decided_by`.

**UI:** a "Corrections" section in `src/components/admin/AdminApp.tsx`, as a new rail entry. Each open item shows:
- the project, linked to its page;
- the field;
- the text;
- the source;
- the email, name and date;
- a tag: "domain matches project website (not confirmed)", or nothing.

The actions are:
- **Approve:** a text input for the public note, prefilled with the first 200 characters of the text.
- **Reject.**

The rail entry shows the count of open items. Both roles (`admin`, `onboarder`) can view; only `admin` can decide.

## 4. Applying approved corrections

The script is `scripts/ecosystem-corrections.ts`, run locally with the owner's wrangler login.

| Command | What it does |
|---|---|
| `list` | Runs `npx wrangler d1 execute registrai-data --remote --json` and prints approved, unapplied rows: id, slug, field, text, source, public note |
| `mark-applied <id…>` | Sets `status='applied'` and `applied_at` for those ids, only where the status is `approved` |

**Applying is an editing step, not automatic.** The engineer edits `entities.json` and sets that entity's
`last_reviewed` to today. They then append one entry per correction to `src/data/arc-ecosystem/corrections.json`:

```json
{ "id": 12, "date": "2026-10-22", "slug": "visa", "field": "summary",
  "change": "Summary now says the pilot settles in USDC on Arc.", "source": "https://…", "from": "project" }
```

**Entry rules:**
- **`from`:** `project` when `domain_match` was 1, otherwise `reader`.
- **`change`:** the approved `public_note`, which the owner wrote or approved.
- **Removals:** delete the entity and add a log entry with `"field": "removal"`. The project page answers 410 for a
  removed slug that has a log entry.

**Then:** `npx tsx scripts/ecosystem-validate.ts`, the tests, a commit and a deploy from `abi-deploy`. After that,
`mark-applied`.

**Validation:**
- **Function:** `validateCorrections(list, entities)`, in `src/lib/arc-ecosystem-corrections.ts`.
- **When it runs:** in the build, next to `validateEntities`.
- **What it checks:**
  - unique ids
  - `date` as `YYYY-MM-DD`
  - a known `field`
  - `change` of 5–200 characters
  - an `https` `source` or none
  - `from` in `project | reader`
  - `slug`: either an existing entity, or a removed one with a `removal` entry

## 5. The public log

**`/ecosystem/corrections/`:**
- **Content:** a table, newest first, with columns date, project (linked, or plain text if removed), field, change,
  source, from.
- **Opening line:** "Corrections to the Arc ecosystem directory, newest first. Suggest one from any project page."
- **Feed:** a JSON link.
- **JSON-LD:** `ItemList`.
- **Sitemap:** included, with lastmod set to the latest date.

**`GET /api/v1/ecosystem/corrections`:**
- **Response:** `{version: 1, corrections: [...]}`, newest first.
- **Docs:** in the OpenAPI file and `/data-api/` docs, with fixture
  `docs/superpowers/specs/data-api-v1-fixtures/ecosystem-corrections.json`.

**Project pages:** a muted line under Sources, "Corrected N times · latest DATE", linking to
`/ecosystem/corrections/#<slug>`. Pages without corrections show no line.

**Reserved slug:** add `corrections` to the slug words `validateEntities` rejects.

**Not changed:** the MCP tools. `arc_entity` keeps returning the entity, which already carries `last_reviewed`.

## Files

- **New:**
  - `builders-site/lib/corrections.ts`: form parsing, validation, `domain_match`, rate limit, Turnstile, insert, admin
    list and decide, purge
  - `builders-site/lib/corrections-pages.ts`: form page, received page, log page
  - `builders-site/functions/api/ecosystem/corrections.ts`
  - `builders-site/functions/api/admin/corrections.ts`
  - `builders-site/functions/api/v1/ecosystem/corrections.ts`, or a branch in the existing ecosystem v1 route
  - `builders-site/migrations-data/0004_corrections.sql`
  - `src/lib/arc-ecosystem-corrections.ts`
  - `src/data/arc-ecosystem/corrections.json` (starts as `[]`)
  - `scripts/ecosystem-corrections.ts`
  - tests next to each
- **Changed:**
  - `functions/ecosystem/[[path]].ts`: the `correct/` and `corrections/` routes, and 410 for removed slugs
  - `lib/ecosystem-pages.ts`: link and count line
  - `lib/env.ts`: `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`
  - `lib/data-api-ingest.ts`: adds 0004 to `DATA_MIGRATIONS`
  - `lib/builders-index.ts`: purge in the daily `later`
  - `src/lib/arc-ecosystem.ts`: the reserved word
  - `AdminApp.tsx`
  - `sitemap-urls.ts`
  - the docs and OpenAPI files
  - the build validation step

## Owner steps

1. **Create a Turnstile widget** in the Cloudflare dashboard (free). Use hostname `builder.registrai.cc` and Managed
   mode.
2. **Set the keys** on the `registrai-builders` Pages project:
   - `TURNSTILE_SITE_KEY` (public) as a variable;
   - `TURNSTILE_SECRET` as a secret.
3. **Apply the migration:** approve `npx wrangler d1 migrations apply registrai-data --remote`, which applies 0004.

## Review focus

1. **No Turnstile keys:** the form page and the project page fall back to `mailto:`, and nothing 500s.
2. **Hostile input:**
   - HTML or script in `text` or `name` is escaped everywhere, both in `/admin` and on the log;
   - oversized bodies get 400;
   - a non-https or `javascript:` source is refused;
   - an unknown slug or field gets 400.
3. **Double submit or replay:**
   - the same Turnstile token is single-use on Cloudflare's side;
   - the rate limits cap one IP and one email;
   - deciding an item twice gets 409.
4. **Privacy:**
   - emails and IP hashes never appear in a public response, page or log;
   - they are cleared 30 days after the decision;
   - error redirects carry codes, not user input.
5. **Removed entity:** the page answers 410 with a link to its log entry, the sitemap drops it, and the
   `/apps/` → `/ecosystem/` 301 for that app falls back to the `/apps/` page.
