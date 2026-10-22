import type { PagesFunction } from "../../lib/env";
import { collectArcNumbers } from "../../lib/arc-numbers";
import { readArcDaily } from "../../lib/arc-daily";
import { renderArc } from "../../lib/arc-pages";
import { renderAcceptsUsdc, renderGetUsdc, renderMostUsed, renderNew } from "../../lib/arc-question-pages";
import { loadArcWeek } from "../../lib/arc-week";
import { renderEcosystemNotFound } from "../../lib/ecosystem-pages";
import { edgeCachedGet } from "../../lib/http";

/** GET /arc/ (Arc in numbers: live figures, edge-cached 10 min, plus the last 30 daily snapshots) and the four question
 *  pages under it (spec docs/superpowers/specs/2026-10-22-arc-question-pages-design.md), each edge-cached 10 min. */
const html = (body: string, status = 200, head = false) =>
  new Response(head ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=600" : "no-store" } });

type Load = typeof loadArcWeek;
const QUESTIONS: Record<string, (env: Parameters<Load>[0], deps: Parameters<Load>[1]) => Promise<string>> = {
  "most-used-apps": async (env, deps) => renderMostUsed(await loadArcWeek(env, deps)),
  "apps-that-accept-usdc": async (env, deps) => renderAcceptsUsdc(await loadArcWeek(env, deps)),
  "new": async (env, deps) => renderNew(await loadArcWeek(env, deps), new Date().toISOString().slice(0, 10)),
  "get-usdc": async () => renderGetUsdc(),
};

export const onRequest: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const head = m === "HEAD";
  const asHead = (res: Response) => (head ? new Response(null, { status: res.status, headers: res.headers }) : res);
  if (parts.length === 1 && Object.hasOwn(QUESTIONS, parts[0])) {
    const q = parts[0];
    return asHead(await edgeCachedGet(new Request(`${url.origin}/arc/${q}/`), deps, async () => html(await QUESTIONS[q](ctx.env, deps)), 600, `arc-q:${q}`));
  }
  if (parts.length) return html(renderEcosystemNotFound(), 404, head);
  const res = await edgeCachedGet(new Request(`${url.origin}/arc/`), deps, async () => {
    const [n, history] = await Promise.all([collectArcNumbers(ctx.env), ctx.env.DATA_DB ? readArcDaily(ctx.env.DATA_DB, 30).catch(() => []) : Promise.resolve([])]);
    return html(renderArc(n, history));
  }, 600, "arc");
  return asHead(res);
};
