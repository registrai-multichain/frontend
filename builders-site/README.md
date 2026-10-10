# builders-site

The Pages Functions and config of builder.registrai.cc (Pages project `registrai-builders`).
`wrangler.toml` is the source of truth for bindings and variables; secrets live on the Pages project.
Deploy from `frontend/` with `npm run deploy:builders`.

## Bindings, variables, secrets

| Name | Kind | Used by |
|---|---|---|
| `INVITES` | KV | invites, admin sign-in nonces and sessions, the Arc Builders Index files |
| `PILOT_DB` | D1 `registrai-pilot` | ABI points pilot: accounts, positions, minute bars, latest mark |
| `ADMIN_ADDRESSES`, `ONBOARDER_ADDRESSES`, `SITE_ORIGIN`, `PROPOSALS_ALLOWED_ORIGIN` | var | admin sign-in, CSRF, CORS |
| `PILOT_OPEN` | var, default `"0"` | pilot kill switch: `"1"` accepts new orders |
| `NONCE_SECRET` | secret | sign-in nonces (admin and pilot) |
| `PILOT_SESSION_SECRET` | secret, ≥ 32 chars | pilot session cookie HMAC |
| `ABI_PUSH_TOKEN` | secret, ≥ 32 chars | Bearer of `POST /api/index`, `/api/index/seen` and `/api/index/mark` |
| `BOT_SECRET`, `RADAR_PUBLISH_SECRET` | secret | `/api/bot/*` |

## ABI points pilot

Points only: no deposits, no withdrawals, no prizes, no transfers. Spec
`docs/superpowers/specs/2026-10-10-abi-points-pilot.md`; code `lib/pilot.ts`, `lib/pilot-auth.ts`,
rules engine `src/lib/abi-pilot.ts` (a port of `research/arc-builders-index/pilot/pilot.js`).

One-time setup, from `frontend/builders-site/`:

```sh
npx wrangler d1 create registrai-pilot                      # paste database_id into wrangler.toml
npx wrangler d1 migrations apply registrai-pilot --remote   # migrations/0001_pilot.sql
openssl rand -base64 48 | npx wrangler pages secret put PILOT_SESSION_SECRET --project-name=registrai-builders
```

The mark service (`research/arc-builders-index/live/mark.py`) posts to
`https://builder.registrai.cc/api/index/mark` with `Authorization: Bearer $ABI_PUSH_TOKEN`.
Set `PILOT_OPEN = "1"` in `wrangler.toml` and redeploy to open orders; anything else closes them
(closes, reads and the mark ingest keep working).

Routes: `POST|GET /api/index/mark`, `GET|POST|DELETE /api/pilot/auth`, `GET /api/pilot/account`,
`POST /api/pilot/order`, `POST /api/pilot/close`, `GET /api/pilot/positions`, `GET /api/pilot/history`,
`GET /api/pilot/leaderboard`.

Tests run offline: the D1 double (`test/memory-d1.ts`) is Node's built-in SQLite (Node ≥ 22.13).
