import type { PagesFunction } from "../../lib/env";
import { withMarkdown } from "../../lib/markdown-route";
import { ARC_QUESTIONS, arcHtml as html, arcPage, arcQuestionPage } from "../../lib/arc-routes";
import { renderEcosystemNotFound } from "../../lib/ecosystem-pages";

/** GET /arc/ (Arc in numbers: live figures, edge-cached 10 min, plus the last 30 daily snapshots) and the four question
 *  pages under it (spec docs/superpowers/specs/2026-10-22-arc-question-pages-design.md), each edge-cached 10 min. */
const htmlPages: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const head = m === "HEAD";
  const asHead = (res: Response) => (head ? new Response(null, { status: res.status, headers: res.headers }) : res);
  if (parts.length === 1 && Object.hasOwn(ARC_QUESTIONS, parts[0])) return asHead(await arcQuestionPage(ctx.env, deps, url.origin, parts[0]));
  if (parts.length) return html(renderEcosystemNotFound(), 404, head);
  return asHead(await arcPage(ctx.env, deps, url.origin));
};

/** …/index.md: the Markdown copy of the same page (spec 2026-10-23-machine-readable-copies-design.md). */
export const onRequest: PagesFunction = withMarkdown(htmlPages);
