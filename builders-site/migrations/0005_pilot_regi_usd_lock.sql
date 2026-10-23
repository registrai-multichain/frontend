-- Points pilot: REGI in dollars and the REGI lock (owner decisions 2026-10-13; plan
-- docs/superpowers/plans/2026-10-13-pilot-regi-usd-gate-and-lock.md R1, R3, R4, R5).
-- Table names stay distinct from every column name (builders-site/scripts/d1-guard-check.mjs relies on it).

-- The site's own REGI/USDC pool samples (R1): one per 10-minute slot (ts = the slot's start, unix s), USD per REGI.
-- The price is the median of the last 24 h of samples; fewer than 6 = unknown (admission and leverage refuse).
CREATE TABLE regi_price (
  ts           INTEGER PRIMARY KEY,
  usd_per_regi REAL    NOT NULL CHECK (usd_per_regi > 0)
);

-- The withdrawal watch (R4): the last Arc block whose RegiLockFactory Withdrawn logs are fully handled (NULL: not
-- started), and when the watch last ran (unix s; it runs at most once a minute).
CREATE TABLE lock_cursor (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  block   INTEGER,
  checked INTEGER NOT NULL DEFAULT 0
);
INSERT INTO lock_cursor (id, block, checked) VALUES (1, NULL, 0);

-- R3: the lock requirement in force when the position opened, raw REGI (18 decimals) as a canonical decimal string
-- (no leading zeros; '0' at 1×). Too large for an INTEGER, so it is compared by length, then as text.
ALTER TABLE positions ADD COLUMN lock_req TEXT NOT NULL DEFAULT '0';
-- R4: why a close happened when the site made it: 'lock withdrawn'. reason stays 'close' (the normal close
-- settlement; migration 0001's CHECK allows only 'close' and 'liquidation'). NULL for a close the wallet asked for.
ALTER TABLE positions ADD COLUMN close_note TEXT;
-- The requirement checked when the order was placed (against lockedOf read then), copied to the position at the fill.
ALTER TABLE orders ADD COLUMN lock_req TEXT NOT NULL DEFAULT '0';
