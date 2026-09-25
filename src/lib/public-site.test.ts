import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { BUILDERS_SITE_ROUTES, PUBLIC_ROUTES, TESTNET_ROUTES, publicRedirects } from "./public-site";

const APP = resolve(__dirname, "../app");

describe("public registrai.cc", () => {
  test("every app route is decided: public, moved to the builders site, or testnet (redirected)", () => {
    const routes = readdirSync(APP).filter((d) => statSync(resolve(APP, d)).isDirectory() && !d.startsWith("(") && !d.startsWith("_"));
    const decided = [...PUBLIC_ROUTES, ...BUILDERS_SITE_ROUTES, ...TESTNET_ROUTES] as string[];
    expect(routes.filter((r) => !decided.includes(r)), "new app route: add it to src/lib/public-site.ts").toEqual([]);
    expect(new Set(decided).size).toBe(decided.length);
  });

  test("the redirects: builders routes to builder.registrai.cc, testnet routes to the landing, the bridge stays", () => {
    const r = publicRedirects();
    expect(r).toContain("/verify/* https://builder.registrai.cc/verify/:splat 302");
    expect(r).toContain("/builders https://builder.registrai.cc/builders/ 302");
    expect(r).toContain("/perennial/* / 302");
    expect(r).toContain("/markets / 302");
    expect(r).toContain("/methodology/* / 302");
    const sources = r.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(" ")[0]);
    for (const kept of ["/", "/bridge", "/bridge/*", "/.well-known/*", "/brand/*", "/social/*"]) expect(sources).not.toContain(kept);
    // no redirect points back into a redirected path (no loops)
    for (const l of r.split("\n").filter((x) => x && !x.startsWith("#"))) {
      const to = l.split(" ")[1];
      expect(to === "/" || to.startsWith("https://builder.registrai.cc/")).toBe(true);
    }
  });
});
