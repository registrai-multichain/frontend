import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { API_CATALOG, API_INDEX, MCP_SERVER_CARD, discoveryResponse } from "../lib/discovery";
import { MCP_TOOLS } from "../lib/mcp";
import { OPENAPI } from "../../src/lib/data-api-openapi";

const FN = resolve(__dirname, "../functions");

describe("API and MCP discovery documents", () => {
  test("/api/v1/ lists every free path of the OpenAPI, the docs, the MCP endpoint and the licence", () => {
    const free = Object.keys(OPENAPI.paths).filter((p) => !p.includes("/paid"));
    expect(API_INDEX.endpoints.map((e) => e.path).sort()).toEqual(free.sort());
    expect(API_INDEX.openapi).toBe("https://builder.registrai.cc/api/v1/openapi.json");
    expect(API_INDEX.mcp).toBe("https://builder.registrai.cc/api/mcp");
    expect(API_INDEX.licence).toMatch(/CC BY 4\.0/);
  });

  test("the RFC 9727 api-catalog links the API to its OpenAPI and docs", () => {
    const [entry] = API_CATALOG.linkset;
    expect(entry.anchor).toBe("https://builder.registrai.cc/api/v1/");
    expect(entry["service-desc"][0]).toEqual({ href: "https://builder.registrai.cc/api/v1/openapi.json", type: "application/openapi+json" });
    expect(entry["service-doc"][0].href).toBe("https://builder.registrai.cc/data-api/");
  });

  test("the MCP server card names the registry id, the remote and every tool", () => {
    expect(MCP_SERVER_CARD.name).toBe("cc.registrai/arc-data");
    expect(MCP_SERVER_CARD.remotes).toEqual([{ type: "streamable-http", url: "https://builder.registrai.cc/api/mcp" }]);
    expect(MCP_SERVER_CARD.tools.map((t) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
  });

  test("responses: JSON with CORS, linkset type for the catalog, 405 on POST", async () => {
    const r = discoveryResponse(new Request("https://x/.well-known/api-catalog"), API_CATALOG, "application/linkset+json");
    expect(r.headers.get("content-type")).toBe("application/linkset+json");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect((await r.json()).linkset).toHaveLength(1);
    expect(discoveryResponse(new Request("https://x/api/v1/", { method: "POST" }), API_INDEX).status).toBe(405);
  });

  test("routes exist: /openapi.json, /api/v1/, /.well-known/api-catalog, /.well-known/mcp/server-card.json", () => {
    for (const f of ["openapi.json.ts", "api/v1/index.ts", ".well-known/api-catalog.ts", ".well-known/mcp/server-card.json.ts"]) expect(existsSync(resolve(FN, f)), f).toBe(true);
  });
});
