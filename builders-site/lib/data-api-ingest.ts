/** Data API v1 ingest: upserts the rows of one pushed index file into DATA_DB. Never throws (the KV publish must not fail on it). */
import type { AbiData } from "../../src/lib/builders-index";
import type { D1Database } from "./env";
import { indexHourRows, memberHourRows, type IndexHourRow, type IndexId, type MemberHourRow } from "./data-api-rows";

export const DATA_MIGRATIONS = ["0001_data_api.sql", "0002_x402.sql"];
/** Closes are re-upserted for this many hours back on every push, so a gap of up to two days heals itself. */
export const INGEST_INDEX_LOOKBACK_H = 48;

export function upsertSql(rows: (IndexHourRow | MemberHourRow)[]): { sql: string; params: unknown[] }[] {
  return rows.flatMap((r) =>
    "id" in r
      ? [{ sql: "INSERT OR REPLACE INTO member_hour (idx, id, hour, points, points_earned, payments, wallets, new_payers, usdc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
           params: [r.index, r.id, r.hour, r.points, r.points_earned, r.payments, r.wallets, r.new_payers, r.usdc] },
         { sql: "INSERT INTO member_first (idx, id, first_hour) VALUES (?, ?, ?) ON CONFLICT (idx, id) DO UPDATE SET first_hour = MIN(first_hour, excluded.first_hour)",
           params: [r.index, r.id, r.hour] }]
      : [{ sql: "INSERT OR REPLACE INTO index_hour (idx, hour, close) VALUES (?, ?, ?)", params: [r.index, r.hour, r.close] }]);
}

export async function ingestIndexFile(db: D1Database | undefined, index: IndexId, d: AbiData): Promise<{ index: number; members: number } | null> {
  if (!db) return null;
  try {
    const until = Date.parse(d.data_until) / 3600e3;
    const closes = indexHourRows(index, d, until - INGEST_INDEX_LOOKBACK_H);
    const members = memberHourRows(index, d);
    const stmts = upsertSql([...closes, ...members]).map((s) => db.prepare(s.sql).bind(...s.params));
    if (stmts.length) await db.batch(stmts);
    return { index: closes.length, members: members.length };
  } catch (err) {
    console.warn("data-api ingest failed", index, err);
    return null;
  }
}
