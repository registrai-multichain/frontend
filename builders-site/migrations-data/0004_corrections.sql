-- Ecosystem corrections (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md)
CREATE TABLE corrections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL,
  field         TEXT    NOT NULL,
  text          TEXT    NOT NULL,
  source_url    TEXT,
  email         TEXT,                -- NULL 30 days after the decision
  name          TEXT,
  domain_match  INTEGER NOT NULL,    -- 1: the email's domain is the website's host or a subdomain of it (a hint, never confirmed)
  ip_hash       TEXT    NOT NULL,    -- keyed hash, for rate limits; '' after the retention period
  status        TEXT    NOT NULL DEFAULT 'open',   -- open | approved | rejected | applied
  public_note   TEXT,
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER,
  decided_by    TEXT,
  applied_at    INTEGER
);
CREATE INDEX corrections_status ON corrections(status, created_at);
