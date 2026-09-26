/**
 * The paper readability sweep (spec §7): rewrites the legacy CSS families and
 * the scoped components' Tailwind classes so nothing reads under 13px, labels
 * are sentence case, and the dark palette maps onto paper tokens. Also the
 * dead-rule prune used at the end. Node-only (tests and scripts/paper-sweep.ts).
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Rule } from "postcss";

export const SCOPED_SELECTOR =
  /\.(pp-|pv-|bld-|vf-|econ|atlas-|city-|adm-|wonder-|perennial-|builders-|season|globe-|gd-|bb-|board|share-|vbadge|milestone-)/;
/** The atlas's pixel city and globe keep their tiny glyph sizes. */
export const TINY_EXEMPT = /\.(city|globe)-/;

type Family = "up" | "accent" | "down" | "fg" | "dark" | "line" | "line-strong" | "fg-mute";
const FAMILY: Record<string, Family> = {
  "215,255,86": "up", "201,255,61": "up",
  "255,112,56": "accent", "255,90,31": "accent",
  "255,118,95": "down", "255,80,80": "down",
  "251,248,234": "fg", "255,255,255": "fg",
  "8,9,7": "dark", "13,13,12": "dark", "23,25,19": "dark", "19,21,16": "dark", "21,21,18": "dark",
  "27,29,23": "dark", "13,15,11": "dark", "0,0,0": "dark",
  "74,76,67": "line", "98,101,90": "line",
  "122,125,112": "line-strong", "147,150,138": "line-strong",
  "128,129,120": "fg-mute", "154,155,145": "fg-mute", "139,140,128": "fg-mute", "203,200,186": "fg-mute",
  "185,186,174": "fg-mute", "227,224,210": "fg-mute",
};

function parseHex(h: string): { rgb: string; a: number } | null {
  let x = h.slice(1);
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join("");
  if (x.length !== 6 && x.length !== 8) return null;
  const n = (i: number) => parseInt(x.slice(i, i + 2), 16);
  return { rgb: `${n(0)},${n(2)},${n(4)}`, a: x.length === 8 ? n(6) / 255 : 1 };
}

const pct = (x: number) => Math.max(1, Math.round(x));

function replacement(f: Family, a: number): string {
  if (f === "dark") return a >= 0.5 ? "var(--bg-elev)" : `color-mix(in srgb, var(--fg) ${pct(a * 25)}%, transparent)`;
  return a >= 1 ? `var(--${f})` : `color-mix(in srgb, var(--${f}) ${pct(a * 100)}%, transparent)`;
}

export function mapColors(value: string, unknown: Set<string>): string {
  return value.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/g, (m, r, g, b, a) => {
    const c = m.startsWith("#") ? parseHex(m) : { rgb: `${Number(r)},${Number(g)},${Number(b)}`, a: a === undefined ? 1 : Number(a) };
    const f = c && FAMILY[c.rgb];
    if (!c || !f) {
      unknown.add(m);
      return m;
    }
    return replacement(f, c.a);
  });
}

const SANS = "var(--font-sans), ui-sans-serif, system-ui, sans-serif";

export function sweepCss(css: string): { css: string; unknown: string[] } {
  const root = postcss.parse(css);
  const unknown = new Set<string>();
  root.walkRules((rule: Rule) => {
    if (!SCOPED_SELECTOR.test(rule.selector)) return;
    const tinyOk = TINY_EXEMPT.test(rule.selector);
    rule.walkDecls((d) => {
      if (d.prop.startsWith("--")) return;
      const v = d.value.trim();
      if (d.prop === "text-transform" && v === "uppercase") return void d.remove();
      if (d.prop === "letter-spacing" && !v.startsWith("-") && v !== "0" && v !== "normal") return void d.remove();
      if (d.prop === "box-shadow" && !rule.selector.includes(":focus")) return void d.remove();
      if (d.prop === "font-size" && !tinyOk) {
        const px = /^([\d.]+)px$/.exec(v);
        if (px && Number(px[1]) < 13) d.value = "13px";
      }
      if (d.prop === "font-family" && v.includes("--font-mono") && !/code|hash|addr|mono/.test(rule.selector)) d.value = SANS;
      d.value = mapColors(d.value, unknown);
    });
  });
  return { css: root.toString(), unknown: [...unknown] };
}

export function sweepTsx(src: string): string {
  return src
    .replace(/\btext-\[(?:9|10|10\.5|11|12|12\.5)px\]/g, "text-[13px]")
    .replace(/\btext-2xs\b/g, "text-[13px]")
    .replace(/(["'`\s])uppercase(?=[\s"'`])/g, "$1")
    .replace(/(["'`\s])tracking-(?:\[(?!-)[^\]]*\]|wide|wider|widest)(?=[\s"'`])/g, "$1")
    .replace(/className="([^"]*)"/g, (_, c: string) => `className="${c.replace(/\s+/g, " ").trim()}"`);
}

/** Scoped component files outside the scoped directories. */
export const SCOPED_FILES = [
  "src/components/PerennialShell.tsx",
  "src/components/BuildersShell.tsx",
  "src/components/EconomyPanel.tsx",
  "src/components/Atlas.tsx",
  "src/components/BuilderIncome.tsx",
  "src/components/BuilderProfile.tsx",
  "src/components/BuilderBadgeSection.tsx",
  "src/components/BuilderBadgeCard.tsx",
  "src/components/VerifiedBadge.tsx",
  "src/components/AgentBadge.tsx",
  "src/components/CommonMarkets.tsx",
  "src/components/RoundCharts.tsx",
];
export const SCOPED_DIRS = [
  "src/components/paper",
  "src/components/perennial",
  "src/components/builders",
  "src/components/verify",
  "src/components/admin",
  "src/components/wonder",
  "src/app/perennial",
  "src/app/atlas",
  "src/app/builders",
  "src/app/verify",
  "src/app/guide",
  "src/app/admin",
  "src/app/rounds",
  "src/app/transparency",
  "src/components/transparency",
];

export function scopedTsxFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) out.push(p);
    }
  };
  SCOPED_DIRS.forEach((d) => walk(join(root, d)));
  return [...out, ...SCOPED_FILES.map((f) => join(root, f)).filter((f) => existsSync(f))];
}

/** Class names a selector needs from the scoped families. */
const scopedClasses = (sel: string) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => SCOPED_SELECTOR.test(`.${c}`));

/** Remove scoped selectors whose classes appear nowhere in the code (`inUse`); drop rules left empty. */
export function pruneCss(css: string, inUse: Set<string>): { css: string; removed: string[] } {
  const root = postcss.parse(css);
  const removed: string[] = [];
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/.test((rule.parent as { name?: string }).name ?? "")) return;
    const keep = rule.selectors.filter((s) => {
      const need = scopedClasses(s);
      const dead = need.length > 0 && need.some((c) => !inUse.has(c));
      if (dead) removed.push(s.trim());
      return !dead;
    });
    if (keep.length === 0) rule.remove();
    else if (keep.length !== rule.selectors.length) rule.selectors = keep;
  });
  root.walkAtRules((at) => {
    if (at.nodes && at.nodes.length === 0) at.remove();
  });
  return { css: root.toString().replace(/\s+$/g, "").replace(/ {2,}/g, " "), removed };
}
