import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { RETIRED_ROUTES, BUILDERS_SITE_ROUTES, DASHBOARD_SITE_ROUTES, PUBLIC_ROUTES, TESTNET_ROUTES, appSiteRedirects, builderUrl, dashboardSiteRedirects, publicRedirects } from "./public-site";

const APP = resolve(__dirname, "../app");

describe("public registrai.cc", () => {
  test("every app route is decided: public, moved to the builders site, or testnet (redirected)", () => {
    const routes = readdirSync(APP).filter((d) => statSync(resolve(APP, d)).isDirectory() && !d.startsWith("(") && !d.startsWith("_"));
    const decided = [...PUBLIC_ROUTES, ...BUILDERS_SITE_ROUTES, ...RETIRED_ROUTES, ...DASHBOARD_SITE_ROUTES, ...TESTNET_ROUTES] as string[];
    expect(routes.filter((r) => !decided.includes(r)), "new app route: add it to src/lib/public-site.ts").toEqual([]);
    expect(new Set(decided).size).toBe(decided.length);
  });

  test("the redirects: builders routes to builder.registrai.cc, testnet routes to the landing, the bridge stays", () => {
    const r = publicRedirects();
    expect(r).toContain("/verify/* https://builder.registrai.cc/verify/:splat 302");
    expect(r).toContain("/builders https://builder.registrai.cc/builders/ 302");
    expect(r).toContain("/perennial https://builder.registrai.cc/ 301");
    expect(r).toContain("/perennial/* https://builder.registrai.cc/ 301");
    expect(r).toContain("/rounds/* https://builder.registrai.cc/ 301");
    expect(r).toContain("/atlas https://builder.registrai.cc/ 301");
    expect(r).toContain("/transparency https://dashboard.registrai.cc/ 302");
    expect(r).toContain("/transparency/* https://dashboard.registrai.cc/ 302");
    expect(r).toContain("/markets / 302");
    expect(r).toContain("/methodology/* / 302");
    const sources = r.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(" ")[0]);
    for (const kept of ["/", "/bridge", "/bridge/*", "/.well-known/*", "/brand/*", "/social/*"]) expect(sources).not.toContain(kept);
    // no redirect points back into a redirected path (no loops)
    for (const l of r.split("\n").filter((x) => x && !x.startsWith("#"))) {
      const to = l.split(" ")[1];
      expect(to === "/" || to.startsWith("https://builder.registrai.cc/") || to.startsWith("https://dashboard.registrai.cc/")).toBe(true);
    }
  });
});

describe("app.registrai.cc", () => {
  test("is retired: the bridge and builder pages point to their own sites, everything else to builder.registrai.cc", () => {
    expect([...RETIRED_ROUTES].sort()).toEqual(["atlas", "perennial", "propose", "rounds"]);
    const r = appSiteRedirects();
    expect(r).toContain("/bridge https://registrai.cc/bridge/ 301");
    expect(r).toContain("/verify/* https://builder.registrai.cc/verify/:splat 301");
    expect(r).toContain("/builders https://builder.registrai.cc/builders/ 301");
    expect(r).toContain("/transparency/* https://dashboard.registrai.cc/ 302");
    const rules = r.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(rules.at(-1)).toBe("/* https://builder.registrai.cc/ 301");
    expect(r).not.toContain("app.registrai.cc/");
  });
});

describe("dashboard.registrai.cc", () => {
  test("serves the transparency dashboard at its root; every other page points to its own site", () => {
    expect([...DASHBOARD_SITE_ROUTES]).toEqual(["transparency"]);
    const r = dashboardSiteRedirects();
    expect(r).toContain("/transparency / 301");
    expect(r).toContain("/transparency/* / 301");
    expect(r).toContain("/perennial/* https://builder.registrai.cc/ 301");
    expect(r).toContain("/atlas https://builder.registrai.cc/ 301");
    expect(r).toContain("/builders https://builder.registrai.cc/builders/ 302");
    expect(r).toContain("/bridge https://registrai.cc/bridge/ 302");
    const sources = r.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(" ")[0]);
    for (const kept of ["/", "/index.html", "/_next/*"]) expect(sources).not.toContain(kept);
  });
});

describe("canonical host of the builders site", () => {
  test("builderUrl is the builder.registrai.cc URL with a trailing slash", () => {
    expect(builderUrl("data-api")).toBe("https://builder.registrai.cc/data-api/");
    expect(builderUrl("/apps/")).toBe("https://builder.registrai.cc/apps/");
    expect(builderUrl("")).toBe("https://builder.registrai.cc/");
  });

  // registrai.cc/<route> 302s to builder.registrai.cc, so a canonical on registrai.cc points crawlers in a loop
  test("every builders-site page declares its own canonical on builder.registrai.cc", () => {
    const pages = BUILDERS_SITE_ROUTES.filter((r) => r !== "admin" && existsSync(resolve(APP, r, "page.tsx")));
    expect(pages.length).toBeGreaterThan(10);
    for (const r of pages) {
      const src = readFileSync(resolve(APP, r, "page.tsx"), "utf8");
      expect(src, `${r}/page.tsx`).toContain(`canonical: builderUrl("${r}")`);
    }
  });
});
