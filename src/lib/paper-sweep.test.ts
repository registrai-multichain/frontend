import { describe, expect, test } from "vitest";
import { mapColors, pruneCss, sweepCss, sweepTsx } from "./paper-sweep";

describe("mapColors", () => {
  test("old accents become paper tokens, keeping their alpha", () => {
    const u = new Set<string>();
    expect(mapColors("#d7ff56", u)).toBe("var(--up)");
    expect(mapColors("rgba(215, 255, 86, .15)", u)).toBe("color-mix(in srgb, var(--up) 15%, transparent)");
    expect(mapColors("1px solid rgba(255,112,56,.45)", u)).toBe("1px solid color-mix(in srgb, var(--accent) 45%, transparent)");
    expect(mapColors("#ff765f", u)).toBe("var(--down)");
    expect(mapColors("#4a4c43", u)).toBe("var(--line)");
    expect(mapColors("#808178", u)).toBe("var(--fg-mute)");
    expect(u.size).toBe(0);
  });
  test("dark surfaces become cards; faint dark overlays become a light ink tint", () => {
    const u = new Set<string>();
    expect(mapColors("#171913", u)).toBe("var(--bg-elev)");
    expect(mapColors("rgba(23,25,19,.98)", u)).toBe("var(--bg-elev)");
    expect(mapColors("rgba(13,13,12,.28)", u)).toBe("color-mix(in srgb, var(--fg) 7%, transparent)");
    // a mostly opaque dark panel is a surface, not a shadow
    expect(mapColors("rgba(8,9,7,.72)", u)).toBe("var(--bg-elev)");
    expect(mapColors("rgba(13,13,12,.5)", u)).toBe("var(--bg-elev)");
  });
  test("unknown colours are kept and reported", () => {
    const u = new Set<string>();
    expect(mapColors("#123456", u)).toBe("#123456");
    expect([...u]).toEqual(["#123456"]);
  });
});

describe("sweepCss", () => {
  test("scoped rules: tiny text to 13px, no uppercase, no positive tracking, no offset shadows, sans for labels", () => {
    const { css } = sweepCss(
      ".pp-x { font-size: 9px; text-transform: uppercase; letter-spacing: .14em; box-shadow: 8px 8px 0 #ff7038; font-family: var(--font-mono), monospace; color: #9a9b91; }",
    );
    expect(css).toBe(".pp-x { font-size: 13px; font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif; color: var(--fg-mute); }");
  });
  test("keeps negative tracking, larger text, mono on hash/code selectors, and custom properties", () => {
    const src = ".vf-hash { font-family: var(--font-mono), monospace; letter-spacing: -.03em; font-size: 20px; } .bld-x { --dot: #d7ff56; }";
    expect(sweepCss(src).css).toBe(src);
  });
  test("leaves unscoped rules and the pixel city alone", () => {
    const src = ".lp-hero { font-size: 9px; text-transform: uppercase; } .city-label { font-size: 8px; }";
    expect(sweepCss(src).css).toBe(src);
  });
  test("walks inside @media", () => {
    expect(sweepCss("@media (max-width: 600px) { .vf-step-num { font-size: 10px; } }").css).toBe(
      "@media (max-width: 600px) { .vf-step-num { font-size: 13px; } }",
    );
  });
});

describe("sweepTsx", () => {
  test("tiny text classes become 13px; uppercase and positive tracking go; tidy spaces", () => {
    expect(sweepTsx('<span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fg-dim">x</span>')).toBe(
      '<span className="font-mono text-[13px] text-fg-dim">x</span>',
    );
    expect(sweepTsx('<p className="mt-2 text-2xs sm:text-[11px] tracking-wider">')).toBe('<p className="mt-2 text-[13px] sm:text-[13px]">');
  });
  test("keeps negative tracking and non-class words", () => {
    const src = '<h1 className="tracking-[-0.02em]">Uppercase letters</h1>';
    expect(sweepTsx(src)).toBe(src);
  });
});

describe("pruneCss", () => {
  test("drops selectors whose scoped classes are unused, keeps used ones and unscoped rules", () => {
    const css = ".pp-dead { color: red; } .pp-live, .pp-gone { color: blue; } .lp-any { color: green; } @media (x) { .pp-dead span { a: b; } }";
    const { css: out, removed } = pruneCss(css, new Set(["pp-live"]));
    expect(out).toBe(".pp-live { color: blue; } .lp-any { color: green; }");
    expect(removed.sort()).toEqual([".pp-dead", ".pp-dead span", ".pp-gone"]);
  });
});
