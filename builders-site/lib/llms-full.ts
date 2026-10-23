/**
 * /llms-full.txt (spec 2026-10-23-machine-readable-copies-design.md): the whole reference in one file, as llmstxt.org
 * describes: the method, Arc in numbers, the four question pages, then one line per project. A failing live source
 * only marks its own section "Not available right now"; the file always builds.
 */
import { STATUS_LABEL, categoryOf, entityHref, sortByName } from "../../src/lib/arc-ecosystem";
import { ECOSYSTEM } from "../../src/lib/arc-ecosystem-data";
import { readArcDaily } from "./arc-daily";
import { collectArcNumbers } from "./arc-numbers";
import { renderArc } from "./arc-pages";
import { renderAcceptsUsdc, renderGetUsdc, renderMostUsed, renderNew } from "./arc-question-pages";
import { share7d } from "./arc-share";
import { loadArcWeek } from "./arc-week";
import { ATTRIBUTION } from "./attribution";
import { indexFile } from "./data-api";
import type { Env } from "./env";
import type { EdgeCacheDeps } from "./http";
import { escapeMd, htmlToMarkdown } from "./markdown";
import { renderMethodology } from "./methodology-page";

const SITE = "https://builder.registrai.cc";
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
const na = (title: string) => `## ${title}\n\nNot available right now.\n`;

export async function buildLlmsFull(env: Env, deps: EdgeCacheDeps, now = Date.now(), fetcher: typeof fetch = fetch): Promise<string> {
  const [aei, days] = await Promise.all([
    indexFile(env, "aei").catch(() => null),
    env.DATA_DB ? readArcDaily(env.DATA_DB, 30).catch(() => []) : Promise.resolve([]),
  ]);
  const f = aei as { params?: Record<string, number>; live?: { base_window?: number; base_scale?: number }; data_until?: string } | null;
  const params = f?.params ? { ...f.params, ...(f.live?.base_window !== undefined ? { base_window: f.live.base_window } : {}), ...(f.live?.base_scale !== undefined ? { base_scale: f.live.base_scale } : {}) } : null;
  const parts: string[] = [];
  parts.push(`# Registrai: Arc ecosystem data (full reference)\n\n${ATTRIBUTION}. Updated ${stamp(now)} UTC.\n\nIndex of pages: ${SITE}/llms.txt. Open data, refreshed daily: https://github.com/registrai-multichain/arc-ecosystem\n`);
  try { parts.push(htmlToMarkdown(renderMethodology({ params, share: share7d(days), until: f?.data_until ?? null }), `${SITE}/methodology/`)); }
  catch { parts.push(na("Methodology")); }
  try {
    const n = await collectArcNumbers(env, fetcher, now, { deadlineMs: 10_000 });
    parts.push(htmlToMarkdown(renderArc(n, days), `${SITE}/arc/`));
  } catch { parts.push(na("Arc in numbers")); }
  const w = await loadArcWeek(env, deps).catch(() => null);
  const today = new Date(now).toISOString().slice(0, 10);
  for (const [path, render] of [["/arc/most-used-apps/", () => renderMostUsed(w)], ["/arc/apps-that-accept-usdc/", () => renderAcceptsUsdc(w)],
    ["/arc/new/", () => renderNew(w, today)], ["/arc/get-usdc/", () => renderGetUsdc()]] as const) {
    try { parts.push(htmlToMarkdown(render(), `${SITE}${path}`)); } catch { parts.push(na(path)); }
  }
  const lines = sortByName(ECOSYSTEM.entities).map((e) =>
    `- **${escapeMd(e.name)}** (${escapeMd(categoryOf(e.category)?.name ?? e.category)}, ${STATUS_LABEL[e.status]}): ${escapeMd(e.summary)}${e.website ? ` ${e.website}` : ""} — ${SITE}${entityHref(e.slug)}`);
  parts.push(`## Projects\n\n${ECOSYSTEM.entities.length} projects in the Arc ecosystem directory (${SITE}/ecosystem/).\n\n${lines.join("\n")}\n`);
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n");
}
