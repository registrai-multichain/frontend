import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import type { D1PreparedStatement } from "../lib/env";
import { runGuardChecks } from "../lib/pilot-guard";
import { INDEXES, MIGRATIONS, REBUILT, scratch, SQL, TABLES } from "../lib/pilot-sql";
import { MemoryD1 } from "./memory-d1";

const migration = MIGRATIONS.map((f) => readFileSync(resolve(__dirname, "../migrations", f), "utf8"));

describe("the remote D1 guard check (scripts/d1-guard-check.mjs)", () => {
  test("passes on the test double, and leaves only the real tables behind", async () => {
    const db = new MemoryD1();
    const before = db.q("SELECT name FROM sqlite_master ORDER BY name");
    const results = await runGuardChecks(db, migration);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.length).toBeGreaterThan(15);
    expect(db.q("SELECT name FROM sqlite_master ORDER BY name")).toEqual(before);
    expect(db.q("SELECT COUNT(*) AS n FROM accounts")[0]).toEqual({ n: 0 });
    expect(db.q("SELECT COUNT(*) AS n FROM ledger")[0]).toEqual({ n: 0 });
    expect(db.q("SELECT SUM(balance) AS b FROM pools")[0]).toEqual({ b: 0 });
  });
  test("fails loudly when a guard does not hold", async () => {
    const db = new MemoryD1();
    const real = db.batch.bind(db);
    db.batch = (async (stmts: D1PreparedStatement[]) => (await real(stmts)).map((x) => ({ ...x, meta: { ...x.meta, changes: 1 } }))) as MemoryD1["batch"];
    expect((await runGuardChecks(db, migration)).some((r) => !r.ok)).toBe(true);
  });
  test("scratch() prefixes every table and index name, never a column", () => {
    expect(scratch(SQL.markUpsert)).toContain("INSERT INTO _guard_mark (market, px, ts");
    expect(scratch(SQL.markUpsert)).toContain("ON CONFLICT (market) DO UPDATE");
    expect(scratch(SQL.markUpsert)).toContain("WHERE excluded.ts > _guard_mark.ts");
    expect(scratch(SQL.liqCandidatesLong)).toContain("FROM _guard_bars INDEXED BY _guard_bars_l");
    expect(scratch(SQL.openDebit)).toMatch(/UPDATE _guard_accounts .* FROM _guard_positions .* FROM _guard_orders/);
    expect(scratch("SELECT position_id, funding_x FROM orders")).toBe("SELECT position_id, funding_x FROM _guard_orders");
    expect(scratch(SQL.ledgerSettled)).toBe("INSERT INTO _guard_ledger (ts, kind, amount, ref, market) SELECT ?, ?, ?, ?, g.market FROM _guard_positions g WHERE g.id = ? AND g.settle = ?");
    expect(scratch(SQL.houseHourInsert)).toMatch(/^INSERT INTO _guard_house_hours .* FROM _guard_rates g WHERE g.market = \? AND g.hour/);
    expect(scratch(SQL.barUpsert)).toContain("FROM _guard_mark m WHERE m.market = ? AND m.post = ?");
    expect(scratch(SQL.gapCoverPool)).toContain("FROM _guard_pools i WHERE i.market = _guard_pools.market");
    // migration 0004's rebuild copies are prefixed too (a scratch run never touches a real table's name)
    expect(scratch("CREATE TABLE mark_v4 (market TEXT); ALTER TABLE mark_v4 RENAME TO mark")).toBe("CREATE TABLE _guard_mark_v4 (market TEXT); ALTER TABLE _guard_mark_v4 RENAME TO _guard_mark");
    expect(scratch(SQL.poolBySplit)).toContain("UPDATE _guard_pools SET balance");
  });
  test("every migration's table and index is in TABLES / INDEXES (so scratch() prefixes it)", () => {
    const ddl = migration.join("\n");
    const tables = [...ddl.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]);
    const indexes = [...ddl.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual([...TABLES, ...REBUILT.map((t) => `${t}_v4`)].sort());
    expect([...new Set(indexes)].sort()).toEqual([...INDEXES].sort());
  });
});
