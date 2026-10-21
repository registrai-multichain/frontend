/** Validate a file of ecosystem entries (the published file or a draft batch): npx tsx scripts/ecosystem-validate.ts <file.json>
 *  With the published file, corrections.json next to it is validated against its slugs too. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateEntities } from "../src/lib/arc-ecosystem";
import { validateCorrections } from "../src/lib/arc-ecosystem-corrections";

const file = process.argv[2];
if (!file) { console.error("usage: npx tsx scripts/ecosystem-validate.ts <file.json>"); process.exit(1); }
const r = validateEntities(JSON.parse(readFileSync(file, "utf8")));
if (!r.ok) { for (const e of r.errors) console.log(e); process.exit(1); }
console.log(`${r.entities.length} entries valid`);
const log = join(dirname(file), "corrections.json");
if (existsSync(log)) {
  const c = validateCorrections(JSON.parse(readFileSync(log, "utf8")), new Set(r.entities.map((e) => e.slug)));
  if (!c.ok) { for (const e of c.errors) console.log(`corrections.json ${e}`); process.exit(1); }
  console.log(`${c.corrections.length} corrections valid`);
}
