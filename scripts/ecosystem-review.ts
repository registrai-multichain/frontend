/**
 * Apply a reviewed set of directory changes (src/lib/arc-ecosystem-review.ts) to entities.json and the corrections log.
 *   npx tsx scripts/ecosystem-review.ts --file docs/ecosystem-review/2026-10-23.json [--day 2026-10-23]
 * Validates both files before writing; writes nothing on any error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateEntities, type ArcEntity } from "../src/lib/arc-ecosystem";
import { validateCorrections, type CorrectionEntry } from "../src/lib/arc-ecosystem-corrections";
import { applyReview, type ReviewItem } from "../src/lib/arc-ecosystem-review";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const file = arg("file");
if (!file) { console.error("usage: npx tsx scripts/ecosystem-review.ts --file <items.json> [--day YYYY-MM-DD]"); process.exit(1); }
const day = arg("day") ?? new Date().toISOString().slice(0, 10);
const ENT = resolve("src/data/arc-ecosystem/entities.json"), COR = resolve("src/data/arc-ecosystem/corrections.json");
const items = JSON.parse(readFileSync(resolve(file), "utf8")) as ReviewItem[];
const r = applyReview(JSON.parse(readFileSync(ENT, "utf8")) as ArcEntity[], JSON.parse(readFileSync(COR, "utf8")) as CorrectionEntry[], items, day);
const ve = validateEntities(r.entities), vc = validateCorrections(r.corrections, new Set(r.entities.map((e) => e.slug)));
if (!ve.ok || !vc.ok) { console.error([...(ve.ok ? [] : ve.errors), ...(vc.ok ? [] : vc.errors)].join("\n")); process.exit(1); }
writeFileSync(ENT, `${JSON.stringify(r.entities, null, 2)}\n`);
writeFileSync(COR, `${JSON.stringify(r.corrections, null, 2)}\n`);
const by = items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.field]: (m[i.field] ?? 0) + 1 }), {});
console.log(`applied ${items.length} items (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ")}); log has ${r.corrections.length} entries`);
