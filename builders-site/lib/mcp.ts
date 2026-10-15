/**
 * Read-only MCP server at /api/mcp (spec docs/superpowers/specs/2026-10-15-agent-reference-design.md): stateless JSON-RPC 2.0 over
 * HTTP POST (Streamable HTTP without sessions or SSE). Tools answer with the same JSON as Data API v1, plus a source_url an
 * agent can cite. API-backed tools call the v1 handlers in-process, so tool output and API output cannot differ.
 */
import { idToPath, loadApp, loadAppList, type AppRow } from "./apps-data";
import { parseSort } from "./apps-pages";
import { handleIndexHourly, handleIndices, handleMemberHourly, handleMembersNew, parseIndex } from "./data-api";
import { handleVerified } from "./data-api-verified";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";

const SITE = "https://builder.registrai.cc";
const API = `${SITE}/api/v1`;
const VERSIONS = ["2025-06-18", "2025-03-26"];
const HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };

const INDEX = { type: "string", enum: ["abi", "aii", "aei"], description: "abi = builder apps, aii = integrations, aei = both plus the Arc base layer" };
const HOUR = (d: string) => ({ type: "string", description: `${d} An ISO hour close, e.g. 2026-10-14T19:00:00Z.` });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export const MCP_TOOLS = [
  { name: "arc_indices", description: "Latest hourly close of the Arc Builders, Integrations and Ecosystem indices (ABI, AII, AEI), their 24 h change base and decay parameters.", inputSchema: obj({}) },
  { name: "arc_index_history", description: "Hourly closes of one Arc index, oldest first (at most 744 hours per call).", inputSchema: obj({ index: INDEX, from: HOUR("First hour (inclusive)."), to: HOUR("Last hour (inclusive).") }, ["index"]) },
  { name: "arc_apps", description: "Every stablecoin app on Arc in the indices with its last 24 h of stablecoin payments and USD volume, verified status and first-seen hour.", inputSchema: obj({ sort: { type: "string", enum: ["payments", "usdc", "points", "first_seen"] } }) },
  { name: "arc_app", description: "One Arc app by id (e.g. domain:archery.wtf, integration:uniswap): last 24 h, contracts count, verified status and the last 7 days of hourly rows.", inputSchema: obj({ id: { type: "string" } }, ["id"]) },
  { name: "arc_app_history", description: "One app's hourly points and activity (payments, paying wallets, new payers, USD) in one index, oldest first.", inputSchema: obj({ id: { type: "string" }, index: INDEX, from: HOUR("First hour (inclusive)."), to: HOUR("Last hour (inclusive).") }, ["id", "index"]) },
  { name: "arc_new_apps", description: "Apps first seen in an index after a given hour.", inputSchema: obj({ index: INDEX, since: HOUR("Members first seen after this hour.") }, ["index", "since"]) },
  { name: "arc_verified", description: "Projects whose builder proof validates against the Arc mainnet builder registry.", inputSchema: obj({}) },
] as const;

type Args = Record<string, unknown>;
type ToolResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };
class BadArgs extends Error {}

const str = (a: Args, k: string, required = false): string | undefined => {
  const v = a[k];
  if (v === undefined) { if (required) throw new BadArgs(`${k} is required.`); return undefined; }
  if (typeof v !== "string") throw new BadArgs(`${k} must be a string.`);
  return v;
};
const index = (a: Args) => { const i = parseIndex(str(a, "index", true)!); if (!i) throw new BadArgs("index must be abi, aii or aei."); return i; };
const qs = (p: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(p)) if (v !== undefined) u.set(k, v); const s = u.toString(); return s ? `?${s}` : ""; };

/** Call a v1 handler in-process; its JSON plus source_url, or its error sentence. */
async function viaApi(url: string, run: (req: Request) => Promise<Response>): Promise<ToolResult> {
  const r = await run(new Request(url));
  const body = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as Record<string, unknown>;
  return r.status === 200 ? { ok: true, data: { ...body, source_url: url } } : { ok: false, error: String(body.error ?? `HTTP ${r.status}`) };
}

async function callTool(name: string, a: Args, env: Env, deps: EdgeCacheDeps): Promise<ToolResult | null> {
  const d = { ...deps, cache: null };
  switch (name) {
    case "arc_indices": return viaApi(`${API}/indices`, (q) => handleIndices(q, env, d));
    case "arc_index_history": { const i = index(a); return viaApi(`${API}/indices/${i}/hourly${qs({ from: str(a, "from"), to: str(a, "to") })}`, (q) => handleIndexHourly(q, env, i, d)); }
    case "arc_app_history": { const i = index(a), id = str(a, "id", true)!; return viaApi(`${API}/members/${encodeURIComponent(id)}/hourly${qs({ index: i, from: str(a, "from"), to: str(a, "to") })}`, (q) => handleMemberHourly(q, env, i, id, d)); }
    case "arc_new_apps": { const i = index(a); return viaApi(`${API}/members/new${qs({ index: i, since: str(a, "since", true) })}`, (q) => handleMembersNew(q, env, i, d)); }
    case "arc_verified": return viaApi(`${API}/verified`, (q) => handleVerified(q, env, d));
    case "arc_apps": {
      const sort = parseSort(str(a, "sort") ?? null);
      const l = await loadAppList(env, deps);
      if (!l) return { ok: false, error: "The data is not available right now. Retry later." };
      const key: Record<string, (r: AppRow) => number> = { payments: (r) => r.last_24h.payments, usdc: (r) => r.last_24h.usdc, points: (r) => r.points, first_seen: (r) => Date.parse(r.first_hour) };
      const rows = [...l.rows].sort((x, y) => key[sort](y) - key[sort](x) || (x.id < y.id ? -1 : 1)).map((r) => ({ ...r, source_url: `${SITE}${idToPath(r.id)}` }));
      return { ok: true, data: { version: 1, data_until: l.data_until, sort, totals: l.totals, rows, source_url: `${SITE}/apps/` } };
    }
    case "arc_app": {
      const id = str(a, "id", true)!;
      const app = await loadApp(env, deps, id);
      if (app === null) return { ok: false, error: "The data is not available right now. Retry later." };
      if (app === "unknown") return { ok: false, error: `No app with id ${id} in the Arc indices. Use arc_apps for the list.` };
      return { ok: true, data: { version: 1, ...app, source_url: `${SITE}${idToPath(id)}` } };
    }
    default: return null;
  }
}

const reply = (id: unknown, body: { result?: unknown; error?: { code: number; message: string } }, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, ...body }), { status, headers: HEADERS });

export async function handleMcp(req: Request, env: Env, deps: EdgeCacheDeps): Promise<Response> {
  if (req.method.toUpperCase() === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id" } });
  if (req.method.toUpperCase() !== "POST") return new Response(JSON.stringify({ error: "MCP over POST only (stateless, no SSE stream)." }), { status: 405, headers: { ...HEADERS, allow: "POST" } });
  let msg: unknown;
  try { msg = JSON.parse(await req.text()); } catch { return reply(null, { error: { code: -32700, message: "Parse error" } }); }
  if (Array.isArray(msg) || typeof msg !== "object" || msg === null) return reply(null, { error: { code: -32600, message: "Invalid request: send one JSON-RPC object (batches are not supported)." } });
  const m = msg as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
  if (typeof m.method !== "string") return reply(m.id, { error: { code: -32600, message: "Invalid request: method is required." } });
  if (m.id === undefined) return new Response(null, { status: 202, headers: HEADERS }); // notification
  switch (m.method) {
    case "initialize": {
      const asked = typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "";
      return reply(m.id, { result: { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: {} },
        serverInfo: { name: "registrai-arc-data", version: "1.0.0" }, instructions: "Read-only Arc stablecoin app data from Registrai (CC BY 4.0). Cite source_url." } });
    }
    case "ping": return reply(m.id, { result: {} });
    case "tools/list": return reply(m.id, { result: { tools: MCP_TOOLS } });
    case "tools/call": {
      const name = m.params?.name, args = (m.params?.arguments ?? {}) as Args;
      if (typeof name !== "string" || !MCP_TOOLS.some((t) => t.name === name)) return reply(m.id, { error: { code: -32602, message: `Unknown tool: ${String(name)}` } });
      if (typeof args !== "object" || args === null || Array.isArray(args)) return reply(m.id, { error: { code: -32602, message: "arguments must be an object." } });
      let r: ToolResult | null;
      try { r = await callTool(name, args, env, deps); } catch (e) {
        if (e instanceof BadArgs) r = { ok: false, error: e.message };
        else { console.warn("mcp tool failed", name, e); r = { ok: false, error: "The tool failed. Retry later." }; }
      }
      if (!r) return reply(m.id, { error: { code: -32602, message: `Unknown tool: ${name}` } });
      return reply(m.id, { result: r.ok ? { content: [{ type: "text", text: JSON.stringify(r.data) }], structuredContent: r.data } : { content: [{ type: "text", text: r.error }], isError: true } });
    }
    default: return reply(m.id, { error: { code: -32601, message: `Method not found: ${m.method}` } });
  }
}
