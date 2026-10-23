/**
 * Load nomination drafts into the builders KV (`draft:<source>`), for /admin → Nominate
 * on chain. Each file is validated with validateDraft first; an invalid file stops the
 * run before anything is written.
 *
 *   npx tsx builders-site/scripts/load-drafts.ts [dir]      (default ../docs/superpowers/investigations/drafts)
 *   --dry-run   validate and print, write nothing
 *
 * Writes with `wrangler kv key put --binding INVITES --remote` from builders-site/, so it
 * uses the same Cloudflare login as deploy:builders.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { validateDraft } from "../../src/lib/drafts";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? resolve(__dirname, "../../../docs/superpowers/investigations/drafts"));
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
if (!files.length) {
  console.error(`no draft files in ${dir}`);
  process.exit(1);
}
const drafts = files.map((f) => {
  const v = validateDraft(JSON.parse(readFileSync(resolve(dir, f), "utf8")));
  if (!v.ok) {
    console.error(`${f}: ${v.error}`);
    process.exit(1);
  }
  return v.value;
});
for (const d of drafts) {
  console.log(`${dry ? "would load" : "loading"} draft:${d.source}  (${d.recommendation}, ${d.invite.name})`);
  if (dry) continue;
  execFileSync(
    "npx",
    ["wrangler", "kv", "key", "put", `draft:${d.source}`, JSON.stringify(d), "--binding", "INVITES", "--remote",
      "--metadata", JSON.stringify({ source: d.source, name: d.invite.name })],
    { cwd: resolve(__dirname, ".."), stdio: ["ignore", "ignore", "inherit"] },
  );
}
console.log(`${dry ? "validated" : "loaded"} ${drafts.length} draft(s)`);
