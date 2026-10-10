-- ABI points pilot, economy v3 (spec docs/superpowers/specs/2026-10-10-abi-points-pilot.md §9, §9.13; plan
-- docs/superpowers/plans/2026-10-10-abi-pilot-v3-site.md R2–R6). Points only. Times are unix seconds.
-- Table names stay distinct from every column name (builders-site/scripts/d1-guard-check.mjs relies on it).
-- The v2 `funding` table is kept (no longer written or read).

-- The hourly rates (R2), fixed once per hour from the first mark post with a non-null trend and sigma_1h for that
-- hour; never recomputed. In force during [hour, hour + 1h). long / short: points per unit of notional per hour,
-- + = pays (pilot.js fundingRates). L / S: the traders' open notional at the fix. cut: the protocol's projected cut
-- for the hour (points). house_exposure: S − L. house_funding: the house's projected receipts incl. the cut.
-- post: the mark post that fixed it (its ledger rows are written only by that post).
CREATE TABLE rates (
  hour           INTEGER PRIMARY KEY,
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
  post           TEXT    NOT NULL
);

-- Append-only points ledger (R4): every point that leaves a trader's balance or position lands here, so
-- sum(balance changes) + sum(ledger.amount) = 0 once every position is settled and every hour is booked.
--   fee              open and close fees                       ref open:<pos> / close:<pos>
--   borrow           borrow fees, at close or liquidation      ref borrow:<pos>
--   cut              funding cut: projected at the rate fix    ref hour:<h>, its true-up hour:<h>:adj, settle:<pos>
--   house_pnl        the house: houseHour − cut per hour (price + funding) ref hour:<h>
--   house_trueup     the house's true-up to the exact counterparty result: per hour ref hour:<h>:adj, at each
--                    settlement ref settle:<pos>; a negative close's deficit insurance can't cover, ref gap:<pos>
--   liq_margin       equity left at a liquidation, to the house; below zero (a gap) the part insurance can't
--                    cover is a house loss                     ref liq:<pos>
--   insurance_draw   gap losses insurance covers, never more than its balance (negative)  ref draw:<pos>
--   split_*          the weekly split (insurance; treasury not earmarked; buyback earmark). The split also writes
--                    negative fee / borrow / cut / house_* / liq_margin rows (ref split:<week>) that move the
--                    week's pool out, so each source's balance is what is left unsplit.
CREATE TABLE ledger (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  kind   TEXT    NOT NULL CHECK (kind IN ('fee', 'borrow', 'cut', 'house_pnl', 'house_trueup', 'liq_margin', 'insurance_draw', 'split_insurance', 'split_treasury', 'split_buyback')),
  amount REAL    NOT NULL,
  ref    TEXT    NOT NULL
);
CREATE UNIQUE INDEX ledger_ref ON ledger (ref, kind);   -- one row per event: a duplicate aborts its batch
CREATE INDEX ledger_kind_ts ON ledger (kind, ts);

-- Running totals of the ledger per kind, updated in the same statement batch as each ledger row (same guard):
-- balance = sum of every row; gross = sum without the split's moving rows (ref split:%). Read by the economy
-- endpoint and the weekly split instead of scanning the ledger.
CREATE TABLE pools (
  kind    TEXT PRIMARY KEY,
  balance REAL NOT NULL DEFAULT 0,
  gross   REAL NOT NULL DEFAULT 0
);
INSERT INTO pools (kind) VALUES ('fee'), ('borrow'), ('cut'), ('house_pnl'), ('house_trueup'), ('liq_margin'), ('insurance_draw'), ('split_insurance'), ('split_treasury'), ('split_buyback');

-- The weekly split (R5), one row per week (week = Monday 00:00 UTC of the week that ended). pool = fee + borrow +
-- cut + max(0, house) at the split; insurance / treasury / buyback = splitFees(pool) (buyback is inside treasury).
CREATE TABLE splits (
  week      INTEGER PRIMARY KEY,
  ts        INTEGER NOT NULL,
  pool      REAL    NOT NULL,
  fee       REAL    NOT NULL,
  borrow    REAL    NOT NULL,
  cut       REAL    NOT NULL,
  house     REAL    NOT NULL,
  insurance REAL    NOT NULL,
  treasury  REAL    NOT NULL,
  buyback   REAL    NOT NULL,
  post      TEXT    NOT NULL
);

-- The house's booked hours (R2): the houseHour figures of the hour (exposure, price_pnl, funding net of the cut,
-- pnl = total − cut) from the rates row and the hour's candle (open, close); adj = the true-up to the exact
-- counterparty result of the positions booked at the hour's end; total = pnl + adj + the house's settlement rows
-- attributed to the hour. Settlement rows (house_trueup, liq_margin) are attributed once, by ledger id: every row
-- with id in (previous upto_id, upto_id]. cum_* = running sums (price, funding, true-up incl. adj, liquidations),
-- cum = their total: the economy's 24 h / week figures are differences of these.
CREATE TABLE house_hours (
  hour      INTEGER PRIMARY KEY,
  open      REAL    NOT NULL,
  close     REAL    NOT NULL,
  exposure  REAL    NOT NULL,
  price_pnl REAL    NOT NULL,
  funding   REAL    NOT NULL,
  pnl       REAL    NOT NULL,
  adj       REAL    NOT NULL,
  total     REAL    NOT NULL,
  cum       REAL    NOT NULL,
  cum_price  REAL   NOT NULL,
  cum_funding REAL  NOT NULL,
  cum_trueup REAL   NOT NULL,
  cum_liq   REAL    NOT NULL,
  upto_id   INTEGER NOT NULL,
  booked_at INTEGER NOT NULL,
  post      TEXT    NOT NULL
);

-- Positions, v3: borrow paid at settlement; fill = the price the house marks the exit at (the exit for a close,
-- the crossing bar's low / high for a liquidation); settle = the batch token that settled it (its ledger rows are
-- written only under it); booked / booked_cut / booked_to = the house's and the cut's claim on the position already
-- in the ledger, and up to when (every booking or settlement moves them under a booked_to guard).
ALTER TABLE positions ADD COLUMN borrow REAL;
ALTER TABLE positions ADD COLUMN fill REAL;
ALTER TABLE positions ADD COLUMN settle TEXT;
ALTER TABLE positions ADD COLUMN booked REAL NOT NULL DEFAULT 0;
ALTER TABLE positions ADD COLUMN booked_cut REAL NOT NULL DEFAULT 0;
ALTER TABLE positions ADD COLUMN booked_to INTEGER;
UPDATE positions SET booked_to = opened_at WHERE booked_to IS NULL;
