/**
 * The edge-cached HTML of /arc/ and its question pages, shared by functions/arc/[[path]].ts and /llms-full.txt, so the
 * full reference reuses a page another request already built instead of recomputing it inside its own CPU budget.
 */
import { collectArcNumbers } from "./arc-numbers";
import { readArcDaily } from "./arc-daily";
import { renderArc } from "./arc-pages";
import { renderAcceptsUsdc, renderCompare, renderGetUsdc, renderMostUsed, renderNew } from "./arc-question-pages";
import { collectCompare } from "./chain-compare";
import { loadArcWeek } from "./arc-week";
import type { Env } from "./env";
import { edgeCachedGet, type EdgeCacheDeps } from "./http";

type CollectOpts = NonNullable<Parameters<typeof collectArcNumbers>[3]>;

export const arcHtml = (body: string, status = 200, head = false) =>
  new Response(head ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=600" : "no-store" } });

export const ARC_QUESTIONS: Record<string, (env: Env, deps: EdgeCacheDeps) => Promise<string>> = {
  "arc-vs-ethereum-vs-solana": async (env) => renderCompare(await collectCompare(env).catch(() => null)),
  "most-used-apps": async (env, deps) => renderMostUsed(await loadArcWeek(env, deps)),
  "apps-that-accept-usdc": async (env, deps) => renderAcceptsUsdc(await loadArcWeek(env, deps)),
  "new": async (env, deps) => renderNew(await loadArcWeek(env, deps), new Date().toISOString().slice(0, 10)),
  "get-usdc": async () => renderGetUsdc(),
};
/** A page built while a source was down: cached 10 min, and /llms-full.txt marks its own build degraded (review I3). */
export const DEGRADED_HEADER = "x-registrai-degraded";
export const compareTtl = (r: Response) => (r.headers.has(DEGRADED_HEADER) ? 600 : 3600);
async function comparePage(env: Env): Promise<Response> {
  const c = await collectCompare(env).catch(() => null);
  const res = arcHtml(renderCompare(c));
  if (!c || c.errors.length) {
    res.headers.set(DEGRADED_HEADER, "1");
    // for the owner: which source failed (printable ASCII only, short; never shown on the page)
    res.headers.set("x-registrai-errors", (c ? c.errors.join("; ") : "collector failed").replace(/[^\x20-\x7e]/g, "?").slice(0, 400));
  }
  return res;
}
/** Edge-cache seconds per question page (default 10 min); the chain comparison reads 3 RPCs and DefiLlama, so an hour. */
export const ARC_QUESTION_TTL: Record<string, number> = { "arc-vs-ethereum-vs-solana": 3600 };
const COMPARE = "arc-vs-ethereum-vs-solana";

/** /arc/ (Arc in numbers), edge-cached 10 min. */
export const arcPage = (env: Env, deps: EdgeCacheDeps, origin: string, opts: CollectOpts = {}, fetcher: typeof fetch = fetch) =>
  edgeCachedGet(new Request(`${origin}/arc/`), deps, async () => {
    const [n, history] = await Promise.all([collectArcNumbers(env, fetcher, Date.now(), opts), env.DATA_DB ? readArcDaily(env.DATA_DB, 30).catch(() => []) : Promise.resolve([])]);
    return arcHtml(renderArc(n, history));
  }, 600, "arc");

/** One question page, edge-cached 10 min. */
export const arcQuestionPage = (env: Env, deps: EdgeCacheDeps, origin: string, q: string) =>
  q === COMPARE
    ? edgeCachedGet(new Request(`${origin}/arc/${q}/`), deps, () => comparePage(env), compareTtl, `arc-q:${q}`)
    : edgeCachedGet(new Request(`${origin}/arc/${q}/`), deps, async () => arcHtml(await ARC_QUESTIONS[q](env, deps)), ARC_QUESTION_TTL[q] ?? 600, `arc-q:${q}`);
