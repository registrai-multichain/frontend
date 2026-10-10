#!/usr/bin/env node
/**
 * Before opening the ABI points pilot: prove the guarded batches (lib/pilot-sql.ts: changes() chains, settle /
 * post tokens, the ledger and pools rows, the once-per-hour rates and house hour, the once-per-week split, the
 * batch abort) behave on the remote D1 database exactly as in the tests. Runs on scratch `_guard_*` copies of the tables through the real
 * Workers D1 binding (wrangler's platform proxy, remote binding), then drops them; the pilot tables are not touched.
 *
 *   cd frontend && npx tsx builders-site/scripts/d1-guard-check.mjs            # the remote database (needs wrangler login)
 *   cd frontend && npx tsx builders-site/scripts/d1-guard-check.mjs --local    # a throwaway local D1 (dry run)
 *
 * Reads the PILOT_DB database_name / database_id from builders-site/wrangler.toml. Exit code 0 = every check passed.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import * as guard from "../lib/pilot-guard.ts";
import * as sql from "../lib/pilot-sql.ts";

// tsx loads the .ts as CommonJS (the package has no "type": "module"): its exports may sit on `default`
const { runGuardChecks } = guard.runGuardChecks ? guard : guard.default;
const { MIGRATIONS } = sql.MIGRATIONS ? sql : sql.default;

const here = dirname(fileURLToPath(import.meta.url));
const local = process.argv.includes("--local");
const toml = readFileSync(resolve(here, "../wrangler.toml"), "utf8");
const block = toml.split("[[d1_databases]]")[1] ?? "";
const field = (k) => new RegExp(`^${k}\\s*=\\s*"([^"]+)"`, "m").exec(block)?.[1];
const name = field("database_name"), id = field("database_id");
if (!name || !id) { console.error("no [[d1_databases]] PILOT_DB block in builders-site/wrangler.toml"); process.exit(2); }
if (!local && id === "REPLACE_WITH_D1_ID") { console.error("database_id is still the placeholder: run `npx wrangler d1 create registrai-pilot` first"); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), "d1-guard-"));
const config = join(dir, "wrangler.toml");
writeFileSync(config, [
  'name = "d1-guard-check"',
  'compatibility_date = "2026-05-01"',
  "[[d1_databases]]",
  'binding = "PILOT_DB"',
  `database_name = "${name}"`,
  `database_id = "${local ? "00000000-0000-0000-0000-000000000000" : id}"`,
  `remote = ${local ? "false" : "true"}`,
  "",
].join("\n"));

let code = 1;
const proxy = await getPlatformProxy({ configPath: config, persist: false });
try {
  // every migration in order (0001 v2 tables, 0002 v3: rates, ledger, pools, splits, house_hours), on scratch tables
  const migrations = MIGRATIONS.map((f) => readFileSync(resolve(here, "../migrations", f), "utf8"));
  const results = await runGuardChecks(proxy.env.PILOT_DB, migrations);
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.ok ? "" : `: ${r.detail}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) FAILED on ${local ? "the local" : "the remote"} D1 "${name}": do not open the pilot.` : `\nall ${results.length} checks passed on ${local ? "the local" : "the remote"} D1 "${name}".`);
  code = failed ? 1 : 0;
} finally {
  await proxy.dispose();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
