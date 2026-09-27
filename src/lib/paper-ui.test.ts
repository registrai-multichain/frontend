import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { cssRules, protectedRules, scopedToPaperUi, serializeRules, splitSelectors } from "./css-rules";

/**
 * The app's unified paper UI (src/styles/paper-ui.css) is a scoped layer: every
 * rule hangs off `.paper-ui` (PerennialShell's root), so the dashboard and the
 * builders site, which share `.paper-type` and the global tokens, keep their look.
 */

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const LAYER = "src/styles/paper-ui.css";
/** The shared tokens and type as they were before the layer (generated from abbe895, the Task 11 step-0 merge). */
const SNAPSHOT = "src/lib/__fixtures__/protected-css.txt";
const PROTECTED = ["src/app/globals.css", "src/app/paper.css"];

const TOKENS = [
  "--pu-page", "--pu-ink", "--pu-accent", "--pu-accent-hover", "--pu-rule", "--pu-edge", "--pu-card", "--pu-field",
  "--pu-lede", "--pu-label", "--pu-muted", "--pu-body", "--pu-pill-edge", "--pu-up", "--pu-down", "--pu-display", "--pu-sans",
];

const snapshotOf = (files: Record<string, string>) =>
  Object.entries(files).map(([path, css]) => `## ${path}\n${serializeRules(protectedRules(css))}\n`).join("\n");

/** Every selector of a stylesheet that is not scoped to .paper-ui. */
const unscoped = (css: string) => cssRules(css).flatMap((r) => splitSelectors(r.selector)).filter((s) => !scopedToPaperUi(s));

describe("css-rules", () => {
  test("a statement at-rule in front of a block does not hide it", () => {
    expect(cssRules("@tailwind base;\n@tailwind utilities;\n:root { --bg: red; }").map((r) => r.selector)).toEqual([":root"]);
  });

  test("grouping at-rules are descended into, opaque ones skipped, unknown ones refused", () => {
    const r = cssRules("@layer base { :root { --a: 1 } } @media (x) { @supports (y) { .b { c: d } } } @keyframes k { from { e: f } }");
    expect(r.map((x) => [x.context, x.selector])).toEqual([[["@layer base"], ":root"], [["@media (x)", "@supports (y)"], ".b"]]);
    expect(() => cssRules("@starting-style { .a { b: c } }")).toThrow(/unknown block at-rule/);
  });

  test("scope: descendants and children only", () => {
    for (const s of [".paper-ui", ".paper-ui .a", ".paper-ui > .a", ".paper-ui .a + .b", ".paper-ui:not(.x, .y) .a", ".paper-ui[data-x=\"a b\"] .c"]) {
      expect(scopedToPaperUi(s), s).toBe(true);
    }
    for (const s of [":root", ".a", ".paper-uix .a", ".paper-ui-x", "html .paper-ui", ".paper-ui ~ *", ".paper-ui + x", ".paper-ui~.a", ".paper-ui.is-x + .a"]) {
      expect(scopedToPaperUi(s), s).toBe(false);
    }
  });
});

describe("paper-ui layer", () => {
  const css = read(LAYER);

  test("every rule is scoped to .paper-ui, at any nesting", () => {
    expect(cssRules(css).length).toBeGreaterThan(10);
    expect(unscoped(css)).toEqual([]);
  });

  test("the guard catches an unscoped rule, also inside @layer / @media, and sibling escapes", () => {
    expect(unscoped(`${css}\n@layer x { .pu-card { color: red } }`)).toEqual([".pu-card"]);
    expect(unscoped(`${css}\n@media (min-width: 1px) { :root { --bg: red } }`)).toEqual([":root"]);
    expect(unscoped(`${css}\n.paper-ui ~ * { color: red }`)).toEqual([".paper-ui ~ *"]);
  });

  test("each token is defined exactly once, on .paper-ui itself", () => {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const t of TOKENS) expect(src.match(new RegExp(`${t}\\s*:`, "g"))?.length ?? 0, t).toBe(1);
    const root = cssRules(css).find((r) => r.selector === ".paper-ui" && r.context.length === 0);
    expect(root).toBeDefined();
    for (const t of TOKENS) expect(root!.body, t).toContain(`${t}:`);
  });

  test("a static card keeps its resting border on hover", () => {
    const r = cssRules(css).find((x) => x.selector === ".paper-ui .pu-card--static:hover");
    expect(r?.body).toBe("border-color: var(--pu-rule);");
    // after the brief's hover rule, so it wins at equal specificity
    expect(css.indexOf(".pu-card--static:hover")).toBeGreaterThan(css.indexOf(".pu-card:hover"));
  });

  test("it is imported once, after the shared paper styles", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout.match(/paper-ui\.css/g)?.length).toBe(1);
    expect(layout.indexOf("paper-ui.css")).toBeGreaterThan(layout.indexOf("./paper.css"));
  });

  test("the app shell's root carries .paper-ui", () => {
    expect(read("src/components/PerennialShell.tsx")).toMatch(/className=\{?[`"][^`"]*\bpaper-ui\b/);
  });

  test("the Perennial, wonder, builders and atlas pages opt into the token bridge", () => {
    for (const page of ["src/app/perennial/page.tsx", "src/app/perennial/wonder/page.tsx", "src/app/perennial/builders/page.tsx", "src/app/atlas/page.tsx"]) {
      expect(read(page), page).toMatch(/className="[^"]*\bpu-bridge\b/);
    }
  });

  test("builder cards keep their kind borders: no layer rule sets a border on the card itself", () => {
    // BuilderCardView is shared with the builders gallery; its kinds (verified, onboarding,
    // the dashed on-chain nomination, highlight) are told apart by their borders.
    const onCard = cssRules(css).filter((r) => splitSelectors(r.selector).some((s) => /\.bld-card(?::[\w-]+)*$/.test(s)));
    expect(onCard.length).toBeGreaterThan(0);
    for (const r of onCard) expect(r.body, r.selector).not.toMatch(/(^|;|\s)border(-color|-style|-width)?\s*:/);
  });
});

describe("the shared tokens and .paper-type stay as they were", () => {
  const files = Object.fromEntries(PROTECTED.map((p) => [p, read(p)]));

  test(":root, .paper-theme and .paper-type rules match the checked-in snapshot", () => {
    const snap = read(SNAPSHOT);
    expect(snap).toMatch(/^## src\/app\/globals\.css\n:root \{ --bg: /);
    expect(snapshotOf(files)).toBe(snap);
  });

  test("the guard catches a changed token, and a :root added inside @layer", () => {
    const snap = read(SNAPSHOT);
    const g = files["src/app/globals.css"];
    const bg = g.replace(/--bg:\s*#ebe1cc/, "--bg: red");
    expect(bg).not.toBe(g);
    expect(snapshotOf({ ...files, "src/app/globals.css": bg })).not.toBe(snap);
    expect(snapshotOf({ ...files, "src/app/globals.css": `${g}\n@layer base{:root{--bg:red}}` })).not.toBe(snap);
  });
});
