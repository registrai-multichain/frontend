import { describe, expect, test } from "vitest";

describe("/data-api/ says what it is (data products, item 1)", () => {
  test("opens with what the API serves; an MCP section lists the same free tools the server offers", async () => {
    const { DATA_API_ANSWER, MCP_ANSWER, MCP_DOCS } = await import("../../src/lib/data-api-docs");
    const { MCP_TOOLS } = await import("../lib/mcp");
    expect(DATA_API_ANSWER).toMatch(/^The Registrai Data API serves data on Arc, Circle.s blockchain/);
    expect(MCP_ANSWER).toContain("https://builder.registrai.cc/api/mcp");
    const free = MCP_TOOLS.filter((t) => !t.description.includes("x402"));
    expect(MCP_DOCS.map((t) => [t.name, t.title])).toEqual(free.map((t) => [t.name, t.title]));
    // the page render (heading → sentence, MCP section) is checked in src/app/data-api/page.test.tsx (JSX)
  });
  test("/data-api/index.md: the static page converted to Markdown; the page itself passes through", async () => {
    const { onRequest } = await import("../functions/data-api/index.md");
    const STATIC = `<!doctype html><html><head><link rel="canonical" href="https://builder.registrai.cc/data-api/"/></head><body><main><h1>Data API</h1><p>The Registrai Data API serves hourly data.</p></main></body></html>`;
    const seen: string[] = [];
    const ctx = (path: string) => ({ request: new Request(`https://builder.registrai.cc${path}`), env: {}, params: { path: path.endsWith("index.md") ? ["index.md"] : [] }, waitUntil: () => undefined,
      next: async (input?: Request | string) => { seen.push(input instanceof Request ? input.url : String(input)); return new Response(STATIC, { headers: { "content-type": "text/html; charset=utf-8" } }); } }) as never;
    const md = await onRequest(ctx("/data-api/index.md"));
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const text = await md.text();
    expect(text).toContain("# Data API\n\nThe Registrai Data API serves hourly data.");
    expect(text.trimEnd().endsWith("Source: https://builder.registrai.cc/data-api/ · Registrai, builder.registrai.cc, CC BY 4.0")).toBe(true);   // review M1: Next's self-closing canonical
    expect(seen).toEqual(["https://builder.registrai.cc/data-api/"]);
    // review I4: only the Markdown URL runs a Function; the page and Next's data files stay static
    const fs = await import("node:fs");
    expect(fs.existsSync(new URL("../functions/data-api/[[path]].ts", import.meta.url))).toBe(false);
    expect(fs.existsSync(new URL("../functions/builders-index/[[path]].ts", import.meta.url))).toBe(false);
    expect(fs.existsSync(new URL("../functions/builders-index/index.md.ts", import.meta.url))).toBe(true);
  });
});
