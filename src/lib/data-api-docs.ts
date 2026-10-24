// Data API v1 docs content (builder.registrai.cc/data-api/). Spec: docs/superpowers/specs/2026-10-14-data-api-v1-design.md.
import { ATTRIBUTION } from "./attribution";
import { formatUsd, PRODUCTS, type ProductId } from "./x402-catalog";
// The numbers here are the limits the API enforces (builders-site/lib/data-api.ts); keep them in step.
export const DATA_API_BASE = "https://builder.registrai.cc/api/v1";
export const DATA_API_DOCS_URL = "https://builder.registrai.cc/data-api/";

// requestsPerWindow/windowSeconds: the Cloudflare rate-limiting rule "builders API per-IP limit" on builder.registrai.cc/api/
// (the free plan's one rule, shared with the rest of /api/; owner 2026-10-15). Change the two together.
export const LIMITS = { requestsPerWindow: 100, windowSeconds: 10, historyHours: 744, membersHourlyHours: 168 };
export const HISTORY_START = { indices: "2026-10-02T00:00:00Z", members: "2026-10-10T23:00:00Z" };

export type Endpoint = { method: "GET"; path: string; params: string; returns: string; example: string };
const curl = (q: string) => `curl -s '${DATA_API_BASE}${q}'`;

export const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/indices", params: "none", returns: "Latest close, close 24 h earlier, base and member count of ABI, AII and AEI, plus the decay parameters.",
    example: curl("/indices") },
  { method: "GET", path: "/indices/{index}/hourly", params: "from, to (optional)", returns: "Hourly closes of one index, oldest first.",
    example: curl("/indices/abi/hourly?from=2026-10-14T00:00:00Z&to=2026-10-14T23:00:00Z") },
  { method: "GET", path: "/members", params: "index", returns: "Every scored member of an index now: points, share, verified, first hour and the last 24 h.",
    example: curl("/members?index=aii") },
  { method: "GET", path: "/members/{id}/hourly", params: "index, from, to (optional)", returns: "One member's hourly points and activity, oldest first.",
    example: curl("/members/domain%3Aarchery.wtf/hourly?index=abi") },
  { method: "GET", path: "/members/hourly", params: "index, and hour or from, to (optional; at most 168 h)", returns: "Every member's hourly rows for a range, ordered by hour, then id.",
    example: curl("/members/hourly?index=aii&from=2026-10-14T00:00:00Z&to=2026-10-14T23:00:00Z") },
  { method: "GET", path: "/members/new", params: "index, since", returns: "Members first seen after an hour.",
    example: curl("/members/new?index=abi&since=2026-10-13T00:00:00Z") },
  { method: "GET", path: "/verified", params: "none", returns: "Projects whose builder proof validates against the Arc mainnet builder registry.",
    example: curl("/verified") },
  { method: "GET", path: "/ecosystem", params: "category, status, q (optional)", returns: "Every project in the Arc ecosystem directory: category, status (live, deployed, announced), summary and page URL.",
    example: curl("/ecosystem?category=dexs") },
  { method: "GET", path: "/ecosystem/{slug}", params: "none", returns: "One project: summary, status with evidence, links, contracts on Arc, index ids and sources.",
    example: curl("/ecosystem/aave") },
  { method: "GET", path: "/ecosystem/corrections", params: "none", returns: "Every correction to the Arc ecosystem directory, newest first: date, project, field, what changed, source, and whether it came from the project or a reader.",
    example: curl("/ecosystem/corrections") },
  { method: "GET", path: "/arc", params: "none", returns: "Arc in numbers now: USDC and EURC supply, all stablecoins and TVL (DefiLlama), estimated 24 h stablecoin volume, apps and projects, index closes, timeline. Each figure with its source and date.",
    example: curl("/arc") },
  { method: "GET", path: "/arc/daily", params: "days (optional, 1-365, default 30)", returns: "Daily snapshots of Arc in numbers, newest first (one per UTC day, after the 00:00 close).",
    example: curl("/arc/daily?days=7") },
  { method: "GET", path: "/arc/apps-week", params: "none", returns: "Apps on Arc over the last 7 days (168 closed hours of the Arc Ecosystem Index): stablecoin payments received in USD, payments, new paying wallets and the hour each app was first seen in the index, ranked by USD.",
    example: curl("/arc/apps-week") },
];

export const FIELDS: { name: string; text: string }[] = [
  { name: "points", text: "The member's points stock at the hour's close: the index's value after decay and rise limits." },
  { name: "points_earned", text: "Raw points the member's payments earned within that hour, before rise limits." },
  { name: "payments, wallets, new_payers, usdc", text: "That hour's activity: counted payments, paying wallets, first-time payers and stablecoin volume in USD." },
  { name: "hour_close, hour", text: "The hour's close time in ISO UTC, and the same as unix seconds / 3600." },
  { name: "data_until", text: "The last closed hour served. It only moves forward." },
];

export const ERRORS: { status: number; text: string }[] = [
  { status: 400, text: "A parameter is missing or invalid; the error says which. A from after the last closed hour returns 200 with no rows." },
  { status: 404, text: "Unknown endpoint, or a member id this index has never had." },
  { status: 405, text: "Only GET is supported." },
  { status: 429, text: "Too many requests from your IP; retry after the retry-after header." },
  { status: 503, text: "Data is not available right now; retry later. A response is never partial." },
];

export const PRECISION_NOTE =
  "Closes come from the hourly candles at 3 decimals. points is full precision. points_earned and usdc are rounded to 1 and 2 decimals. Activity is served under its hour's close. A missed hour has no row (never null) and may be filled in later.";

export const CHANGELOG = [{ date: "2026-10-14", text: "v1 released: indices, members, member history, verified projects." }, { date: "2026-10-20", text: "Arc ecosystem directory: /ecosystem and /ecosystem/{slug}." }, { date: "2026-10-20", text: "Arc in numbers: /arc and /arc/daily." }, { date: "2026-10-21", text: "Directory corrections log: /ecosystem/corrections." }, { date: "2026-10-22", text: "Arc apps over 7 days: /arc/apps-week." }];

export const LICENCE = `Free to use under CC BY 4.0. Credit: "${ATTRIBUTION}". No warranty; not financial advice.`;

// Paid extras (x402). Prices come from the same catalogue the payment code charges.
export type PaidDoc = { id: ProductId; path: string; params: string; mcp: string; circle: string; standard: string; returns: string };
const PAID_ROUTES: Record<ProductId, { path: string; params: string; mcp: string }> = {
  deep_index_history: { path: "/paid/indices/{index}/hourly", params: "from, to (any window)", mcp: "arc_index_history_deep" },
  deep_member_history: { path: "/paid/members/{id}/hourly", params: "index, from, to (any window)", mcp: "arc_app_history_deep" },
  members_day: { path: "/paid/members/day", params: "date (YYYY-MM-DD)", mcp: "arc_members_day" },
  events: { path: "/paid/events", params: "since_block, until_block, since_ts, kind, project, contract, labelled, min_balance, min_project_usdc_24h, limit", mcp: "arc_events" },
  contract: { path: "/paid/contract/{address}", params: "none", mcp: "arc_contract" },
  project_scope: { path: "/paid/projects/{source}/scope", params: "limit, offset", mcp: "arc_project_scope" },
};
export const PAID_DOCS: PaidDoc[] = (Object.keys(PRODUCTS) as ProductId[]).map((id) => ({ id, ...PAID_ROUTES[id], circle: formatUsd(PRODUCTS[id].gateway), standard: formatUsd(PRODUCTS[id].standard), returns: PRODUCTS[id].description }));
export const PAID_NOTE = "Paid extras are sold per request through x402 on Arc mainnet. A request without payment answers 402 with two options: Circle Gateway Nanopayments (batched, gasless; the lower price) or a standard EIP-3009 USDC authorization (any x402 wallet). The response is built first and charged only if it can be delivered. The free tier above is unchanged.";

/** What the API is, in one sentence: the opening line of /data-api/ (data products, item 1). */
export const DATA_API_ANSWER = "The Registrai Data API serves hourly data on apps on Arc, Circle's blockchain, as JSON: each app's stablecoin payments, paying wallets and volume, the Arc indices, the Arc ecosystem directory and Arc chain figures. It does not serve raw blocks or transactions; read those from an Arc RPC.";

/** The MCP server in one sentence, then its tools (the free ones the server lists; a test keeps them in step). */
export const MCP_ANSWER = "Registrai runs a read-only MCP server for the same Arc data at https://builder.registrai.cc/api/mcp (Streamable HTTP, no sign-in or key), listed in the MCP registry as cc.registrai/arc-data.";
export const MCP_DOCS: { name: string; title: string; what: string }[] = [
  { name: "arc_indices", title: "Arc indices: latest", what: "latest close of ABI, AII and AEI" },
  { name: "arc_index_history", title: "Arc index: hourly history", what: "hourly closes of one index, up to 31 days" },
  { name: "arc_apps", title: "Arc apps", what: "every app with its last 24 h of stablecoin payments and volume" },
  { name: "arc_app", title: "Arc app: detail", what: "one app's last 24 h and last 7 days" },
  { name: "arc_app_history", title: "Arc app: hourly history", what: "one app's hourly payments, paying wallets and USD" },
  { name: "arc_new_apps", title: "Arc apps: newly seen", what: "apps first seen after a given hour" },
  { name: "arc_verified", title: "Arc builders: verified", what: "projects with a valid builder proof on Arc" },
  { name: "arc_ecosystem", title: "Arc ecosystem: directory", what: "every project on Arc with category and status" },
  { name: "arc_entity", title: "Arc project: detail", what: "one project's status, evidence, contracts and sources" },
  { name: "arc_numbers", title: "Arc in numbers", what: "USDC and stablecoin supply, TVL, transactions and volume" },
  { name: "arc_apps_week", title: "Arc apps, last 7 days", what: "apps ranked by stablecoin payments received over 7 days" },
];
