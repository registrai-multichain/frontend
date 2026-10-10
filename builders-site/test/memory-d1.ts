import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { D1Database, D1PreparedStatement, D1Result } from "../lib/env";
import { MIGRATIONS } from "../lib/pilot-sql";

/**
 * An offline stand-in for Cloudflare D1: Node's built-in SQLite (node:sqlite, Node ≥ 22.13) behind
 * the D1 surface the pilot uses (prepare / bind / first / all / run / batch). Like D1, one database
 * runs one statement at a time; batch() is one transaction (all or nothing). Every call yields to
 * the event loop first, so concurrent handlers interleave at each await as they would on D1.
 */

interface SqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

function openSqlite(): SqliteDb {
  // vite resolves `import "node:sqlite"` as a file; the runtime getter bypasses it.
  const get = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const mod = get?.("node:sqlite") as { DatabaseSync: new (path: string) => SqliteDb } | undefined;
  if (!mod) throw new Error("the D1 test double needs Node ≥ 22.13 (node:sqlite)");
  return new mod.DatabaseSync(":memory:");
}

const yieldTurn = () => new Promise<void>((r) => setTimeout(r, 0));

export class MemoryD1 implements D1Database {
  readonly sqlite = openSqlite();
  /** Every statement executed, in order (tests assert on the writes). */
  readonly log: string[] = [];
  batches = 0;

  constructor(migrations: string[] = MIGRATIONS.map((f) => resolve(__dirname, "../migrations", f))) {
    for (const m of migrations) this.sqlite.exec(readFileSync(m, "utf8"));
  }

  /** Runs one statement synchronously: rows (for SELECT / RETURNING) and the change count. */
  exec1(sql: string, params: unknown[]): D1Result {
    this.log.push(sql);
    const values = params.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v));
    const rows = this.sqlite.prepare(sql).all(...values).map((r) => ({ ...r }));
    const isWrite = /^\s*(insert|update|delete|replace)\b/i.test(sql);
    const info = this.sqlite.prepare("SELECT changes() AS c, last_insert_rowid() AS id").all()[0] as { c: number; id: number };
    // rows_read / rows_written approximate D1's counters (rows returned / changed) so the metering can be tested
    const changes = isWrite ? Number(info.c) : 0;
    return { results: rows, success: true, meta: { changes, last_row_id: Number(info.id), rows_read: rows.length, rows_written: changes } };
  }

  prepare(sql: string): D1PreparedStatement {
    return new MemoryStatement(this, sql, []);
  }

  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    await yieldTurn();
    this.batches++;
    this.sqlite.exec("BEGIN");
    try {
      const out = statements.map((s) => {
        const m = s as MemoryStatement;
        return this.exec1(m.sql, m.params) as D1Result<T>;
      });
      this.sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }

  /** Synchronous helper for test setup / assertions. */
  q<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.sqlite.prepare(sql).all(...params).map((r) => ({ ...r })) as T[];
  }
}

class MemoryStatement implements D1PreparedStatement {
  constructor(readonly db: MemoryD1, readonly sql: string, readonly params: unknown[]) {}
  bind(...values: unknown[]): D1PreparedStatement {
    return new MemoryStatement(this.db, this.sql, values);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    await yieldTurn();
    return (this.db.exec1(this.sql, this.params).results[0] as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    await yieldTurn();
    return this.db.exec1(this.sql, this.params) as D1Result<T>;
  }
  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    await yieldTurn();
    return this.db.exec1(this.sql, this.params) as D1Result<T>;
  }
}
