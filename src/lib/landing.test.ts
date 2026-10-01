import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type AtRule } from "postcss";
import { describe, expect, it } from "vitest";
import { VERDICT_WORDS } from "./facts";
import { CONTACT_EMAIL, FOOTER_BRAND_LINE, FOOTER_PAUSE_LINE, HERO, HOW_WE_PUBLISH, HOW_WE_PUBLISH_URL, STRIP, TIERS, TIERS_SECTION, VERIFY_URL, contactHref } from "./landing";

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const all = strings([HERO, STRIP, TIERS, TIERS_SECTION, HOW_WE_PUBLISH, FOOTER_BRAND_LINE, FOOTER_PAUSE_LINE]);
const word = (w: string, flags: string) => new RegExp(`\\b${w.replace(" ", "\\s+")}\\b`, flags);

describe("landing copy", () => {
  it("has no verdict or betting words and no audit", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const t of all) {
      for (const w of VERDICT_WORDS) {
        const lower = w === "safe" || w === "unsafe";
        expect(word(w, lower ? "" : "i").test(t), `${w} in: ${t}`).toBe(false);
      }
      for (const w of ["bet", "wager", "odds", "payout", "audit"]) expect(word(w, "i").test(t), `${w} in: ${t}`).toBe(false);
    }
  });
  it("builds mailto links", () => {
    expect(CONTACT_EMAIL).toBe("contact@registrai.cc");
    expect(contactHref("Tabula Pro")).toBe("mailto:contact@registrai.cc?subject=Tabula%20Pro");
  });
  it("uses the decided words", () => {
    expect(HERO.headline).toBe("Proof, mapped.");
    expect(TIERS.map((t) => t.name)).toEqual(["Community", "Pro", "Institutional"]);
    expect(strings(TIERS[2])).toContain("Know who can move the money.");
  });
  it("points at the builder site paths", () => {
    expect(VERIFY_URL).toBe("https://builder.registrai.cc/verify/");
    expect(HOW_WE_PUBLISH_URL).toBe("https://builder.registrai.cc/how-we-publish/");
  });
  it("has a footer pause line", () => {
    expect(FOOTER_PAUSE_LINE.trim().length).toBeGreaterThan(0);
  });
});

describe("landing CSS", () => {
  it("the fee cards' min-height applies from 641px only; on a phone they keep min-height 0", () => {
    const found: string[] = [];
    postcss.parse(readFileSync(resolve(__dirname, "../app/globals.css"), "utf8")).walkRules((r) => {
      if (!r.selectors.includes(".lp-fees .lp-route")) return;
      r.walkDecls("min-height", (d) => {
        const at = r.parent?.type === "atrule" ? (r.parent as AtRule) : null;
        found.push(`${at ? `@${at.name} ${at.params} ` : ""}${d.value}`);
      });
    });
    expect(found).toEqual(["@media (min-width: 641px) 220px"]);
  });
});
