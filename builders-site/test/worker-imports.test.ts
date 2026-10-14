import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Workers have no `process`. A module that reads it when it loads (e.g. Next's NEXT_PUBLIC_* env in src/lib) makes
 * `wrangler pages deploy` fail with "process is not defined". Walk every Pages Function's relative imports and refuse
 * any reachable module that mentions process.env / process.argv outside a comment.
 */
const FUNCTIONS = resolve(__dirname, "../functions");
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; });
const resolveImport = (from: string, spec: string) => {
  const base = resolve(dirname(from), spec);
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((p) => existsSync(p) && statSync(p).isFile()) ?? null;
};
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("Pages Functions import graph", () => {
  test("no module reachable from a Function reads process (Workers have none)", () => {
    const seen = new Set<string>(), offenders: string[] = [];
    const walk = (f: string) => {
      if (seen.has(f)) return;
      seen.add(f);
      const src = readFileSync(f, "utf8");
      if (/\bprocess\.(env|argv)\b/.test(code(src))) offenders.push(f.replace(resolve(__dirname, "../.."), ""));
      for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/gm)) {
        const p = resolveImport(f, m[1]);
        if (p && !p.endsWith(".json")) walk(p);
      }
    };
    for (const f of files(FUNCTIONS)) walk(f);
    expect(offenders).toEqual([]);
  });
});
