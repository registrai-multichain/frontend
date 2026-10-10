-- ABI points pilot, economy v2 (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md §8). D1 database bound as PILOT_DB.
-- Points only: no deposits, no withdrawals, no transfers. Times are unix seconds unless named *_ms.
-- Table names are distinct from every column name (builders-site/scripts/d1-guard-check.mjs relies on it).

-- One account per wallet (lowercase).
--   regi_*: the REGI gate. regi_snap = balance ≥ 1 REGI at block regi_snap_block (permanent per block);
--   regi_ok / regi_checked = the balance now (cached ≤ 10 min); regi_retry_at = RPC back-off after a failure.
--   session_epoch: in every session MAC; sign-out bumps it, which ends every session of the wallet.
CREATE TABLE accounts (
  wallet          TEXT PRIMARY KEY,
  balance         REAL    NOT NULL,
  season          INTEGER NOT NULL DEFAULT 1,
  created         INTEGER NOT NULL,
  regi_ok         INTEGER NOT NULL DEFAULT 0,
  regi_checked    INTEGER NOT NULL DEFAULT 0,
  regi_snap       INTEGER,
  regi_snap_block INTEGER,
  regi_retry_at   INTEGER NOT NULL DEFAULT 0,
  session_epoch   INTEGER NOT NULL DEFAULT 0
);

-- Open while closed_at IS NULL. Every close or liquidation is an UPDATE … WHERE closed_at IS NULL (single settle).
-- liq: at open (no funding). fee: open fee, plus the close fee once closed. accrued: funding realised at close.
-- returned: points credited back at close (0 on liquidation).
CREATE TABLE positions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet    TEXT    NOT NULL,
  side      TEXT    NOT NULL CHECK (side IN ('long', 'short')),
  margin    REAL    NOT NULL,
  lev       INTEGER NOT NULL,
  notional  REAL    NOT NULL,
  entry     REAL    NOT NULL,
  liq       REAL    NOT NULL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  exit      REAL,
  pnl       REAL,
  accrued   REAL,
  fee       REAL    NOT NULL,
  returned  REAL,
  reason    TEXT CHECK (reason IS NULL OR reason IN ('close', 'liquidation'))
);
CREATE INDEX positions_wallet ON positions (wallet, closed_at);
CREATE INDEX positions_open ON positions (closed_at);

-- Order intents. An order fills at the first mark posted after it arrived (at most RULES.markMaxAgeS later),
-- inside that mark's ingest; otherwise it is refused. kind 'open': side / margin / lev, position_id = the
-- position it opened. kind 'close': position_id = the position to close.
CREATE TABLE orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet      TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('open', 'close')),
  side        TEXT,
  margin      REAL,
  lev         INTEGER,
  position_id INTEGER,
  arrived_ms  INTEGER NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'filled', 'refused')),
  error       TEXT,
  fill_px     REAL,
  filled_at   INTEGER
);
CREATE INDEX orders_pending ON orders (status, arrived_ms);
CREATE INDEX orders_wallet ON orders (wallet, id);

-- One-minute ABI bars from the mark producer (7 days kept). The l / h indexes make the liquidation
-- lookups read only the bars that cross a liquidation price.
CREATE TABLE bars (
  minute INTEGER PRIMARY KEY,
  h      REAL NOT NULL,
  l      REAL NOT NULL,
  c      REAL NOT NULL
);
CREATE INDEX bars_l ON bars (l);
CREATE INDEX bars_h ON bars (h);

-- Missing minutes in an earlier (closed) hour that no closed candle covered yet: until a later post fills them
-- from the index candles with a gap bar (that hour's high and low), nothing fills and no order is accepted.
CREATE TABLE gaps (
  minute_from INTEGER PRIMARY KEY,
  minute_to   INTEGER NOT NULL
);

-- Funding: the rate in force during [hour_start, hour_start + 1h), as posted by the producer (written once per hour).
CREATE TABLE funding (
  hour_start INTEGER PRIMARY KEY,
  rate       REAL NOT NULL
);

-- The latest mark (one row). post: a random id per accepted post; that post's bars and funding are written
-- only while the row carries its id (a duplicate or older post changes nothing).
CREATE TABLE mark (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  px           REAL    NOT NULL,
  ts           INTEGER NOT NULL,
  received_ms  INTEGER NOT NULL,
  head         INTEGER NOT NULL,
  hour_start   INTEGER NOT NULL,
  ch24         REAL    NOT NULL,
  ch1          REAL    NOT NULL,
  sigma_1h     REAL,
  sigma_24h    REAL,
  funding_known INTEGER NOT NULL DEFAULT 0,
  base_pending INTEGER NOT NULL DEFAULT 0,
  base_step_ts INTEGER,
  candle       TEXT    NOT NULL,
  post         TEXT    NOT NULL
);

-- Sign-in nonces already used (single use; pruned after expiry).
CREATE TABLE used_nonces (
  nonce TEXT PRIMARY KEY,
  exp   INTEGER NOT NULL
);

-- Fixed one-minute rate-limit windows: k = "<kind>:<wallet or ip>", slot = unix minute.
CREATE TABLE ratelimit (
  k    TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  n    INTEGER NOT NULL
);
