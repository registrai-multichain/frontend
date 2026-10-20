/**
 * The builder site's URL list: /sitemap.xml and the daily IndexNow ping share it. Project pages are listed when they have
 * a public profile or public facts; that list is built from a KV listing at most once a day (KV list operations are scarce on
 * the free plan) and kept under one key, which an admin facts or profile save deletes so the next sitemap rebuilds it.
 */
import type { EdgeCacheDeps } from "./http";
import type { Env } from "./env";
import { idToPath, loadAppList } from "./apps-data";
import { FACTS_KEY_PREFIX, listNames, MAX_SOURCES, mapChunks } from "./kv-chunks";
import { getVerify } from "./verify";
import { getProfile, PROJECT_PREFIX } from "./projects";
import { normalizeSource } from "../../src/lib/verified-builders";
import { publicResponse, type ProjectFacts } from "../../src/lib/facts";
import { FACTS_SITEMAP_KEY } from "./facts";
export { FACTS_SITEMAP_KEY };
import { projectHref } from "../../src/lib/project-page";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { CATEGORIES, categoryHref, entityHref } from "../../src/lib/arc-ecosystem";

export const SITE = "https://builder.registrai.cc";
const FACTS_SITEMAP_MAX_AGE_MS = 24 * 3600e3;
/** Pages whose content follows the hourly data: their lastmod is the data's last closed hour. /verify/ is noindex, so it is not listed. */
const DATA = ["/builders-index/", "/apps/", "/track-record/"];
const STATIC = ["/builders/", "/data-api/", "/how-we-publish/", "/guide/", "/terms/", "/privacy/"];

type FactPage = { path: string; lastmod?: string };

export async function factPages(env: Env, now = Date.now()): Promise<FactPage[]> {
  try {
    const cached = JSON.parse((await env.INVITES.get(FACTS_SITEMAP_KEY)) ?? "null") as { built: number; pages: FactPage[] } | null;
    if (cached && now - cached.built < FACTS_SITEMAP_MAX_AGE_MS) return cached.pages;
  } catch { /* rebuild */ }
  const sources = (await listNames(env.INVITES, FACTS_KEY_PREFIX)).map((n) => n.slice(FACTS_KEY_PREFIX.length)).slice(0, MAX_SOURCES);
  const factsFound = await mapChunks(sources, async (source): Promise<FactPage | null> => {
    try {
      const stored = JSON.parse((await env.INVITES.get(`${FACTS_KEY_PREFIX}${source}`)) ?? "null") as ProjectFacts | null;
      if (!stored || stored.source !== source || !Array.isArray(stored.facts)) return null;
      const shown = publicResponse(stored, now, await getVerify(env.INVITES, source));
      if (!shown.facts.length) return null;
      return { path: projectHref(source), ...(shown.lastReviewedAt ? { lastmod: shown.lastReviewedAt } : {}) };
    } catch { return null; }
  });
  // a public profile alone makes the page useful (name, website, contracts): /api/projects serves every stored profile
  const profiles = (await listNames(env.INVITES, PROJECT_PREFIX)).map((n) => n.slice(PROJECT_PREFIX.length)).filter((s) => normalizeSource(s) === s).slice(0, MAX_SOURCES);
  const profileFound = await mapChunks(profiles, async (source): Promise<FactPage | null> => {
    const p = await getProfile(env.INVITES, source).catch(() => null);
    return p ? { path: projectHref(source), ...(p.declaredAt ? { lastmod: p.declaredAt } : {}) } : null;
  });
  const merged = new Map<string, FactPage>();
  for (const f of [...factsFound, ...profileFound]) {
    if (!f) continue;
    const prev = merged.get(f.path);
    merged.set(f.path, !prev || (f.lastmod ?? "") > (prev.lastmod ?? "") ? f : prev);
  }
  const found = [...merged.values()];
  const pages = found.filter((p): p is FactPage => p !== null && p.path.startsWith("/project/") && !p.path.includes("?"));
  await env.INVITES.put(FACTS_SITEMAP_KEY, JSON.stringify({ built: now, pages })).catch(() => undefined);
  return pages;
}

export async function sitemapUrls(env: Env, deps: EdgeCacheDeps, now = Date.now()): Promise<{ loc: string; lastmod?: string }[]> {
  const [l, facts] = await Promise.all([loadAppList(env, deps), factPages(env, now).catch(() => [])]);
  const mod = l?.data_until;
  const apps = (l?.rows ?? []).map((r) => idToPath(r.id)).filter((p): p is string => p !== null);
  const at = (p: string, lastmod?: string) => ({ loc: `${SITE}${p}`, ...(lastmod ? { lastmod } : {}) });
  const eco = ECOSYSTEM.entities;
  const ecoMod = eco.map((e) => e.last_reviewed).sort().pop();
  const claimed = new Set(eco.flatMap((e) => (e.index_ids ?? []).map((id) => idToPath(id))));
  const cats = CATEGORIES.filter((c) => eco.some((e) => e.category === c.id || (e.tags ?? []).includes(c.id)));
  const ecoUrls = eco.length ? [at("/ecosystem/", ecoMod), ...cats.map((c) => at(categoryHref(c.id), ecoMod)), ...eco.map((e) => at(entityHref(e.slug), e.last_reviewed))] : [];
  return [...DATA.map((p) => at(p, mod)), ...STATIC.map((p) => at(p)), ...ecoUrls, ...apps.filter((p) => !claimed.has(p)).map((p) => at(p, mod)), ...facts.map((f) => at(f.path, f.lastmod))];
}

/** IndexNow (Bing, Yandex, Seznam, Naver): the key is public by design; the file at /<key>.txt proves the host is ours. */
export const INDEXNOW_KEY = "10dec8b5c4706a0c957248ee188ce526";
export const shouldPing = (dataUntil: string) => /T00:00:00(\.000)?Z$/.test(dataUntil);

export async function pingIndexNow(urls: string[], fetcher: typeof fetch = fetch): Promise<void> {
  try {
    await fetcher("https://api.indexnow.org/indexnow", {
      method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ host: "builder.registrai.cc", key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(0, 10_000) }),
    });
  } catch (err) {
    console.warn("indexnow ping failed", err instanceof Error ? err.message : err);
  }
}
