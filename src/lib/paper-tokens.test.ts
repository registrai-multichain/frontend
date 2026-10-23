import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(css).walkRules((r) => {
    if (r.selector.trim() !== selector) return;
    r.walkDecls((d) => {
      if (d.prop.startsWith("--")) out[d.prop] = d.value.trim().toUpperCase();
    });
  });
  return out;
}

describe(".paper-theme tokens (spec §1)", () => {
  test("every colour token has the spec's exact value", () => {
    expect(tokens(".paper-theme")).toMatchObject({
      "--bg": "#F4EEE1",
      "--bg-elev": "#FBF7EE",
      "--line": "#E2D6BF",
      "--line-strong": "#C9B994",
      "--fg": "#2B2620",
      "--fg-mute": "#6F6353",
      "--fg-dim": "#6F6353",
      "--accent": "#8F560C",
      "--up": "#2F6B4F",
      "--down": "#8A3B22",
      "--chip": "#E6DCC7",
      "--chip-fg": "#6B5E4A",
      "--unclaimed": "#E9DFF0",
      "--unclaimed-fg": "#5B4470",
    });
  });

  test("the atlas globe gets paper colours", () => {
    expect(tokens(".paper-theme")).toMatchObject({
      "--globe-ocean": "#EDE4D2",
      "--globe-land": "#D9CBAE",
      "--globe-border": "#C9B994",
      "--globe-accent": "#8F560C",
      "--globe-halo": "#8F560C",
    });
  });
});
