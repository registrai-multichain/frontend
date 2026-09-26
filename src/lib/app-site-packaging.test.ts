import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const FRONTEND = resolve(__dirname, "../..");

test("app.registrai.cc: built for mainnet, ships only the markets app, deploys to registrai-app", () => {
  const pkg = JSON.parse(readFileSync(resolve(FRONTEND, "package.json"), "utf8"));
  expect(pkg.scripts["deploy:app"]).toMatch(/^NEXT_PUBLIC_PERENNIAL_NETWORK=mainnet next build && bash scripts\/build-app-site\.sh && wrangler pages deploy dist-app --project-name=registrai-app --branch=main$/);
  const build = readFileSync(resolve(FRONTEND, "scripts/build-app-site.sh"), "utf8");
  const shipped = /for x in ([^;]*); do/s.exec(build)![1].replace(/\\\n/g, " ").split(/\s+/).filter(Boolean);
  for (const r of ["perennial", "rounds", "atlas", "_next"]) expect(shipped).toContain(r);
  for (const r of ["transparency", "bridge", "builders", "verify", "admin", "markets", "lending", "data", "legacy"]) expect(shipped).not.toContain(r);
  expect(build).toContain("appSiteRedirects()");
  expect(build).toMatch(/connect-src 'self' https:\/\/rpc\.mainnet\.arc\.io/);
});

test("dashboard.registrai.cc: built for mainnet, ships only the transparency page at its root, deploys to registrai-dashboard", () => {
  const pkg = JSON.parse(readFileSync(resolve(FRONTEND, "package.json"), "utf8"));
  expect(pkg.scripts["deploy:dashboard"]).toMatch(/^NEXT_PUBLIC_PERENNIAL_NETWORK=mainnet next build && bash scripts\/build-dashboard-site\.sh && wrangler pages deploy dist-dashboard --project-name=registrai-dashboard --branch=main$/);
  const build = readFileSync(resolve(FRONTEND, "scripts/build-dashboard-site.sh"), "utf8");
  const shipped = /for x in ([^;]*); do/s.exec(build)![1].replace(/\\\n/g, " ").split(/\s+/).filter(Boolean);
  expect(shipped).toContain("_next");
  for (const r of ["perennial", "rounds", "atlas", "bridge", "builders", "verify", "admin", "brand", "social"]) expect(shipped).not.toContain(r);
  expect(build).toContain('cp out/transparency/index.html "$D/index.html"');
  expect(build).toContain("dashboardSiteRedirects()");
  expect(build).toMatch(/connect-src 'self' https:\/\/rpc\.mainnet\.arc\.io https:\/\/api\.dexscreener\.com;/);
});
