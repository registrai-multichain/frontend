-- Arc in numbers: one snapshot per UTC day (spec docs/superpowers/specs/2026-10-20-arc-in-numbers-design.md)
CREATE TABLE arc_daily (
  day        TEXT    NOT NULL PRIMARY KEY,   -- YYYY-MM-DD (UTC) of the 00:00 close that triggered it
  json       TEXT    NOT NULL,               -- ArcNumbers
  created_at INTEGER NOT NULL                -- unix seconds
) WITHOUT ROWID;
