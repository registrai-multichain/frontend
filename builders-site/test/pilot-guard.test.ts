import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import type { D1PreparedStatement } from "../lib/env";
import { runGuardChecks } from "../lib/pilot-guard";
import { scratch, SQL } from "../lib/pilot-sql";
import { MemoryD1 } from "./memory-d1";

const migration = readFileSync(resolve(__dirname, "../migrations/0001_pilot.sql"), "utf8");

describe("the remote D1 guard check (scripts/d1-guard-check.mjs)", () => {
  test("passes on the test double, and leaves only the real tables behind", async () => {
    const db = new MemoryD1();
    const before = db.q("SELECT name FROM sqlite_master ORDER BY name");
    const results = await runGuardChecks(db, migration);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.length).toBeGreaterThan(15);
    expect(db.q("SELECT name FROM sqlite_master ORDER BY name")).toEqual(before);
    expect(db.q("SELECT COUNT(*) AS n FROM accounts")[0]).toEqual({ n: 0 });
  });
  test("fails loudly when a guard does not hold", async () => {
    const db = new MemoryD1();
    const real = db.batch.bind(db);
    db.batch = (async (stmts: D1PreparedStatement[]) => (await real(stmts)).map((x) => ({ ...x, meta: { ...x.meta, changes: 1 } }))) as MemoryD1["batch"];
    expect((await runGuardChecks(db, migration)).some((r) => !r.ok)).toBe(true);
  });
  test("scratch() prefixes every table and index name, never a column", () => {
    expect(scratch(SQL.markUpsert)).toContain("INSERT INTO _guard_mark (id, px, ts");
    expect(scratch(SQL.markUpsert)).toContain("WHERE excluded.ts > _guard_mark.ts");
    expect(scratch(SQL.liqCandidatesLong)).toContain("FROM _guard_bars INDEXED BY _guard_bars_l");
    expect(scratch(SQL.openDebit)).toMatch(/UPDATE _guard_accounts .* FROM _guard_positions .* FROM _guard_orders/);
    expect(scratch("SELECT position_id, funding_x FROM orders")).toBe("SELECT position_id, funding_x FROM _guard_orders");
  });
});
