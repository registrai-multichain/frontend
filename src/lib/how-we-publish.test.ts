import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { VERDICT_WORDS } from "./facts";
import { BUILDERS_SITE_ROUTES } from "./public-site";
import { projectHref } from "./project-page";

describe("how-we-publish + routing", () => {
  test("both new routes are builder-site routes", () => {
    expect(BUILDERS_SITE_ROUTES).toContain("project");
    expect(BUILDERS_SITE_ROUTES).toContain("how-we-publish");
  });
  test("the build script copies and keeps both routes", () => {
    const sh = readFileSync(new URL("../../scripts/build-builders-site.sh", import.meta.url), "utf8");
    const copy = sh.split("\n").filter((l) => l.includes("for x in"))[0];
    const keep = sh.split("\n").filter((l) => l.includes("case"))[0];
    for (const r of ["project", "how-we-publish"]) {
      expect(copy, `copy list ${r}`).toContain(r);
      expect(keep, `case list ${r}`).toContain(r);
    }
  });
  test("projectHref encodes github sources", () => {
    expect(projectHref("github:owner/repo")).toBe("/project/?source=github%3Aowner%2Frepo");
  });
  test("the policy page states the rules and uses no verdict words", () => {
    const src = readFileSync(new URL("../app/how-we-publish/page.tsx", import.meta.url), "utf8");
    for (const must of ["proof, not opinions", "You judge", "30 days", "No personal data", "Nobody can pay us to change a fact"]) {
      expect(src, must).toContain(must);
    }
    for (const w of VERDICT_WORDS) expect(src.toLowerCase(), w).not.toMatch(new RegExp(`\\b${w.replace(" ", "\\s+")}\\b`));
  });
});
