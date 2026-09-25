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
 * client / reader as arguments. Used by scripts/sync.ts (the snapshot) and the
 * page (the snapshot plus a live overlay).
 *
 * ── Who decides (the live overlay is authoritative) ─────────────────────────
 * The snapshot paints the page first. Then every active project of every
 * active builder is re-checked live (GET /api/proof on builder.registrai.cc, a
 * direct fetch elsewhere; checkLiveProofs: 6 at a time, 20 s in all) and that
 * verdict wins. The snapshot's verdict is only the fallback for a project the
 * live check could not read; a project neither could confirm is "unconfirmed":
 * grey, never counted, never named by its profile. Nominated / Verified need a
 * validated proof (live, or the snapshot's).
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
 * A nominee whose source is a VALIDATED project (verified or nominated: its
 * proof checks out) of a shown builder merges into that builder's card (never
 * twice; see mergeGallery); otherwise — a squatter without a valid proof
 * included — it stays Invited, with only what the file says: name, source
 * link, X handle. Never a country or a wallet: an invitee has claimed nothing.
 *
 * On builder.registrai.cc the page also merges the invites the owner made in
 * /admin (GET /api/invites, public fields only): parsePublicInvites +
 * mergeNominees. Where that API does not exist the file alone is shown.
 *
 * ── A builder's name (builderName) ──────────────────────────────────────────
 *   1. the owner's curated name (nominee / invite) of one of its projects, in
 *      project order
 *   2. ONLY once onboarded (shown as Verified): its profileURI, when it is a
 *      plain short name (plainProfileName: ≤ 48 characters of Latin letters,
 *      digits, spaces and . , ' ’ & + _ ( ) ! -; so never a link, a `registrai:`
 *      string, an address or a look-alike from another script). A builder the
 *      multisig has not onboarded cannot put its own text on the gallery.
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
  parseProofText,
  proofUrl as proofUrlFor,
  sourceLabel,
  validateProof,
  type BuilderStatus,
  type ProjectStatus,
} from "./verified-builders";
import { browserProofReader, createProofReader, type ProofReader } from "./proof-fetch";
import type { BuilderRecord } from "./verified-builders-chain";
import { parseSnapshotBadge, readBadge, serialDigits, type BadgeInfo, type BadgeReader } from "./verified-builder-badge";
import { siteIconPath } from "./site-icon";

// ───────────────────────────── snapshot ─────────────────────────────

/** A chain builder's status in the gallery: the spec's builder status, plus
 *  "unconfirmed" (live overlay only: no project verified, and at least one
 *  that neither the live check nor the snapshot could confirm). */
export type GalleryStatus = BuilderStatus | "unconfirmed";
const STATUSES: readonly BuilderStatus[] = ["verified", "pending", "lapsed", "unverified", "inactive"];
/** A project's status in the gallery: the spec's, plus "unconfirmed" (live overlay only). */
export type GalleryProjectStatus = ProjectStatus | "unconfirmed";
const PROJECT_STATUSES: readonly ProjectStatus[] = ["verified", "lapsed", "inactive"];

/** live-data.json `gallery.builders[].projects[]`. Canonical sources only. */
export interface GalleryProject {
  /** Registry project id; 0 = unknown (a builder from an old single-source snapshot). */
  id: number;
  source: string;
  /** The registry's flag (a removed project is inactive). */
  active: boolean;
  status: GalleryProjectStatus;
  /** From the project's valid claim only. */
  country: string | null;
  proofUrl: string | null;
  /** Live overlay only: the live check could not read the proof, so `status`
   *  is the snapshot's verdict (or "unconfirmed" without one). */
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
  /** The multisig onboarded it: its caretaker is the operator (false when unknown). */
  onboarded?: boolean;
  /** Live overlay only: some active project's proof could not be read live (see GalleryProject.proofUnchecked). */
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

/** Pure (sync.ts): the gallery rows for chain records and their badges. `operator`
 *  tells an onboarded builder (caretaker = operator) from one never onboarded. */
export function galleryRowsFromRecords(
  records: (Pick<BuilderRecord, "builderId" | "owner" | "active" | "status" | "profileURI" | "projects" | "country" | "createdAt"> &
    Partial<Pick<BuilderRecord, "caretaker">>)[],
  badges: ReadonlyMap<number, BadgeInfo>,
  operator: string | null = null,
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
    onboarded:
      r.status === "verified" ||
      Boolean(operator && r.caretaker && r.caretaker.toLowerCase() !== zeroAddress && r.caretaker.toLowerCase() === operator.toLowerCase()),
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
  /** The keeper operator (caretaker of every onboarded builder). */
  operator?: string | null;
}): GallerySnapshot {
  const builders = galleryRowsFromRecords(o.records, o.badges, o.operator ?? null);
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
function legacyProjects(raw: Record<string, unknown>, status: BuilderStatus): GalleryProject[] {
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
  if (typeof status !== "string" || !STATUSES.includes(status as BuilderStatus)) return null;
  const st = status as BuilderStatus;
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
    // Older snapshots do not say: only a verified builder is known to be onboarded.
    onboarded: typeof raw.onboarded === "boolean" ? raw.onboarded : st === "verified",
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

/** What a card shows. Claimed = colour; lapsed, unconfirmed and not claimed = grayscale. */
export type DisplayKind = "verified" | "nominated" | "lapsed" | "unconfirmed" | "invited";

export const DISPLAY: Record<DisplayKind, { label: string; tone: "color" | "grayscale" }> = {
  verified: { label: "Verified", tone: "color" },
  nominated: { label: "Nominated", tone: "color" },
  lapsed: { label: "Lapsed", tone: "grayscale" },
  unconfirmed: { label: "Unconfirmed", tone: "grayscale" },
  invited: { label: "Invited", tone: "grayscale" },
};

/**
 * Pure: how a chain builder is shown, or null when it is not shown at all.
 *   hidden       no active project or deactivated — unless it holds a badge;
 *                lapsed and never onboarded (no caretaker, no badge): /admin only
 *   lapsed       no verified project, or its badge is marked lapsed on chain; a
 *                badge holder without an active project (its badge link resolves)
 *   unconfirmed  no verified project, and a proof nobody could read: grey
 *   verified     caretaker set, or a (non-lapsed) badge issued
 *   nominated    pending: a verified project, awaiting the Safe's onboarding batch
 */
export function displayKind(b: Pick<GalleryBuilder, "status" | "badge" | "onboarded">): Exclude<DisplayKind, "invited"> | null {
  if (b.status === "unverified" || b.status === "inactive") return b.badge ? "lapsed" : null;
  if (b.status === "lapsed") return b.onboarded || b.badge ? "lapsed" : null;
  if (b.badge?.lapsed) return "lapsed";
  if (b.status === "unconfirmed") return "unconfirmed";
  if (b.status === "verified" || b.badge) return "verified";
  return "nominated";
}

/** Pure: why a greyed builder card is grey (null for the others). */
export function greyReason(b: Pick<GalleryBuilder, "status" | "badge" | "projects">): string | null {
  if (b.status === "inactive") return "Deactivated on the registry";
  if (b.status === "unverified" || !b.projects.some((p) => p.active)) return "No active project";
  if (b.status === "unconfirmed") return "Proof couldn't be read right now: unconfirmed";
  if (b.status === "lapsed" || b.badge?.lapsed) return "No project proof checks out right now";
  return null;
}

export const toneOf = (k: DisplayKind) => DISPLAY[k].tone;
export const labelOf = (k: DisplayKind) => DISPLAY[k].label;

// ───────────────────────────── projects on a card ─────────────────────────────

/** A project chip: verified (the builder is onboarded), nominated (verified
 *  project, builder not onboarded yet), lapsed or unconfirmed (greyed). */
export type ChipKind = "verified" | "nominated" | "lapsed" | "unconfirmed";

export interface ProjectChip {
  id: number;
  source: string;
  label: string;
  kind: ChipKind;
  unchecked: boolean;
}

/** Pure: one project's chip on its builder's card; null for an inactive project. */
export function projectChipKind(p: Pick<GalleryProject, "status" | "active">, b: Pick<GalleryBuilder, "status" | "badge" | "onboarded">): ChipKind | null {
  if (!p.active || p.status === "inactive") return null;
  if (p.status === "lapsed") return "lapsed";
  if (p.status === "unconfirmed") return "unconfirmed";
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

/**
 * A plain short display name: ≤ 48 characters of LATIN letters (A–Z, a–z and
 * the accented Latin-1 / Latin Extended-A ones: é ñ ü ß ł ż …, minus the
 * look-alikes ı ĸ ŉ ſ), ASCII digits, spaces and . , ' ’ & + _ ( ) ! -.
 * Nothing from another script, so no look-alike of a real project's name (a
 * Cyrillic "а" for a Latin "a", a fullwidth "Ｕ", an Arabic-Indic digit).
 */
const PLAIN_NAME = /^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u0130\u0132-\u0137\u0139-\u0148\u014A-\u017E][A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u0130\u0132-\u0137\u0139-\u0148\u014A-\u017E .,'\u2019&+_()!-]*$/;
export const MAX_NAME_LEN = 48;

/** Pure: the profileURI as a display name, or null when it is not a plain short name. */
export function plainProfileName(profileURI: string | null | undefined): string | null {
  const s = (profileURI ?? "").trim().replace(/\s+/g, " ");
  if (!s || [...s].length > MAX_NAME_LEN) return null;
  return PLAIN_NAME.test(s) ? s : null;
}

/**
 * Pure: a builder's name (the rule is in the header). `onboarded` = the card
 * shows it as Verified (displayKind); only then may its own profile name it.
 */
export function builderName(
  b: Pick<GalleryBuilder, "id" | "profileURI" | "projects">,
  nominees: readonly Pick<Nominee, "name">[] = [],
  onboarded = false,
): string {
  const curated = nominees.find((n) => n.name)?.name;
  if (curated) return curated;
  const profile = onboarded ? plainProfileName(b.profileURI) : null;
  if (profile) return profile;
  const lead = leadProject(b);
  return lead ? sourceLabel(lead.source) : `Builder #${b.id}`;
}

/** Pure: the builder's avatar — its first verified GitHub project's owner, else its first verified domain's site icon, else null (the initial). */
export function builderAvatarUrl(b: Pick<GalleryBuilder, "projects">, size = 96): string | null {
  const verified = b.projects.filter((p) => p.status === "verified");
  const pick = verified.find((p) => p.source.startsWith("github:")) ?? verified.find((p) => p.source.startsWith("domain:"));
  return pick ? avatarUrl(pick.source, size) : null;
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

const KIND_ORDER: Record<DisplayKind, number> = { verified: 0, nominated: 1, unconfirmed: 2, lapsed: 3, invited: 4 };
const RANK: Record<string, number> = { verified: 0, nominated: 1 };

/** @deprecated An invitee's display name: the nominee's name, else `owner/repo` / the host. */
export function entryName(source: string | null, builderId?: number, nominee?: Nominee): string {
  if (nominee?.name) return nominee.name;
  if (source) return sourceLabel(source);
  return builderId !== undefined ? `Builder #${builderId}` : "";
}

/**
 * Pure: every source that is a VALIDATED project (active, proof verified) of a
 * builder shown as verified or nominated. Only these absorb an invite: a
 * project without a proof that checks out (a squatter's, a lapsed or an
 * unconfirmed one) never swallows it.
 */
export function claimedSources(builders: readonly GalleryBuilder[]): Set<string> {
  const out = new Set<string>();
  for (const b of builders) {
    const kind = displayKind(b);
    if (kind !== "verified" && kind !== "nominated") continue;
    for (const p of b.projects) if (p.active && p.status === "verified") out.add(p.source);
  }
  return out;
}

/**
 * Pure: chain builders merged with the invited list, in gallery order —
 * verified by badge serial, then nominated, unconfirmed, lapsed (by builder
 * id), then invitees in file order. A nominee whose source is a validated
 * project (claimedSources) is never "Invited"; it merges into the best-ranked
 * builder holding that validated project (verified, then nominated; lowest id
 * on a tie), which then carries its name and X handle (see builderName). A
 * builder may absorb several nominees (one per project).
 */
export function mergeGallery(builders: GalleryBuilder[], nominees: Nominee[]): GalleryEntry[] {
  const shown = builders
    .map((b) => ({ b, kind: displayKind(b) }))
    .filter((x): x is { b: GalleryBuilder; kind: Exclude<DisplayKind, "invited"> } => x.kind !== null);
  const claimed = claimedSources(builders);
  // Each claimed nominee attaches to the best-ranked builder with that validated project.
  const bestFor = new Map<string, { id: number; rank: number }>();
  for (const { b, kind } of shown) {
    const rank = RANK[kind];
    if (rank === undefined) continue;
    for (const p of b.projects) {
      if (!p.active || p.status !== "verified") continue;
      const cur = bestFor.get(p.source);
      if (!cur || rank < cur.rank || (rank === cur.rank && b.id < cur.id)) bestFor.set(p.source, { id: b.id, rank });
    }
  }
  const nomineeBySource = new Map(nominees.map((n) => [n.source, n]));

  const entries: GalleryEntry[] = shown.map(({ b, kind }) => {
    const mine = b.projects
      .filter((p) => p.active && bestFor.get(p.source)?.id === b.id)
      .map((p) => nomineeBySource.get(p.source))
      .filter((n): n is Nominee => Boolean(n));
    const name = builderName(b, mine, kind === "verified");
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
export const FILTERS: GalleryFilter[] = ["all", "verified", "nominated", "unconfirmed", "lapsed", "invited"];

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
  /** Shown grey; never in the header stats. */
  unconfirmed: number;
  invited: number;
  /** Distinct countries among claimed (verified + nominated) builders. */
  countries: number;
}

export function galleryCounts(entries: GalleryEntry[]): GalleryCounts {
  const c: GalleryCounts = { all: entries.length, verified: 0, nominated: 0, lapsed: 0, unconfirmed: 0, invited: 0, countries: 0 };
  const countries = new Set<string>();
  for (const e of entries) {
    c[e.kind]++;
    if ((e.kind === "verified" || e.kind === "nominated") && e.builder?.country) countries.add(e.builder.country);
  }
  c.countries = countries.size;
  return c;
}

/**
 * Pure: whether the gallery shows its counters. All zeros read as a dead
 * registry to the first invitees; the "founding builders" panel speaks for an
 * empty gallery instead.
 */
export function showGalleryStats(c: Pick<GalleryCounts, "all">): boolean {
  return c.all > 0;
}

// ───────────────────────────── links ─────────────────────────────

/**
 * A project's picture: the GitHub owner's avatar (CORS-enabled, cached by
 * GitHub), or a domain's own site icon through this site's /api/icon (same
 * origin; where that API is absent the image fails and the initial shows).
 */
export function avatarUrl(source: string | null | undefined, size = 96): string | null {
  const m = /^github:([^/]+)\//.exec(source ?? "");
  if (m) return `https://avatars.githubusercontent.com/${encodeURIComponent(m[1])}?size=${size}`;
  return source && source.startsWith("domain:") ? siteIconPath(source) : null;
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
 *  owner (a proof names the owner), same project, and it was checked. Only the
 *  fallback when the live check could not read the proof. */
function snapshotVerdict(row: LiveChainRow, p: LiveProjectRow, snap: GalleryBuilder | undefined): GalleryProject | null {
  if (!snap || snap.owner !== row.owner.toLowerCase() || snap.status === "inactive") return null;
  const sp = snap.projects.find((x) => x.id === p.id && x.source === p.source);
  return sp && sp.active && (sp.status === "verified" || sp.status === "lapsed") ? sp : null;
}

/** Pure: the projects of a live row whose proof the page checks — every
 *  active canonical project of an active builder (the live check is authoritative). */
export function projectsToCheck(row: LiveChainRow): LiveProjectRow[] {
  if (!row.active) return [];
  return row.projects.filter((p) => p.active && isCanonical(p.source));
}

/** Live proof checks: at most this many at once… */
export const LIVE_CHECK_PARALLEL = 6;
/** …and all of them within this long; the rest stay unchecked (the snapshot's verdict, else unconfirmed). */
export const LIVE_CHECK_BUDGET_MS = 20_000;

/**
 * Check every project of `rows` (projectsToCheck) with `check`, LIVE_CHECK_PARALLEL
 * at a time, within `budgetMs` in all. A check still running when the budget
 * runs out, or one that throws, is left out of the map (= unchecked).
 */
export async function checkLiveProofs(
  rows: readonly LiveChainRow[],
  check: (p: { owner: string; source: string }) => Promise<LiveProof>,
  o: { parallel?: number; budgetMs?: number } = {},
): Promise<Map<number, LiveProof>> {
  const out = new Map<number, LiveProof>();
  const queue = rows.flatMap((r) => projectsToCheck(r).map((p) => ({ owner: r.owner, id: p.id, source: p.source })));
  let expired = false;
  const workers = Array.from({ length: Math.min(o.parallel ?? LIVE_CHECK_PARALLEL, queue.length) }, async () => {
    for (let t = queue.shift(); t !== undefined && !expired; t = queue.shift()) {
      try {
        const r = await check({ owner: t.owner, source: t.source });
        if (!expired) out.set(t.id, r);
      } catch {
        // unchecked
      }
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve();
    }, o.budgetMs ?? LIVE_CHECK_BUDGET_MS);
  });
  await Promise.race([Promise.all(workers).then(() => undefined), budget]);
  clearTimeout(timer);
  expired = true;
  return new Map(out);
}

/**
 * Pure: the snapshot updated with the live chain. The live proof check
 * (`proofs`, by project id) decides every active project: valid = verified,
 * invalid = lapsed. Only where it could not read the proof (unchecked, or not
 * checked in time) does the snapshot's verdict stand in (same owner, same
 * project; flagged proofUnchecked); without one the project is "unconfirmed".
 * Caretaker, badge, active flags and the project list are always live. A
 * non-canonical source is never shown but counts as a lapsed project.
 *
 * Builder status: verified / pending with ≥1 verified project (caretaker =
 * operator or not); else "unconfirmed" when a project is unconfirmed; else
 * lapsed / unverified / inactive as the spec says.
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
      const base = { id: p.id, source: p.source, active: p.active, proofUrl: proofHref(p.source) };
      if (!row.active || !p.active) {
        projects.push({ ...base, status: "inactive", country: null });
        continue;
      }
      const proof = proofs.get(p.id) ?? { state: "unchecked" };
      if (proof.state === "valid") {
        projects.push({ ...base, status: "verified", country: proof.country });
        continue;
      }
      if (proof.state === "invalid") {
        projects.push({ ...base, status: "lapsed", country: null });
        continue;
      }
      const v = snapshotVerdict(row, p, snap);
      if (v) projects.push({ ...base, status: v.status, country: v.status === "verified" ? v.country : null, proofUnchecked: true });
      else projects.push({ ...base, status: "unconfirmed", country: null, proofUnchecked: true });
    }
    const confirmed = projects.filter((p): p is GalleryProject & { status: ProjectStatus } => p.status !== "unconfirmed");
    const forStatus = hiddenLapsed ? [...confirmed, { status: "lapsed" as const }] : confirmed;
    let status: GalleryStatus = builderStatus({ active: row.active, projects: forStatus, caretakerIsOperator });
    if ((status === "lapsed" || status === "unverified") && projects.some((p) => p.status === "unconfirmed")) status = "unconfirmed";
    const b: GalleryBuilder = {
      id: row.id,
      owner: row.owner.toLowerCase(),
      status,
      profileURI: row.profileURI,
      projects,
      country: claimedStatus(status) ? builderCountry(projects) : null,
      badge: row.badge,
      createdAt: row.createdAt || snap?.createdAt || 0,
      onboarded: caretakerIsOperator,
    };
    if (projects.some((p) => p.proofUnchecked)) b.proofUnchecked = true;
    out.set(row.id, b);
  }
  return [...out.values()].sort((a, b) => a.id - b.id);
}

/**
 * A project's proof as the page sees it, with the reason:
 *   valid      checks out for this owner
 *   resign     a well-signed proof for ANOTHER wallet (the builder's owner
 *              changed): the current wallet must re-sign it
 *   invalid    present but does not check out
 *   missing    404 / 410
 *   unchecked  could not be read (network, 5xx, 429, CORS without the proof
 *              API, larger than PROOF_MAX_BYTES) — never a verdict
 */
export type ProjectProofState =
  | { state: "valid"; country: string }
  | { state: "resign"; signer: string }
  | { state: "invalid"; reason: string }
  | { state: "missing" }
  | { state: "unchecked"; reason?: string };

export interface ProofCheckOptions {
  chainId: number;
  /** How to read the file; default: the browser's shared reader (GET /api/proof, else direct). */
  reader?: ProofReader;
  /** Tests / scripts: read directly with this fetch (no proof API). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function readerFor(o: ProofCheckOptions): ProofReader {
  if (o.reader) return o.reader;
  if (o.fetchImpl) return createProofReader({ fetchImpl: o.fetchImpl, apiPath: null, timeoutMs: o.timeoutMs });
  return browserProofReader();
}

/** Pure: a read proof file checked for this owner (parseProofText + validateProof). */
export async function judgeProofText(text: string, p: { owner: string; source: string }, chainId: number): Promise<ProjectProofState> {
  let body: unknown;
  try {
    body = parseProofText(text);
  } catch {
    return { state: "invalid", reason: "the file is not valid JSON" };
  }
  const r = await validateProof(body, { expectedSource: p.source, onchainOwner: getAddress(p.owner), chainId });
  if (r.valid) return { state: "valid", country: r.claim.country };
  if (r.rule === 4) {
    const signer = String((body as { claim?: { builder?: unknown } }).claim?.builder ?? "").toLowerCase();
    return { state: "resign", signer };
  }
  return { state: "invalid", reason: r.reason };
}

export async function browserProjectProof(p: { owner: string; source: string }, o: ProofCheckOptions): Promise<ProjectProofState> {
  try {
    proofUrlFor(p.source);
  } catch {
    return { state: "invalid", reason: "not a canonical source" };
  }
  const read = await readerFor(o)(p.source);
  if (!read.ok) {
    if (read.error === "missing") return { state: "missing" };
    if (read.error === "invalid-json") return { state: "invalid", reason: "the file is not valid JSON" };
    return { state: "unchecked", reason: read.detail };
  }
  return judgeProofText(read.text, p, o.chainId);
}

/**
 * Check a claim's proof from the page: through the builders site's proof API
 * (server-side, so a domain's CORS does not matter), else directly. A read
 * that fails is "unchecked", never "invalid".
 */
export async function browserProofCheck(b: { owner: string; source: string }, o: ProofCheckOptions): Promise<LiveProof> {
  const r = await browserProjectProof(b, o);
  if (r.state === "valid") return r;
  if (r.state === "unchecked") return { state: "unchecked" };
  return { state: "invalid" };
}
