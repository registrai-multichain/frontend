import { readFileSync } from "node:fs";
import { relative } from "node:path";
import postcss from "postcss";
import { expect, test } from "vitest";
import { SCOPED_SELECTOR, TINY_EXEMPT, scopedTsxFiles } from "./paper-sweep";

const ROOT = process.cwd();
const FORBIDDEN = [/\btext-\[(?:9|10|10\.5|11|12|12\.5)px\]/, /\btext-2xs\b/, /(["'`\s])uppercase(?=[\s"'`])/, /(["'`\s])tracking-(?:\[(?!-)|wide)/];

test("scoped components use no tiny or uppercase-label classes (spec §7)", () => {
  const hits: string[] = [];
  for (const f of scopedTsxFiles(ROOT)) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (FORBIDDEN.some((re) => re.test(line))) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  expect(hits).toEqual([]);
});

test("scoped CSS rules have no text under 13px and no uppercase labels (spec §7)", () => {
  const hits: string[] = [];
  postcss.parse(readFileSync(`${ROOT}/src/app/globals.css`, "utf8")).walkRules((r) => {
    if (!SCOPED_SELECTOR.test(r.selector) || TINY_EXEMPT.test(r.selector)) return;
    r.walkDecls((d) => {
      const px = d.prop === "font-size" ? /^([\d.]+)px$/.exec(d.value.trim()) : null;
      if (px && Number(px[1]) < 13) hits.push(`${r.selector} { font-size: ${d.value} }`);
      if (d.prop === "text-transform" && d.value.trim() === "uppercase") hits.push(`${r.selector} { text-transform: uppercase }`);
    });
  });
  expect(hits).toEqual([]);
});
