-- ABI points pilot (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md). D1 database bound as PILOT_DB.
-- Points only: no deposits, no withdrawals, no transfers. Times are unix seconds.

-- One account per wallet (lowercase). The REGI check is cached here (≤ 10 min).
CREATE TABLE accounts (
  wallet       TEXT PRIMARY KEY,
  balance      REAL    NOT NULL,
  season       INTEGER NOT NULL DEFAULT 1,
  created      INTEGER NOT NULL,
  regi_ok      INTEGER NOT NULL DEFAULT 0,
  regi_checked INTEGER NOT NULL DEFAULT 0
);

-- Open while closed_at IS NULL. Every close or liquidation is an UPDATE … WHERE closed_at IS NULL (single settle).
-- fee: the open fee, plus the close fee once closed. returned: points credited back at close (0 on liquidation).
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
  fee       REAL    NOT NULL,
  returned  REAL,
  reason    TEXT CHECK (reason IS NULL OR reason IN ('close', 'liquidation'))
);
CREATE INDEX positions_wallet ON positions (wallet, closed_at);
CREATE INDEX positions_open ON positions (closed_at, side, liq);

-- One-minute ABI bars from the mark producer (7 days kept). The l / h indexes make the
-- liquidation lookups read only the bars that cross a liquidation price.
CREATE TABLE bars (
  minute INTEGER PRIMARY KEY,
  h      REAL NOT NULL,
  l      REAL NOT NULL,
  c      REAL NOT NULL
);
CREATE INDEX bars_l ON bars (l);
CREATE INDEX bars_h ON bars (h);

-- The latest mark (one row). post: a random id per accepted post; that post's bars are written only
-- while the row carries its id (a duplicate or older post changes neither the row nor the bars).
CREATE TABLE mark (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  mark       REAL    NOT NULL,
  ts         INTEGER NOT NULL,
  head       INTEGER NOT NULL,
  hour_start INTEGER NOT NULL,
  ch24       REAL    NOT NULL,
  ch1        REAL    NOT NULL,
  candle     TEXT    NOT NULL,
  post       TEXT    NOT NULL
);

-- Sign-in nonces already used (single use; pruned after expiry).
CREATE TABLE used_nonces (
  nonce TEXT PRIMARY KEY,
  exp   INTEGER NOT NULL
);

-- Fixed one-minute rate-limit windows: k = "<kind>:<wallet or ip>", slot = unix minute.
CREATE TABLE rate (
  k    TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  n    INTEGER NOT NULL
);
