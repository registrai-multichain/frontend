/**
 * The /builders gallery: every builder who claimed a project (verified,
 * nominated, lapsed) plus the owner's invited list, read with the builder
 * registries and the badge ONLY — no market, pool, oracle or feed is read,
 * linked or shown, because mainnet phase 1 has none of them.
 *
 * Pure except readLiveGallery and browserProofCheck, which take their client /
 * fetch as arguments. Used by scripts/sync.ts (the snapshot) and the page (the
 * snapshot plus a live overlay).
 *
 * ── Invited list: src/data/nominees.json ──────────────────────────────────
 * Curated by hand by the owner. A JSON array; each entry:
 *
 *   { "source": "github:owner/repo" | "domain:host",   required
 *     "name":   "Project name",                          optional, shown
 *     "x":      "@handle",                               optional, shown (X link)
 *     "note":   "anything"                               optional, NEVER shown }
 *
 * `source` may also be written the way /verify accepts it (a GitHub URL,
 * `owner/repo`, a bare host); it is normalised, and an entry whose source does
 * not normalise is dropped. Duplicates (same normalised source) keep the first.
 * A nominee whose source matches an on-chain `registrai:` claim is shown as
 * that builder, with its chain status (never twice); otherwise as Invited,
 * with only what the file says: name, source link, X handle. Never a country
 * or a wallet: an invitee has claimed nothing.
 *
 * On builder.registrai.cc the page also merges the invites the owner made in
 * /admin (GET /api/invites, public fields only): parsePublicInvites +
 * mergeNominees. Where that API does not exist the file alone is shown.
 */
import { getAddress, isAddress, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import {
  builderStatus,
  normalizeSource,
  proofUrl as proofUrlFor,
  sourceFromProfileURI,
  sourceLabel,
  validateProof,
  type BuilderStatus,
} from "./verified-builders";
import type { BuilderRecord } from "./verified-builders-chain";
import { parseSnapshotBadge, readBadge, serialDigits, type BadgeInfo, type BadgeReader } from "./verified-builder-badge";

// ───────────────────────────── snapshot ─────────────────────────────

/** A chain builder's status in the gallery. `inactive` = deactivated on chain. */
export type GalleryStatus = BuilderStatus | "inactive";
const STATUSES: readonly GalleryStatus[] = ["verified", "pending", "lapsed", "unverified", "inactive"];

/** live-data.json `gallery.builders[]`. */
export interface GalleryBuilder {
  id: number;
  /** Lowercase. */
  owner: string;
  status: GalleryStatus;
  /** Canonical source from the `registrai:` profile link, else null. */
  source: string | null;
  /** From a valid claim only (verified / pending). */
  country: string | null;
  proofUrl: string | null;
  badge: BadgeInfo | null;
  /** Registration time, unix seconds (0 when unknown). */
  createdAt: number;
  /** Live overlay only: a domain proof the browser could not read (CORS). */
  proofUnchecked?: boolean;
}

/** live-data.json `gallery`. */
export interface GallerySnapshot {
  network: "mainnet" | "testnet";
  chainId: number;
  builderRegistry: string;
  syncedAt: string;
  /** The registry's nextId at the snapshot: ids >= this were registered after it. */
  nextId: number;
  builders: GalleryBuilder[];
}

/** Pure: a record's gallery status (the verified-builders status, plus inactive). */
export function galleryStatus(r: { active: boolean; status: BuilderStatus }): GalleryStatus {
  return r.active ? r.status : "inactive";
}

/** Pure (sync.ts): the gallery rows for chain records and their badges. */
export function galleryRowsFromRecords(
  records: Pick<BuilderRecord, "builderId" | "owner" | "active" | "status" | "source" | "country" | "proofUrl" | "createdAt">[],
  badges: ReadonlyMap<number, BadgeInfo>,
): GalleryBuilder[] {
  return records.map((r) => {
    const status = galleryStatus(r);
    const claimed = status === "verified" || status === "pending";
    return {
      id: r.builderId,
      owner: r.owner.toLowerCase(),
      status,
      source: r.source,
      country: claimed ? r.country : null,
      proofUrl: r.proofUrl,
      badge: badges.get(r.builderId) ?? null,
      createdAt: r.createdAt ?? 0,
    };
  });
}

/** Pure (sync.ts): the whole `gallery` entry. Records cover ids 1..nextId-1. */
export function buildGallerySnapshot(o: {
  network: "mainnet" | "testnet";
  chainId: number;
  builderRegistry: string;
  syncedAt: string;
  records: Parameters<typeof galleryRowsFromRecords>[0];
  badges: ReadonlyMap<number, BadgeInfo>;
}): GallerySnapshot {
  const builders = galleryRowsFromRecords(o.records, o.badges);
  return {
    network: o.network,
    chainId: o.chainId,
    builderRegistry: o.builderRegistry,
    syncedAt: o.syncedAt,
    nextId: builders.reduce((m, b) => Math.max(m, b.id), 0) + 1,
    builders,
  };
}

/**
 * Pure (sync.ts): where the gallery comes from.
 *   skip   the builders network has no registry
 *   reuse  it is the registry the market sync already read (testnet): no second read
 *   read   read it with the registries + badge only (mainnet phase 1: no markets needed)
 */
export function gallerySyncPlan(
  builders: { chainId: number; contracts: { BuilderRegistry: string | null } },
  alreadyRead: { chainId: number; builderRegistry: string | null | undefined } | null,
): "skip" | "reuse" | "read" {
  const reg = builders.contracts.BuilderRegistry;
  if (!reg) return "skip";
  if (
    alreadyRead?.builderRegistry &&
    alreadyRead.chainId === builders.chainId &&
    alreadyRead.builderRegistry.toLowerCase() === reg.toLowerCase()
  ) {
    return "reuse";
  }
  return "read";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseGalleryRow(raw: unknown): GalleryBuilder | null {
  if (!isObj(raw)) return null;
  const { id, owner, status, source, country, proofUrl, createdAt } = raw;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  if (typeof owner !== "string" || !isAddress(owner, { strict: false })) return null;
  if (typeof status !== "string" || !STATUSES.includes(status as GalleryStatus)) return null;
  const src = typeof source === "string" && normalizeSource(source) === source ? source : null;
  return {
    id,
    owner: owner.toLowerCase(),
    status: status as GalleryStatus,
    source: src,
    country: typeof country === "string" && /^[A-Z]{2}$/.test(country) ? country : null,
    proofUrl: typeof proofUrl === "string" && proofUrl.startsWith("https://") ? proofUrl : null,
    badge: parseSnapshotBadge(raw.badge),
    createdAt: typeof createdAt === "number" && createdAt > 0 ? createdAt : 0,
  };
}

/**
 * Pure: the synced gallery, trusted only when it describes the expected chain
 * and registry (a testnet snapshot is never shown as mainnet). Malformed rows
 * are dropped. null when absent or for another deployment.
 */
export function parseGallerySnapshot(
  raw: unknown,
  expect: { chainId: number; builderRegistry: string | null },
): GallerySnapshot | null {
  if (!isObj(raw) || !expect.builderRegistry) return null;
  if (raw.chainId !== expect.chainId) return null;
  if (typeof raw.builderRegistry !== "string" || raw.builderRegistry.toLowerCase() !== expect.builderRegistry.toLowerCase()) return null;
  const builders = (Array.isArray(raw.builders) ? raw.builders : [])
    .map(parseGalleryRow)
    .filter((b): b is GalleryBuilder => b !== null);
  const maxId = builders.reduce((m, b) => Math.max(m, b.id), 0);
  const nextId = typeof raw.nextId === "number" && Number.isSafeInteger(raw.nextId) && raw.nextId > maxId ? raw.nextId : maxId + 1;
  return {
    network: raw.network === "mainnet" ? "mainnet" : "testnet",
    chainId: expect.chainId,
    builderRegistry: raw.builderRegistry,
    syncedAt: typeof raw.syncedAt === "string" ? raw.syncedAt : "",
    nextId,
    builders,
  };
}

// ───────────────────────────── display ─────────────────────────────

/** What a card shows. Claimed = colour; lapsed and not claimed = grayscale. */
export type DisplayKind = "verified" | "nominated" | "lapsed" | "invited";

export const DISPLAY: Record<DisplayKind, { label: string; tone: "color" | "grayscale" }> = {
  verified: { label: "Verified", tone: "color" },
  nominated: { label: "Nominated", tone: "color" },
  lapsed: { label: "Lapsed", tone: "grayscale" },
  invited: { label: "Invited", tone: "grayscale" },
};

/**
 * Pure: how a chain builder is shown, or null when it is not shown at all
 * (unverified: no claim; inactive: deactivated on chain).
 *   lapsed     proof missing/invalid, or its badge is marked lapsed on chain
 *   verified   caretaker set, or a (non-lapsed) badge issued
 *   nominated  pending: claimed + registered, awaiting the Safe's onboarding batch
 */
export function displayKind(b: Pick<GalleryBuilder, "status" | "badge">): Exclude<DisplayKind, "invited"> | null {
  if (b.status === "unverified" || b.status === "inactive") return null;
  if (b.status === "lapsed" || b.badge?.lapsed) return "lapsed";
  if (b.status === "verified" || b.badge) return "verified";
  return "nominated";
}

export const toneOf = (k: DisplayKind) => DISPLAY[k].tone;
export const labelOf = (k: DisplayKind) => DISPLAY[k].label;

// ───────────────────────────── nominees ─────────────────────────────

export interface Nominee {
  /** Canonical source. */
  source: string;
  name?: string;
  /** "@handle" */
  x?: string;
  /** Curator's note — never rendered. */
  note?: string;
}

const X_HANDLE = /^@?([A-Za-z0-9_]{1,15})$/;

/** Pure: src/data/nominees.json, validated and normalised (see the header). */
export function parseNominees(raw: unknown): Nominee[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Nominee[] = [];
  for (const e of raw) {
    if (!isObj(e) || typeof e.source !== "string") continue;
    const source = normalizeSource(e.source);
    if (!source || seen.has(source)) continue;
    seen.add(source);
    const n: Nominee = { source };
    if (typeof e.name === "string" && e.name.trim()) n.name = e.name.trim().slice(0, 80);
    const x = typeof e.x === "string" ? X_HANDLE.exec(e.x.trim()) : null;
    if (x) n.x = `@${x[1]}`;
    if (typeof e.note === "string") n.note = e.note;
    out.push(n);
  }
  return out;
}

/**
 * Pure: the builders site's GET /api/invites (invites the owner made in /admin),
 * as nominees. Same rules as the file; anything else (e.g. the HTML 404 page
 * of a host without the API) is no invitees.
 */
export function parsePublicInvites(raw: unknown): Nominee[] {
  if (!isObj(raw) || !Array.isArray(raw.invites)) return [];
  // A public list never carries a note; drop one if it ever did.
  return parseNominees(raw.invites).map((n) => ({ source: n.source, ...(n.name ? { name: n.name } : {}), ...(n.x ? { x: n.x } : {}) }));
}

/**
 * Pure: the file's nominees plus the API's invitees, deduped by normalised
 * source. File order first, then new invitees in API order; for a source in
 * both, the API's name / X handle win (the admin record is the editable one).
 * An on-chain claim still wins over either (mergeGallery).
 */
export function mergeNominees(file: Nominee[], api: Nominee[]): Nominee[] {
  const fromApi = new Map<string, Nominee>();
  for (const n of api) if (!fromApi.has(n.source)) fromApi.set(n.source, n);
  const seen = new Set<string>();
  const out: Nominee[] = [];
  for (const n of file) {
    if (seen.has(n.source)) continue;
    seen.add(n.source);
    const a = fromApi.get(n.source);
    out.push(a ? { ...n, ...(a.name ? { name: a.name } : {}), ...(a.x ? { x: a.x } : {}) } : n);
  }
  for (const n of fromApi.values()) {
    if (seen.has(n.source)) continue;
    seen.add(n.source);
    out.push(n);
  }
  return out;
}

export interface GalleryEntry {
  /** DOM-safe, unique. */
  key: string;
  kind: DisplayKind;
  name: string;
  source: string | null;
  /** From the nominee file only. */
  x: string | null;
  /** The chain builder; null for an invitee. */
  builder: GalleryBuilder | null;
}

const KIND_ORDER: Record<DisplayKind, number> = { verified: 0, nominated: 1, lapsed: 2, invited: 3 };
const STATUS_RANK: Record<string, number> = { verified: 0, nominated: 1, lapsed: 2 };

/** A project's display name: the nominee's name, else `owner/repo` / the host, else "Builder #id". */
export function entryName(source: string | null, builderId?: number, nominee?: Nominee): string {
  if (nominee?.name) return nominee.name;
  if (source) return sourceLabel(source);
  return builderId !== undefined ? `Builder #${builderId}` : "";
}

/**
 * Pure: chain builders merged with the invited list, deduped by normalised
 * source, in gallery order — verified by badge serial, then nominated, lapsed
 * (by builder id), then invitees in file order.
 */
export function mergeGallery(builders: GalleryBuilder[], nominees: Nominee[]): GalleryEntry[] {
  const shown = builders
    .map((b) => ({ b, kind: displayKind(b) }))
    .filter((x): x is { b: GalleryBuilder; kind: Exclude<DisplayKind, "invited"> } => x.kind !== null);
  // Every source any chain builder claims, shown or not: a nominee whose project
  // was claimed on chain is never also "Invited".
  const claimedSources = new Set(builders.map((b) => b.source).filter((s): s is string => Boolean(s)));
  // Each nominee attaches to the best-ranked shown builder with its source.
  const bestFor = new Map<string, number>();
  for (const { b, kind } of shown) {
    if (!b.source) continue;
    const cur = bestFor.get(b.source);
    const curKind = cur === undefined ? undefined : shown.find((x) => x.b.id === cur)!.kind;
    if (curKind === undefined || STATUS_RANK[kind] < STATUS_RANK[curKind]) bestFor.set(b.source, b.id);
  }
  const nomineeBySource = new Map(nominees.map((n) => [n.source, n]));

  const entries: GalleryEntry[] = shown.map(({ b, kind }) => {
    const nominee = b.source && bestFor.get(b.source) === b.id ? nomineeBySource.get(b.source) : undefined;
    return {
      key: `builder-${b.id}`,
      kind,
      name: entryName(b.source, b.id, nominee),
      source: b.source,
      x: nominee?.x ?? null,
      builder: b,
    };
  });
  entries.sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k) return k;
    const sa = a.builder?.badge?.serial ?? Infinity;
    const sb = b.builder?.badge?.serial ?? Infinity;
    if (sa !== sb) return sa - sb;
    return (a.builder?.id ?? 0) - (b.builder?.id ?? 0);
  });

  const invited: GalleryEntry[] = nominees
    .filter((n) => !claimedSources.has(n.source))
    .map((n) => ({
      key: `invited-${n.source.replace(/[^a-z0-9]+/g, "-")}`,
      kind: "invited" as const,
      name: entryName(n.source, undefined, n),
      source: n.source,
      x: n.x ?? null,
      builder: null,
    }));
  return [...entries, ...invited];
}

// ───────────────────────────── filters, counts ─────────────────────────────

export type GalleryFilter = "all" | DisplayKind;
export const FILTERS: GalleryFilter[] = ["all", "verified", "nominated", "lapsed", "invited"];

/** Pure: a `?filter=`-style value, else "all". */
export function parseFilter(raw: string | null | undefined): GalleryFilter {
  return FILTERS.includes(raw as GalleryFilter) ? (raw as GalleryFilter) : "all";
}

function haystack(e: GalleryEntry): string {
  const parts = [e.name, e.source ?? "", e.source ? sourceLabel(e.source) : "", e.x ?? ""];
  if (e.builder) {
    parts.push(`#${e.builder.id}`, e.builder.country ?? "");
    if (e.builder.badge) parts.push(`no. ${serialDigits(e.builder.badge.serial)}`, `#${serialDigits(e.builder.badge.serial)}`);
  }
  return parts.join(" ").toLowerCase();
}

/** Pure: entries matching the chip and every word of the query (case-insensitive). */
export function filterGallery(entries: GalleryEntry[], filter: GalleryFilter, query: string): GalleryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (filter !== "all" && e.kind !== filter) return false;
    if (!words.length) return true;
    const h = haystack(e);
    return words.every((w) => h.includes(w));
  });
}

export interface GalleryCounts {
  all: number;
  verified: number;
  nominated: number;
  lapsed: number;
  invited: number;
  /** Distinct countries among claimed (verified + nominated) builders. */
  countries: number;
}

export function galleryCounts(entries: GalleryEntry[]): GalleryCounts {
  const c: GalleryCounts = { all: entries.length, verified: 0, nominated: 0, lapsed: 0, invited: 0, countries: 0 };
  const countries = new Set<string>();
  for (const e of entries) {
    c[e.kind]++;
    if ((e.kind === "verified" || e.kind === "nominated") && e.builder?.country) countries.add(e.builder.country);
  }
  c.countries = countries.size;
  return c;
}

// ───────────────────────────── links ─────────────────────────────

/** GitHub owner avatar (CORS-enabled, cached by GitHub); null for domains. */
export function avatarUrl(source: string | null | undefined, size = 96): string | null {
  const m = /^github:([^/]+)\//.exec(source ?? "");
  return m ? `https://avatars.githubusercontent.com/${encodeURIComponent(m[1])}?size=${size}` : null;
}

/** The project itself: the repo on GitHub, or the site. */
export function sourceHref(source: string): string {
  return source.startsWith("github:") ? `https://github.com/${source.slice(7)}` : `https://${source.slice(7)}`;
}

/** The proof file for a canonical source, else null. */
export function proofHref(source: string | null): string | null {
  if (!source) return null;
  try {
    return proofUrlFor(source);
  } catch {
    return null;
  }
}

export function xHref(handle: string): string {
  return `https://x.com/${handle.replace(/^@/, "")}`;
}

/** An invitee's claim link: /verify with the source prefilled. */
export function claimHref(source: string): string {
  return `/verify?source=${encodeURIComponent(source)}`;
}

/** The card's element id — `?builder=<id>` scrolls to it. */
export const builderAnchor = (id: number) => `builder-${id}`;

/** Pure: `/verify?source=` -> the canonical source and its proof path, else null. */
export function parseSourceParam(raw: string | null | undefined): { source: string; path: "repo" | "domain" } | null {
  if (!raw) return null;
  const source = normalizeSource(raw);
  if (!source) return null;
  return { source, path: source.startsWith("github:") ? "repo" : "domain" };
}

// ───────────────────────────── live overlay ─────────────────────────────

/** One builder as the chain says right now. */
export interface LiveChainRow {
  id: number;
  owner: string;
  profileURI: string;
  active: boolean;
  createdAt: number;
  caretaker: string;
  badge: BadgeInfo | null;
}

/** A proof as the browser could (or could not) check it. */
export type LiveProof = { state: "valid"; country: string } | { state: "invalid" } | { state: "unchecked" };

const liveAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function builders(uint256) view returns (address owner, string profileURI, bytes linkedIdentity, uint64 createdAt, bool active)",
  "function caretakerOf(uint256) view returns (address)",
]);

/** Minimal read surface (a viem PublicClient satisfies it). */
export interface GalleryReader {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

/** Most builders the page reads live; the snapshot covers the rest. */
export const LIVE_MAX_BUILDERS = 1000;

/**
 * Every builder, live: registry row, caretaker and badge. Reads are issued
 * concurrently so a batching transport folds them into a few requests.
 */
export async function readLiveGallery(
  client: GalleryReader,
  o: { registry: Address; caretakers: Address | null; badge: Address | null; imageBase: string; max?: number },
): Promise<LiveChainRow[]> {
  const nextId = Number(await client.readContract({ address: o.registry, abi: liveAbi, functionName: "nextId" }));
  const last = Math.min(nextId - 1, o.max ?? LIVE_MAX_BUILDERS);
  const ids = Array.from({ length: Math.max(0, last) }, (_, i) => i + 1);
  return Promise.all(
    ids.map(async (id) => {
      const [row, caretaker, badge] = await Promise.all([
        client.readContract({ address: o.registry, abi: liveAbi, functionName: "builders", args: [BigInt(id)] }) as Promise<
          readonly [Address, string, Hex, bigint, boolean]
        >,
        o.caretakers
          ? (client.readContract({ address: o.caretakers, abi: liveAbi, functionName: "caretakerOf", args: [BigInt(id)] }) as Promise<Address>)
          : Promise.resolve(zeroAddress as Address),
        o.badge ? readBadge(client as unknown as BadgeReader, o.badge, id, o.imageBase) : Promise.resolve(null),
      ]);
      const [owner, profileURI, , createdAt, active] = row;
      return { id, owner: owner.toLowerCase(), profileURI, active, createdAt: Number(createdAt), caretaker, badge };
    }),
  );
}

/** Pure: whether the browser must check this row's proof (the snapshot never saw this claim). */
export function needsProofCheck(row: LiveChainRow, snap: GalleryBuilder | undefined): boolean {
  const source = sourceFromProfileURI(row.profileURI);
  if (!row.active || !source) return false;
  // The sync checks proofs of active builders only: an inactive row was never checked.
  if (!snap || snap.status === "inactive" || snap.status === "unverified") return true;
  return snap.source !== source || snap.owner !== row.owner.toLowerCase();
}

/**
 * Pure: the snapshot updated with the live chain. A claim the snapshot already
 * checked keeps its proof verdict (re-checked at the next sync) and takes the
 * live caretaker, badge and active flag; a claim it never saw uses the
 * browser's check — a domain the browser could not read (CORS) is shown as
 * nominated (or verified, once the Safe set its caretaker), flagged unchecked.
 */
export function overlayLive(
  snapshot: GalleryBuilder[],
  live: LiveChainRow[],
  proofs: ReadonlyMap<number, LiveProof>,
  operator: string | null,
): GalleryBuilder[] {
  const byId = new Map(snapshot.map((b) => [b.id, b]));
  const out = new Map(byId);
  for (const row of live) {
    const snap = byId.get(row.id);
    const source = sourceFromProfileURI(row.profileURI);
    const caretakerIsOperator = Boolean(
      operator && row.caretaker.toLowerCase() !== zeroAddress && row.caretaker.toLowerCase() === operator.toLowerCase(),
    );
    const base = { id: row.id, owner: row.owner.toLowerCase(), source, badge: row.badge, createdAt: row.createdAt || snap?.createdAt || 0 };
    const proofUrl = proofHref(source);
    if (!needsProofCheck(row, snap)) {
      const proofValid = snap?.status === "verified" || snap?.status === "pending";
      const status = galleryStatus({ active: row.active, status: builderStatus({ active: row.active, profileURI: row.profileURI, proofValid, caretakerIsOperator }) });
      const claimed = status === "verified" || status === "pending";
      out.set(row.id, { ...base, status, country: claimed ? (snap?.country ?? null) : null, proofUrl: snap?.proofUrl ?? proofUrl });
      continue;
    }
    const proof = proofs.get(row.id) ?? { state: "unchecked" };
    if (proof.state === "invalid") {
      out.set(row.id, { ...base, status: "lapsed", country: null, proofUrl });
    } else {
      out.set(row.id, {
        ...base,
        status: caretakerIsOperator ? "verified" : "pending",
        country: proof.state === "valid" ? proof.country : null,
        proofUrl,
        ...(proof.state === "unchecked" ? { proofUnchecked: true } : {}),
      });
    }
  }
  return [...out.values()].sort((a, b) => a.id - b.id);
}

/**
 * Check a claim's proof from the browser. GitHub raw is CORS-friendly; a domain
 * may not be, and a read the browser is not allowed to make is "unchecked"
 * (the sync reads it server-side), never "invalid".
 */
export async function browserProofCheck(
  b: { owner: string; source: string },
  o: { chainId: number; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<LiveProof> {
  let url: string;
  try {
    url = proofUrlFor(b.source);
  } catch {
    return { state: "invalid" };
  }
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(url, { cache: "no-store", signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
  } catch {
    return { state: "unchecked" };
  }
  if (!res.ok) return res.status === 404 || res.status === 410 ? { state: "invalid" } : { state: "unchecked" };
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return { state: "invalid" };
  }
  const r = await validateProof(body, { expectedSource: b.source, onchainOwner: getAddress(b.owner), chainId: o.chainId });
  return r.valid ? { state: "valid", country: r.claim.country } : { state: "invalid" };
}
