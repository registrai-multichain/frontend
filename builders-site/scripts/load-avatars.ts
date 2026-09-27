/**
 * Mirror invited projects' X pictures into the builders KV (`avatar:<source>`), so
 * /api/icon serves them without calling a third party at request time (lib/avatars.ts).
 *
 *   npx tsx builders-site/scripts/load-avatars.ts [domain:<host> …]   (default: every invited domain source with an X handle)
 *   --dry-run   look everything up and print, write nothing
 *
 * A source whose own site icon works is skipped, so a mirror never shadows a real icon.
 * Pictures come from unavatar.io from this machine (a normal connection), capped at
 * 200 KB and sniffed as an image. Writes with `wrangler kv key put --binding INVITES
 * --remote` from builders-site/, the same Cloudflare login as deploy:builders.
 * Re-run it when a domain project without a site icon is invited or changes its picture.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findSiteIcon, findXAvatar } from "../../src/lib/site-icon";
import { avatarCandidates, avatarKey, encodeAvatar } from "../lib/avatars";

const INVITES_URL = "https://builder.registrai.cc/api/invites";

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const only = new Set(args.filter((a) => a.startsWith("domain:")));
  const res = await fetch(INVITES_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${INVITES_URL}: HTTP ${res.status}`);
  const { invites } = (await res.json()) as { invites: { source: string; x?: string }[] };
  const todo = avatarCandidates(invites).filter((c) => !only.size || only.has(c.source));
  const tmp = mkdtempSync(join(tmpdir(), "avatars-"));
  let loaded = 0;
  try {
    for (const { source, handle } of todo) {
      if (await findSiteIcon(source)) {
        console.log(`skip   ${source}: its site icon works`);
        continue;
      }
      const pic = await findXAvatar(handle);
      if (!pic) {
        console.log(`none   ${source}: no X picture for ${handle}`);
        continue;
      }
      const value = encodeAvatar(pic, `x:${handle}`, new Date());
      console.log(`${dry ? "would load" : "loading"} ${avatarKey(source)}  (${pic.type}, ${pic.bytes.length} bytes, from ${handle})`);
      if (dry) continue;
      const file = join(tmp, "value.json");
      writeFileSync(file, value);
      execFileSync(
        "npx",
        ["wrangler", "kv", "key", "put", avatarKey(source), "--path", file, "--binding", "INVITES", "--remote",
          "--metadata", JSON.stringify({ source, from: `x:${handle}`, type: pic.type })],
        { cwd: resolve(__dirname, ".."), stdio: ["ignore", "ignore", "inherit"] },
      );
      loaded++;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(dry ? `checked ${todo.length} source(s)` : `loaded ${loaded} picture(s) of ${todo.length} source(s)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
