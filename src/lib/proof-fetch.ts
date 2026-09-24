/**
 * Reading a project's proof file (spec docs/superpowers/specs/
 * 2026-09-24-verified-builders-design.md), shared by the builders site's
 * server-side proof check (builders-site/lib/proof.ts, GET /api/proof) and the
 * browser (the gallery overlay, /verify's "check it's live", /admin).
 *
 * A browser may not read a domain's proof (CORS), so the pages ask
 * builder.registrai.cc's GET /api/proof?source=<canonical source>, which reads
 * it server-side with the rules below, and fall back to a direct fetch where
 * that API does not exist (registrai.cc, a local static build). Either way the
 * page gets the file's TEXT and validates it itself (parseProofText +
 * validateProof): the server never vouches for a proof.
 *
 * The fetch rules (the server applies all of them; a direct browser fetch gets
 * what the browser allows):
 *   - https only; the host passes the site's source grammar (normalizeSource),
 *     never an IP literal or localhost
 *   - no redirects except same-scheme https to a host that also passes, at
 *     most PROOF_MAX_REDIRECTS hops
 *   - at most PROOF_MAX_BYTES, within PROOF_TIMEOUT_MS
 *   - the freshProofUrl cache-buster on the request
 *
 * Pure except createProofReader's reader, which takes its fetch as an argument.
 * RELATIVE IMPORTS ONLY: wrangler bundles this file into the Pages Functions.
 */
import { freshProofUrl, normalizeSource, proofUrl } from "./verified-builders";

export const PROOF_MAX_BYTES = 20 * 1024;
export const PROOF_TIMEOUT_MS = 8_000;
export const PROOF_MAX_REDIRECTS = 3;
/** The edge keeps a /api/proof answer this long (seconds). */
export const PROOF_CACHE_S = 60;
/** GET /api/proof says this, so a page can tell the API from a static 404 page. */
export const PROOF_SERVICE = "registrai-proof";
export const PROOF_API_PATH = "/api/proof";

/** Why a proof could not be read. `missing` = 404 / 410; `unreachable` = anything else (network, 5xx, 429, a refused redirect, a timeout). */
export type ProofReadError = "missing" | "invalid-json" | "unreachable" | "too-large";

export type ProofRead =
  | { ok: true; text: string; url: string }
  | { ok: false; error: ProofReadError; detail: string; url?: string };

/** GET /api/proof's body. */
export type ProofApiBody = ProofRead & { service: typeof PROOF_SERVICE; source: string };

const LOCAL = /(^|\.)localhost$/;

/** A host a proof may be read from: the source grammar's, never localhost or an IP literal. */
export function proofHostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  if (!h || LOCAL.test(h) || h === "127.0.0.1" || /^[\d.]+$/.test(h) || h.includes(":") || h.includes("[")) return false;
  return normalizeSource(`domain:${h}`) === `domain:${h}`;
}

/** A URL a proof may be read from (the first request, or a redirect's target). */
export function proofUrlAllowed(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && proofHostAllowed(u.hostname);
}

/**
 * The canonical source a /api/proof request asks for (its `source` query
 * parameter, normalised), or null when it is not one the server reads:
 * not a source, or a local test host.
 */
export function proofApiSource(requestUrl: string): string | null {
  let raw: string | null;
  try {
    raw = new URL(requestUrl).searchParams.get("source");
  } catch {
    return null;
  }
  const source = raw ? normalizeSource(raw) : null;
  if (!source) return null;
  if (source.startsWith("domain:") && !proofHostAllowed(source.slice(7))) return null;
  return source;
}

/** The edge cache key for a /api/proof request: the canonical source only (other query parameters ignored). */
export function proofCacheKey(requestUrl: string, source: string): string {
  const u = new URL(requestUrl);
  return `${u.origin}${PROOF_API_PATH}?source=${encodeURIComponent(source)}`;
}

/** Read at most `max` bytes of a body; null when it is longer. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) {
    const b = new Uint8Array(await res.arrayBuffer());
    return b.length > max ? null : b;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The file's text as a ProofRead, once a 2xx response arrived. */
async function bodyRead(res: Response, url: string, maxBytes: number): Promise<ProofRead> {
  const bytes = await readCapped(res, maxBytes);
  if (!bytes) return { ok: false, error: "too-large", detail: `larger than ${maxBytes} bytes`, url };
  const text = new TextDecoder().decode(bytes);
  try {
    JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid-json", detail: "the file is not valid JSON", url };
  }
  return { ok: true, text, url };
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * Server side (GET /api/proof): read a canonical source's proof with every
 * rule in the header. Redirects are followed by hand (`redirect: "manual"`),
 * each target checked before it is requested.
 */
export async function readProofServerSide(
  source: string,
  o: { fetchImpl?: typeof fetch; now?: number; timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<ProofRead> {
  const f = o.fetchImpl ?? fetch;
  let url: string;
  try {
    url = proofUrl(source);
  } catch {
    return { ok: false, error: "unreachable", detail: "not a canonical source" };
  }
  const first = url;
  if (!proofUrlAllowed(url)) return { ok: false, error: "unreachable", detail: `refused to read ${url}`, url: first };
  const signal = AbortSignal.timeout(o.timeoutMs ?? PROOF_TIMEOUT_MS);
  let target = freshProofUrl(url, o.now);
  const maxRedirects = o.maxRedirects ?? PROOF_MAX_REDIRECTS;
  try {
    for (let hop = 0; ; hop++) {
      const res = await f(target, {
        redirect: "manual",
        signal,
        headers: { accept: "application/json", "user-agent": "registrai-proof-check (+https://builder.registrai.cc)" },
      });
      if (REDIRECT.has(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, error: "unreachable", detail: `HTTP ${res.status} without a Location`, url: first };
        if (hop >= maxRedirects) return { ok: false, error: "unreachable", detail: `more than ${maxRedirects} redirects`, url: first };
        let next: string;
        try {
          next = new URL(loc, target).toString();
        } catch {
          return { ok: false, error: "unreachable", detail: "a redirect to an invalid URL", url: first };
        }
        if (!proofUrlAllowed(next)) return { ok: false, error: "unreachable", detail: `refused a redirect to ${next}`, url: first };
        target = next;
        continue;
      }
      if (res.status === 404 || res.status === 410) return { ok: false, error: "missing", detail: `HTTP ${res.status}`, url: first };
      if (!res.ok) return { ok: false, error: "unreachable", detail: `HTTP ${res.status}`, url: first };
      return await bodyRead(res, first, o.maxBytes ?? PROOF_MAX_BYTES);
    }
  } catch (e) {
    const timedOut = signal.aborted || (e as { name?: string })?.name === "TimeoutError";
    return { ok: false, error: "unreachable", detail: timedOut ? "timed out" : "network error", url: first };
  }
}

/** Pure: GET /api/proof's body, or null when it is not the proof API's (e.g. a static 404 page's JSON). */
export function parseProofApiBody(raw: unknown, source: string): ProofRead | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (b.service !== PROOF_SERVICE || b.source !== source) return null;
  const url = typeof b.url === "string" ? b.url : undefined;
  if (b.ok === true && typeof b.text === "string") return { ok: true, text: b.text, url: url ?? "" };
  if (b.ok === false && (b.error === "missing" || b.error === "invalid-json" || b.error === "unreachable" || b.error === "too-large")) {
    return { ok: false, error: b.error, detail: typeof b.detail === "string" ? b.detail : b.error, ...(url ? { url } : {}) };
  }
  return null;
}

/** Where a read came from: the builders site's API, or the browser itself. */
export type ProofReadVia = "api" | "direct";

/** A read with its origin. */
export type ProofReadResult = ProofRead & { via: ProofReadVia };

/** Browser side, direct: what the browser may read (CORS decides; a blocked read is "unreachable"). */
export async function readProofDirect(source: string, o: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: number } = {}): Promise<ProofRead> {
  let url: string;
  try {
    url = proofUrl(source);
  } catch {
    return { ok: false, error: "unreachable", detail: "not a canonical source" };
  }
  let res: Response;
  try {
    res = await (o.fetchImpl ?? fetch)(freshProofUrl(url, o.now), { cache: "no-store", signal: AbortSignal.timeout(o.timeoutMs ?? PROOF_TIMEOUT_MS) });
  } catch {
    return { ok: false, error: "unreachable", detail: "the browser could not read it (CORS, network or timeout)", url };
  }
  if (res.status === 404 || res.status === 410) return { ok: false, error: "missing", detail: `HTTP ${res.status}`, url };
  if (!res.ok) return { ok: false, error: "unreachable", detail: `HTTP ${res.status}`, url };
  try {
    return await bodyRead(res, url, PROOF_MAX_BYTES);
  } catch {
    return { ok: false, error: "unreachable", detail: "the read was interrupted", url };
  }
}

export interface ProofReader {
  (source: string): Promise<ProofReadResult>;
}

/**
 * A proof reader: GET /api/proof first, a direct fetch when the API is not
 * there. Once one request shows the API missing (a 404 page, not JSON, not
 * the proof service), the reader stops asking it.
 */
export function createProofReader(o: { fetchImpl?: typeof fetch; apiPath?: string | null; timeoutMs?: number } = {}): ProofReader {
  const f = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let apiMissing = o.apiPath === null;
  const apiPath = o.apiPath ?? PROOF_API_PATH;
  return async (source) => {
    if (!apiMissing) {
      try {
        const res = await f(`${apiPath}?source=${encodeURIComponent(source)}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout((o.timeoutMs ?? PROOF_TIMEOUT_MS) + 4_000),
        });
        const json = (res.headers.get("content-type") ?? "").includes("application/json") ? await res.json().catch(() => null) : null;
        const read = json ? parseProofApiBody(json, source) : null;
        if (read) return { ...read, via: "api" };
        // Not the proof service: this host has no API. Stop asking it.
        if (res.status === 404 || !json || (json as { service?: unknown }).service !== PROOF_SERVICE) apiMissing = true;
      } catch {
        // the API did not answer this time: read directly
      }
    }
    return { ...(await readProofDirect(source, { fetchImpl: f, timeoutMs: o.timeoutMs })), via: "direct" };
  };
}

/** The browser's shared reader (one API probe per page load). */
let shared: ProofReader | null = null;
export function browserProofReader(): ProofReader {
  shared ??= createProofReader();
  return shared;
}
