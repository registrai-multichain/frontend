/**
 * Approved ecosystem corrections, for the engineer applying them (spec docs/superpowers/specs/2026-10-21-ecosystem-corrections-design.md §4).
 * Run from the repo root; uses your wrangler login against the remote registrai-data database.
 *   npx tsx scripts/ecosystem-corrections.ts list              approved, not yet applied
 *   npx tsx scripts/ecosystem-corrections.ts next-id           the next id for src/data/arc-ecosystem/corrections.json
 *   npx tsx scripts/ecosystem-corrections.ts mark-applied 3 5  after the deploy that contains them
 * Applying is an edit: change entities.json (and that entry's last_reviewed), add one log entry per correction
 * (from: project when domain_match was 1, else reader; change: the approved public note), validate, test, commit, deploy.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRow, listSql, markAppliedSql, nextLogId, type ApprovedRow } from "../src/lib/arc-ecosystem-corrections-cli";

function d1(sql: string): { results: unknown[] }[] {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "registrai-data", "--remote", "--json", "--command", sql], { cwd: resolve("builders-site"), encoding: "utf8" });
  return JSON.parse(out) as { results: unknown[] }[];
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "list") {
  const rows = (d1(listSql())[0]?.results ?? []) as ApprovedRow[];
  console.log(rows.length ? rows.map(formatRow).join("\n\n") : "No approved corrections waiting.");
} else if (cmd === "next-id") {
  console.log(nextLogId(JSON.parse(readFileSync(resolve("src/data/arc-ecosystem/corrections.json"), "utf8")) as { id: number }[]));
} else if (cmd === "mark-applied") {
  d1(markAppliedSql(args.map(Number), Date.now() / 1000));
  console.log(`marked applied: ${args.join(", ")}`);
} else {
  console.error("usage: npx tsx scripts/ecosystem-corrections.ts list | next-id | mark-applied <id…>");
  process.exit(1);
}
