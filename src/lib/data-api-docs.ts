// Data API v1 docs content (builder.registrai.cc/data-api/). Spec: docs/superpowers/specs/2026-10-14-data-api-v1-design.md.
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

export const CHANGELOG = [{ date: "2026-10-14", text: "v1 released: indices, members, member history, verified projects." }];

export const LICENCE = 'Free to use under CC BY 4.0 with the attribution "Data: Registrai". No warranty; not financial advice.';
