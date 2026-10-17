import type { PagesFunction } from "../../lib/env";
import { handlePublicProject } from "../../lib/projects";
import { handlePublicFacts } from "../../lib/facts";
import { injectSummary } from "../../lib/ssr-summary";
import { projectName, renderProjectSummary, setHead } from "../../lib/project-ssr";
import { pageState, parseSourceParam, projectHref, sourceFromProjectPath } from "../../../src/lib/project-page";
import { builderUrl } from "../../../src/lib/public-site";

const read = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => ({})) });
/** Next's own files for the /project/ route (RSC payloads, prefetch trees): served as static assets. */
const isNextFile = (s: string) => s.startsWith("__next") || s.endsWith(".txt");

/**
 * /project/?source=<source> → 301 to /project/<kind>/<rest>/ (one URL per project). /project/<kind>/<rest>/ serves the
 * static facts page with the project's own head and its facts in the HTML (lib/project-ssr.ts); the page's script then
 * loads the same facts live. No public profile or facts → 404, noindex. Responses keep the static page's headers
 * (Pages does not apply _headers to Function responses, so the CSP and frame rules come from the asset response).
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
  if (isNextFile(segs[segs.length - 1])) return ctx.next();

  const static_ = ctx.env.ASSETS ? await ctx.env.ASSETS.fetch(new Request(`${url.origin}/project/`)) : await ctx.next();
  if (static_.status !== 200) return static_;
  const page = await static_.text();
  const respond = (body: string, status: number, cache = "public, max-age=60", extra: Record<string, string> = {}) => {
    const headers = new Headers(static_.headers);
    headers.delete("content-length"); headers.delete("etag");
    headers.set("content-type", "text/html; charset=utf-8"); headers.set("cache-control", cache);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return new Response(method === "HEAD" ? null : body, { status, headers });
  };

  const source = sourceFromProjectPath(url.pathname);
  if (!source) return respond(setHead(page, { title: "Project not found · Registrai", description: "No project with this id.", canonical: builderUrl("project"), noindex: true }), 404);
  if (url.pathname !== projectHref(source)) return Response.redirect(`${url.origin}${projectHref(source)}`, 301);
  const canonical = `${builderUrl("")}${projectHref(source).slice(1)}`;
  const deps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
  const enc = encodeURIComponent(source);
  let state: ReturnType<typeof pageState>;
  try {
    const [p, f] = await Promise.all([
      handlePublicProject(new Request(`${url.origin}/api/projects/${enc}`), ctx.env, source, deps).then(read),
      handlePublicFacts(new Request(`${url.origin}/api/facts/${enc}`), ctx.env, source, deps).then(read),
    ]);
    state = pageState(p, f);
  } catch {
    state = { kind: "error" };
  }
  if (state.kind === "error") return respond(setHead(page, { title: "Project facts · Registrai", description: "Project facts on Arc.", canonical }), 503, "no-store", { "retry-after": "60" });
  if (state.kind !== "ready") return respond(setHead(page, { title: "No public facts · Registrai", description: "No public facts for this project yet.", canonical, noindex: true }), 404);
  const name = projectName(source, state);
  const head = { title: `${name}: facts · Registrai`, description: `On-chain facts about ${name} on Arc, with evidence: who controls it, its contracts and how it is used.`, canonical };
  return respond(injectSummary(setHead(page, head), renderProjectSummary(source, state)), 200);
};
