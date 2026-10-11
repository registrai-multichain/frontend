# builders-site

The Pages Functions and config of builder.registrai.cc (Pages project `registrai-builders`).
`wrangler.toml` is the source of truth for bindings and variables; secrets live on the Pages project.
Deploy from the checkout of the commit you mean to ship with `npm run deploy:builders`. Both
`scripts/build-builders-site.sh` and `scripts/deploy-builders-site.sh` refuse uncommitted changes to tracked files;
the build refuses an `out/` older than the last commit ("run npm run build first"), the deploy a `dist-builders`
older than `out/` or than the last commit, and it prints the commit it deploys.

## Bindings, variables, secrets

| Name | Kind | Used by |
|---|---|---|
| `INVITES` | KV | invites, admin sign-in nonces and sessions, the Arc Builders Index files |
| `PILOT_DB` | D1 `registrai-pilot` | ABI points pilot: accounts, positions, minute bars, latest mark |
| `ADMIN_ADDRESSES`, `ONBOARDER_ADDRESSES`, `SITE_ORIGIN`, `PROPOSALS_ALLOWED_ORIGIN` | var | admin sign-in, CSRF, CORS |
| `PILOT_OPEN` | var, default `"0"` | pilot kill switch: `"1"` accepts new orders |
| `PILOT_REGI_SNAPSHOT_BLOCK` | var, default `""` | REGI holding window: a block in the past, ≥ 22,419,071 (REGI's deploy); with `PILOT_OPEN = "1"`, empty / malformed / future / pre-REGI = "pilot misconfigured" (every order refused, logged once per isolate) |
| `PILOT_REGI_MIN` | var, default `"1000000"` | whole REGI a wallet must hold at the snapshot block and now |
| `PILOT_MAX_LEV` | var, default `"10"` | the pilot's leverage cap after the engine's (ticket, `POST /api/pilot/order`, `maxLev` in `/api/index/mark`) |
| `PILOT_BLOCKED_WALLETS` | var, default `""` | comma-separated lowercase wallets that may not open positions (milestone recorders); closes still work |
| `NONCE_SECRET` | secret | sign-in nonces (admin and pilot) |
| `PILOT_SESSION_SECRET` | secret, ≥ 32 chars | pilot session cookie HMAC |
| `ABI_PUSH_TOKEN` | secret, ≥ 32 chars | Bearer of `POST /api/index`, `/api/index/seen`, `/api/index/contracts` (and the AII / AEI ones) and `/api/index/mark`. An index file older than the stored one (`data_until`), or a seen file or contract map older than the stored one (`hour_start`), is refused with 409; the same value is accepted again |
| `BOT_SECRET`, `RADAR_PUBLISH_SECRET` | secret | `/api/bot/*` |

## ABI points pilot

Points only: no deposits, no withdrawals, no prizes, no transfers. Spec
`docs/superpowers/specs/2026-10-10-abi-points-pilot.md` (economy v3: §9, §9.13; site plan
`docs/superpowers/plans/2026-10-10-abi-pilot-v3-site.md`); code `lib/pilot.ts`, `lib/pilot-auth.ts`,
`lib/pilot-sql.ts` (every guarded statement); rules engine `src/lib/abi-pilot.ts`, an exact port of
`research/arc-builders-index/pilot/pilot.js` v3 (parity tests: `test/abi-pilot-engine.test.ts`, every vector of
`fixtures-v3.json`; the economy on the site: `test/pilot-v3.test.ts`).

Economy v3 (with the §9.14 rulings): hourly skew + trend funding, fixed once per hour from the book time-weighted
over the closing hour (`rates`); borrow at 10% APR; levels to 30×; the house as the counterparty to the net imbalance
(`house_hours`: price, funding and true-up lines); an append-only points ledger (`ledger`, totals in `pools`); an
insurance pool that never goes below zero (a gap beyond its balance is a carried house loss); and a weekly split
(`splits`, Monday 00:00 UTC: 20% insurance, 80% treasury, half of it earmarked for the buyback) of fees, borrow, the
funding cut and the house's realized result only. All in points. Opens and closes wait for each hour's rates.
Milestone premium (§9.15, audit PE-2): longs also pay the trailing 30-day mean hourly log milestone step
(`milestone_premium` from the producer, stored in `rates.premium`, part of the long rate); the house collects it in
its funding line.

One-time setup, from `frontend/builders-site/`:

```sh
npx wrangler d1 create registrai-pilot                      # paste database_id into wrangler.toml
npx wrangler d1 migrations apply registrai-pilot --remote   # migrations/0001_pilot.sql, 0002_pilot_v3.sql, 0003_pilot_premium.sql
openssl rand -base64 48 | npx wrangler pages secret put PILOT_SESSION_SECRET --project-name=registrai-builders
```

Before opening, from `frontend/`, prove the guarded batches hold on the remote database (scratch
`_guard_*` tables through the real D1 binding, dropped afterwards; exit 0 = all passed):

```sh
npx tsx builders-site/scripts/d1-guard-check.mjs            # remote (wrangler login)
npx tsx builders-site/scripts/d1-guard-check.mjs --local    # dry run on a throwaway local D1
```

To open: set `PILOT_REGI_SNAPSHOT_BLOCK` (an Arc block in the past, taken before the opening is announced) and
`PILOT_OPEN = "1"` in `wrangler.toml`, check `PILOT_REGI_MIN`, `PILOT_MAX_LEV` and `PILOT_BLOCKED_WALLETS`, redeploy.
`PILOT_OPEN` anything but `"1"` keeps new orders closed; a wrong setting with `"1"` refuses them as "pilot
misconfigured" (the ticket shows it). Closes, reads and the mark ingest keep working either way.

Sign-in (`POST /api/pilot/auth`): the body, the message, the nonce's MAC and age, the origin and the issue time
are checked before any D1 statement; then 10 sign-ins a minute per IPv4 address or IPv6 /64 (a refused one writes
nothing); then the signature. `GET /api/pilot/account` without a session only reads.

Limits per wallet: 30 orders and 60 closes a minute, at most 3 orders pending at once, 5 open positions (queued opens
count). One mark ingest runs at most 800 statements in all (reads and batch statements: the safety-net
liquidations first, then its batch, then the fills); what does not fit waits for the next post, and nothing fills
while liquidations are held back.

### Mark producer (`research/arc-builders-index/live/mark.py` v3)

`POST https://builder.registrai.cc/api/index/mark`, `Authorization: Bearer $ABI_PUSH_TOKEN`, every 5 s:
`{mark, ts, head, hour_start, candle:[o,h,l,c,payments,usdc], ch24, ch1, trend, funding_rate, funding_hour, sigma_1h,
sigma_24h, milestone_premium, base_pending, base_step_ts, milestone_ts, bars:[[minute,h,l,c] …]}`.

- `ts` within 30 s of server time and newer than the stored mark (else 409, with `last_minute`).
- `bars`: 1–60, ascending, `l ≤ c ≤ h`, minutes ≤ `ts`. When the batch ends at the minute of `ts`, the mark lies
  in that bar; a full 60-bar catch-up batch may end earlier. The mark lies in the candle.
- 200 answers `{"last_minute": …, "rows": {"read", "written"}, …}`. `last_minute` is the newest stored minute;
  only finished minutes are stored. The producer sends every bar after it, so the open minute is re-sent until it
  closes, and is stored once it has.
- Any missing minute between the stored bars and a post gets a gap bar: for the open hour at the posted candle's
  low and high, for an earlier hour at that hour's closed candle from the index file in KV (`abi:index`
  `candles`). An earlier hour with no candle yet is kept in `gaps`; until a later post closes it, nothing fills
  and no order is accepted ("price updating").
- `hour_start` never goes backwards (409). The first post of an hour whose `trend` and `sigma_1h` are not null and
  whose `funding_hour` and `hour_start` are the hour of its `ts` fixes that hour's rates (`rates`, once; never
  recomputed, never for an hour already booked) from the book time-weighted over the hour before, books the
  projected funding cut, books the house's hours since the last booking (`house_hours`; ledger `house_pnl`,
  `house_trueup`), and re-checks every bar of the hour so far against the open positions with the new rates.
  `trend` is null for ~15 s after mark.py's own hour close: nothing changes, and new orders are refused ("price
  updating") until the hour's rates are fixed. A producer without `trend` has its `funding_rate` used instead. `sigma_24h`,
  `sigma_1h` and `ch1` drive the leverage cap and the pause; `sigma_24h` ≤ 0 or missing, or `sigma_1h` < 0 or
  missing, is unknown and refuses orders the same way.
- `milestone_premium` (§9.15): a finite number within ±0.001 per hour, or `null`. The hour's rates are fixed only
  once it is not null, like `trend`. A producer that doesn't send the key (an older mark.py, or before
  `ABI_POST_PREMIUM=1`) counts as 0 and blocks nothing.
- Orders pause while `base_pending` and for 60 s after `base_step_ts`.
- `milestone_ts`: the latest recorded index milestone at or before head (integer unix time, at or before `ts`,
  at most 7 days old), or `null`. It is stored on the mark row. New orders, but not closes, pause for 60 s after
  it ("Paused: index milestone"): recorded milestones change the index at once.

Orders fill at the first mark whose own `ts` (chain time) is later than the order's arrival, if that mark comes
within 10 s of server time; otherwise they are refused "price updating". Nothing fills while the producer is
catching up (bars behind the mark) or a gap is open.

No hedging: a wallet holds open positions in one direction at a time (the engine refuses "one direction at a
time", shown as "Close your long first" / "Close your short first"; the fill batch re-checks it atomically).

Routes: `POST|GET /api/index/mark`, `GET|POST|DELETE /api/pilot/auth`, `GET /api/pilot/account`,
`POST /api/pilot/order` (202, pending) + `GET /api/pilot/order?id=`, `POST /api/pilot/close` (202),
`GET /api/pilot/positions`, `GET /api/pilot/history`, `GET /api/pilot/leaderboard`, `GET /api/pilot/funding`
(the last 24 hourly rates, edge-cached 60 s), `GET /api/pilot/economy` (skew, funding, the house, the fee pool by
source, insurance, the weekly split; edge-cached 30 s, about 40 rows read per miss).

Ledger: every point that leaves a balance or a position lands in `ledger` (fees, borrow, the funding cut, the house,
liquidation margin, insurance draws, the split) in the same batch, under a guard only the owning batch passes, so
sum(balance − start) + sum(ledger) = 0 once every position is settled and every hour booked. The house's hourly row
is houseHour() − cut; a second row (`hour:<h>:adj`) and a row at each settlement (`settle:<id>`) true it up to the
exact counterparty result of every position (per-position `booked` / `booked_cut` / `booked_to`).

### D1 load

The D1 account is shared with live projects (free plan: 100k row writes and 5M row reads a day, account-wide).
Measured on workerd's D1 (`meta.rows_read` / `rows_written`), every 5 s post, a week of bars stored:

| Source | Reads / day | Writes / day |
|---|---|---|
| Producer, no open positions | ~65k (3.75 per post) | ~21.6k (1.25 per post) |
| Producer, per open position | +1.4k (the once-a-minute sweep reads it) | 0 |
| Producer, 100 open positions | ~209k | ~21.6k |
| Active user (4 h visible: 960 account polls × 8 rows; 10 open + close round trips × ~50 reads / 27 writes; REGI refresh) | ~8k | ~300 |
| Leaderboard (edge-cached 60 s; only while someone views it) | ≤ 1,440 × (accounts with positions + open positions) per edge location | 0 |

What keeps it there:
- The mark row is written every post. A bar is written only when its minute has finished, and not again if a
  re-sent minute is unchanged.
- The liquidation sweep runs inside the ingest batch over the bars it stores, so it reads the open positions about
  once a minute. It records `swept_minute`, and lazy liquidation reads no bars while that watermark is current.
- The ingest reads the mark row and probes for pending orders, open gaps, this hour's rates, the last split and the
  last booked hour in one statement. The rates, the house's hour and one booking update per open position are
  written once per hour. Pruning runs once an hour, on the first post of a new hour.
- Every batch stays under 400 statements (`MAX_BATCH_STATEMENTS`; D1 allows 1000 queries per invocation on Workers
  Paid, 100 bound parameters per statement). Catch-up hours take at most half of an hourly batch and open positions
  the rest (about 180; beyond that their bookings rotate, losing nothing); liquidations beyond the cap wait for the
  next post. A batch that fails for any reason but the deliberate abort is logged (`console.error`, with its kind
  and size) and answers 500.
- An account poll (every 15 s, only while the page is visible) is one query for the account and open positions,
  plus the mark row, the pending orders and the funding rates since the oldest open position. The funding list is
  `GET /api/pilot/funding`, edge-cached 60 s.
- History is the caller's last 100 rows through `positions_wallet (wallet, closed_at, id)`, with no sort.

Every ingest response carries `rows: {read, written}`, D1's totals for that request, so the owner can watch usage
(Cloudflare dashboard: D1, then Metrics).

Tests run offline: the D1 double (`test/memory-d1.ts`) is Node's built-in SQLite (Node ≥ 22.13).
