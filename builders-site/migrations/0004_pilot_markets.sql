-- Points pilot: three markets, ABI, AII and AEI (owner decision 2026-10-12; plan
-- docs/superpowers/plans/2026-10-12-pilot-three-markets.md R1, R5). Everything that is market state is keyed by
-- market: the mark row, minute bars, gaps, hourly rates, house hours, the pools and the weekly splits. Positions,
-- orders and ledger rows carry their market. accounts.balance stays one number per wallet, spent across markets.
-- Every row that exists before this migration belongs to ABI (the only market so far): it is copied as market 'abi'.
-- SQLite cannot change a primary key, so the keyed tables are rebuilt: create <name>_v4, copy, drop the old table
-- (its indexes go with it), rename, recreate the indexes with market leading where it is a filter.
-- Table names stay distinct from every column name (builders-site/scripts/d1-guard-check.mjs relies on it).

-- The latest mark per market (was one row, id = 1). The producer's post without "index" is ABI's.
CREATE TABLE mark_v4 (
  market        TEXT    PRIMARY KEY CHECK (market IN ('abi', 'aii', 'aei')),
  px            REAL    NOT NULL,
  ts            INTEGER NOT NULL,
  received_ms   INTEGER NOT NULL,
  head          INTEGER NOT NULL,
  hour_start    INTEGER NOT NULL,
  ch24          REAL    NOT NULL,
  ch1           REAL    NOT NULL,
  sigma_1h      REAL,
  sigma_24h     REAL,
  funding_known INTEGER NOT NULL DEFAULT 0,
  funding_rate  REAL,
  bars_minute   INTEGER,
  swept_minute  INTEGER,
  base_pending  INTEGER NOT NULL DEFAULT 0,
  base_step_ts  INTEGER,
  milestone_ts  INTEGER,
  candle        TEXT    NOT NULL,
  post          TEXT    NOT NULL
);
INSERT INTO mark_v4 (market, px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, funding_rate, bars_minute, swept_minute, base_pending, base_step_ts, milestone_ts, candle, post)
  SELECT 'abi', px, ts, received_ms, head, hour_start, ch24, ch1, sigma_1h, sigma_24h, funding_known, funding_rate, bars_minute, swept_minute, base_pending, base_step_ts, milestone_ts, candle, post FROM mark;
DROP TABLE mark;
ALTER TABLE mark_v4 RENAME TO mark;

-- One-minute bars per market. bars_l / bars_h: the liquidation lookups (market, then the crossing price).
CREATE TABLE bars_v4 (
  market TEXT    NOT NULL DEFAULT 'abi',
  minute INTEGER NOT NULL,
  h      REAL    NOT NULL,
  l      REAL    NOT NULL,
  c      REAL    NOT NULL,
  PRIMARY KEY (market, minute)
);
INSERT INTO bars_v4 (market, minute, h, l, c) SELECT 'abi', minute, h, l, c FROM bars;
DROP TABLE bars;
ALTER TABLE bars_v4 RENAME TO bars;
CREATE INDEX bars_l ON bars (market, l);
CREATE INDEX bars_h ON bars (market, h);

-- Open gaps per market.
CREATE TABLE gaps_v4 (
  market      TEXT    NOT NULL DEFAULT 'abi',
  minute_from INTEGER NOT NULL,
  minute_to   INTEGER NOT NULL,
  PRIMARY KEY (market, minute_from)
);
INSERT INTO gaps_v4 (market, minute_from, minute_to) SELECT 'abi', minute_from, minute_to FROM gaps;
DROP TABLE gaps;
ALTER TABLE gaps_v4 RENAME TO gaps;

-- The hourly rates per market, fixed once per market hour.
CREATE TABLE rates_v4 (
  market         TEXT    NOT NULL DEFAULT 'abi',
  hour           INTEGER NOT NULL,
  long           REAL    NOT NULL,
  short          REAL    NOT NULL,
  skew           REAL    NOT NULL,
  r              REAL    NOT NULL,
  r_max          REAL    NOT NULL,
  cut            REAL    NOT NULL,
  house_exposure REAL    NOT NULL,
  house_funding  REAL    NOT NULL,
  trend          REAL    NOT NULL,
  sigma_1h       REAL    NOT NULL,
  L              REAL    NOT NULL,
  S              REAL    NOT NULL,
  fixed_at       INTEGER NOT NULL,
  post           TEXT    NOT NULL,
  premium        REAL,
  PRIMARY KEY (market, hour)
);
INSERT INTO rates_v4 (market, hour, long, short, skew, r, r_max, cut, house_exposure, house_funding, trend, sigma_1h, L, S, fixed_at, post, premium)
  SELECT 'abi', hour, long, short, skew, r, r_max, cut, house_exposure, house_funding, trend, sigma_1h, L, S, fixed_at, post, premium FROM rates;
DROP TABLE rates;
ALTER TABLE rates_v4 RENAME TO rates;

-- The house's booked hours per market (upto_id: the market's settlement rows are attributed by ledger id).
CREATE TABLE house_hours_v4 (
  market      TEXT    NOT NULL DEFAULT 'abi',
  hour        INTEGER NOT NULL,
  open        REAL    NOT NULL,
  close       REAL    NOT NULL,
  exposure    REAL    NOT NULL,
  price_pnl   REAL    NOT NULL,
  funding     REAL    NOT NULL,
  pnl         REAL    NOT NULL,
  adj         REAL    NOT NULL,
  total       REAL    NOT NULL,
  cum         REAL    NOT NULL,
  cum_price   REAL    NOT NULL,
  cum_funding REAL    NOT NULL,
  cum_trueup  REAL    NOT NULL,
  cum_liq     REAL    NOT NULL,
  upto_id     INTEGER NOT NULL,
  booked_at   INTEGER NOT NULL,
  post        TEXT    NOT NULL,
  PRIMARY KEY (market, hour)
);
INSERT INTO house_hours_v4 (market, hour, open, close, exposure, price_pnl, funding, pnl, adj, total, cum, cum_price, cum_funding, cum_trueup, cum_liq, upto_id, booked_at, post)
  SELECT 'abi', hour, open, close, exposure, price_pnl, funding, pnl, adj, total, cum, cum_price, cum_funding, cum_trueup, cum_liq, upto_id, booked_at, post FROM house_hours;
DROP TABLE house_hours;
ALTER TABLE house_hours_v4 RENAME TO house_hours;

-- The ledger's running totals per market and kind: ABI keeps its balances; AII and AEI start at zero.
CREATE TABLE pools_v4 (
  market  TEXT NOT NULL,
  kind    TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  gross   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (market, kind)
);
INSERT INTO pools_v4 (market, kind, balance, gross) SELECT 'abi', kind, balance, gross FROM pools;
INSERT INTO pools_v4 (market, kind) VALUES
  ('aii', 'fee'), ('aii', 'borrow'), ('aii', 'cut'), ('aii', 'house_pnl'), ('aii', 'house_trueup'), ('aii', 'liq_margin'), ('aii', 'insurance_draw'), ('aii', 'split_insurance'), ('aii', 'split_treasury'), ('aii', 'split_buyback'),
  ('aei', 'fee'), ('aei', 'borrow'), ('aei', 'cut'), ('aei', 'house_pnl'), ('aei', 'house_trueup'), ('aei', 'liq_margin'), ('aei', 'insurance_draw'), ('aei', 'split_insurance'), ('aei', 'split_treasury'), ('aei', 'split_buyback');
DROP TABLE pools;
ALTER TABLE pools_v4 RENAME TO pools;

-- The weekly split per market.
CREATE TABLE splits_v4 (
  market    TEXT    NOT NULL DEFAULT 'abi',
  week      INTEGER NOT NULL,
  ts        INTEGER NOT NULL,
  pool      REAL    NOT NULL,
  fee       REAL    NOT NULL,
  borrow    REAL    NOT NULL,
  cut       REAL    NOT NULL,
  house     REAL    NOT NULL,
  insurance REAL    NOT NULL,
  treasury  REAL    NOT NULL,
  buyback   REAL    NOT NULL,
  post      TEXT    NOT NULL,
  PRIMARY KEY (market, week)
);
INSERT INTO splits_v4 (market, week, ts, pool, fee, borrow, cut, house, insurance, treasury, buyback, post)
  SELECT 'abi', week, ts, pool, fee, borrow, cut, house, insurance, treasury, buyback, post FROM splits;
DROP TABLE splits;
ALTER TABLE splits_v4 RENAME TO splits;

-- Positions, orders and ledger rows carry their market (every existing row is ABI's). A close order's market is its
-- position's. The ledger's one-row-per-event key is per market (hour:<h>, split:<week> repeat across markets).
ALTER TABLE positions ADD COLUMN market TEXT NOT NULL DEFAULT 'abi';
ALTER TABLE orders ADD COLUMN market TEXT NOT NULL DEFAULT 'abi';
ALTER TABLE ledger ADD COLUMN market TEXT NOT NULL DEFAULT 'abi';
CREATE INDEX positions_market ON positions (market, closed_at);
DROP INDEX orders_pending;
CREATE INDEX orders_pending ON orders (market, status, arrived_ms);
DROP INDEX ledger_ref;
CREATE UNIQUE INDEX ledger_ref ON ledger (market, ref, kind);
DROP INDEX ledger_kind_ts;
CREATE INDEX ledger_kind_ts ON ledger (market, kind, ts);
