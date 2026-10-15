import { describe, expect, it } from "vitest";
import { OPENAPI } from "./data-api-openapi";
import { ENDPOINTS } from "./data-api-docs";
import indices from "../../docs/superpowers/specs/data-api-v1-fixtures/indices.json";

describe("OpenAPI", () => {
  it("documents exactly the endpoints the docs list, under the v1 server", () => {
    expect(OPENAPI.openapi).toBe("3.1.0");
    expect(OPENAPI.servers[0].url).toBe("https://builder.registrai.cc/api/v1");
    expect(Object.keys(OPENAPI.paths).sort()).toEqual(ENDPOINTS.map((e) => e.path).sort());
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
