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

  test("the builders site serves badge art with the generic fallback, and ships the generic pictures", () => {
    expect(existsSync(resolve(FRONTEND, "builders-site/functions/badge/[net]/[file].ts"))).toBe(true);
    expect(existsSync(resolve(FRONTEND, "builders-site/functions/api/proof.ts"))).toBe(true);
    const build = readFileSync(resolve(FRONTEND, "scripts/build-builders-site.sh"), "utf8");
    expect(build).toMatch(/for x in [^\n]*\bbadge\b/);
    expect(build).toContain("badge-generic.jpg");
    expect(build).toContain("badge-generic-lapsed.jpg");
    const render = readFileSync(resolve(FRONTEND, "scripts/render-badges.py"), "utf8");
    expect(render).toContain('GENERIC = "badge-generic"');
    expect(render).toContain('"--generic"');
    const pkg = JSON.parse(readFileSync(resolve(FRONTEND, "package.json"), "utf8"));
    expect(pkg.scripts["deploy:builders"]).toMatch(/^python3 scripts\/render-badges\.py && next build && bash scripts\/build-builders-site\.sh/);
  });

  test("the builders site ships a tight CSP and the security headers", () => {
    const build = readFileSync(resolve(FRONTEND, "scripts/build-builders-site.sh"), "utf8");
    // The full _headers is written fresh by the build (not inherited from public/_headers).
    const csp = build.match(/Content-Security-Policy: ([^\n]+)/)?.[1] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Injected wallet does its own RPC; the read client + proof fallback are the only egress.
    expect(csp).toContain("connect-src 'self' https://rpc.mainnet.arc.io https://rpc.testnet.arc.io https://raw.githubusercontent.com");
    expect(csp).toContain("img-src 'self' data: blob: https://avatars.githubusercontent.com");
    // Next static export emits per-build inline hydration scripts: 'unsafe-inline' is required.
    expect(csp).toMatch(/script-src 'self' 'unsafe-inline'/);
    expect(build).toMatch(/Strict-Transport-Security: max-age=\d+; includeSubDomains/);
    expect(build).toContain("Permissions-Policy:");
    expect(build).toContain("Cross-Origin-Opener-Policy: same-origin-allow-popups");
    // The badges must stay cross-origin embeddable, and there must be no global
    // CORP that Cloudflare would combine into an invalid doubled header.
    expect(build).toMatch(/\/badge\/\*\n(?:[^\n]*\n)*?\s+Cross-Origin-Resource-Policy: cross-origin/);
    expect(build).not.toMatch(/\/\*\n(?:[^\n]*\n)*?\s+Cross-Origin-Resource-Policy: same-origin/);
  });

  test("NONCE_SECRET is documented where the deploy happens (a Pages secret, never in wrangler.toml)", () => {
    const toml = readFileSync(resolve(FRONTEND, "builders-site/wrangler.toml"), "utf8");
    expect(toml).toContain("wrangler pages secret put NONCE_SECRET");
    expect(toml).not.toMatch(/^NONCE_SECRET\s*=/m);
    expect(readFileSync(resolve(FRONTEND, "scripts/deploy-builders-site.sh"), "utf8")).toContain("NONCE_SECRET");
  });
});
