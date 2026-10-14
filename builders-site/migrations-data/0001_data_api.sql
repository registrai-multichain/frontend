-- registrai-data: Data API v1 history (spec docs/superpowers/specs/2026-10-14-data-api-v1-design.md)
CREATE TABLE index_hour (
  idx   TEXT    NOT NULL,            -- abi | aii | aei
  hour  INTEGER NOT NULL,            -- unix seconds / 3600 of the hour's close
  close REAL    NOT NULL,
  PRIMARY KEY (idx, hour)
) WITHOUT ROWID;
CREATE TABLE member_hour (
  idx           TEXT    NOT NULL,
  id            TEXT    NOT NULL,    -- the index source
  hour          INTEGER NOT NULL,
  points        REAL    NOT NULL,    -- stock at the close (live.P)
  points_earned REAL    NOT NULL,    -- that hour's activity event points
  payments      INTEGER NOT NULL,
  wallets       INTEGER NOT NULL,
  new_payers    INTEGER NOT NULL,
  usdc          REAL    NOT NULL,
  PRIMARY KEY (idx, id, hour)
) WITHOUT ROWID;
CREATE INDEX member_hour_by_hour ON member_hour (idx, hour);
