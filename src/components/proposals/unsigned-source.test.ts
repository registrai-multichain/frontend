import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { UNSIGNED_SOURCE_LABEL, UnsignedSource } from "./UnsignedSource";

describe("R54 F1: a proposal's source is never a link", () => {
  test("a swapped (phishing) source renders as plain text, labelled as not signed", () => {
    const html = renderToStaticMarkup(createElement(UnsignedSource, { source: "https://evil.example/phish" }));
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toMatch(/href=/);
    expect(html).toContain("https://evil.example/phish");
    expect(html).toContain(`(${UNSIGNED_SOURCE_LABEL})`);
  });
  test("neither the market page nor the status page links a proposal's source", () => {
    for (const f of ["src/components/CommonMarkets.tsx", "src/components/proposals/ProposalStatus.tsx"]) {
      const src = readFileSync(join(__dirname, "..", "..", "..", f), "utf8");
      expect(src, f).not.toMatch(/href=\{[^}]*source/i);
      expect(src, f).toMatch(/<UnsignedSource /);
    }
  });
});
