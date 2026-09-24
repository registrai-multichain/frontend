/**
 * Regenerates src/lib/__fixtures__/verified-builder-vectors.json — the shared
 * test vectors for the verified-builders rules (TS here, Python in the keeper).
 *
 *   npx tsx scripts/gen-verified-builder-vectors.ts
 *
 * Deterministic: RFC 6979 signatures with anvil's public dev keys, which hold
 * nothing anywhere real. src/lib/verified-builders.test.ts fails if the checked-in
 * file drifts from what this script produces.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildVerifiedBuilderVectors } from "../src/lib/verified-builder-vectors";

async function main() {
  const vectors = await buildVerifiedBuilderVectors();
  const target = resolve(__dirname, "../src/lib/__fixtures__/verified-builder-vectors.json");
  writeFileSync(target, `${JSON.stringify(vectors, null, 2)}\n`);
  console.log(`wrote ${target}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
