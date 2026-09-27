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
