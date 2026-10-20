/**
 * Seed candidates for the Arc ecosystem directory (plan 2026-10-20-arc-ecosystem-directory.md, Task 2).
 * Reads the owner's tracker READ-ONLY, the live index members and DefiLlama's Arc protocols; writes a git-ignored draft.
 *   npx tsx scripts/ecosystem-seed.ts [--out .superpowers/arc-ecosystem/draft.json]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mergeCandidates, type LlamaItem, type MemberItem, type TrackerItem } from "../src/lib/arc-ecosystem-seed";

const TRACKER = "/Users/tobiasd/Desktop/arc/research/arc-builders-index/integrations.json";
(async () => {
  const i = process.argv.indexOf("--out");
  const out = resolve(i > 0 ? process.argv[i + 1] : ".superpowers/arc-ecosystem/draft.json");
  const tracker = JSON.parse(readFileSync(TRACKER, "utf8")) as TrackerItem[];
  const members = ((await (await fetch("https://builder.registrai.cc/api/v1/members?index=aei")).json()) as { members: MemberItem[] }).members
    .filter((m) => m.kind !== "base");
  const llama = (await (await fetch("https://api.llama.fi/protocols")).json()) as LlamaItem[];
  const c = mergeCandidates({ tracker, members, llama });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(c, null, 2));
  const by = (k: string) => c.filter((x) => x.status === k).length;
  console.log(`${c.length} candidates (${by("live")} live, ${by("deployed")} deployed, ${by("announced")} announced) → ${out}`);
})().catch((e) => { console.error("seed failed:", e instanceof Error ? e.message : e); process.exit(1); });
