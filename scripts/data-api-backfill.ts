/**
 * One-off: load Data API v1 history into registrai-data from the index server's hourly archives.
 *   scp -r root@<radar>:/opt/abi/out/archive  <archive-dir>      (read-only copy)
 *   scp root@<radar>:/opt/abi/out/index*.json <current-dir>
 *   npx tsx scripts/data-api-backfill.ts <archive-dir> <current-dir> /tmp/backfill.sql
 *   (cd builders-site && npx wrangler d1 execute registrai-data --remote --file /tmp/backfill.sql)
 * Idempotent (INSERT OR REPLACE), so a re-run or an overlap with live pushes is harmless.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { AbiData } from "../src/lib/builders-index";
import { indexHourRows, memberHourRows, type IndexHourRow, type IndexId, type MemberHourRow } from "../builders-site/lib/data-api-rows";
import { upsertSql } from "../builders-site/lib/data-api-ingest";

const lit = (v: unknown) => (typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v));

export function backfillStatements(files: { index: IndexId; data: AbiData }[]): string[] {
  // archives repeat the last 30 days of candles: keep one row per key, the later file's (files come oldest first)
  const byKey = new Map<string, IndexHourRow | MemberHourRow>();
  for (const { index, data } of files)
    for (const r of [...indexHourRows(index, data), ...memberHourRows(index, data)]) byKey.set("id" in r ? `m|${r.index}|${r.id}|${r.hour}` : `i|${r.index}|${r.hour}`, r);
  return upsertSql([...byKey.values()]).map(({ sql, params }) => { let i = 0; return sql.replace(/\?/g, () => lit(params[i++])) + ";"; });
}

const SUFFIX: Record<string, IndexId> = { "index.json": "abi", "index-aii.json": "aii", "index-aei.json": "aei" };

function main([archive, current, out]: string[]) {
  const files: { index: IndexId; data: AbiData }[] = [];
  for (const day of readdirSync(archive).filter((d) => /^\d{8}$/.test(d)).sort())
    for (const f of readdirSync(join(archive, day)).sort()) {
      const m = f.match(/^\d{8}T\d{2}-(index(?:-aii|-aei)?\.json)\.gz$/);
      if (!m) continue;
      try { files.push({ index: SUFFIX[m[1]], data: JSON.parse(gunzipSync(readFileSync(join(archive, day, f))).toString()) }); }
      catch (e) { console.warn("skipped unreadable archive", f, String(e)); }
    }
  for (const [name, index] of Object.entries(SUFFIX)) files.push({ index, data: JSON.parse(readFileSync(join(current, name), "utf8")) });
  const sql = backfillStatements(files);
  writeFileSync(out, sql.join("\n") + "\n");
  console.log(`wrote ${sql.length} statements from ${files.length} files to ${out}`);
}

if (process.argv[1]?.endsWith("data-api-backfill.ts")) main(process.argv.slice(2));
