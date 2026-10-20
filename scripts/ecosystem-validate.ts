/** Validate a file of ecosystem entries (the published file or a draft batch): npx tsx scripts/ecosystem-validate.ts <file.json> */
import { readFileSync } from "node:fs";
import { validateEntities } from "../src/lib/arc-ecosystem";

const file = process.argv[2];
if (!file) { console.error("usage: npx tsx scripts/ecosystem-validate.ts <file.json>"); process.exit(1); }
const r = validateEntities(JSON.parse(readFileSync(file, "utf8")));
if (r.ok) console.log(`${r.entities.length} entries valid`);
else { for (const e of r.errors) console.log(e); process.exit(1); }
