/**
 * The /builders gallery: one card per builder who claimed a project (verified,
 * nominated, lapsed) plus the owner's invited list, read with the builder
 * registries and the badge ONLY — no market, pool, oracle or feed is read,
 * linked or shown, because mainnet phase 1 has none of them.
 *
 * A builder holds up to 16 projects (spec docs/superpowers/specs/
 * 2026-09-24-builder-projects-design.md); each project is one claimed source
 * with its own signed proof. The card shows the builder's projects as chips.
 *
 * Pure except readLiveGallery and the browser proof checks, which take their
 * client / fetch as arguments. Used by scripts/sync.ts (the snapshot) and the
 * page (the snapshot plus a live overlay).
 *
 * ── Invited list: src/data/nominees.json ──────────────────────────────────
 * Curated by hand by the owner. A JSON array; each entry is one PROJECT:
 *
 *   { "source": "github:owner/repo" | "domain:host",   required
 *     "name":   "Project name",                          optional, shown
 *     "x":      "@handle",                               optional, shown (X link)
 *     "note":   "anything"                               optional, NEVER shown }
 *
 * `source` may also be written the way /verify accepts it (a GitHub URL,
 * `owner/repo`, a bare host); it is normalised, and an entry whose source does
 * not normalise is dropped. Duplicates (same normalised source) keep the first.
 * A nominee whose source is an active project of any builder merges into that
 * builder's card (never twice; see mergeGallery); otherwise it is shown as
 * Invited, with only what the file says: name, source link, X handle. Never a
 * country or a wallet: an invitee has claimed nothing.
 *
 * On builder.registrai.cc the page also merges the invites the owner made in
 * /admin (GET /api/invites, public fields only): parsePublicInvites +
 * mergeNominees. Where that API does not exist the file alone is shown.
 *
 * ── A builder's name (builderName) ──────────────────────────────────────────
 *   1. its profileURI, when the builder has a verified project and the profile
 *      is a plain short name (plainProfileName: ≤ 48 characters of letters,
 *      digits, spaces and . , ' & + _ ( ) ! -; so never a link, a `registrai:`
 *      string or an address). An unproven builder cannot put its own text on the
 *      gallery.
 *   2. the owner's curated name (nominee / invite) of one of its projects, in
 *      project order
 *   3. its lead project's label (`owner/repo` or the host): the first verified
 *      project, else the first active one, else the first
 *   4. "Builder #id"
 *
 * ── A builder's avatar (builderAvatarUrl) ────────────────────────────────────
 * The GitHub owner avatar of its first VERIFIED github project, else none (the
 * card shows the name's initial).
 */
import { getAddress, isAddress, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import {
  builderCountry,
  builderStatus,
  normalizeSource,
  proofUrl as proofUrlFor,
  sourceLabel,
  validateProof,
  type BuilderStatus,
  type ProjectStatus,
} from "./verified-builders";
import type { BuilderRecord } from "./verified-builders-chain";
import { parseSnapshotBadge, readBadge, serialDigits, type BadgeInfo, type BadgeReader } from "./verified-builder-badge";

// ───────────────────────────── snapshot ─────────────────────────────

/** A chain builder's status in the gallery (the spec's builder status). */
export type GalleryStatus = BuilderStatus;
const STATUSES: readonly GalleryStatus[] = ["verified", "pending", "lapsed", "unverified", "inactive"];
const PROJECT_STATUSES: readonly ProjectStatus[] = ["verified", "lapsed", "inactive"];

/** live-data.json `gallery.builders[].projects[]`. Canonical sources only. */
export interface GalleryProject {
  /** Registry project id; 0 = unknown (a builder from an old single-source snapshot). */
  id: number;
  source: string;
  /** The registry's flag (a removed project is inactive). */
  active: boolean;
  status: ProjectStatus;
  /** From the project's valid claim only. */
  country: string | null;
  proofUrl: string | null;
  /** Live overlay only: a domain proof the browser could not read (CORS). */
  proofUnchecked?: boolean;
}

/** live-data.json `gallery.builders[]`. */
export interface GalleryBuilder {
  id: number;
  /** Lowercase. */
  owner: string;
  status: GalleryStatus;
  /** Free-form (a display name, a link, or empty); never a claim. */
  profileURI: string;
  /** Canonical-source projects in add order, inactive ones included. */
  projects: GalleryProject[];
  /** builderCountry over the verified projects (verified / pending builders only). */
  country: string | null;
  badge: BadgeInfo | null;
  /** Registration time, unix seconds (0 when unknown). */
  createdAt: number;
  /** Live overlay only: the builder is claimed only through proofs the browser could not read. */
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

const claimedStatus = (s: GalleryStatus) => s === "verified" || s === "pending";

/** Pure (sync.ts): the gallery rows for chain records and their badges. */
export function galleryRowsFromRecords(
  records: Pick<BuilderRecord, "builderId" | "owner" | "active" | "status" | "profileURI" | "projects" | "country" | "createdAt">[],
  badges: ReadonlyMap<number, BadgeInfo>,
): GalleryBuilder[] {
  return records.map((r) => ({
    id: r.builderId,
    owner: r.owner.toLowerCase(),
    status: r.status,
    profileURI: r.profileURI,
    projects: r.projects
      .filter((p) => p.canonical)
      .map((p) => ({
        id: p.projectId,
        source: p.source,
        active: p.active,
        status: p.status,
        country: p.status === "verified" ? p.country : null,
        proofUrl: p.proofUrl,
      })),
    country: claimedStatus(r.status) ? r.country : null,
    badge: badges.get(r.builderId) ?? null,
    createdAt: r.createdAt ?? 0,
  }));
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
const canonicalOrNull = (v: unknown): string | null => (typeof v === "string" && normalizeSource(v) === v ? v : null);
const countryOrNull = (v: unknown): string | null => (typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : null);
const httpsOrNull = (v: unknown): string | null => (typeof v === "string" && v.startsWith("https://") ? v : null);

function parseGalleryProject(raw: unknown): GalleryProject | null {
  if (!isObj(raw)) return null;
  const source = canonicalOrNull(raw.source);
  if (!source) return null;
  const id = typeof raw.id === "number" && Number.isSafeInteger(raw.id) && raw.id >= 0 ? raw.id : 0;
  const status = PROJECT_STATUSES.includes(raw.status as ProjectStatus) ? (raw.status as ProjectStatus) : "lapsed";
  return {
    id,
    source,
    active: typeof raw.active === "boolean" ? raw.active : status !== "inactive",
    status,
    country: status === "verified" ? countryOrNull(raw.country) : null,
    proofUrl: httpsOrNull(raw.proofUrl),
  };
}

/**
 * An old (single-source) snapshot row `{source, proofUrl, status, country}` as
 * one project: a claimed builder's (verified / pending) source is a verified
 * project, a lapsed builder's a lapsed one, anything else inactive.
 */
function legacyProjects(raw: Record<string, unknown>, status: GalleryStatus): GalleryProject[] {
  const source = canonicalOrNull(raw.source);
  if (!source) return [];
  const ps: ProjectStatus = claimedStatus(status) ? "verified" : status === "lapsed" ? "lapsed" : "inactive";
  return [
    {
      id: 0,
      source,
      active: ps !== "inactive",
      status: ps,
      country: ps === "verified" ? countryOrNull(raw.country) : null,
      proofUrl: httpsOrNull(raw.proofUrl),
    },
  ];
}

function parseGalleryRow(raw: unknown): GalleryBuilder | null {
  if (!isObj(raw)) return null;
  const { id, owner, status, createdAt } = raw;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  if (typeof owner !== "string" || !isAddress(owner, { strict: false })) return null;
  if (typeof status !== "string" || !STATUSES.includes(status as GalleryStatus)) return null;
  const st = status as GalleryStatus;
  const projects = Array.isArray(raw.projects)
    ? raw.projects.map(parseGalleryProject).filter((p): p is GalleryProject => p !== null)
    : legacyProjects(raw, st);
  return {
    id,
    owner: owner.toLowerCase(),
    status: st,
    profileURI: typeof raw.profileURI === "string" ? raw.profileURI.slice(0, 256) : "",
    projects,
    country: claimedStatus(st) ? countryOrNull(raw.country) : null,
    badge: parseSnapshotBadge(raw.badge),
    createdAt: typeof createdAt === "number" && createdAt > 0 ? createdAt : 0,
  };
}

/**
 * Pure: the synced gallery, trusted only when it describes the expected chain
 * and registry (a testnet snapshot is never shown as mainnet). Malformed rows
 * are dropped. Old single-source rows read as one project each. null when
 * absent or for another deployment.
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
 * (unverified: no active project; inactive: deactivated on chain).
 *   lapsed     no verified project, or its badge is marked lapsed on chain
 *   verified   caretaker set, or a (non-lapsed) badge issued
 *   nominated  pending: a verified project, awaiting the Safe's onboarding batch
 */
export function displayKind(b: Pick<GalleryBuilder, "status" | "badge">): Exclude<DisplayKind, "invited"> | null {
  if (b.status === "unverified" || b.status === "inactive") return null;
  if (b.status === "lapsed" || b.badge?.lapsed) return "lapsed";
  if (b.status === "verified" || b.badge) return "verified";
  return "nominated";
}

export const toneOf = (k: DisplayKind) => DISPLAY[k].tone;
export const labelOf = (k: DisplayKind) => DISPLAY[k].label;

// ───────────────────────────── projects on a card ─────────────────────────────

/** A project chip: verified (the builder is onboarded), nominated (verified
 *  project, builder not onboarded yet) or lapsed (greyed). */
export type ChipKind = "verified" | "nominated" | "lapsed";

export interface ProjectChip {
  id: number;
  source: string;
  label: string;
  kind: ChipKind;
  unchecked: boolean;
}

/** Pure: one project's chip on its builder's card; null for an inactive project. */
export function projectChipKind(p: Pick<GalleryProject, "status" | "active">, b: Pick<GalleryBuilder, "status" | "badge">): ChipKind | null {
  if (!p.active || p.status === "inactive") return null;
  if (p.status === "lapsed") return "lapsed";
  const k = displayKind(b);
  return k === "verified" || (k === "lapsed" && b.status === "verified") ? "verified" : "nominated";
}

/** Pure: the card's chips — active projects in add order. */
export function projectChips(b: GalleryBuilder): ProjectChip[] {
  const out: ProjectChip[] = [];
  for (const p of b.projects) {
    const kind = projectChipKind(p, b);
    if (kind) out.push({ id: p.id, source: p.source, label: sourceLabel(p.source), kind, unchecked: Boolean(p.proofUnchecked) });
  }
  return out;
}

/** Pure: the builder's lead project — first verified, else first active, else first. */
export function leadProject(b: Pick<GalleryBuilder, "projects">): GalleryProject | null {
  return b.projects.find((p) => p.status === "verified") ?? b.projects.find((p) => p.active) ?? b.projects[0] ?? null;
}

/** A plain short display name: ≤ 48 characters of letters, digits, spaces and . , ' & + _ ( ) ! -. */
const PLAIN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'\u2019&+_()!-]*$/u;
export const MAX_NAME_LEN = 48;

/** Pure: the profileURI as a display name, or null when it is not a plain short name. */
export function plainProfileName(profileURI: string | null | undefined): string | null {
  const s = (profileURI ?? "").trim().replace(/\s+/g, " ");
  if (!s || [...s].length > MAX_NAME_LEN) return null;
  return PLAIN_NAME.test(s) ? s : null;
}

/** Pure: a builder's name (the rule is in the header). */
export function builderName(
  b: Pick<GalleryBuilder, "id" | "profileURI" | "projects">,
  nominees: readonly Pick<Nominee, "name">[] = [],
): string {
  const claimed = b.projects.some((p) => p.status === "verified");
  const profile = claimed ? plainProfileName(b.profileURI) : null;
  if (profile) return profile;
  const curated = nominees.find((n) => n.name)?.name;
  if (curated) return curated;
  const lead = leadProject(b);
  return lead ? sourceLabel(lead.source) : `Builder #${b.id}`;
}

/** Pure: the builder's avatar — its first verified GitHub project's owner, else null (show the initial). */
export function builderAvatarUrl(b: Pick<GalleryBuilder, "projects">, size = 96): string | null {
  const gh = b.projects.find((p) => p.status === "verified" && p.source.startsWith("github:"));
  return gh ? avatarUrl(gh.source, size) : null;
}

/** The name's first letter or digit, for a card without an avatar. */
export function initialOf(name: string): string {
  return (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "R").toUpperCase();
}

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
 * An on-chain project still wins over either (mergeGallery).
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
  /** The builder's lead project source; the invitee's source. */
  source: string | null;
  /** From the nominee file / invites only. */
  x: string | null;
  /** The chain builder; null for an invitee. */
  builder: GalleryBuilder | null;
  /** The builder's active projects (empty for an invitee). */
  chips: ProjectChip[];
  /** Avatar image, else the card shows the name's initial. */
  avatar: string | null;
}

const KIND_ORDER: Record<DisplayKind, number> = { verified: 0, nominated: 1, lapsed: 2, invited: 3 };
const RANK: Record<string, number> = { verified: 0, nominated: 1, lapsed: 2 };

/** @deprecated An invitee's display name: the nominee's name, else `owner/repo` / the host. */
export function entryName(source: string | null, builderId?: number, nominee?: Nominee): string {
  if (nominee?.name) return nominee.name;
  if (source) return sourceLabel(source);
  return builderId !== undefined ? `Builder #${builderId}` : "";
}

/** Pure: every source that is an active project of some builder (shown or not). */
export function claimedSources(builders: readonly GalleryBuilder[]): Set<string> {
  const out = new Set<string>();
  for (const b of builders) for (const p of b.projects) if (p.active) out.add(p.source);
  return out;
}

/**
 * Pure: chain builders merged with the invited list, in gallery order —
 * verified by badge serial, then nominated, lapsed (by builder id), then
 * invitees in file order. A nominee whose source is an active project of any
 * builder is never "Invited"; it merges into the best-ranked SHOWN builder
 * holding that project (verified, nominated, lapsed; lowest id on a tie),
 * which then carries its name and X handle (see builderName). A builder may
 * absorb several nominees (one per project).
 */
export function mergeGallery(builders: GalleryBuilder[], nominees: Nominee[]): GalleryEntry[] {
  const shown = builders
    .map((b) => ({ b, kind: displayKind(b) }))
    .filter((x): x is { b: GalleryBuilder; kind: Exclude<DisplayKind, "invited"> } => x.kind !== null);
  const claimed = claimedSources(builders);
  // Each claimed nominee attaches to the best-ranked shown builder with that project.
  const bestFor = new Map<string, { id: number; rank: number }>();
  for (const { b, kind } of shown) {
    for (const p of b.projects) {
      if (!p.active) continue;
      const cur = bestFor.get(p.source);
      const rank = RANK[kind];
      if (!cur || rank < cur.rank || (rank === cur.rank && b.id < cur.id)) bestFor.set(p.source, { id: b.id, rank });
    }
  }
  const nomineeBySource = new Map(nominees.map((n) => [n.source, n]));

  const entries: GalleryEntry[] = shown.map(({ b, kind }) => {
    const mine = b.projects
      .filter((p) => p.active && bestFor.get(p.source)?.id === b.id)
      .map((p) => nomineeBySource.get(p.source))
      .filter((n): n is Nominee => Boolean(n));
    const name = builderName(b, mine);
    return {
      key: `builder-${b.id}`,
      kind,
      name,
      source: leadProject(b)?.source ?? null,
      x: mine.find((n) => n.x)?.x ?? null,
      builder: b,
      chips: projectChips(b),
      avatar: builderAvatarUrl(b, 128),
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
    .filter((n) => !claimed.has(n.source))
    .map((n) => ({
      key: `invited-${n.source.replace(/[^a-z0-9]+/g, "-")}`,
      kind: "invited" as const,
      name: entryName(n.source, undefined, n),
      source: n.source,
      x: n.x ?? null,
      builder: null,
      chips: [],
      avatar: avatarUrl(n.source, 128),
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
    for (const p of e.builder.projects) parts.push(p.source, sourceLabel(p.source));
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

/** One project as the chain says right now. */
export interface LiveProjectRow {
  id: number;
  source: string;
  active: boolean;
  addedAt: number;
}

/** One builder as the chain says right now. */
export interface LiveChainRow {
  id: number;
  owner: string;
  profileURI: string;
  active: boolean;
  createdAt: number;
  caretaker: string;
  badge: BadgeInfo | null;
  /** Every project ever added, in add order. */
  projects: LiveProjectRow[];
}

/** A proof as the browser could (or could not) check it. */
export type LiveProof = { state: "valid"; country: string } | { state: "invalid" } | { state: "unchecked" };

const liveAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function builders(uint256) view returns (address owner, string profileURI, bytes linkedIdentity, uint64 createdAt, bool active)",
  "function projectsOf(uint256 builderId) view returns (uint256[])",
  "function projects(uint256) view returns (uint256 builderId, string source, bool active, uint64 addedAt)",
  "function caretakerOf(uint256) view returns (address)",
]);

/** Minimal read surface (a viem PublicClient satisfies it). */
export interface GalleryReader {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

/** Most builders the page reads live; the snapshot covers the rest. */
export const LIVE_MAX_BUILDERS = 1000;

/** One builder's projects, live. */
export async function readLiveProjects(client: GalleryReader, registry: Address, builderId: number): Promise<LiveProjectRow[]> {
  const ids = (await client.readContract({ address: registry, abi: liveAbi, functionName: "projectsOf", args: [BigInt(builderId)] })) as readonly bigint[];
  return Promise.all(
    ids.map(async (pid) => {
      const [, source, active, addedAt] = (await client.readContract({ address: registry, abi: liveAbi, functionName: "projects", args: [pid] })) as readonly [
        bigint, string, boolean, bigint,
      ];
      return { id: Number(pid), source, active, addedAt: Number(addedAt) };
    }),
  );
}

/**
 * Every builder, live: registry row, projects, caretaker and badge. Reads are
 * issued concurrently so a batching transport folds them into a few requests.
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
      const [row, projects, caretaker, badge] = await Promise.all([
        client.readContract({ address: o.registry, abi: liveAbi, functionName: "builders", args: [BigInt(id)] }) as Promise<
          readonly [Address, string, Hex, bigint, boolean]
        >,
        readLiveProjects(client, o.registry, id),
        o.caretakers
          ? (client.readContract({ address: o.caretakers, abi: liveAbi, functionName: "caretakerOf", args: [BigInt(id)] }) as Promise<Address>)
          : Promise.resolve(zeroAddress as Address),
        o.badge ? readBadge(client as unknown as BadgeReader, o.badge, id, o.imageBase) : Promise.resolve(null),
      ]);
      const [owner, profileURI, , createdAt, active] = row;
      return { id, owner: owner.toLowerCase(), profileURI, active, createdAt: Number(createdAt), caretaker, badge, projects };
    }),
  );
}

const isCanonical = (source: string) => normalizeSource(source) === source;

/** The snapshot's verdict for a live project, when it still applies: same
 *  owner (a proof names the owner), same project, and it was checked. */
function snapshotVerdict(row: LiveChainRow, p: LiveProjectRow, snap: GalleryBuilder | undefined): GalleryProject | null {
  if (!snap || snap.owner !== row.owner.toLowerCase() || snap.status === "inactive") return null;
  const sp = snap.projects.find((x) => x.id === p.id && x.source === p.source);
  return sp && sp.active && sp.status !== "inactive" ? sp : null;
}

/** Pure: the projects of a live row whose proof the browser must check (the snapshot never checked them). */
export function projectsNeedingCheck(row: LiveChainRow, snap: GalleryBuilder | undefined): LiveProjectRow[] {
  if (!row.active) return [];
  return row.projects.filter((p) => p.active && isCanonical(p.source) && !snapshotVerdict(row, p, snap));
}

/** Pure: whether the browser must check any of this row's proofs. */
export function needsProofCheck(row: LiveChainRow, snap: GalleryBuilder | undefined): boolean {
  return projectsNeedingCheck(row, snap).length > 0;
}

/**
 * Pure: the snapshot updated with the live chain. A project the snapshot
 * already checked (same owner) keeps its proof verdict (re-checked at the next
 * sync); a project it never saw — or any project after an owner change — uses
 * the browser's check (`proofs`, by project id). A domain the browser could not
 * read (CORS) counts as verified, flagged unchecked. Caretaker, badge, active
 * flags and the project list are always live. A non-canonical source is never
 * shown but counts as a lapsed project.
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
    const caretakerIsOperator = Boolean(
      operator && row.caretaker.toLowerCase() !== zeroAddress && row.caretaker.toLowerCase() === operator.toLowerCase(),
    );
    const projects: GalleryProject[] = [];
    let hiddenLapsed = false;
    for (const p of row.projects) {
      if (!isCanonical(p.source)) {
        if (row.active && p.active) hiddenLapsed = true;
        continue;
      }
      const base = { id: p.id, source: p.source, active: p.active };
      if (!row.active || !p.active) {
        projects.push({ ...base, status: "inactive", country: null, proofUrl: proofHref(p.source) });
        continue;
      }
      const v = snapshotVerdict(row, p, snap);
      if (v) {
        projects.push({ ...base, status: v.status, country: v.country, proofUrl: v.proofUrl ?? proofHref(p.source), ...(v.proofUnchecked ? { proofUnchecked: true } : {}) });
        continue;
      }
      const proof = proofs.get(p.id) ?? { state: "unchecked" };
      if (proof.state === "invalid") projects.push({ ...base, status: "lapsed", country: null, proofUrl: proofHref(p.source) });
      else
        projects.push({
          ...base,
          status: "verified",
          country: proof.state === "valid" ? proof.country : null,
          proofUrl: proofHref(p.source),
          ...(proof.state === "unchecked" ? { proofUnchecked: true } : {}),
        });
    }
    const forStatus = hiddenLapsed ? [...projects, { status: "lapsed" as const }] : projects;
    const status = builderStatus({ active: row.active, projects: forStatus, caretakerIsOperator });
    const verified = projects.filter((p) => p.status === "verified");
    const b: GalleryBuilder = {
      id: row.id,
      owner: row.owner.toLowerCase(),
      status,
      profileURI: row.profileURI,
      projects,
      country: claimedStatus(status) ? builderCountry(projects) : null,
      badge: row.badge,
      createdAt: row.createdAt || snap?.createdAt || 0,
    };
    if (verified.length > 0 && verified.every((p) => p.proofUnchecked)) b.proofUnchecked = true;
    out.set(row.id, b);
  }
  return [...out.values()].sort((a, b) => a.id - b.id);
}

/**
 * A project's proof as the browser sees it, with the reason:
 *   valid      checks out for this owner
 *   resign     a well-signed proof for ANOTHER wallet (the builder's owner
 *              changed): the current wallet must re-sign it
 *   invalid    present but does not check out
 *   missing    404 / 410
 *   unchecked  the browser may not read it (CORS, network, 5xx) — never a verdict
 */
export type ProjectProofState =
  | { state: "valid"; country: string }
  | { state: "resign"; signer: string }
  | { state: "invalid"; reason: string }
  | { state: "missing" }
  | { state: "unchecked" };

export async function browserProjectProof(
  p: { owner: string; source: string },
  o: { chainId: number; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ProjectProofState> {
  let url: string;
  try {
    url = proofUrlFor(p.source);
  } catch {
    return { state: "invalid", reason: "not a canonical source" };
  }
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(url, { cache: "no-store", signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
  } catch {
    return { state: "unchecked" };
  }
  if (!res.ok) return res.status === 404 || res.status === 410 ? { state: "missing" } : { state: "unchecked" };
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return { state: "invalid", reason: "the file is not valid JSON" };
  }
  const r = await validateProof(body, { expectedSource: p.source, onchainOwner: getAddress(p.owner), chainId: o.chainId });
  if (r.valid) return { state: "valid", country: r.claim.country };
  if (r.rule === 4) {
    const signer = String((body as { claim?: { builder?: unknown } }).claim?.builder ?? "").toLowerCase();
    return { state: "resign", signer };
  }
  return { state: "invalid", reason: r.reason };
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
  const r = await browserProjectProof(b, o);
  if (r.state === "valid") return r;
  if (r.state === "unchecked") return r;
  return { state: "invalid" };
}
