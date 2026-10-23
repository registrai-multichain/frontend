-- Points pilot: owners due a lock re-check (review 2026-10-13 S1). The withdrawal watch records every owner named in a
-- Withdrawn log here and moves its cursor on as soon as the logs are read; an owner leaves only once its leveraged
-- positions (in every market) are settled or confirmed still covered by the lock, and its pending leveraged orders
-- refused where the lock no longer covers them. So one market that can't settle now (a stale mark, unfixed rates)
-- holds back only its own owners, never the cursor.
-- Table names stay distinct from every column name (builders-site/scripts/d1-guard-check.mjs relies on it).
CREATE TABLE lock_due (
  owner      TEXT    PRIMARY KEY,
  -- the first Withdrawn block not yet handled for this owner, and the latest one seen
  from_block INTEGER NOT NULL,
  last_block INTEGER NOT NULL
);
