/**
 * Paid extras (spec 2026-10-16-x402-data-api-design.md): deep history, the all-index day export and the watch-feed data.
 * Every product is computed or fetched BEFORE charging (the gate's precheck): an invalid request, an unknown id or a down
 * backend is answered without any payment moving.
 */
import { handleIndexHourly, handleMemberHourly, parseIndex } from "./data-api";
import { hourOf, isoHour, INDEX_IDS } from "./data-api-rows";
import { formatUsd, PRODUCTS, readX402Config, type ProductId } from "./x402-config";
import { paidHealth, payGate, type GateDeps } from "./x402-gate";
import { salesStats } from "./x402-ledger";
import type { Env } from "./env";

const DEEP_CAP_H = 24 * 366 * 3;
const HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const err = (status: number, error: string) => json({ error }, status);

/** Build first, charge only if the product is deliverable (status 200). */
async function sell(req: Request, env: Env, deps: GateDeps, product: ProductId, produce: () => Promise<Response>): Promise<Response> {
  let ready: Response | null = null;
  return payGate(req, env, deps, product, async () => ready!, {
    precheck: async () => {
      ready = await produce();
      return ready.status === 200 ? null : ready;
    },
  });
}

async function membersDay(env: Env, date: string): Promise<Response> {
  const db = env.DATA_DB!;
  const first = hourOf(`${date}T01:00:00Z`)!, last = first + 23;
  const indices: Record<string, unknown> = {};
  for (const idx of INDEX_IDS) {
    const closes = (await db.prepare("SELECT hour, close FROM index_hour WHERE idx = ? AND hour BETWEEN ? AND ? ORDER BY hour").bind(idx, first, last).all<{ hour: number; close: number }>()).results
      .map((r) => ({ hour_close: isoHour(r.hour), hour: r.hour, close: r.close }));
    const rows = (await db.prepare("SELECT id, hour, points, points_earned, payments, wallets, new_payers, usdc FROM member_hour WHERE idx = ? AND hour BETWEEN ? AND ? ORDER BY hour, id").bind(idx, first, last)
      .all<{ id: string; hour: number; points: number; points_earned: number; payments: number; wallets: number; new_payers: number; usdc: number }>()).results
      .map(({ hour, ...r }) => ({ ...r, hour_close: isoHour(hour), hour }));
    indices[idx] = { closes, rows };
  }
  return json({ version: 1, date, hours: [isoHour(first), isoHour(last)], indices });
}

async function watchfeed(env: Env, path: string, search: string): Promise<Response> {
  const base = (env.WATCHFEED_URL ?? "").replace(/\/+$/, "");
  if (!base || !env.WATCHFEED_SECRET) return err(503, "The watch feed is not available right now.");
  try {
    const r = await fetch(`${base}${path}${search}`, { headers: { "X-Registrai-Internal": env.WATCHFEED_SECRET }, signal: AbortSignal.timeout(8000) });
    if (r.status >= 500 || r.status === 401) return err(503, "The watch feed is not available right now.");
    return new Response(await r.text(), { status: r.status, headers: HEADERS });
  } catch {
    return err(503, "The watch feed is not available right now.");
  }
}

const ROUTES: Record<ProductId, string> = {
  deep_index_history: "/api/v1/paid/indices/{index}/hourly?from&to",
  deep_member_history: "/api/v1/paid/members/{id}/hourly?index&from&to",
  members_day: "/api/v1/paid/members/day?date=YYYY-MM-DD",
  events: "/api/v1/paid/events?since_block&until_block&since_ts&kind&project&contract&labelled&min_balance&min_project_usdc_24h&limit",
  contract: "/api/v1/paid/contract/{address}",
  project_scope: "/api/v1/paid/projects/{source}/scope?limit&offset",
};

const PREFLIGHT = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "PAYMENT-SIGNATURE, X-PAYMENT, content-type", "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE", "access-control-max-age": "86400" };
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return null; } };

export async function handlePaid(req: Request, env: Env, deps: GateDeps & { readBalance?: (a: `0x${string}`) => Promise<number> }, parts: string[]): Promise<Response> {
  if (req.method.toUpperCase() === "OPTIONS") return new Response(null, { status: 204, headers: PREFLIGHT });
  if (req.method.toUpperCase() !== "GET") return err(405, "Only GET is supported.");
  try {
    return await route(req, env, deps, parts);
  } catch (e) {
    console.warn("x402 paid route failed", parts.join("/"), e instanceof Error ? e.message.slice(0, 200) : e);
    return err(503, "Not available right now. Retry later; nothing was charged.");
  }
}

async function route(req: Request, env: Env, deps: GateDeps & { readBalance?: (a: `0x${string}`) => Promise<number> }, parts: string[]): Promise<Response> {
  const url = new URL(req.url);
  const [a, b, c] = parts;
  if (parts.length === 0) {
    const cfg = readX402Config(env);
    return json({ version: 1, configured: !!cfg, network: cfg?.caip2 ?? null, payment: "x402 v2: Circle Gateway (batched, gasless) or standard EIP-3009 USDC on Arc",
      products: (Object.keys(PRODUCTS) as ProductId[]).map((id) => ({ id, description: PRODUCTS[id].description, route: ROUTES[id], price_circle: formatUsd(PRODUCTS[id].gateway), price_standard: formatUsd(PRODUCTS[id].standard) })) });
  }
  if (a === "health" && parts.length === 1) return json(await paidHealth(env, deps.readBalance));
  if (a === "stats" && parts.length === 1) return env.DATA_DB ? json({ version: 1, sales: await salesStats(env.DATA_DB) }) : err(503, "Not available right now.");
  if (a === "indices" && c === "hourly" && parts.length === 3) {
    const index = parseIndex(b);
    if (!index) return err(404, "Unknown index.");
    return sell(req, env, deps, "deep_index_history", () => handleIndexHourly(req, env, index, { ...deps, cache: null }, DEEP_CAP_H));
  }
  if (a === "members" && b === "day" && parts.length === 2) {
    const date = url.searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || hourOf(`${date}T00:00:00Z`) === null || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return err(400, "date must be YYYY-MM-DD.");
    if (!env.DATA_DB) return err(503, "History is not available right now. Retry later.");
    return sell(req, env, deps, "members_day", () => membersDay(env, date));
  }
  if (a === "members" && c === "hourly" && parts.length === 3) {
    const index = parseIndex(url.searchParams.get("index"));
    if (!index) return err(400, "index is required: abi, aii or aei.");
    const id = safeDecode(b);
    if (id === null) return err(400, "The member id is not valid URL encoding.");
    return sell(req, env, deps, "deep_member_history", () => handleMemberHourly(req, env, index, id, { ...deps, cache: null }, DEEP_CAP_H));
  }
  const feedOff = !env.WATCHFEED_URL || !env.WATCHFEED_SECRET;
  if ((a === "events" || a === "contract" || a === "projects") && feedOff) return err(503, "The watch feed is not available right now."); // never offer what can't be delivered
  if (a === "events" && parts.length === 1) return sell(req, env, deps, "events", () => watchfeed(env, "/v1/events", url.search));
  if (a === "contract" && parts.length === 2 && /^0x[0-9a-fA-F]{40}$/.test(b)) return sell(req, env, deps, "contract", () => watchfeed(env, `/v1/contract/${b}`, ""));
  if (a === "projects" && c === "scope" && parts.length === 3) {
    const source = safeDecode(b);
    if (source === null) return err(400, "The project source is not valid URL encoding.");
    return sell(req, env, deps, "project_scope", () => watchfeed(env, `/v1/projects/${encodeURIComponent(source)}/scope`, url.search));
  }
  return err(404, "Unknown paid endpoint. See https://builder.registrai.cc/api/v1/paid");
}
