/**
 * The Arc ecosystem directory (spec docs/superpowers/specs/2026-10-19-arc-ecosystem-directory-design.md): every project
 * with a public Arc link, one entry each, every claim sourced. Pure: taxonomy, the entry type, validation, lookups.
 * The published file is src/data/arc-ecosystem/entities.json (arc-ecosystem-data.ts).
 */
import { hasVerdict } from "./facts";

export const CATEGORIES = [
  { id: "payments", name: "Payments", label: "Payment apps on Arc" },
  { id: "wallets", name: "Wallets", label: "Wallets that support Arc" },
  { id: "exchanges", name: "Exchanges", label: "Exchanges that support Arc" },
  { id: "banks", name: "Banks", label: "Banks building on Arc" },
  { id: "stablecoin-issuers", name: "Stablecoin issuers", label: "Stablecoin issuers on Arc" },
  { id: "infrastructure", name: "Infrastructure", label: "Infrastructure for Arc" },
  { id: "developer-tools", name: "Developer tools", label: "Developer tools for Arc" },
  { id: "dexs", name: "DEXs", label: "DEXs on Arc" },
  { id: "lending", name: "Lending", label: "Lending on Arc" },
  { id: "trading", name: "Trading", label: "Trading on Arc" },
  { id: "market-makers", name: "Market makers", label: "Market makers on Arc" },
  { id: "custody", name: "Custody", label: "Custody on Arc" },
  { id: "rwa", name: "Tokenization and RWA", label: "Tokenization and RWA on Arc" },
  { id: "bridges", name: "Bridges and cross-chain", label: "Bridges and cross-chain on Arc" },
  { id: "ai-agents", name: "AI agents", label: "AI agents on Arc" },
  { id: "ramps", name: "On/off-ramps", label: "On/off-ramps for Arc" },
  { id: "consumer", name: "Games and consumer", label: "Games and consumer apps on Arc" },
  { id: "launchpads", name: "Launchpads", label: "Launchpads on Arc" },
  { id: "validators", name: "Validators", label: "Arc validators" },
  { id: "asset-managers", name: "Asset managers", label: "Asset managers on Arc" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type Category = (typeof CATEGORIES)[number];
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
export const categoryOf = (id: string): Category | null => CATEGORIES.find((c) => c.id === id) ?? null;

export type EntityStatus = "live" | "deployed" | "announced";
export const STATUS_LABEL: Record<EntityStatus, string> = { live: "Live on mainnet", deployed: "Deployed", announced: "Announced" };
export const parseStatus = (v: string | null): EntityStatus | null => (v === "live" || v === "deployed" || v === "announced" ? v : null);

/** type "mainnet-support": the project's own page stating it supports Arc mainnet (for integrations without their own contracts).
 *  type "arc-official-live": an arc.io or circle.com page stating the project is live on Arc mainnet (e.g. the 16 Sep launch post). */
export type Source = { url: string; title?: string; date?: string; type?: "mainnet-support" | "arc-official-live" };
const OFFICIAL = /(^|\.)(arc\.io|circle\.com)$/;
export type ArcEntity = {
  slug: string; name: string; aliases?: string[]; category: CategoryId; tags?: CategoryId[];
  status: EntityStatus; status_evidence: Source[]; summary: string;
  website?: string; x?: string; github?: string; docs?: string;
  first_announced?: string; first_live?: string;
  contracts?: { address: string; role: string; source: string }[];
  index_ids?: string[]; facts_source?: string; sources: Source[]; last_reviewed: string;
};
export const SUMMARY_MAX = 280;

/** The summary's first sentence, at most 140 characters, for "What it does on Arc" (spec 2026-10-23-replace-competitor-citations §2).
 *  A sentence ends at ". " before a capital letter, never after an abbreviation like "e.g." or "i.e.". */
export function whatItDoes(e: Pick<ArcEntity, "summary">): string {
  const s = e.summary.trim();
  const m = /^(.+?(?<!\b(?:e\.g|i\.e|etc|vs|approx))\.)\s+(?=[A-Z])/.exec(s);
  const first = m ? m[1] : s;
  return first.length <= 140 ? first : `${first.slice(0, 140).replace(/\s+\S*$/, "")}…`;
}

const FIELDS = new Set(["slug", "name", "aliases", "category", "tags", "status", "status_evidence", "summary", "website", "x", "github", "docs",
  "first_announced", "first_live", "contracts", "index_ids", "facts_source", "sources", "last_reviewed"]);
/** Path words a slug may not take (they would read as routes or files under /ecosystem/). */
const RESERVED = new Set(["api", "category", "categories", "entities", "status", "search", "index", "all", "corrections"]);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/, DAY = /^\d{4}-\d{2}-\d{2}$/, ADDR = /^0x[0-9a-f]{40}$/, ID = /^[a-z]+:\S+$/, HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const urlOf = (u: unknown): URL | null => { if (typeof u !== "string") return null; try { return new URL(u); } catch { return null; } };
const https = (u: unknown) => { const x = urlOf(u); return !!x && x.protocol === "https:" && !x.username && !x.password; };

export function validateEntities(list: unknown): { ok: true; entities: ArcEntity[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(list)) return { ok: false, errors: ["expected an array of entities"] };
  const errors: string[] = [], slugs = new Set<string>(), indexIds = new Map<string, string>(), factsSources = new Map<string, string>();
  list.forEach((raw, i) => {
    const e = (raw ?? {}) as Record<string, unknown> & Partial<ArcEntity>;
    const err = (m: string) => errors.push(`#${i} ${typeof e.slug === "string" ? e.slug : "?"}: ${m}`);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return err("not an object");
    for (const k of Object.keys(e)) if (!FIELDS.has(k)) err(`unknown field ${k}`);
    if (typeof e.slug !== "string" || !SLUG.test(e.slug)) err("slug must be kebab-case (a-z, 0-9, -)");
    else if (CATEGORY_IDS.has(e.slug)) err("slug is a category id");
    else if (RESERVED.has(e.slug)) err("slug is a reserved word");
    else if (slugs.has(e.slug)) err("duplicate slug");
    else slugs.add(e.slug);
    if (typeof e.name !== "string" || !e.name.trim()) err("name is required");
    if (!CATEGORY_IDS.has(String(e.category))) err(`unknown category ${String(e.category)}`);
    for (const t of e.tags ?? []) if (!CATEGORY_IDS.has(t)) err(`unknown tag ${t}`);
    if (!parseStatus(String(e.status))) err("status must be live, deployed or announced");
    if (!Array.isArray(e.status_evidence) || !e.status_evidence.length) err("status_evidence is required");
    if (!Array.isArray(e.sources) || !e.sources.length) err("sources are required");
    for (const s of [...(e.status_evidence ?? []), ...(e.sources ?? [])]) {
      if (!https(s?.url)) err(`not an https URL: ${String(s?.url)}`);
      if (s?.type !== undefined && s.type !== "mainnet-support" && s.type !== "arc-official-live") err(`unknown evidence type ${String(s.type)}`);
      if (s?.type === "arc-official-live" && !OFFICIAL.test(urlOf(s.url)?.hostname ?? "")) err("arc-official-live must be an arc.io or circle.com page");
    }
    if (typeof e.summary !== "string" || !e.summary.trim()) err("summary is required");
    else {
      if (e.summary.length > SUMMARY_MAX) err(`summary is over ${SUMMARY_MAX} characters`);
      if (hasVerdict(e.summary)) err("summary has a verdict word");
    }
    for (const k of ["website", "docs"] as const) if (e[k] !== undefined && !https(e[k])) err(`${k} must be an https URL`);
    if (e.github !== undefined && !(https(e.github) && urlOf(e.github)!.hostname === "github.com")) err("github must be an https://github.com URL");
    if (e.x !== undefined && !HANDLE.test(e.x)) err("x must be a handle without @");
    for (const k of ["first_announced", "first_live"] as const) if (e[k] !== undefined && !DAY.test(e[k]!)) err(`${k} must be YYYY-MM-DD`);
    if (typeof e.last_reviewed !== "string" || !DAY.test(e.last_reviewed)) err("last_reviewed must be YYYY-MM-DD");
    for (const c of e.contracts ?? []) {
      if (!ADDR.test(String(c?.address))) err(`contract address must be lowercase 0x + 40 hex: ${String(c?.address)}`);
      if (!c?.role) err("contract role is required");
      if (!https(c?.source)) err("contract source must be an https URL");
    }
    for (const id of e.index_ids ?? []) {
      if (!ID.test(id)) err(`bad index id ${id}`);
      else if (indexIds.has(id)) err(`index id ${id} also on ${indexIds.get(id)}`);
      else indexIds.set(id, String(e.slug));
    }
    if (e.facts_source !== undefined) {
      if (!ID.test(e.facts_source)) err(`bad facts_source ${e.facts_source}`);
      else if (factsSources.has(e.facts_source)) err(`facts_source ${e.facts_source} also on ${factsSources.get(e.facts_source)}`);
      else factsSources.set(e.facts_source, String(e.slug));
    }
    const explorer = (e.status_evidence ?? []).some((s) => urlOf(s?.url)?.hostname === "explorer.arc.io" || s?.type === "mainnet-support" || s?.type === "arc-official-live");
    if (e.status === "live" && !(e.contracts?.length || e.index_ids?.length || explorer)) err("live needs mainnet evidence: a contract, an index id, an explorer.arc.io link, a mainnet-support page or an official Arc post saying it is live");
  });
  return errors.length ? { ok: false, errors } : { ok: true, entities: list as ArcEntity[] };
}

export const entityHref = (slug: string) => `/ecosystem/${slug}/`;
export const categoryHref = (id: CategoryId) => `/ecosystem/${id}/`;
const COLLATOR = new Intl.Collator("en", { sensitivity: "base" }); // one collator: localeCompare with options per comparison is slow
export const sortByName = (l: ArcEntity[]) => [...l].sort((a, b) => COLLATOR.compare(a.name, b.name) || (a.slug < b.slug ? -1 : 1));

export type EcosystemIndex = { entities: ArcEntity[]; bySlug: Map<string, ArcEntity>; byIndexId: Map<string, ArcEntity>; byFactsSource: Map<string, ArcEntity> };
export function indexEntities(entities: ArcEntity[]): EcosystemIndex {
  const bySlug = new Map<string, ArcEntity>(), byIndexId = new Map<string, ArcEntity>(), byFactsSource = new Map<string, ArcEntity>();
  for (const e of entities) {
    bySlug.set(e.slug, e);
    for (const id of e.index_ids ?? []) byIndexId.set(id, e);
    if (e.facts_source) byFactsSource.set(e.facts_source, e);
  }
  return { entities, bySlug, byIndexId, byFactsSource };
}

/** Announced entries not re-checked for more than `days` (the spec's monthly re-check: they may have gone live, or quiet). */
export function staleEntries(l: ArcEntity[], today: string, days = 90): ArcEntity[] {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - days * 86400e3;
  return l.filter((e) => e.status === "announced" && Date.parse(`${e.last_reviewed}T00:00:00Z`) < cutoff);
}
