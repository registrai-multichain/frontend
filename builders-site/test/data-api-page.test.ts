import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

describe("/data-api/ says what it is (data products, item 1)", () => {
  test("opens with what the API serves; an MCP section lists the same free tools the server offers", async () => {
    const { DATA_API_ANSWER, MCP_ANSWER, MCP_DOCS } = await import("../../src/lib/data-api-docs");
    const { MCP_TOOLS } = await import("../lib/mcp");
    expect(DATA_API_ANSWER).toMatch(/^The Registrai Data API serves hourly data on apps on Arc, Circle's blockchain/);
    expect(MCP_ANSWER).toContain("https://builder.registrai.cc/api/mcp");
    const free = MCP_TOOLS.filter((t) => !t.description.includes("x402"));
    expect(MCP_DOCS.map((t) => [t.name, t.title])).toEqual(free.map((t) => [t.name, t.title]));
    const { default: DataApiPage } = await import("../../src/app/data-api/page");
    const h = renderToStaticMarkup(createElement(DataApiPage));
    const i = h.indexOf("<h1"), a = h.indexOf("The Registrai Data API serves hourly data");
    expect(a).toBeGreaterThan(i);
    expect(a - i).toBeLessThan(200);   // right under the heading
    expect(h).toContain(">MCP server</h2>");
    for (const t of MCP_DOCS) expect(h).toContain(t.name);
  });
  test("/data-api/index.md: the static page converted to Markdown; the page itself passes through", async () => {
    const { onRequest } = await import("../functions/data-api/[[path]]");
    const STATIC = `<!doctype html><html><head><link rel="canonical" href="https://builder.registrai.cc/data-api/"></head><body><main><h1>Data API</h1><p>The Registrai Data API serves hourly data.</p></main></body></html>`;
    const seen: string[] = [];
    const ctx = (path: string) => ({ request: new Request(`https://builder.registrai.cc${path}`), env: {}, params: { path: path.endsWith("index.md") ? ["index.md"] : [] }, waitUntil: () => undefined,
      next: async (input?: Request | string) => { seen.push(input instanceof Request ? input.url : String(input)); return new Response(STATIC, { headers: { "content-type": "text/html; charset=utf-8" } }); } }) as never;
    const md = await onRequest(ctx("/data-api/index.md"));
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await md.text()).toContain("# Data API\n\nThe Registrai Data API serves hourly data.");
    expect(seen).toEqual(["https://builder.registrai.cc/data-api/"]);
    const page = await onRequest(ctx("/data-api/"));
    expect(await page.text()).toBe(STATIC);
  });
});
