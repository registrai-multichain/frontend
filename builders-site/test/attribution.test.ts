import { describe, expect, test } from "vitest";

const A = "Registrai, builder.registrai.cc, CC BY 4.0";

describe("one credit line", () => {
  test("every v1 200 body carries it after version; 304 still works; errors carry none", async () => {
    const { v1Json, v1Error } = await import("../lib/data-api");
    const req = new Request("https://builder.registrai.cc/api/v1/x");
    const r = await v1Json(req, { a: 1 });
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ version: 1, attribution: A, a: 1 });
    expect(text.indexOf('"attribution"')).toBeLessThan(text.indexOf('"a"'));
    const again = await v1Json(new Request(req.url, { headers: { "if-none-match": r.headers.get("etag")! } }), { a: 1 });
    expect(again.status).toBe(304);
    expect(await v1Error(404, "nope").json()).toEqual({ error: "nope" });
  });
  test("the page footer uses it", async () => {
    const { page } = await import("../lib/apps-pages");
    expect(page({ title: "t", canonical: "https://x/", description: "d", body: "" })).toContain(`Data: ${A}`);
  });
  test("MCP results built outside the API carry it", async () => {
    const { ATTRIBUTION } = await import("../lib/attribution");
    expect(ATTRIBUTION).toBe(A);
    const src = (await import("node:fs")).readFileSync(new URL("../lib/mcp.ts", import.meta.url), "utf8");
    expect(src.match(/data: \{ version: 1, attribution: ATTRIBUTION/g)?.length).toBe(2);   // arc_apps and arc_app
  });
});
