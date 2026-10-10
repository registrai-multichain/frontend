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
| `PILOT_REGI_SNAPSHOT_BLOCK` | var, default `""` | REGI holding window; empty = pilot closed |
| `NONCE_SECRET` | secret | sign-in nonces (admin and pilot) |
| `PILOT_SESSION_SECRET` | secret, ≥ 32 chars | pilot session cookie HMAC |
| `ABI_PUSH_TOKEN` | secret, ≥ 32 chars | Bearer of `POST /api/index`, `/api/index/seen` and `/api/index/mark` |
| `BOT_SECRET`, `RADAR_PUBLISH_SECRET` | secret | `/api/bot/*` |

## ABI points pilot

Points only: no deposits, no withdrawals, no prizes, no transfers. Spec
`docs/superpowers/specs/2026-10-10-abi-points-pilot.md` (economy v2: §8); code `lib/pilot.ts`, `lib/pilot-auth.ts`,
`lib/pilot-sql.ts` (every guarded statement); rules engine `src/lib/abi-pilot.ts`, an exact port of
`research/arc-builders-index/pilot/pilot.js` v2 (parity tests: `test/abi-pilot-engine.test.ts`).

One-time setup, from `frontend/builders-site/`:

```sh
npx wrangler d1 create registrai-pilot                      # paste database_id into wrangler.toml
npx wrangler d1 migrations apply registrai-pilot --remote   # migrations/0001_pilot.sql
openssl rand -base64 48 | npx wrangler pages secret put PILOT_SESSION_SECRET --project-name=registrai-builders
```

Before opening, from `frontend/`, prove the changes()-guarded batches hold on the remote database (scratch
`_guard_*` tables through the real D1 binding, dropped afterwards; exit 0 = all passed):

```sh
npx tsx builders-site/scripts/d1-guard-check.mjs            # remote (wrangler login)
npx tsx builders-site/scripts/d1-guard-check.mjs --local    # dry run on a throwaway local D1
```

To open: set `PILOT_REGI_SNAPSHOT_BLOCK` (a past Arc block) and `PILOT_OPEN = "1"` in `wrangler.toml`, redeploy.
Anything else keeps new orders closed; closes, reads and the mark ingest keep working.

### Mark producer (`research/arc-builders-index/live/mark.py` v2)

`POST https://builder.registrai.cc/api/index/mark`, `Authorization: Bearer $ABI_PUSH_TOKEN`, every 5 s:
`{mark, ts, head, hour_start, candle:[o,h,l,c,payments,usdc], ch24, ch1, funding_rate, funding_hour, sigma_1h,
sigma_24h, base_pending, base_step_ts, bars:[[minute,h,l,c] …]}`.

- `ts` within 30 s of server time and newer than the stored mark (else 409, with `last_minute`).
- `bars`: 1–60, ascending, `l ≤ c ≤ h`, minutes ≤ `ts`. When the batch ends at the minute of `ts`, the mark lies
  in that bar; a full 60-bar catch-up batch may end earlier. The mark lies in the candle.
- 200 answers `{"last_minute": …}`: the newest stored minute that is already finished. The producer sends every
  bar after it, so the open minute is re-sent until it closes.
- Any missing minute between the stored bars and a post gets a gap bar: for the open hour at the posted candle's
  low and high, for an earlier hour at that hour's closed candle from the index file in KV (`abi:index`
  `candles`). An earlier hour with no candle yet is kept in `gaps`; until a later post closes it, nothing fills
  and no order is accepted ("price updating").
- `funding_rate` is stored for `funding_hour`, written once per hour (the first rate stands). `null` (fewer than
  2 closed hours) means unknown: nothing is stored and orders are refused ("price updating"). `sigma_24h`,
  `sigma_1h` and `ch1` drive the leverage cap and the pause; `sigma_24h` ≤ 0 or missing, or `sigma_1h` < 0 or
  missing, is unknown and refuses orders the same way.
- Orders pause while `base_pending` and for 60 s after `base_step_ts`.

Orders fill at the first mark whose own `ts` (chain time) is later than the order's arrival, if that mark comes
within 10 s of server time; otherwise they are refused "price updating". Nothing fills while the producer is
catching up (bars behind the mark) or a gap is open.

No hedging: a wallet holds open positions in one direction at a time (the engine refuses "one direction at a
time", shown as "Close your long first" / "Close your short first"; the fill batch re-checks it atomically).

Routes: `POST|GET /api/index/mark`, `GET|POST|DELETE /api/pilot/auth`, `GET /api/pilot/account`,
`POST /api/pilot/order` (202, pending) + `GET /api/pilot/order?id=`, `POST /api/pilot/close` (202),
`GET /api/pilot/positions`, `GET /api/pilot/history`, `GET /api/pilot/leaderboard`.

Tests run offline: the D1 double (`test/memory-d1.ts`) is Node's built-in SQLite (Node ≥ 22.13).
