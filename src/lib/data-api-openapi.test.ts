import { describe, expect, it } from "vitest";
import { OPENAPI } from "./data-api-openapi";
import { ENDPOINTS } from "./data-api-docs";
import indices from "../../docs/superpowers/specs/data-api-v1-fixtures/indices.json";

describe("OpenAPI", () => {
  it("documents exactly the endpoints the docs list, under the v1 server", () => {
    expect(OPENAPI.openapi).toBe("3.1.0");
    expect(OPENAPI.servers[0].url).toBe("https://builder.registrai.cc/api/v1");
    expect(Object.keys(OPENAPI.paths).filter((p) => !p.startsWith("/paid/")).sort()).toEqual(ENDPOINTS.map((e) => e.path).sort());
  });
  it("response schemas follow the contract fixtures", () => {
    const s = OPENAPI.components.schemas.Indices;
    expect(Object.keys(s.properties ?? {}).sort()).toEqual(Object.keys(indices).sort());
    expect([...(s.required ?? [])].sort()).toEqual(Object.keys(indices).sort());
  });
  it("every path answers JSON errors as documented", () => {
    for (const p of Object.values(OPENAPI.paths)) expect(Object.keys(p.get.responses)).toEqual(expect.arrayContaining(["200", "400", "429", "503"]));
  });
});

describe("review fixes", () => {
  it("I3: every operation has a unique operationId (GPT Actions and OpenAPI tool converters need it)", () => {
    const ids = Object.values(OPENAPI.paths).map((p) => (p.get as { operationId?: string }).operationId);
    expect(ids.every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("M1: close_24h_ago may be null (fewer than 24 closed hours)", () => {
    const abi = (OPENAPI.components.schemas.Indices.properties as Record<string, { properties?: Record<string, { properties?: Record<string, { type: unknown }> }> }>).indices.properties!.abi.properties!;
    expect(abi.close_24h_ago.type).toEqual(["number", "null"]);
  });
});

describe("paid paths", () => {
  it("documents the six paid routes with a 402 response, beside the free ones", async () => {
    const { PAID_DOCS } = await import("./data-api-docs");
    const paid = PAID_DOCS.map((p) => p.path);
    for (const p of paid) {
      const op = (OPENAPI.paths as Record<string, { get: { responses: Record<string, unknown>; operationId: string } }>)[p];
      expect(op, p).toBeDefined();
      expect(Object.keys(op.get.responses)).toEqual(expect.arrayContaining(["200", "402"]));
    }
  });
});
