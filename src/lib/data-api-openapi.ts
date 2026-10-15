// OpenAPI 3.1 description of Registrai Data API v1 (spec docs/superpowers/specs/2026-10-14-data-api-v1-design.md).
// Response schemas are derived from the contract fixtures, so the description cannot drift from what consumers test against.
import { DATA_API_BASE, LIMITS } from "./data-api-docs";
import indices from "../../docs/superpowers/specs/data-api-v1-fixtures/indices.json";
import indexHourly from "../../docs/superpowers/specs/data-api-v1-fixtures/indices-abi-hourly.json";
import members from "../../docs/superpowers/specs/data-api-v1-fixtures/members-aii.json";
import memberHourly from "../../docs/superpowers/specs/data-api-v1-fixtures/member-hourly.json";
import membersHourly from "../../docs/superpowers/specs/data-api-v1-fixtures/members-hourly-aii.json";
import verified from "../../docs/superpowers/specs/data-api-v1-fixtures/verified.json";

type Schema = { type: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; additionalProperties?: Schema | boolean };

/** JSON Schema from an example value: every key required; arrays from their first item. Maps keyed by index id are open objects. */
function schemaOf(v: unknown): Schema {
  if (Array.isArray(v)) return { type: "array", items: v.length ? schemaOf(v[0]) : {} as Schema };
  if (v === null) return { type: "null" };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return { type: "object", properties: Object.fromEntries(Object.entries(o).map(([k, x]) => [k, schemaOf(x)])), required: Object.keys(o) };
  }
  return { type: typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string" };
}

const membersNew = { version: 1, index: "aii", since: "2026-10-14T19:00:00Z", data_until: "2026-10-14T21:00:00Z", members: members.members };
const hourParam = (name: string, description: string) => ({ name, in: "query", required: false, description, schema: { type: "string", format: "date-time", example: "2026-10-14T19:00:00Z" } });
const indexQuery = { name: "index", in: "query", required: true, schema: { type: "string", enum: ["abi", "aii", "aei"] } };
const from = hourParam("from", "First hour close (inclusive), an ISO hour like 2026-10-14T19:00:00Z.");
const to = hourParam("to", "Last hour close (inclusive).");
const err = { $ref: "#/components/responses/Error" };
const ok = (schema: string, description: string) => ({ description, content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } } });
const op = (summary: string, schema: string, parameters: unknown[] = []) => ({
  get: { summary, parameters, responses: { "200": ok(schema, summary), "304": { description: "Not modified (If-None-Match)" }, "400": err, "404": err, "405": err, "429": err, "503": err } },
});

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Registrai Data API",
    version: "1",
    description: `Hourly Arc index and per-app stablecoin data. Public, read-only, no key. Rate limit: ${LIMITS.requestsPerWindow} requests per ${LIMITS.windowSeconds} s per IP. Attribution "Data: Registrai".`,
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  },
  servers: [{ url: DATA_API_BASE }],
  externalDocs: { url: "https://builder.registrai.cc/data-api/" },
  paths: {
    "/indices": op("Latest close of ABI, AII and AEI, with parameters", "Indices"),
    "/indices/{index}/hourly": op("Hourly closes of one index", "IndexHourly", [{ name: "index", in: "path", required: true, schema: { type: "string", enum: ["abi", "aii", "aei"] } }, from, to]),
    "/members": op("Every scored member of an index now", "Members", [indexQuery]),
    "/members/{id}/hourly": op("One member's hourly points and activity", "MemberHourly", [{ name: "id", in: "path", required: true, description: "Member id (index source), URL-encoded, e.g. domain%3Aarchery.wtf", schema: { type: "string" } }, indexQuery, from, to]),
    "/members/hourly": op(`Every member's hourly rows for one hour or a range (at most ${LIMITS.membersHourlyHours} h)`, "MembersHourly", [indexQuery, hourParam("hour", "One hour close; not with from/to."), from, to]),
    "/members/new": op("Members first seen after an hour", "MembersNew", [indexQuery, { ...hourParam("since", "Hour close; members first seen after it."), required: true }]),
    "/verified": op("Projects whose builder proof validates against the Arc mainnet registry", "Verified"),
  },
  components: {
    schemas: {
      Indices: schemaOf(indices),
      IndexHourly: schemaOf(indexHourly),
      Members: schemaOf(members),
      MemberHourly: schemaOf(memberHourly),
      MembersHourly: schemaOf(membersHourly),
      MembersNew: schemaOf(membersNew),
      Verified: schemaOf(verified),
      Error: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
    },
    responses: { Error: { description: "Error with a plain sentence", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
  },
};
