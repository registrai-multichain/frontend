/**
 * Read-only MCP server at /api/mcp (spec docs/superpowers/specs/2026-10-15-agent-reference-design.md): stateless JSON-RPC 2.0 over
 * HTTP POST (Streamable HTTP without sessions or SSE). Tools answer with the same JSON as Data API v1, plus a source_url an
 * agent can cite. API-backed tools call the v1 handlers in-process, so tool output and API output cannot differ.
 */
import { appHref } from "./app-href";
import { loadApp, loadAppList, type AppRow } from "./apps-data";
import { handleEcosystem } from "./data-api-ecosystem";
import { handleArc } from "./data-api-arc";
import { CATEGORIES } from "../../src/lib/arc-ecosystem";
import { parseSort } from "./apps-pages";
import { handleIndexHourly, handleIndices, handleMemberHourly, handleMembersNew, parseIndex } from "./data-api";
import { handleVerified } from "./data-api-verified";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";
import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { handlePaid } from "./x402-products";
import { formatUsd, PRODUCTS, type ProductId } from "./x402-config";
import type { GateDeps } from "./x402-gate";

const SITE = "https://builder.registrai.cc";
const API = `${SITE}/api/v1`;
const VERSIONS = ["2025-06-18", "2025-03-26"];
const HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };

const INDEX = { type: "string", enum: ["abi", "aii", "aei"], description: "abi = builder apps, aii = integrations, aei = both plus the Arc base layer" };
const HOUR = (d: string) => ({ type: "string", description: `${d} An ISO hour close, e.g. 2026-10-14T19:00:00Z.` });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

/** Paid tools: x402 over MCP. Call without payment → isError + structuredContent.x402 (the requirements); retry with
 * params._meta["x402/payment"] = the payment payload. Settlement is the same path as the paid HTTP routes. */
type PaidTool = { name: string; product: ProductId; route: (a: Args) => { parts: string[]; query: Record<string, string | undefined> }; schema: Record<string, unknown>; required: string[]; what: string; title: string };
const PAID: PaidTool[] = [
  { name: "arc_index_history_deep", title: "Arc index: full history", product: "deep_index_history", what: "Hourly closes of one Arc index for any window (beyond the free 744 h).",
    schema: { index: INDEX, from: HOUR("First hour (inclusive)."), to: HOUR("Last hour (inclusive).") }, required: ["index"],
    route: (a) => ({ parts: ["indices", String(a.index), "hourly"], query: { from: a.from as string, to: a.to as string } }) },
  { name: "arc_app_history_deep", title: "Arc app: full history", product: "deep_member_history", what: "One app's hourly points and activity for any window.",
    schema: { id: { type: "string" }, index: INDEX, from: HOUR("First hour (inclusive)."), to: HOUR("Last hour (inclusive).") }, required: ["id", "index"],
    route: (a) => ({ parts: ["members", encodeURIComponent(String(a.id)), "hourly"], query: { index: a.index as string, from: a.from as string, to: a.to as string } }) },
  { name: "arc_members_day", title: "Arc apps: one day", product: "members_day", what: "Every member's hourly rows and the ABI, AII and AEI closes for one UTC day.",
    schema: { date: { type: "string", description: "YYYY-MM-DD (UTC)." } }, required: ["date"],
    route: (a) => ({ parts: ["members", "day"], query: { date: a.date as string } }) },
  { name: "arc_events", title: "Arc watch-feed events", product: "events", what: "Watch-feed events on Arc: deploys, upgrades, control changes, pauses and large outflows, labelled to projects.",
    schema: Object.fromEntries(["since_block", "until_block", "since_ts", "kind", "project", "contract", "labelled", "min_balance", "min_project_usdc_24h", "limit"].map((k) => [k, { type: "string" }])), required: [],
    route: (a) => ({ parts: ["events"], query: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v === undefined ? undefined : String(v)])) }) },
  { name: "arc_contract", title: "Arc contract facts", product: "contract", what: "Facts for one contract on Arc: label, project, recent events and USDC balance.",
    schema: { address: { type: "string" } }, required: ["address"], route: (a) => ({ parts: ["contract", String(a.address)], query: {} }) },
  { name: "arc_project_scope", title: "Arc project contracts", product: "project_scope", what: "Every contract attributed to one project.",
    schema: { source: { type: "string" }, limit: { type: "string" }, offset: { type: "string" } }, required: ["source"],
    route: (a) => ({ parts: ["projects", encodeURIComponent(String(a.source)), "scope"], query: { limit: a.limit as string, offset: a.offset as string } }) },
];
function paidTools() {
  return PAID.map((t) => ({ name: t.name, title: t.title, description: `${t.what} Paid via x402 (USDC on Arc): ${formatUsd(PRODUCTS[t.product].gateway)} via Circle Gateway or ${formatUsd(PRODUCTS[t.product].standard)} standard. Call once to get the payment requirements, then retry with params._meta["x402/payment"].`,
    inputSchema: obj(t.schema, t.required), annotations: { ...RO, title: t.title } }));
}

// every tool only reads public data (review I4: clients skip the confirm prompt for read-only tools)
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const tool = (name: string, title: string, description: string, inputSchema: ReturnType<typeof obj>) =>
  ({ name, title, description, inputSchema, annotations: { ...RO, title } });

export const MCP_TOOLS = [
  tool("arc_indices", "Arc indices: latest", "Latest hourly close of the Arc Builders, Integrations and Ecosystem indices (ABI, AII, AEI), their 24 h change base and decay parameters. Use this when asked how Arc app activity is trending overall.", obj({})),
  tool("arc_index_history", "Arc index: hourly history", "Hourly closes of one Arc index, oldest first (at most 744 hours per call). Use this for charts or changes over a window of up to 31 days.", obj({ index: INDEX, from: HOUR("First hour (inclusive)."), to: HOUR("Last hour (inclusive).") }, ["index"])),
  tool("arc_apps", "Arc apps", "Every app on Arc in the indices with its last 24 h of stablecoin payments (USDC, EURC) and USD volume, verified status and first-seen hour. Use this when asked which apps use USDC on Arc, or which are most used. Not for token prices, DeFi TVL or chains other than Arc.", obj({ sort: { type: "string", enum: ["payments", "usdc", "points", "first_seen"] } })),
  tool("arc_app", "Arc app: detail", "One Arc app by id (e.g. domain:archery.wtf, integration:uniswap; ids come from arc_apps): last 24 h, contracts count, verified status and the last 7 days of hourly rows.", obj({ id: { type: "string" } }, ["id"])),
  tool("arc_app_history", "Arc app: hourly history", "One Arc app's hourly points and activity (payments, paying wallets, new payers, USD) in one index, oldest first.", obj({ id: { type: "string" }, index: INDEX, from: HOUR("First hour (inclusive)."), to: HOUR("Last hour (inclusive).") }, ["id", "index"])),
  tool("arc_new_apps", "Arc apps: newly seen", "Arc apps first seen in an index after a given hour. Use this when asked what is new on Arc.", obj({ index: INDEX, since: HOUR("Members first seen after this hour.") }, ["index", "since"])),
  tool("arc_verified", "Arc builders: verified", "Arc projects whose builder proof validates against the Arc mainnet builder registry.", obj({})),
  tool("arc_ecosystem", "Arc ecosystem: directory", "Every project in the Arc ecosystem directory (apps, wallets, exchanges, banks, infrastructure, partners) with category and status: live on mainnet, deployed or announced. Use this when asked what exists on Arc, which projects are in a category, or whether a company is on Arc. Not for token prices.",
    obj({ category: { type: "string", enum: CATEGORIES.map((c) => c.id) }, status: { type: "string", enum: ["live", "deployed", "announced"] }, q: { type: "string", description: "Name contains." } })),
  tool("arc_entity", "Arc project: detail", "One project in the Arc ecosystem directory by slug (slugs come from arc_ecosystem): summary, status with evidence, links, contracts on Arc and sources.", obj({ slug: { type: "string" } }, ["slug"])),
  tool("arc_numbers", "Arc in numbers", "Chain-level Arc numbers: USDC and EURC supply, all stablecoins and TVL (from DefiLlama), estimated 24 h stablecoin volume, apps and projects, index closes and a dated timeline, each with its source and date. Use this when asked how big Arc is, how much USDC is on Arc, or Arc's TVL or volume.", obj({})),
  ...paidTools(),
] as const;

async function callPaid(t: PaidTool, a: Args, meta: Record<string, unknown> | undefined, env: Env, deps: GateDeps) {
  for (const k of t.required) if (a[k] === undefined) return { content: [{ type: "text", text: `${k} is required.` }], isError: true };
  const { parts, query } = t.route(a);
  const q = new URLSearchParams(); for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, v);
  const url = `${SITE}/api/v1/paid/${parts.join("/")}${q.toString() ? `?${q}` : ""}`;
  const payment = meta?.["x402/payment"];
  const headers: Record<string, string> = {};
  if (payment) { try { headers["PAYMENT-SIGNATURE"] = encodePaymentSignatureHeader(payment as never); } catch { return { content: [{ type: "text", text: "The x402 payment could not be read." }], isError: true }; } }
  let r: Response;
  try { r = await handlePaid(new Request(url, { headers }), env, deps, parts); } catch (err) {
    console.warn("mcp paid tool failed", t.name, err instanceof Error ? err.message : err);
    return { content: [{ type: "text", text: "The tool failed. Retry later; nothing was charged." }], isError: true };
  }
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.status === 200) {
    const pr = r.headers.get("PAYMENT-RESPONSE");
    return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: { ...body, source_url: url }, _meta: { "x402/payment-response": pr ? decodePaymentResponseHeader(pr) : null } };
  }
  // x402 MCP transport (coinbase/x402 specs/transports-v2/mcp.md): structuredContent is the PaymentRequired; text is its JSON
  if (r.status === 402) return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, isError: true };
  return { content: [{ type: "text", text: String(body.error ?? `HTTP ${r.status}`) }], isError: true };
}

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
  const d = deps; // share the API's edge cache (review I2): a tool call costs what an API call costs
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
      const rows = [...l.rows].sort((x, y) => key[sort](y) - key[sort](x) || (x.id < y.id ? -1 : 1)).map((r) => ({ ...r, source_url: `${SITE}${appHref(r.id)}` }));
      return { ok: true, data: { version: 1, data_until: l.data_until, sort, totals: l.totals, rows, source_url: `${SITE}/apps/` } };
    }
    case "arc_app": {
      const id = str(a, "id", true)!;
      const app = await loadApp(env, deps, id);
      if (app === null) return { ok: false, error: "The data is not available right now. Retry later." };
      if (app === "unknown") return { ok: false, error: `No app with id ${id} in the Arc indices. Use arc_apps for the list.` };
      return { ok: true, data: { version: 1, ...app, source_url: `${SITE}${appHref(id)}` } };
    }
    case "arc_numbers": return viaApi(`${API}/arc`, (q) => handleArc(q, env, d, []));
    case "arc_ecosystem": return viaApi(`${API}/ecosystem${qs({ category: str(a, "category"), status: str(a, "status"), q: str(a, "q") })}`, (q) => handleEcosystem(q, d, []));
    case "arc_entity": { const slug = str(a, "slug", true)!; return viaApi(`${API}/ecosystem/${encodeURIComponent(slug)}`, (q) => handleEcosystem(q, d, [slug])); }
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
        serverInfo: { name: "registrai-arc-data", title: "Registrai Arc data", version: "1.0.0" }, instructions: "Read-only Arc ecosystem data from Registrai: apps, their stablecoin activity, the Arc indices, verified builders (CC BY 4.0). Cite source_url." } });
    }
    case "ping": return reply(m.id, { result: {} });
    case "tools/list": return reply(m.id, { result: { tools: MCP_TOOLS } });
    case "tools/call": {
      const name = m.params?.name, args = (m.params?.arguments ?? {}) as Args;
      if (typeof name !== "string" || !MCP_TOOLS.some((t) => t.name === name)) return reply(m.id, { error: { code: -32602, message: `Unknown tool: ${String(name)}` } });
      if (typeof args !== "object" || args === null || Array.isArray(args)) return reply(m.id, { error: { code: -32602, message: "arguments must be an object." } });
      const paid = PAID.find((t) => t.name === name);
      if (paid) return reply(m.id, { result: await callPaid(paid, args, m.params?._meta as Record<string, unknown> | undefined, env, deps as GateDeps) });
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
