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
  test("review I3: paid JSON and the /api/v1/ index carry it; errors do not", async () => {
    const { ATTRIBUTION } = await import("../lib/attribution");
    const { API_INDEX } = await import("../lib/discovery");
    expect((API_INDEX as Record<string, unknown>).attribution).toBe(ATTRIBUTION);
    const { paidJson } = await import("../lib/x402-products");
    expect(await paidJson({ version: 1, date: "d" }).json()).toEqual({ version: 1, attribution: ATTRIBUTION, date: "d" });
    expect(await paidJson({ error: "no" }, 400).json()).toEqual({ error: "no" });
    const { withAttribution } = await import("../lib/x402-products");
    expect(JSON.parse(withAttribution('{"version":1,"events":[]}'))).toEqual({ version: 1, attribution: ATTRIBUTION, events: [] });
    expect(withAttribution("not json")).toBe("not json");
    expect(withAttribution("[1]")).toBe("[1]");
  });
  test("review I4: every place that tells agents how to credit uses the exact line", async () => {
    const { ATTRIBUTION } = await import("../lib/attribution");
    const fs = await import("node:fs");
    for (const f of ["../functions/llms.txt.ts", "../../public/llms.txt", "../lib/discovery.ts", "../../src/lib/data-api-docs.ts", "../../src/app/terms/page.tsx", "../../src/lib/data-api-openapi.ts"]) {
      const s = fs.readFileSync(new URL(f, import.meta.url), "utf8");
      expect(s, f).not.toContain("Data: Registrai");
    }
    const { LICENCE } = await import("../../src/lib/data-api-docs");
    expect(LICENCE).toContain(ATTRIBUTION);
    expect(fs.readFileSync(new URL("../../public/llms.txt", import.meta.url), "utf8")).toContain(ATTRIBUTION);
  });
});

