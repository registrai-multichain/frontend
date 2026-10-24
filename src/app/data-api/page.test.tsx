import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import DataApiPage from "./page";
import { MCP_DOCS } from "@/lib/data-api-docs";

describe("/data-api/ page", () => {
  test("the sentence saying what the API serves sits right under the heading; an MCP section lists the tools", () => {
    const h = renderToStaticMarkup(createElement(DataApiPage));
    const i = h.indexOf("<h1"), a = h.indexOf("The Registrai Data API serves hourly data");
    expect(a).toBeGreaterThan(i);
    expect(a - i).toBeLessThan(200);
    expect(h).toContain(">MCP server</h2>");
    for (const t of MCP_DOCS) expect(h).toContain(t.name);
  });
});
