/**
 * GET /api/proof?source=<canonical source> — a project's proof file read
 * server-side (a browser may not read a domain's file: CORS), with the rules
 * in src/lib/proof-fetch.ts: https only, source-grammar hosts only (never an
 * IP literal or localhost), same-scheme redirects to such hosts only (≤ 3
 * hops), ≤ 20 KB, 8 s, the cache-buster upstream.
 *
 * Always the file's TEXT (or a structured error), never a verdict: the page
 * validates it with validateProof. The edge keeps each answer 60 s under a key
 * made of the canonical source alone, so extra query parameters cannot make
 * it fetch again.
 *
 *   200 { service, source, ok: true, text, url }
 *   200 { service, source, ok: false, error: missing | invalid-json | unreachable | too-large, detail, url? }
 *   400 { service, source, ok: false, error: "unreachable", detail }   not a source this site reads
 */
import { PROOF_CACHE_S, PROOF_SERVICE, proofApiSource, proofCacheKey, readProofServerSide } from "../../src/lib/proof-fetch";
import { edgeCache, json } from "./http";

export interface ProofHandlerDeps {
  fetchImpl?: typeof fetch;
  cache?: Cache | null;
  waitUntil?: (p: Promise<unknown>) => void;
  now?: number;
}

export async function handleProof(req: Request, deps: ProofHandlerDeps = {}): Promise<Response> {
  const source = proofApiSource(req.url);
  if (!source) {
    const raw = new URL(req.url).searchParams.get("source") ?? "";
    return json(
      { service: PROOF_SERVICE, source: raw.slice(0, 200), ok: false, error: "unreachable", detail: "not a GitHub repo or a public domain" },
      400,
      { "cache-control": "public, max-age=300" },
    );
  }
  const cache = deps.cache === undefined ? edgeCache() : deps.cache;
  const key = new Request(proofCacheKey(req.url, source), { method: "GET" });
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;
  const read = await readProofServerSide(source, { fetchImpl: deps.fetchImpl, now: deps.now });
  const res = json({ service: PROOF_SERVICE, source, ...read }, 200, { "cache-control": `public, max-age=${PROOF_CACHE_S}` });
  if (cache) {
    const put = cache.put(key, res.clone());
    if (deps.waitUntil) deps.waitUntil(put);
    else await put;
  }
  return res;
}
