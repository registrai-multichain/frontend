/** Monthly: list announced entries to re-check. npx tsx scripts/ecosystem-stale.ts [YYYY-MM-DD] */
import { readFileSync } from "node:fs";
import { staleEntries, type ArcEntity } from "../src/lib/arc-ecosystem";

const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const l = staleEntries(JSON.parse(readFileSync("src/data/arc-ecosystem/entities.json", "utf8")) as ArcEntity[], today);
console.log(`${l.length} announced entries to re-check`);
for (const e of l) console.log(`${e.slug}\tlast reviewed ${e.last_reviewed}`);
