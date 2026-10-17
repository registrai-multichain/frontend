import type { PagesFunction } from "../../lib/env";
import { handlePublicProject } from "../../lib/projects";
import { handlePublicFacts } from "../../lib/facts";
import { injectSummary } from "../../lib/ssr-summary";
import { projectName, renderProjectSummary, setHead } from "../../lib/project-ssr";
import { pageState, parseSourceParam, projectHref, sourceFromProjectPath } from "../../../src/lib/project-page";
import { builderUrl } from "../../../src/lib/public-site";

const html = (body: string, status: number, cache = "public, max-age=60") => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });
const read = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => ({})) });

/**
 * /project/?source=<source> → 301 to /project/<kind>/<rest>/ (one URL per project). /project/<kind>/<rest>/ serves the
 * static facts page with the project's own head and its facts in the HTML (lib/project-ssr.ts); the page's script then
 * loads the same facts live. No public profile or facts → 404, noindex.
 */
export const onRequest: PagesFunction = async (ctx) => {
  const method = ctx.request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return ctx.next();
  const url = new URL(ctx.request.url);
  const segs = ((ctx.params as { path?: string[] }).path ?? []).filter(Boolean);
  if (!segs.length) {
    const src = parseSourceParam(url.searchParams.get("source"));
    return src ? Response.redirect(`${url.origin}${projectHref(src)}`, 301) : ctx.next();
  }
  const source = sourceFromProjectPath(url.pathname);
  const asset = async () => {
    const r = ctx.env.ASSETS ? await ctx.env.ASSETS.fetch(new Request(`${url.origin}/project/`)) : await ctx.next();
    return r.status === 200 ? r.text() : null;
  };
  if (!source) {
    const page = await asset();
    return html(page ? setHead(page, { title: "Project not found · Registrai", description: "No project with this id.", canonical: builderUrl("project"), noindex: true }) : "Not found", 404);
  }
  if (url.pathname !== projectHref(source)) return Response.redirect(`${url.origin}${projectHref(source)}`, 301);
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const enc = encodeURIComponent(source);
  const [p, f] = await Promise.all([
    handlePublicProject(new Request(`${url.origin}/api/projects/${enc}`), ctx.env, source, deps).then(read),
    handlePublicFacts(new Request(`${url.origin}/api/facts/${enc}`), ctx.env, source, deps).then(read),
  ]);
  const state = pageState(p, f);
  const page = await asset();
  if (!page) return ctx.next();
  const canonical = `${builderUrl("")}${projectHref(source).slice(1)}`;
  if (state.kind === "error") return html(setHead(page, { title: "Project facts · Registrai", description: "Project facts on Arc.", canonical }), 200, "no-store");
  if (state.kind !== "ready") return html(setHead(page, { title: "No public facts · Registrai", description: "No public facts for this project yet.", canonical, noindex: true }), 404);
  const name = projectName(source, state);
  const head = { title: `${name}: facts · Registrai`, description: `On-chain facts about ${name} on Arc, with evidence: who controls it, its contracts and how it is used.`, canonical };
  return html(injectSummary(setHead(page, head), renderProjectSummary(source, state)), 200);
};
