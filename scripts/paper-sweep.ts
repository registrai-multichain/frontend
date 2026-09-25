/**
 * npx tsx scripts/paper-sweep.ts          the readability sweep (Task 7)
 * npx tsx scripts/paper-sweep.ts --prune  drop dead scoped CSS rules (Task 12)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pruneCss, scopedTsxFiles, sweepCss, sweepTsx } from "../src/lib/paper-sweep";

const ROOT = process.cwd();
const CSS = join(ROOT, "src/app/globals.css");

function allSource(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allSource(p, out);
    else if (/\.(tsx?|jsx?)$/.test(p)) out.push(p);
  }
  return out;
}

if (process.argv.includes("--prune")) {
  const words = new Set<string>();
  for (const f of allSource(join(ROOT, "src"))) for (const w of readFileSync(f, "utf8").match(/[A-Za-z][\w-]*/g) ?? []) words.add(w);
  const { css, removed } = pruneCss(readFileSync(CSS, "utf8"), words);
  writeFileSync(CSS, css + "\n");
  console.log(`pruned ${removed.length} selectors:\n${removed.join("\n")}`);
} else {
  const { css, unknown } = sweepCss(readFileSync(CSS, "utf8"));
  writeFileSync(CSS, css);
  let changed = 0;
  for (const f of scopedTsxFiles(ROOT)) {
    const s = readFileSync(f, "utf8");
    const t = sweepTsx(s);
    if (t !== s) { writeFileSync(f, t); changed++; }
  }
  console.log(`swept globals.css and ${changed} component files`);
  if (unknown.length) console.log(`colours left as they were (review by hand):\n${unknown.join("\n")}`);
}
