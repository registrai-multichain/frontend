/**
 * Arc Builders Index: the published data file and its validator (shared by the
 * builders-site Pages Function and the page). The producer POSTs the whole file
 * to /api/index; only the fields below are kept, anything else is dropped.
 */

import { evidenceItem } from "./facts";

export const ABI_KEY = "abi:index";
export const ABI_SEEN_KEY = "abi:seen";

export const ABI_LIMITS = {
  /** an index file; history is trimmed by the producer (30 days hourly, then daily) and the member map lives apart */
  bytes: 1024 * 1024,
  seenBytes: 1024 * 1024,
  /** AII/AEI: ~350k integration payers in the 30-day window */
  seenBytesWide: 6 * 1024 * 1024,
  contracts: 5_000,
  deployersPer: 50,
  seenSources: 200,
  /** under the RPC's getLogs range limit (10,000 blocks) */
  baseWindow: 5_000,
  candles: 5_000,
  tape: 1_000,
  series: 10_000,
  projects: 200,
  events: 2_000,
  params: 32,
  str: 200,
  milestones: 500,
  milestoneTitle: 120,
  company: 60,
  integrations: 400,
  openSenders: 500,
  /** the separate contracts file (factory pools: Uniswap alone ≈ 11.5k) */
  contractsFile: 100_000,
  contractsBytes: 8 * 1024 * 1024,
  /** live.contracts_add: today's joins on top of the daily base map */
  contractsAdd: 5_000,
  integrationCompany: 80,
  integrationCategory: 40,
  evidencePer: 10,
  stablecoins: 50,
  volumeCoins: 50,
  fxDates: 10,
  fxCurrencies: 20,
} as const;

/** Spec §17: three indices with one method and one file shape. ABI = builders + base layer;
 * AII = integrated products only; AEI = everything. Each has its own KV keys and endpoints. */
export const ABI_INDEX_IDS = ["abi", "aii", "aei"] as const;
export type AbiIndexId = (typeof ABI_INDEX_IDS)[number];
export type AbiIndexDef = { id: AbiIndexId; name: string; code: string; label: string; key: string; seenKey: string; contractsKey: string; path: string; seenPath: string; contractsPath: string; seenBytes: number };
export const ABI_INDICES: Record<AbiIndexId, AbiIndexDef> = {
  abi: { id: "abi", name: "Arc Builders Index", code: "ABI", label: "Builders", key: ABI_KEY, seenKey: ABI_SEEN_KEY, contractsKey: "abi:contracts", path: "/api/index", seenPath: "/api/index/seen", contractsPath: "/api/index/contracts", seenBytes: ABI_LIMITS.seenBytes },
  aii: { id: "aii", name: "Arc Integrations Index", code: "AII", label: "Integrations", key: "aii:index", seenKey: "aii:seen", contractsKey: "aii:contracts", path: "/api/index/aii", seenPath: "/api/index/aii/seen", contractsPath: "/api/index/aii/contracts", seenBytes: ABI_LIMITS.seenBytesWide },
  aei: { id: "aei", name: "Arc Ecosystem Index", code: "AEI", label: "Ecosystem", key: "aei:index", seenKey: "aei:seen", contractsKey: "aei:contracts", path: "/api/index/aei", seenPath: "/api/index/aei/seen", contractsPath: "/api/index/aei/contracts", seenBytes: ABI_LIMITS.seenBytesWide },
};
/** GET /api/index/summary: each index's last closed value, for the index tabs. null when that index has no file yet. */
/** Hourly closes the summary carries per index for a sparkline: the last 7 days. */
export const ABI_SUMMARY_SPARK_HOURS = 168;
export type AbiIndexSummary = Record<AbiIndexId, { index: number; index_24h_ago: number | null; data_until: string; spark: [string, number][] } | null>;
export const ABI_SUMMARY_PATH = "/api/index/summary";

export const isIndexId = (v: unknown): v is AbiIndexId => typeof v === "string" && (ABI_INDEX_IDS as readonly string[]).includes(v);

/** Milestone tiers (spec §12, §14): the multiplier on the target member's points (for `integration` the maximum:
 * 1 + 0.025 · log10(revenue / $1M)), and whether the target is the Arc base layer. */
export const ABI_MILESTONE_TIERS = {
  "arc-upgrade": { mult: 1.25, base: true },
  "circle-product": { mult: 1.15, base: true },
  "stablecoin-launch": { mult: 1.1, base: true },
  "integration": { mult: 1.1, base: true },
  "project-release": { mult: 1.1, base: false },
} as const;
export type AbiMilestoneTier = keyof typeof ABI_MILESTONE_TIERS;

export const ABI_PROJECT_KINDS = ["project", "integration", "base"] as const;
export type AbiProjectKind = (typeof ABI_PROJECT_KINDS)[number];
export type AbiProject = { source: string; name: string; share: number; share_base: number | null; points: number; contracts: number; base_layer: boolean;
  /** §15; files before it have no kind: base when base_layer, else project */
  kind: AbiProjectKind;
  /** points this hour / last 24 closed hours, payments and USDC in the last 24 closed hours */
  pts_1h: number; pts_24h: number; pay_24h: number; usdc_24h: number };
export type AbiEvent = { t: string; source: string; name: string; kind: "activity" | "rise_limit"; payments: number; wallets: number; new_payers: number; points: number; usdc: number; open?: true };
/** What the browser needs to replay the open hour (the producer's state at the last closed hour). */
export type AbiLive = {
  hour_start: number; hour_start_block: number;
  K: number; base_k: number; base: string;
  P: Record<string, number>; roots_prev: Record<string, number>;
  decay_h: number; cap: number; new_payer: number; proj_up: number; rel_up: number; entry: number; base_scale: number; base_window: number;
  /** inline map (small indices, older files); empty when it is published separately (contracts_sha256) */
  contracts: Record<string, string>; deployers: Record<string, string[]>; seen_prefix: number;
  /** audit F1 (absent in older files): payments under min_pay are ignored; only a payment of new_payer_min or more
   * earns (and marks) the new-payer bonus, at most new_payer_max_h per member-hour; entry_step phases the entry in */
  min_pay?: number; new_payer_min?: number; new_payer_max_h?: number; entry_step?: number;
  /** §21 (absent in older files = today's rule): payment cap per payer per hour, USD per volume point, base-layer cap */
  vol_cap?: number; vol_unit?: number; base_cap?: number;
  /** "close the gaps": the contract map lives in its own file (/api/index/…/contracts); this pins its version */
  contracts_sha256?: string; contracts_count?: number;
  /** §18: contracts that joined since the base map's day0 (merged into it; integration ones are also open senders) */
  contracts_add?: Record<string, string>;
  /** registered fiat stablecoins by lowercase token address (counted from `added`, unix seconds) */
  stablecoins?: Record<string, AbiLiveCoin>;
  /** §15: integrated products' contracts (sorted, lowercase); their payments into OTHER members count */
  open_senders?: string[];
};
export type AbiLiveCoin = { symbol: string; currency: string; decimals: number; added: number };
/** A recorded milestone: from `t` (unix seconds) the target's √P is multiplied by √mult, after the rise limit. */
export type AbiMilestone = { id: string; t: number; target: string; tier: AbiMilestoneTier; mult: number; title: string; evidence: string[];
  /** integration milestones (§14): the company and its annual revenue, from a filing or a published estimate */
  company?: string; revenue_usd?: number; revenue_kind?: "filing" | "estimate" };
/** A company that announced an Arc integration (spec §14). link: the live evidence when live, else the first announcement. */
export type AbiIntegration = { company: string; category: string; status: AbiIntegrationStatus; first_announced: string; link: string | null; member: string | null; milestone_id: string | null };
/** Last 24 closed hours of a company's Arc activity (§14 tracking; not scored). wallets: wallets known only from
 * public explorer labels; contracts: the company's member contracts. */
export type AbiIntegrationActivity =
  | { source: "wallets"; wallets: number; out_usd: number; out_transfers: number; recipients: number; in_usd: number; in_transfers: number; senders: number }
  | { source: "contracts"; payments: number; usd_in: number; points: number; payers_hourly_sum: number };
export const ABI_INTEGRATION_STATUSES = ["live", "deployed", "announced"] as const;
export type AbiIntegrationStatus = (typeof ABI_INTEGRATION_STATUSES)[number];
export type AbiStablecoin = { symbol: string; currency: string; issuer: string; address: string; decimals: number; added: number };
export type AbiVolume = { members_usd: number; members_payments: number; base_usd_est: number; base_transfers_est: number };
/** ECB fixes: date (YYYY-MM-DD) -> currency -> USD per unit */
export type AbiFx = Record<string, Record<string, number>>;
/** [iso hour open, open, high, low, close, payments, USDC, points] */
export type AbiCandle = [string, number, number, number, number, number, number, number];
/** [iso time, source, USDC, points, new payer 0|1] */
export type AbiTapeRow = [string, string, number, number, 0 | 1];
export type AbiData = {
  updated: string;
  data_until: string;
  head_time: string;
  head_block: number;
  index: number;
  index_24h_ago: number | null;
  base: { time: string; level: number; sha256: string };
  series: [string, number][];
  projects: AbiProject[];
  events: AbiEvent[];
  params: { half_life_days: number; decay_per_hour_pct: number } & Record<string, number>;
  roots_24h: Record<string, number>;
  candles: AbiCandle[];
  tape: AbiTapeRow[];
  milestones: AbiMilestone[];
  stablecoins: AbiStablecoin[];
  integrations: AbiIntegration[];
  integration_activity: Record<string, AbiIntegrationActivity>;
  volume_24h: Record<string, AbiVolume>;
  live_fx: AbiFx;
  live?: AbiLive;
};

export type AbiSeen = { hour_start: number; seen: Record<string, string> };

export type AbiResult = { ok: true; data: AbiData } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown, max: number = ABI_LIMITS.str): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const iso = (v: unknown): v is string => str(v, 40) && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => num(v) && Number.isInteger(v) && v >= 0;
const SHA = /^[0-9a-f]{64}$/;
const KEY = /^[a-z0-9_]{1,40}$/;

const ADDR = /^0x[0-9a-f]{40}$/;
const posInt = (v: unknown): v is number => count(v) && v > 0;
const SYMBOL = /^[A-Za-z0-9.]{1,16}$/;
const CCY = /^[A-Z]{3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const decimals = (v: unknown): v is number => count(v) && v <= 36;
// one line of plain text: no control characters
const line = (v: unknown, max: number): v is string => str(v, max) && !/[\u0000-\u001f\u007f]/.test(v) && v.trim() === v;

function numberMap(v: unknown, max: number): Record<string, number> | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > max) return null;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const x = v[k];
    if (!str(k) || !num(x) || x < 0) return null;
    out[k] = x;
  }
  return out;
}

/** live.stablecoins: lowercase token address -> { symbol, currency, decimals, added }; null when malformed. */
function validateLiveCoins(v: unknown): Record<string, AbiLiveCoin> | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > ABI_LIMITS.stablecoins) return null;
  const out: Record<string, AbiLiveCoin> = {};
  for (const a of keys) {
    const c = v[a];
    if (!ADDR.test(a) || !isObj(c) || typeof c.symbol !== "string" || !SYMBOL.test(c.symbol) || typeof c.currency !== "string" || !CCY.test(c.currency) || !decimals(c.decimals) || !posInt(c.added)) return null;
    out[a] = { symbol: c.symbol, currency: c.currency, decimals: c.decimals, added: c.added };
  }
  return out;
}

/** Recorded milestones (spec §12): known tier, base tiers on a base member and member tiers off it, evidence links only. */
function validateMilestones(v: unknown): AbiMilestone[] | string {
  if (!Array.isArray(v) || v.length > ABI_LIMITS.milestones) return `milestones must be an array of at most ${ABI_LIMITS.milestones}`;
  const out: AbiMilestone[] = [];
  for (const m of v) {
    if (!isObj(m) || typeof m.id !== "string" || !MS_ID.test(m.id) || !posInt(m.t) || !str(m.target) || !line(m.title, ABI_LIMITS.milestoneTitle)) return "a milestone is malformed";
    const tier = typeof m.tier === "string" && Object.prototype.hasOwnProperty.call(ABI_MILESTONE_TIERS, m.tier) ? (m.tier as AbiMilestoneTier) : null;
    if (!tier) return "a milestone tier is unknown";
    if (ABI_MILESTONE_TIERS[tier].base !== m.target.startsWith("base:")) return `milestone ${m.id}: ${tier} targets ${ABI_MILESTONE_TIERS[tier].base ? "the Arc base layer" : "a member"}`;
    if (!num(m.mult) || m.mult <= 1 || m.mult > 2) return "a milestone multiplier must be above 1 and at most 2";
    if (tier === "integration" && m.mult > ABI_MILESTONE_TIERS.integration.mult) return `milestone ${m.id}: an integration multiplier is at most ${ABI_MILESTONE_TIERS.integration.mult}`;
    if (m.company !== undefined && !line(m.company, ABI_LIMITS.company)) return `milestone ${m.id}: company must be one line of at most ${ABI_LIMITS.company} characters`;
    if (m.revenue_usd !== undefined && (!num(m.revenue_usd) || m.revenue_usd <= 0)) return `milestone ${m.id}: revenue_usd must be a positive number`;
    if ((m.revenue_usd === undefined) !== (m.revenue_kind === undefined) || (m.revenue_kind !== undefined && m.revenue_kind !== "filing" && m.revenue_kind !== "estimate")) return `milestone ${m.id}: revenue_usd needs revenue_kind "filing" or "estimate"`;
    if (!Array.isArray(m.evidence) || m.evidence.length < 1 || m.evidence.length > ABI_LIMITS.evidencePer) return `a milestone needs 1 to ${ABI_LIMITS.evidencePer} evidence items`;
    const evidence: string[] = [];
    for (const e of m.evidence) {
      const ok = evidenceItem(e);
      if (!ok) return "milestone evidence must be https URLs, 0x addresses or 0x tx hashes";
      evidence.push(ok);
    }
    const ms: AbiMilestone = { id: m.id, t: m.t, target: m.target, tier, mult: m.mult, title: m.title, evidence };
    if (m.company !== undefined) ms.company = m.company as string;
    if (m.revenue_usd !== undefined) { ms.revenue_usd = m.revenue_usd as number; ms.revenue_kind = m.revenue_kind as "filing" | "estimate"; }
    out.push(ms);
  }
  return out;
}

/** integrations (§14): malformed rows are dropped, not fatal, so one bad row can't hold back the hourly push. */
function validateIntegrations(v: unknown): AbiIntegration[] {
  if (!Array.isArray(v)) return [];
  const out: AbiIntegration[] = [];
  for (const r of v.slice(0, ABI_LIMITS.integrations)) {
    if (!isObj(r) || !line(r.company, ABI_LIMITS.integrationCompany) || !line(r.category, ABI_LIMITS.integrationCategory)) continue;
    if (typeof r.status !== "string" || !(ABI_INTEGRATION_STATUSES as readonly string[]).includes(r.status)) continue;
    if (typeof r.first_announced !== "string" || !DAY.test(r.first_announced)) continue;
    // the tracker's evidence lines read "<url> — note (date)": keep the URL (audit L11: 65 links 404'd with the note)
    const link = r.link == null ? null : evidenceItem(typeof r.link === "string" ? r.link.trim().split(/\s/)[0] : r.link);
    if (r.link != null && !link) continue;
    const member = typeof r.member === "string" && str(r.member) ? r.member : null;
    const milestone_id = typeof r.milestone_id === "string" && MS_ID.test(r.milestone_id) ? r.milestone_id : null;
    out.push({ company: r.company, category: r.category, status: r.status as AbiIntegrationStatus, first_announced: r.first_announced, link: link || null, member, milestone_id });
  }
  return out;
}

const ACTIVITY_FIELDS = {
  wallets: ["wallets", "out_usd", "out_transfers", "recipients", "in_usd", "in_transfers", "senders"],
  contracts: ["payments", "usd_in", "points", "payers_hourly_sum"],
} as const;
/** integration_activity (§14): company -> last-24h activity; malformed entries are dropped, not fatal. */
function validateActivity(v: unknown): Record<string, AbiIntegrationActivity> {
  const out: Record<string, AbiIntegrationActivity> = {};
  if (!isObj(v)) return out;
  for (const k of Object.keys(v).slice(0, ABI_LIMITS.integrations)) {
    const a = v[k];
    if (!line(k, ABI_LIMITS.integrationCompany) || !isObj(a) || (a.source !== "wallets" && a.source !== "contracts")) continue;
    const fields = ACTIVITY_FIELDS[a.source];
    if (!fields.every((f) => num(a[f]) && (a[f] as number) >= 0)) continue;
    out[k] = Object.fromEntries([["source", a.source], ...fields.map((f) => [f, a[f]])]) as AbiIntegrationActivity;
  }
  return out;
}

function validateStablecoins(v: unknown): AbiStablecoin[] | null {
  if (!Array.isArray(v) || v.length > ABI_LIMITS.stablecoins) return null;
  const out: AbiStablecoin[] = [];
  for (const c of v) {
    if (!isObj(c) || typeof c.symbol !== "string" || !SYMBOL.test(c.symbol) || typeof c.currency !== "string" || !CCY.test(c.currency)) return null;
    if (typeof c.address !== "string" || !ADDR.test(c.address) || !decimals(c.decimals) || !posInt(c.added)) return null;
    if (c.issuer !== undefined && !line(c.issuer, 80)) return null;
    out.push({ symbol: c.symbol, currency: c.currency, issuer: (c.issuer as string | undefined) ?? "", address: c.address, decimals: c.decimals, added: c.added });
  }
  return out;
}

function validateVolume(v: unknown): Record<string, AbiVolume> | null {
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length > ABI_LIMITS.volumeCoins) return null;
  const out: Record<string, AbiVolume> = {};
  for (const k of keys) {
    const o = v[k];
    if (!SYMBOL.test(k) || !isObj(o)) return null;
    const vals = [o.members_usd ?? 0, o.members_payments ?? 0, o.base_usd_est ?? 0, o.base_transfers_est ?? 0];
    if (!vals.every((x) => num(x) && x >= 0)) return null;
    const [mu, mp, bu, bt] = vals as number[];
    out[k] = { members_usd: mu, members_payments: mp, base_usd_est: bu, base_transfers_est: bt };
  }
  return out;
}

/**
 * ECB fixes for the open hour's conversions: only the currencies of registered coins are kept (the producer sends the
 * whole ECB table), at most `fxDates` dates and `fxCurrencies` currencies per date. Rates are USD per unit, positive.
 */
function validateFx(v: unknown, currencies: Set<string>): AbiFx | null {
  if (!isObj(v)) return null;
  const days = Object.keys(v);
  if (days.length > ABI_LIMITS.fxDates) return null;
  const out: AbiFx = {};
  for (const d of days) {
    const row = v[d];
    if (!DAY.test(d) || !isObj(row) || Object.keys(row).length > 64) return null;
    const kept: Record<string, number> = {};
    for (const c of Object.keys(row)) {
      if (!currencies.has(c)) continue;
      const r = row[c];
      if (!num(r) || r <= 0) return null;
      kept[c] = r;
    }
    if (Object.keys(kept).length > ABI_LIMITS.fxCurrencies) return null;
    out[d] = kept;
  }
  return out;
}

/** The `live` block: null when malformed. Unknown keys are dropped. */
function validateLive(v: unknown): AbiLive | null {
  if (!isObj(v)) return null;
  if (!posInt(v.hour_start) || !count(v.hour_start_block) || !str(v.base) || !posInt(v.base_window) || v.base_window > ABI_LIMITS.baseWindow || !posInt(v.seen_prefix) || v.seen_prefix > 40) return null;
  for (const k of ["K", "base_k", "decay_h", "cap", "new_payer", "proj_up", "rel_up", "entry", "base_scale"] as const) if (!num(v[k]) || v[k] < 0) return null;
  let add: Record<string, string> | null = null;
  if (v.contracts_add !== undefined && v.contracts_add !== null) {
    if (!isObj(v.contracts_add)) return null;
    const keys = Object.keys(v.contracts_add);
    if (keys.length > ABI_LIMITS.contractsAdd) return null;
    add = {};
    for (const a of keys) {
      const src = (v.contracts_add as Record<string, unknown>)[a];
      if (!ADDR.test(a) || !str(src)) return null;
      add[a] = src;
    }
  }
  const f1: Partial<Pick<AbiLive, "min_pay" | "new_payer_min" | "new_payer_max_h" | "entry_step" | "vol_cap" | "vol_unit" | "base_cap">> = {};
  for (const k of ["min_pay", "new_payer_min", "new_payer_max_h", "entry_step", "vol_cap", "vol_unit", "base_cap"] as const) {
    if (v[k] === undefined || v[k] === null) continue;
    if (!num(v[k]) || (v[k] as number) < 0) return null;
    f1[k] = v[k] as number;
  }
  const P = numberMap(v.P, ABI_LIMITS.projects), roots = numberMap(v.roots_prev, ABI_LIMITS.projects);
  const external = v.contracts_sha256 !== undefined;
  if (external && (typeof v.contracts_sha256 !== "string" || !SHA.test(v.contracts_sha256) || !count(v.contracts_count) || v.contracts_count > ABI_LIMITS.contractsFile)) return null;
  if (!P || !roots || (!external && !isObj(v.contracts)) || !isObj(v.deployers)) return null;
  const contracts: Record<string, string> = {};
  if (!external) {
    const contractKeys = Object.keys(v.contracts as object);
    if (contractKeys.length > ABI_LIMITS.contracts) return null;
    for (const a of contractKeys) {
      const src = (v.contracts as Record<string, unknown>)[a];
      if (!ADDR.test(a) || !str(src)) return null;
      contracts[a] = src;
    }
  }
  const depKeys = Object.keys(v.deployers);
  if (depKeys.length > ABI_LIMITS.projects) return null;
  const deployers: Record<string, string[]> = {};
  for (const src of depKeys) {
    const list = v.deployers[src];
    if (!str(src) || !Array.isArray(list) || list.length > ABI_LIMITS.deployersPer || !list.every((a) => typeof a === "string" && ADDR.test(a))) return null;
    deployers[src] = list as string[];
  }
  let coins: Record<string, AbiLiveCoin> | null = null;
  if (v.stablecoins !== undefined) {
    coins = validateLiveCoins(v.stablecoins);
    if (!coins) return null;
  }
  let open: string[] | null = null;
  if (v.open_senders !== undefined) {
    const o = v.open_senders;
    if (!Array.isArray(o) || o.length > ABI_LIMITS.openSenders || !o.every((a) => typeof a === "string" && ADDR.test(a))) return null;
    open = [...new Set(o as string[])].sort();
  }
  return {
    ...(coins ? { stablecoins: coins } : {}),
    ...(open && !external ? { open_senders: open } : {}),
    ...(external ? { contracts_sha256: v.contracts_sha256 as string, contracts_count: v.contracts_count as number } : {}),
    ...f1,
    ...(add ? { contracts_add: add } : {}),
    hour_start: v.hour_start, hour_start_block: v.hour_start_block, K: v.K as number, base_k: v.base_k as number, base: v.base, P, roots_prev: roots,
    decay_h: v.decay_h as number, cap: v.cap as number, new_payer: v.new_payer as number, proj_up: v.proj_up as number, rel_up: v.rel_up as number,
    entry: v.entry as number, base_scale: v.base_scale as number, base_window: v.base_window, contracts, deployers, seen_prefix: v.seen_prefix,
  };
}

export type AbiSeenResult = { ok: true; data: AbiSeen } | { ok: false; error: string };

/** The wallets seen before the open hour: per source, concatenated 10-hex payer-address prefixes. */
export function validateSeen(raw: unknown): AbiSeenResult {
  if (!isObj(raw)) return { ok: false, error: "expected a JSON object" };
  if (!posInt(raw.hour_start)) return { ok: false, error: "hour_start must be a positive integer" };
  if (!isObj(raw.seen)) return { ok: false, error: "seen must be an object" };
  const keys = Object.keys(raw.seen);
  if (keys.length > ABI_LIMITS.seenSources) return { ok: false, error: `seen may hold at most ${ABI_LIMITS.seenSources} sources` };
  const seen: Record<string, string> = {};
  for (const k of keys) {
    const s = raw.seen[k];
    if (!str(k) || typeof s !== "string" || !/^[0-9a-f]*$/.test(s) || s.length % 10 !== 0) return { ok: false, error: "seen values must be lowercase hex in multiples of 10 characters" };
    seen[k] = s;
  }
  return { ok: true, data: { hour_start: raw.hour_start, seen } };
}

export function validateIndex(raw: unknown): AbiResult {
  const bad = (error: string): AbiResult => ({ ok: false, error });
  if (!isObj(raw)) return bad("expected a JSON object");
  for (const k of ["updated", "data_until", "head_time"] as const) if (!iso(raw[k])) return bad(`${k} must be an ISO time`);
  if (!count(raw.head_block)) return bad("head_block must be a non-negative integer");
  if (!num(raw.index) || raw.index <= 0) return bad("index must be a positive number");
  if (raw.index_24h_ago !== null && raw.index_24h_ago !== undefined && (!num(raw.index_24h_ago) || raw.index_24h_ago <= 0)) return bad("index_24h_ago must be a positive number or null");
  const b = raw.base;
  if (!isObj(b) || !iso(b.time) || !num(b.level) || b.level <= 0 || typeof b.sha256 !== "string" || !SHA.test(b.sha256)) return bad("base must be { time, level, sha256 }");

  if (!Array.isArray(raw.series) || raw.series.length > ABI_LIMITS.series) return bad(`series must be an array of at most ${ABI_LIMITS.series}`);
  const series: [string, number][] = [];
  for (const p of raw.series) {
    if (!Array.isArray(p) || p.length !== 2 || !iso(p[0]) || !num(p[1])) return bad("series entries must be [ISO time, number]");
    series.push([p[0], p[1]]);
  }
  if (!Array.isArray(raw.projects) || raw.projects.length > ABI_LIMITS.projects) return bad(`projects must be an array of at most ${ABI_LIMITS.projects}`);
  const projects: AbiProject[] = [];
  for (const p of raw.projects) {
    if (!isObj(p) || !str(p.source) || !str(p.name) || !num(p.share) || !num(p.points) || !count(p.contracts) || typeof p.base_layer !== "boolean") return bad("a project is malformed");
    if (p.share_base !== null && p.share_base !== undefined && !num(p.share_base)) return bad("share_base must be a number or null");
    if (p.kind !== undefined && !(typeof p.kind === "string" && (ABI_PROJECT_KINDS as readonly string[]).includes(p.kind))) return bad(`a project's kind must be one of ${ABI_PROJECT_KINDS.join(", ")}`);
    const kind = (p.kind as AbiProjectKind | undefined) ?? (p.base_layer ? "base" : "project");
    const [h1, d1, pay, usd] = [p.pts_1h ?? 0, p.pts_24h ?? 0, p.pay_24h ?? 0, p.usdc_24h ?? 0];
    if (!num(h1) || !num(d1) || !count(pay) || !num(usd)) return bad("a project's pts_1h, pts_24h, pay_24h or usdc_24h is malformed");
    const extra = { pts_1h: h1, pts_24h: d1, pay_24h: pay, usdc_24h: usd };
    projects.push({ source: p.source, name: p.name, share: p.share, share_base: p.share_base ?? null, points: p.points, contracts: p.contracts, base_layer: p.base_layer, kind, ...extra });
  }
  if (!Array.isArray(raw.events) || raw.events.length > ABI_LIMITS.events) return bad(`events must be an array of at most ${ABI_LIMITS.events}`);
  const events: AbiEvent[] = [];
  for (const e of raw.events) {
    if (!isObj(e) || !iso(e.t) || !str(e.source) || !str(e.name) || (e.kind !== "activity" && e.kind !== "rise_limit")) return bad("an event is malformed");
    if (e.kind === "rise_limit") {
      // the producer sends only { t, source, name, kind } for a rise-limit hit
      events.push({ t: e.t, source: e.source, name: e.name, kind: e.kind, payments: 0, wallets: 0, new_payers: 0, points: 0, usdc: 0 });
      continue;
    }
    if (!count(e.payments) || !count(e.wallets) || !count(e.new_payers) || !num(e.points)) return bad("event counts must be non-negative integers and points a number");
    if (e.usdc !== undefined && (!num(e.usdc) || e.usdc < 0)) return bad("event usdc must be a non-negative number");
    events.push({ t: e.t, source: e.source, name: e.name, kind: e.kind, payments: e.payments, wallets: e.wallets, new_payers: e.new_payers, points: e.points, usdc: (e.usdc as number | undefined) ?? 0 });
  }
  const candles: AbiCandle[] = [];
  if (raw.candles !== undefined) {
    if (!Array.isArray(raw.candles) || raw.candles.length > ABI_LIMITS.candles) return bad(`candles must be an array of at most ${ABI_LIMITS.candles}`);
    for (const c of raw.candles) {
      if (!Array.isArray(c) || c.length !== 8 || !iso(c[0]) || ![1, 2, 3, 4].every((i) => num(c[i]) && c[i] > 0) || !count(c[5]) || !num(c[6]) || c[6] < 0 || !num(c[7]) || c[7] < 0) return bad("candles entries must be [ISO time, open, high, low, close, payments, USDC, points]");
      candles.push(c as AbiCandle);
    }
  }
  const tape: AbiTapeRow[] = [];
  if (raw.tape !== undefined) {
    if (!Array.isArray(raw.tape) || raw.tape.length > ABI_LIMITS.tape) return bad(`tape must be an array of at most ${ABI_LIMITS.tape}`);
    for (const r of raw.tape) {
      if (!Array.isArray(r) || r.length !== 5 || !iso(r[0]) || !str(r[1]) || !num(r[2]) || r[2] < 0 || !num(r[3]) || r[3] < 0 || (r[4] !== 0 && r[4] !== 1)) return bad("tape entries must be [ISO time, source, USDC, points, 0|1]");
      tape.push(r as AbiTapeRow);
    }
  }
  let roots24: Record<string, number> = {};
  if (raw.roots_24h !== undefined) {
    const m = numberMap(raw.roots_24h, ABI_LIMITS.projects);
    if (!m) return bad("roots_24h must map sources to non-negative numbers");
    roots24 = m;
  }
  if (!isObj(raw.params)) return bad("params must be an object");
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.params)) {
    if (!KEY.test(k) || !num(v)) continue; // unknown or non-numeric entries are dropped
    if (Object.keys(params).length >= ABI_LIMITS.params) return bad(`params may hold at most ${ABI_LIMITS.params} numbers`);
    params[k] = v;
  }
  if (!num(params.half_life_days) || !num(params.decay_per_hour_pct)) return bad("params needs half_life_days and decay_per_hour_pct");

  let live: AbiLive | undefined;
  if (raw.live !== undefined) {
    const l = validateLive(raw.live);
    if (!l) return bad("live is malformed");
    live = l;
  }

  let milestones: AbiMilestone[] = [];
  if (raw.milestones !== undefined) {
    const m = validateMilestones(raw.milestones);
    if (typeof m === "string") return bad(m);
    milestones = m;
  }
  let stablecoins: AbiStablecoin[] = [];
  if (raw.stablecoins !== undefined) {
    const c = validateStablecoins(raw.stablecoins);
    if (!c) return bad(`stablecoins must be at most ${ABI_LIMITS.stablecoins} of { symbol, currency, issuer, address, decimals, added }`);
    stablecoins = c;
  }
  const integrations = validateIntegrations(raw.integrations);
  const integrationActivity = validateActivity(raw.integration_activity);
  let volume: Record<string, AbiVolume> = {};
  if (raw.volume_24h !== undefined) {
    const vv = validateVolume(raw.volume_24h);
    if (!vv) return bad(`volume_24h must map at most ${ABI_LIMITS.volumeCoins} coins to non-negative numbers`);
    volume = vv;
  }
  let liveFx: AbiFx = {};
  if (raw.live_fx !== undefined) {
    const ccys = new Set([...stablecoins.map((c) => c.currency), ...Object.values(live?.stablecoins ?? {}).map((c) => c.currency)]);
    const fx = validateFx(raw.live_fx, ccys);
    if (!fx) return bad(`live_fx must map at most ${ABI_LIMITS.fxDates} dates to at most ${ABI_LIMITS.fxCurrencies} positive rates`);
    liveFx = fx;
  }

  return {
    ok: true,
    data: {
      ...(live ? { live } : {}),
      updated: raw.updated as string, data_until: raw.data_until as string, head_time: raw.head_time as string, head_block: raw.head_block,
      index: raw.index, index_24h_ago: (raw.index_24h_ago as number | null | undefined) ?? null,
      base: { time: b.time, level: b.level, sha256: b.sha256 },
      series, projects, events, candles, tape, roots_24h: roots24, params: params as AbiData["params"],
      milestones, stablecoins, integrations, integration_activity: integrationActivity, volume_24h: volume, live_fx: liveFx,
    },
  };
}

/** The contract map of one index, published on its own because it is large and changes rarely ("close the gaps").
 * sha256 is over the canonical JSON of {contracts, open_senders} (not hour_start, the hour of the last change, so
 * an unchanged map keeps its sha): sorted keys, no spaces, exactly
 * Python's json.dumps(obj, sort_keys=True, separators=(",", ":")) on the producer. The index file pins it. */
export type AbiContracts = { hour_start: number; contracts: Record<string, string>; open_senders: string[]; sha256: string };
export type AbiContractsResult = { ok: true; data: Omit<AbiContracts, "sha256"> } | { ok: false; error: string };

export function validateContracts(raw: unknown): AbiContractsResult {
  const bad = (error: string): AbiContractsResult => ({ ok: false, error });
  if (!isObj(raw) || !posInt(raw.hour_start) || !isObj(raw.contracts) || !Array.isArray(raw.open_senders)) return bad("expected { hour_start, contracts, open_senders }");
  const keys = Object.keys(raw.contracts);
  if (keys.length > ABI_LIMITS.contractsFile) return bad(`at most ${ABI_LIMITS.contractsFile} contracts`);
  const contracts: Record<string, string> = {};
  for (const a of keys) {
    const src = raw.contracts[a];
    if (!ADDR.test(a) || !str(src)) return bad("contracts must map lowercase addresses to source ids");
    contracts[a] = src;
  }
  const open = raw.open_senders;
  if (open.length > ABI_LIMITS.contractsFile || !open.every((a, i) => typeof a === "string" && ADDR.test(a) && a in contracts && (i === 0 || a > (open[i - 1] as string))))
    return bad("open_senders must be sorted, unique, lowercase addresses that are in contracts");
  return { ok: true, data: { hour_start: raw.hour_start, contracts, open_senders: open as string[] } };
}

/** Python json.dumps(sort_keys=True, separators=(",", ":")) for plain JSON (objects, arrays, strings, integers). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  if (v !== null && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
