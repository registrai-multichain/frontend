import type { PagesFunction } from "../../lib/env";
import { CORRECTIONS, ECOSYSTEM } from "../../../src/lib/arc-ecosystem-data";
import { categoryOf, parseStatus } from "../../../src/lib/arc-ecosystem";
import { renderCategory, renderDirectory, renderEcosystemNotFound, renderEntity } from "../../lib/ecosystem-pages";
import { loadEntityView } from "../../lib/ecosystem-load";
import { renderCorrectionForm, renderCorrectionsLog, renderRemoved } from "../../lib/corrections-pages";
import { correctionsOpen } from "../../lib/corrections";
import { ERROR_TEXT, type ErrorCode } from "../../lib/corrections-codes";
import { edgeCachedGet } from "../../lib/http";

/** GET /ecosystem/, /ecosystem/<category>/, /ecosystem/<slug>/ (spec 2026-10-19-arc-ecosystem-directory-design.md). */
const html = (body: string, status = 200, head = false) =>
  new Response(head ? null : body, { status, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": status === 200 ? "public, max-age=300" : "no-store" } });

/** The directory and category pages depend only on the bundled data: rendered once per isolate (free plan: 10 ms CPU). */
const memo = new Map<string, string>();
const once = (key: string, render: () => string) => { let h = memo.get(key); if (h === undefined) { h = render(); memo.set(key, h); } return h; };

export const onRequest: PagesFunction = async (ctx) => {
  const req = ctx.request, url = new URL(req.url), m = req.method.toUpperCase();
  if (m !== "GET" && m !== "HEAD") return new Response("Only GET is supported.", { status: 405, headers: { allow: "GET" } });
  if (!url.pathname.endsWith("/")) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const head = m === "HEAD";
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const parts = ([] as string[]).concat(ctx.params.path ?? []).filter(Boolean);
  const all = ECOSYSTEM.entities;
  if (parts.length === 0) {
    const status = parseStatus(url.searchParams.get("status"));
    return html(once(`dir:${status ?? ""}`, () => renderDirectory(all, status)), 200, head);
  }
  if (parts.length === 2 && parts[1] === "correct") {
    const target = ECOSYSTEM.bySlug.get(parts[0]);
    if (!target) return html(renderEcosystemNotFound(), 404, head);
    const code = url.searchParams.get("error");
    const error = code && Object.hasOwn(ERROR_TEXT, code) ? (code as ErrorCode) : null;
    const h = renderCorrectionForm(target, { siteKey: correctionsOpen(ctx.env) ? ctx.env.TURNSTILE_SITE_KEY! : null, sent: url.searchParams.get("sent") === "1", error });
    return new Response(head ? null : h, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" } });
  }
  if (parts.length !== 1) return html(renderEcosystemNotFound(), 404, head);
  if (parts[0] === "corrections") return html(once("corrections", () => renderCorrectionsLog(CORRECTIONS.all, new Map(all.map((e) => [e.slug, e.name])))), 200, head);
  const cat = categoryOf(parts[0]);
  if (cat) return html(once(`cat:${cat.id}`, () => renderCategory(cat, all)), 200, head);
  const e = ECOSYSTEM.bySlug.get(parts[0]);
  if (!e) {
    const gone = CORRECTIONS.removed.get(parts[0]);
    return gone ? html(renderRemoved(gone), 410, head) : html(renderEcosystemNotFound(), 404, head);
  }
  const res = await edgeCachedGet(new Request(url.toString()), deps, async () => html(renderEntity(await loadEntityView(ctx.env, deps, e, url.origin))), 300, `entity:${e.slug}:${correctionsOpen(ctx.env) ? "c" : "m"}`);
  return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
};
