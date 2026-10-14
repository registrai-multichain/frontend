import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss, { type AtRule } from "postcss";
import { describe, expect, it } from "vitest";
import { VERDICT_WORDS } from "./facts";
import { AUDIENCE, CONTACT_EMAIL, FOOTER_BRAND_LINE, HERO, HOW_WE_PUBLISH, HOW_WE_PUBLISH_URL, INDICES_URL, MEASURED, PRODUCTS, SITE_DESCRIPTION, SITE_TITLE, STEPS, TRACK_RECORD_URL, TIERS, TIERS_SECTION, VERIFY_URL, contactHref } from "./landing";

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const all = strings([SITE_TITLE, SITE_DESCRIPTION, HERO, PRODUCTS, AUDIENCE, TIERS, TIERS_SECTION, HOW_WE_PUBLISH, FOOTER_BRAND_LINE]);
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
    expect(SITE_TITLE).toBe("Registrai · Data on Arc");
    expect(HERO.headline).toBe("The source of truth for the Arc economy.");
    expect(HERO.headline.endsWith(HERO.headlineAccent)).toBe(true);
    expect(HERO.microcopy).toBe("Independent. Not affiliated with Circle or Arc.");
    expect([HERO.primaryCta, HERO.secondaryCta]).toEqual(["See the indices", "Request data"]);
    expect(HERO.secondaryHref).toBe("mailto:contact@registrai.cc?subject=Data%20request");
    expect(PRODUCTS.map((p) => [p.name, p.tag])).toEqual([["Indices", "Live"], ["Project facts (Tabula)", "Live"], ["Data API", "Live"], ["Other chains", "Later"]]);
    expect(AUDIENCE.map((a) => a.who)).toEqual(["Funds and market makers", "Exchange listing teams", "Launchpads and DEXs", "Ecosystem and grant programs", "Builders"]);
    expect(TIERS.map((t) => t.name)).toEqual(["Community", "Pro", "Institutional"]);
    expect(HOW_WE_PUBLISH.headline).toBe("Facts, not opinions.");
  });
  it("no paper-trading promotion, no $REGI link to trading, buybacks or rewards, no old slogan", () => {
    for (const t of all) expect(t, t).not.toMatch(/paper|trading|leverage|buyback|reward|\$?REGI\b|Proof, mapped|proof layer/i);
  });
  it("no hard-coded live numbers: the only figures are the index base and its date, and the decay half-life", () => {
    const nums = all.filter((t) => !/^(https?:|mailto:)/.test(t)).flatMap((t) => t.match(/\d[\d,]*/g) ?? []);
    expect([...new Set(nums)].sort()).toEqual(["1,000", "2", "2026", "21"].sort());
  });
  it("points at the builder site paths", () => {
    expect(VERIFY_URL).toBe("https://builder.registrai.cc/verify/");
    expect(HOW_WE_PUBLISH_URL).toBe("https://builder.registrai.cc/how-we-publish/");
    expect(TRACK_RECORD_URL).toBe("https://builder.registrai.cc/track-record/");
    expect(INDICES_URL).toBe("https://builder.registrai.cc/builders-index/");
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

it("the Data API card: index and per-app endpoints and full history live, the rest still building; links to the docs", () => {
  const api = PRODUCTS.find((p) => p.name === "Data API")!;
  expect(api.items!.map((i) => i.tag)).toEqual(["Live", "Live", "Building now", "Building now", "Building now"]);
  expect(api.link).toEqual({ label: "Read the API docs", href: "https://builder.registrai.cc/data-api/" });
});

it("Tabula's pieces carry their true status: facts pages and investigations live; Radar, Trace and Record still building", () => {
  const tabula = PRODUCTS.find((p) => p.name === "Project facts (Tabula)")!;
  expect(tabula.items!.map((i) => [i.text.split(" ")[0], i.tag])).toEqual([["Facts", "Live"], ["Investigations", "Live"], ["Radar", "Building now"], ["Trace", "Building now"], ["Record", "Building now"]]);
});

describe("social preview image", () => {
  const layout = readFileSync(resolve(__dirname, "../app/layout.tsx"), "utf8");
  it("layout points openGraph and twitter at registrai-og.png with the hero as alt", () => {
    expect(layout.match(/\/social\/registrai-og\.png/g)).toHaveLength(2);
    expect(layout).not.toContain("tabula-og");
    expect(layout.match(/alt: "([^"]*)"/)?.[1]).toBe("Registrai · The data company for the Arc economy.");
  });
  it("the PNG exists and is 1200x630", () => {
    const png = readFileSync(resolve(__dirname, "../../public/social/registrai-og.png"));
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

describe("landing redesign data", () => {
  it("measures apps by name only and never lists Circle or Arc as an app", () => {
    expect(MEASURED.length).toBeGreaterThan(10);
    expect(new Set(MEASURED).size).toBe(MEASURED.length);
    for (const n of MEASURED) expect(n.toLowerCase()).not.toMatch(/circle|^arc$/);
  });
  it("has three index steps", () => {
    expect(STEPS.map((s) => s.n)).toEqual(["01", "02", "03"]);
  });
});

