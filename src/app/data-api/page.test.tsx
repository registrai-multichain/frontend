import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import DataApiPage from "./page";
import { MCP_DOCS } from "@/lib/data-api-docs";

describe("/data-api/ page", () => {
  test("the sentence saying what the API serves sits right under the heading; an MCP section lists the tools", () => {
    const h = renderToStaticMarkup(createElement(DataApiPage));
    const i = h.indexOf("<h1"), a = h.indexOf("The Registrai Data API serves data on Arc");
    expect(a).toBeGreaterThan(i);
    expect(a - i).toBeLessThan(200);
    expect(h).toContain(">MCP server</h2>");
    for (const t of MCP_DOCS) expect(h).toContain(t.name);
  });
  test("review I3: the Markdown alternate link is on builder.registrai.cc", async () => {
    const { metadata } = await import("./page");
    expect((metadata.alternates?.types as Record<string, string>)["text/markdown"]).toBe("https://builder.registrai.cc/data-api/index.md");
    const bi = await import("../builders-index/page");
    expect((bi.metadata.alternates?.types as Record<string, string>)["text/markdown"]).toBe("https://builder.registrai.cc/builders-index/index.md");
  });
  test("review M4/M5: the opening sentences don't overclaim", async () => {
    const { DATA_API_ANSWER } = await import("@/lib/data-api-docs");
    const { INDICES_ANSWER } = await import("@/lib/builders-index-page");
    expect(DATA_API_ANSWER).toContain("verified builders");
    expect(DATA_API_ANSWER).not.toMatch(/serves hourly data on apps on Arc, Circle's blockchain, as JSON: each app's stablecoin payments, paying wallets and volume, the Arc indices, the Arc ecosystem/);
    expect(INDICES_ANSWER).not.toContain("computed from public Arc mainnet data");
  });
});

