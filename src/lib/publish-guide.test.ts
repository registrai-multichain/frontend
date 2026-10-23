import { describe, expect, test } from "vitest";
import { publishGuide } from "./publish-guide";
import { proofUrl } from "./verified-builders";

describe("publishGuide", () => {
  test("repo: .registrai.json at the root of the default branch, web and terminal recipes", () => {
    const g = publishGuide("github:acme/tool");
    expect(g.kind).toBe("repo");
    expect(g.target).toBe(".registrai.json in the root of acme/tool, on its default branch");
    expect(g.recipes.map((r) => r.id)).toEqual(["github-web", "git"]);
    expect(g.recipes[0].steps.join(" ")).toContain("github.com/acme/tool");
    expect(g.recipes[0].steps.join(" ")).toContain(".registrai.json");
    expect(g.recipes[1].code).toContain("git add .registrai.json");
    expect(g.rules.join(" ")).toMatch(/public/);
    // the checks read exactly this file
    expect(proofUrl("github:acme/tool")).toMatch(/\/acme\/tool\/HEAD\/\.registrai\.json$/);
  });

  test("domain: every recipe lands on /.well-known/registrai.json, and the rules name the exact URL", () => {
    const g = publishGuide("domain:app.acme.dev");
    expect(g.kind).toBe("domain");
    expect(g.target).toBe("https://app.acme.dev/.well-known/registrai.json");
    expect(g.target).toBe(proofUrl("domain:app.acme.dev"));
    expect(g.recipes.map((r) => r.id)).toEqual(["next-vercel", "static", "github-pages", "cpanel", "server"]);
    for (const r of g.recipes) expect(`${r.steps.join(" ")} ${r.code ?? ""}`).toContain(".well-known");
    expect(g.recipes.find((r) => r.id === "github-pages")!.steps.join(" ")).toContain(".nojekyll");
    expect(g.rules[0]).toContain("https://app.acme.dev/.well-known/registrai.json");
    expect(g.rules.join(" ")).toContain("curl https://app.acme.dev/.well-known/registrai.json");
    expect(g.rules.join(" ")).toMatch(/At most 3 redirects/);
    expect(g.rules.join(" ")).toMatch(/20 KB/);
  });
});
