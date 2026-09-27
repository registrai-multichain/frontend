/**
 * Projects: the shared contract between the /admin console (arc-80) and the
 * profile API, feed reader and keeper (arc-cf). Frozen 2026-09-27 in
 * docs/superpowers/specs/2026-09-27-admin-console-design.md §9; the metrics design is
 * docs/superpowers/specs/2026-09-27-wonder-metrics-design.md. Change only by agreement.
 *
 *   GET  /api/admin/projects                               list (admin/onboarder session), with `status`
 *   GET  /api/admin/projects/<encodeURIComponent(source)>  one profile + feeds
 *   PUT  /api/admin/projects/<encodeURIComponent(source)>  full profile (admin session only) -> stored profile
 *   GET  /api/projects/<encodeURIComponent(source)>        public: profile + feeds, no redFlags or notes
 */
import { xHandle } from "./suggestions";
import { normalizeSource } from "./verified-builders";

/** What a project's markets can measure (one Registry feed per project and metric). */
export type MetricId = "deploys" | "txs" | "users" | "holders" | "price" | "mcap" | "volume" | "x-posts" | "x-followers";

export const METRIC_IDS: readonly MetricId[] = ["deploys", "txs", "users", "holders", "price", "mcap", "volume", "x-posts", "x-followers"];

/** An address the admin declared for a project, with how it is tied to the project. */
export interface DeclaredAddress {
  address: string;
  note?: string;
  /** Where the tie can be re-checked (docs page, explorer creation tx, repo deploy file). */
  sourceUrl?: string;
}

export interface DeclaredContract extends DeclaredAddress {
  /** What it is, e.g. "swap router", "vault". */
  label: string;
}

/** A project's declared profile: written by /admin after the manual investigation. */
export interface ProjectProfile {
  /** Canonical source: `github:owner/repo` or `domain:host`. */
  source: string;
  name: string;
  website: string;
  /** "@handle" */
  x?: string;
  /** The investigation confirmed the X account belongs to the project. */
  xChecked?: boolean;
  /** `github:owner/repo` */
  github?: string;
  deployers: DeclaredAddress[];
  contracts: DeclaredContract[];
  token?: DeclaredAddress;
  /** The metrics to track (a feed each). */
  metrics: MetricId[];
  /** Investigation findings, e.g. "deployer key exposed". Never public. */
  redFlags?: string[];
  /** Lowercase admin address that saved the profile, and when (ISO). */
  declaredBy: string;
  declaredAt: string;
}

/** Where a project is in its lifecycle, from KV and the chain (list responses only). */
export type ProjectStatus = "suggested" | "invited" | "nominated" | "claimed" | "dropped";

/** GET /api/admin/projects items. */
export interface ProjectListItem extends ProjectProfile {
  status: ProjectStatus;
}

/** A market's direction as the product states it; on chain GreaterOrEqual / LessOrEqual. */
export type MarketDirection = "atLeast" | "atMost";

export interface FeedReading {
  /** int256 as a decimal string (USDC metrics in 6 decimals). */
  value: string;
  /** The as-of time the reading is for (unix seconds). */
  at: number;
  /** When the agent attested it (unix seconds). */
  attestedAt: number;
  disputed?: boolean;
}

export interface FeedMarket {
  /** bytes32 market id, 0x-hex. */
  id: string;
  comparator: MarketDirection;
  /** int256 as a decimal string. */
  threshold: string;
  /** unix seconds */
  expiry: number;
  /** USDC, 6 decimals, decimal string. */
  potUsdc: string;
  open: boolean;
}

/** One metric feed of a project, as the feed reader returns it. */
export interface MetricFeedView {
  metric: MetricId;
  /** bytes32 Registry feed id, 0x-hex. */
  feedId: string;
  /** The feed's on-chain description, naming what it tracks. */
  description: string;
  /** The tracked set (addresses, token, "@handle"). */
  tracked: string[];
  status: "live" | "stale" | "disputed" | "off";
  cadenceSec: number;
  /** Newest first, at most 30. */
  readings: FeedReading[];
  markets: FeedMarket[];
}

/** GET /api/admin/projects/<source> */
export interface AdminProjectResponse {
  profile: ProjectProfile;
  feeds: MetricFeedView[];
}

/** The public profile: no redFlags, no notes. */
export type PublicProjectProfile = Omit<ProjectProfile, "redFlags" | "deployers" | "contracts" | "token"> & {
  deployers: Omit<DeclaredAddress, "note">[];
  contracts: Omit<DeclaredContract, "note">[];
  token?: Omit<DeclaredAddress, "note">;
};

/** GET /api/projects/<source> */
export interface PublicProjectResponse {
  profile: PublicProjectProfile;
  feeds: MetricFeedView[];
}

/** The API path for one project (sources contain ":" and "/"). */
export function projectPath(source: string, admin = true): string {
  return `/api/${admin ? "admin/" : ""}projects/${encodeURIComponent(source)}`;
}

/** Strip what never leaves /admin. */
export function publicProfile(p: ProjectProfile): PublicProjectProfile {
  const strip = <T extends DeclaredAddress>(a: T): Omit<T, "note"> => {
    const { note: _note, ...rest } = a;
    void _note;
    return rest;
  };
  const { redFlags: _redFlags, ...rest } = p;
  void _redFlags;
  return { ...rest, deployers: p.deployers.map(strip), contracts: p.contracts.map(strip), token: p.token ? strip(p.token) : undefined };
}

// ───────────────────────────── validation ─────────────────────────────

/** A profile as the admin submits it: the server sets declaredBy / declaredAt. */
export type ProfileInput = Omit<ProjectProfile, "declaredBy" | "declaredAt">;

export const PROFILE_LIMITS = { name: 80, label: 40, note: 300, url: 300, redFlag: 200, deployers: 10, contracts: 20, redFlags: 10 } as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function httpsUrl(raw: unknown, bare = false): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > PROFILE_LIMITS.url || /\s/.test(s)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  if (hasScheme && !/^https:\/\//i.test(s)) return null;
  if (!hasScheme && !bare) return null;
  try {
    const u = new URL(hasScheme ? s : `https://${s}`);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return bare ? `https://${u.hostname.toLowerCase()}${u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "")}` : u.toString();
  } catch {
    return null;
  }
}

function text(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > max ? null : s;
}

function addressList<T extends "deployer" | "contract">(raw: unknown, kind: T, max: number):
  { ok: true; value: (T extends "contract" ? DeclaredContract : DeclaredAddress)[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${kind}s must be a list` };
  if (raw.length > max) return { ok: false, error: `at most ${max} ${kind}s` };
  const seen = new Set<string>();
  const out: DeclaredContract[] = [];
  for (const item of raw) {
    const a = addressEntry(item, kind === "contract");
    if (!a.ok) return a;
    if (seen.has(a.value.address)) return { ok: false, error: `${kind} ${a.value.address} is listed twice` };
    seen.add(a.value.address);
    out.push(a.value as DeclaredContract);
  }
  return { ok: true, value: out as (T extends "contract" ? DeclaredContract : DeclaredAddress)[] };
}

function addressEntry(item: unknown, labelled: boolean): { ok: true; value: DeclaredAddress | DeclaredContract } | { ok: false; error: string } {
  if (typeof item !== "object" || item === null) return { ok: false, error: "each address entry must be an object" };
  const o = item as Record<string, unknown>;
  if (typeof o.address !== "string" || !ADDRESS_RE.test(o.address.trim())) return { ok: false, error: `not an address: ${String(o.address).slice(0, 50)}` };
  const out: DeclaredContract = { address: o.address.trim().toLowerCase(), label: "" };
  if (labelled) {
    const label = text(o.label, PROFILE_LIMITS.label);
    if (!label) return { ok: false, error: `contract ${out.address} needs a short label (at most ${PROFILE_LIMITS.label} characters)` };
    out.label = label;
  }
  const note = text(o.note, PROFILE_LIMITS.note);
  if (note === null) return { ok: false, error: `note too long (at most ${PROFILE_LIMITS.note})` };
  if (note) out.note = note;
  if (o.sourceUrl !== undefined && o.sourceUrl !== null && o.sourceUrl !== "") {
    const url = httpsUrl(o.sourceUrl);
    if (!url) return { ok: false, error: `source link for ${out.address} must be an https:// URL` };
    out.sourceUrl = url;
  }
  if (!labelled) {
    const { label: _l, ...plain } = out;
    void _l;
    return { ok: true, value: plain };
  }
  return { ok: true, value: out };
}

/**
 * Validate and normalise an admin-submitted profile for `pathSource` (the source in the
 * URL). Addresses lowercase, X as @handle, website as https, metrics unique in the
 * canonical order; each metric must have what it measures. declaredBy / declaredAt in
 * the body are ignored: the server sets them.
 */
export function validateProfile(body: unknown, pathSource: string): { ok: true; value: ProfileInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "expected a JSON object" };
  const b = body as Record<string, unknown>;
  const source = typeof b.source === "string" ? normalizeSource(b.source) : null;
  if (!source) return { ok: false, error: "source must be github:owner/repo or domain:host" };
  if (source !== pathSource) return { ok: false, error: `source ${source} does not match the URL's ${pathSource}` };
  const name = text(b.name, PROFILE_LIMITS.name);
  if (!name) return { ok: false, error: `name is required (at most ${PROFILE_LIMITS.name} characters)` };
  const website = httpsUrl(b.website, true);
  if (!website) return { ok: false, error: "website must be a site (https)" };
  const out: ProfileInput = { source, name, website, deployers: [], contracts: [], metrics: [] };
  if (b.x !== undefined && b.x !== null && b.x !== "") {
    const x = typeof b.x === "string" ? xHandle(b.x) : null;
    if (!x) return { ok: false, error: "x must be an X account (@handle or x.com link)" };
    out.x = x;
  }
  if (b.xChecked !== undefined) {
    if (typeof b.xChecked !== "boolean") return { ok: false, error: "xChecked must be true or false" };
    out.xChecked = b.xChecked;
  }
  if (b.github !== undefined && b.github !== null && b.github !== "") {
    const g = typeof b.github === "string" ? normalizeSource(b.github) : null;
    if (!g?.startsWith("github:")) return { ok: false, error: "github must be a GitHub repo" };
    out.github = g;
  }
  const deployers = addressList(b.deployers, "deployer", PROFILE_LIMITS.deployers);
  if (!deployers.ok) return deployers;
  out.deployers = deployers.value;
  const contracts = addressList(b.contracts, "contract", PROFILE_LIMITS.contracts);
  if (!contracts.ok) return contracts;
  out.contracts = contracts.value;
  if (b.token !== undefined && b.token !== null) {
    const t = addressEntry(b.token, false);
    if (!t.ok) return t;
    out.token = t.value;
  }
  if (!Array.isArray(b.metrics) || !b.metrics.every((m) => typeof m === "string")) return { ok: false, error: "metrics must be a list" };
  const unknown = (b.metrics as string[]).find((m) => !(METRIC_IDS as readonly string[]).includes(m));
  if (unknown) return { ok: false, error: `unknown metric: ${unknown}` };
  out.metrics = METRIC_IDS.filter((m) => (b.metrics as string[]).includes(m));
  const need: Record<MetricId, [boolean, string]> = {
    deploys: [out.deployers.length > 0, "a deployer wallet"],
    txs: [out.contracts.length > 0, "at least one contract"],
    users: [out.contracts.length > 0, "at least one contract"],
    holders: [Boolean(out.token), "the token"],
    price: [Boolean(out.token), "the token"],
    mcap: [Boolean(out.token), "the token"],
    volume: [Boolean(out.token), "the token"],
    "x-posts": [Boolean(out.x), "the X account"],
    "x-followers": [Boolean(out.x), "the X account"],
  };
  for (const m of out.metrics) if (!need[m][0]) return { ok: false, error: `metric ${m} needs ${need[m][1]}` };
  if (b.redFlags !== undefined) {
    if (!Array.isArray(b.redFlags) || b.redFlags.length > PROFILE_LIMITS.redFlags) return { ok: false, error: `redFlags: at most ${PROFILE_LIMITS.redFlags}` };
    const flags: string[] = [];
    for (const f of b.redFlags) {
      const t = text(f, PROFILE_LIMITS.redFlag);
      if (t === null) return { ok: false, error: `each red flag: at most ${PROFILE_LIMITS.redFlag} characters` };
      if (t) flags.push(t);
    }
    if (flags.length) out.redFlags = flags;
  }
  return { ok: true, value: out };
}
