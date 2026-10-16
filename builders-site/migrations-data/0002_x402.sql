-- x402 paid extras (spec docs/superpowers/specs/2026-10-16-x402-data-api-design.md)
CREATE TABLE x402_payments (
  scheme     TEXT    NOT NULL,   -- gateway | eip3009
  payer      TEXT    NOT NULL,   -- lowercase address
  nonce      TEXT    NOT NULL,   -- 0x… (eip3009 nonce, or the gateway payload's nonce)
  product    TEXT    NOT NULL,
  amount     INTEGER NOT NULL,   -- micro-USDC
  status     TEXT    NOT NULL,   -- pending | settled | failed | unknown
  tx_hash    TEXT,
  created_at INTEGER NOT NULL,   -- unix seconds
  PRIMARY KEY (scheme, payer, nonce)
) WITHOUT ROWID;
CREATE INDEX x402_by_day ON x402_payments (created_at);
