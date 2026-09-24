import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const FRONTEND = resolve(__dirname, "../..");

describe("builders-site packaging", () => {
  test("the main site (frontend/, `wrangler pages deploy out`) has no Pages Functions to pick up", () => {
    expect(existsSync(resolve(FRONTEND, "functions"))).toBe(false);
    expect(existsSync(resolve(FRONTEND, "public/_worker.js"))).toBe(false);
    expect(existsSync(resolve(FRONTEND, "builders-site/functions/api/admin/_middleware.ts"))).toBe(true);
  });

  test("the builders site ships /admin and deploys from builders-site/", () => {
    const build = readFileSync(resolve(FRONTEND, "scripts/build-builders-site.sh"), "utf8");
    expect(build).toMatch(/for x in [^\n]*\badmin\b/);
    expect(build).toMatch(/case "\$d" in [^\n]*\|admin\|/);
    const deploy = readFileSync(resolve(FRONTEND, "scripts/deploy-builders-site.sh"), "utf8");
    expect(deploy).toContain('cd "$(dirname "$0")/../builders-site"');
    const pkg = JSON.parse(readFileSync(resolve(FRONTEND, "package.json"), "utf8"));
    expect(pkg.scripts["deploy:builders"]).toContain("deploy-builders-site.sh");
    expect(pkg.scripts.deploy).not.toContain("builders-site");
    const toml = readFileSync(resolve(FRONTEND, "builders-site/wrangler.toml"), "utf8");
    expect(toml).toMatch(/^name = "registrai-builders"$/m);
    expect(toml).toMatch(/^pages_build_output_dir = "\.\.\/dist-builders"$/m);
    expect(toml).toMatch(/^binding = "INVITES"$/m);
  });
});
