import { describe, expect, test } from "vitest";
import { backfillStatements } from "../../scripts/data-api-backfill";

describe("backfill", () => {
  test("idempotent upserts with escaped literals; same rows as the push ingest", () => {
    const data = { data_until: "2026-10-14T21:00:00Z", candles: [["2026-10-14T20:00:00Z", 1, 1, 1, 961.013, 0, 0, 0]],
      projects: [{ source: "domain:o'brien.app", name: "O'Brien", kind: "project" }], events: [], live: { P: { "domain:o'brien.app": 1.25 } } } as never;
    const sql = backfillStatements([{ index: "abi", data }]);
    expect(sql).toEqual([
      "INSERT OR REPLACE INTO index_hour (idx, hour, close) VALUES ('abi', 497781, 961.013);",
      "INSERT OR REPLACE INTO member_hour (idx, id, hour, points, points_earned, payments, wallets, new_payers, usdc) VALUES ('abi', 'domain:o''brien.app', 497781, 1.25, 0, 0, 0, 0, 0);",
      "INSERT INTO member_first (idx, id, first_hour) VALUES ('abi', 'domain:o''brien.app', 497781) ON CONFLICT (idx, id) DO UPDATE SET first_hour = MIN(first_hour, excluded.first_hour);",
    ]);
  });
});

describe("backfill dedupe", () => {
  test("one statement per row key; a later file wins (archives repeat 30 days of candles)", () => {
    const f = (close: number) => ({ data_until: "2026-10-14T21:00:00Z", candles: [["2026-10-14T20:00:00Z", 1, 1, 1, close, 0, 0, 0]], projects: [], events: [], live: { P: {} } }) as never;
    expect(backfillStatements([{ index: "abi", data: f(1) }, { index: "abi", data: f(2) }, { index: "aii", data: f(3) }])).toEqual([
      "INSERT OR REPLACE INTO index_hour (idx, hour, close) VALUES ('abi', 497781, 2);",
      "INSERT OR REPLACE INTO index_hour (idx, hour, close) VALUES ('aii', 497781, 3);",
    ]);
  });
});
