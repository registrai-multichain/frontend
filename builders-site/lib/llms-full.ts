/**
 * /llms-full.txt (spec 2026-10-23-machine-readable-copies-design.md): the whole reference in one file, as llmstxt.org
 * describes: the method, Arc in numbers, the four question pages, then one line per project. A failing live source
 * only marks its own section "Not available right now"; the file always builds. /arc/ and the question pages come from
 * their own edge cache when another request already built them (review I5: the free plan's CPU budget per request).
 */
import { STATUS_LABEL, categoryOf, entityHref, sortByName } from "../../src/lib/arc-ecosystem";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { readArcDaily } from "./arc-daily";
import { arcPage, arcQuestionPage } from "./arc-routes";
import { share7d } from "./arc-share";
import { ATTRIBUTION } from "./attribution";
import { indexFile } from "./data-api";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";
import type { AbiData } from "../../src/lib/builders-index";
import { escapeMd, htmlToMarkdown } from "./markdown";
import { renderMethodology } from "./methodology-page";

const SITE = "https://builder.registrai.cc";
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const na = (title: string) => `## ${title}\n\nNot available right now.\n`;

export async function buildLlmsFull(env: Env, deps: EdgeCacheDeps, now = Date.now(), fetcher: typeof fetch = fetch): Promise<string> {
  return (await buildLlmsFullDoc(env, deps, now, fetcher)).text;
}

/** The file plus whether any section fell back (the route then caches it for 10 min instead of an hour). */
export async function buildLlmsFullDoc(env: Env, deps: EdgeCacheDeps, now = Date.now(), fetcher: typeof fetch = fetch): Promise<{ text: string; degraded: boolean }> {
  const [aei, days] = await Promise.all([
    indexFile(env, "aei").catch(() => null),
    env.DATA_DB ? readArcDaily(env.DATA_DB, 30).catch(() => []) : Promise.resolve([]),
  ]);
  const f = aei as (AbiData & { params?: Record<string, number>; live?: { base_window?: number; base_scale?: number }; data_until?: string }) | null;
  const params = f?.params ? { ...f.params, ...(f.live?.base_window !== undefined ? { base_window: f.live.base_window } : {}), ...(f.live?.base_scale !== undefined ? { base_scale: f.live.base_scale } : {}) } : null;
  const parts: string[] = [];
  let degraded = false;
  const fallback = (title: string) => { degraded = true; parts.push(na(title)); };
  parts.push(`# Registrai: Arc ecosystem data (full reference)\n\n${ATTRIBUTION}. Updated ${stamp(now)} UTC.\n\nIndex of pages: ${SITE}/llms.txt. Open data, refreshed daily: https://github.com/registrai-multichain/arc-ecosystem\n`);
  try { parts.push(htmlToMarkdown(renderMethodology({ params, share: share7d(days), until: f?.data_until ?? null }), `${SITE}/methodology/`)); }
  catch { fallback("Methodology"); }
  const page = async (title: string, path: string, get: () => Promise<Response>) => {
    try {
      const r = await get();
      if (r.status !== 200) throw new Error(String(r.status));
      parts.push(htmlToMarkdown(await r.text(), `${SITE}${path}`));
    } catch { fallback(title); }
  };
  await page("Arc in numbers", "/arc/", () => arcPage(env, deps, SITE, { deadlineMs: 10_000, aei: f }, fetcher));
  for (const [title, q] of [["Most used apps on Arc", "most-used-apps"], ["Apps on Arc that accept USDC", "apps-that-accept-usdc"], ["New apps on Arc", "new"], ["How to get USDC onto Arc", "get-usdc"], ["Arc vs Ethereum vs Solana for stablecoin payments", "arc-vs-ethereum-vs-solana"]] as const)
    await page(title, `/arc/${q}/`, () => arcQuestionPage(env, deps, SITE, q));
  const lines = sortByName(ECOSYSTEM.entities).map((e) =>
    `- **${escapeMd(e.name)}** (${escapeMd(categoryOf(e.category)?.name ?? e.category)}, ${STATUS_LABEL[e.status]}): ${escapeMd(e.summary)}${e.website ? ` ${e.website}` : ""} — ${SITE}${entityHref(e.slug)}`);
  parts.push(`## Projects\n\n${ECOSYSTEM.entities.length} projects in the Arc ecosystem directory (${SITE}/ecosystem/).\n\n${lines.join("\n")}\n`);
  return { text: parts.join("\n\n").replace(/\n{3,}/g, "\n\n"), degraded };
}
