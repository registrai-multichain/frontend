import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The app's unified paper UI (src/styles/paper-ui.css) is a scoped layer: every
 * rule hangs off `.paper-ui` (PerennialShell's root), so the dashboard and the
 * builders site, which share `.paper-type` and the global tokens, keep their look.
 */

const ROOT = resolve(__dirname, "../..");
const LAYER = resolve(ROOT, "src/styles/paper-ui.css");
/** The merge of feat/builder-atlas (Task 11 step 0): the shared tokens as they were before the layer. */
const BASELINE = "abbe895be02c33490ae5cebf7108f46361bec11f";

const TOKENS = [
  "--pu-page", "--pu-ink", "--pu-accent", "--pu-accent-hover", "--pu-rule", "--pu-edge", "--pu-card", "--pu-field",
  "--pu-lede", "--pu-label", "--pu-muted", "--pu-body", "--pu-pill-edge", "--pu-up", "--pu-down", "--pu-display", "--pu-sans",
];

type Rule = { selector: string; body: string };

/** Style rules (selector + declarations) of a stylesheet, descending into @media / @supports. */
function rules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let i = 0;
  const walk = (end: number) => {
    while (i < end) {
      const open = src.indexOf("{", i);
      if (open < 0 || open >= end) return;
      const head = src.slice(i, open).trim();
      // the matching brace
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      if (head.startsWith("@media") || head.startsWith("@supports")) {
        i = open + 1;
        walk(j - 1);
      } else if (!head.startsWith("@")) {
        out.push({ selector: head.replace(/\s+/g, " "), body: src.slice(open + 1, j - 1).replace(/\s+/g, " ").trim() });
      }
      i = j;
    }
  };
  walk(src.length);
  return out;
}

const selectors = (r: Rule) => r.selector.split(",").map((s) => s.trim());
/** The rules that define the shared tokens and type: `:root`, `.paper-theme`, `.paper-type…`. */
const sharedRules = (css: string) =>
  rules(css).filter((r) => selectors(r).some((s) => s === ":root" || s.startsWith(".paper-theme") || s.startsWith(".paper-type")));

function atBaseline(path: string): string {
  return execFileSync("git", ["show", `${BASELINE}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

describe("paper-ui layer", () => {
  const css = readFileSync(LAYER, "utf8");

  test("every rule is scoped to .paper-ui", () => {
    const all = rules(css);
    expect(all.length).toBeGreaterThan(10);
    for (const r of all) for (const s of selectors(r)) expect(s, r.selector).toMatch(/^\.paper-ui(?![\w-])/);
  });

  test("each token is defined exactly once, on .paper-ui itself", () => {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const t of TOKENS) expect(src.match(new RegExp(`${t}\\s*:`, "g"))?.length ?? 0, t).toBe(1);
    const root = rules(css).find((r) => r.selector === ".paper-ui");
    expect(root).toBeDefined();
    for (const t of TOKENS) expect(root!.body, t).toContain(`${t}:`);
  });

  test("it is imported once, after the shared paper styles", () => {
    const layout = readFileSync(resolve(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout.match(/paper-ui\.css/g)?.length).toBe(1);
    expect(layout.indexOf("paper-ui.css")).toBeGreaterThan(layout.indexOf("./paper.css"));
  });

  test("the app shell's root carries .paper-ui", () => {
    const shell = readFileSync(resolve(ROOT, "src/components/PerennialShell.tsx"), "utf8");
    expect(shell).toMatch(/className=\{?[`"][^`"]*\bpaper-ui\b/);
  });
});

describe("the shared tokens and .paper-type stay as they were", () => {
  for (const path of ["src/app/globals.css", "src/app/paper.css"]) {
    test(`${path}: :root, .paper-theme and .paper-type rules unchanged`, () => {
      const before = sharedRules(atBaseline(path));
      const now = sharedRules(readFileSync(resolve(ROOT, path), "utf8"));
      expect(before.length).toBeGreaterThan(0);
      expect(now).toEqual(before);
    });
  }
});
