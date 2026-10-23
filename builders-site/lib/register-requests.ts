/**
 * "Register it for me": a builder without gas on the builders network asks the
 * Registrai Safe to register a claim it has already signed and published.
 *
 *   POST /api/register-requests {source}      public (same-origin JSON only)
 *   GET  /api/admin/register-requests          the open requests (admin session)
 *   DELETE /api/admin/register-requests?source= dismiss one (admin session)
 *
 * The request carries no authority: the proof does. A request is stored only
 * when the source's proof file is readable right now and valid for the wallet
 * it names (claim.builder), so a stranger cannot queue a claim nobody signed,
 * and /admin re-checks every proof before it builds the Safe batch. One record
 * per source (the newest valid claim wins), kept REQUEST_TTL_S.
 */
import mainnet from "../../src/lib/deployments/arc-mainnet.json";
import { readProofServerSide } from "../../src/lib/proof-fetch";
import { normalizeSource, validateProof } from "../../src/lib/verified-builders";
import type { Env, KV } from "./env";
import { csrfFailure, errorJson, json, readJson, siteOrigin } from "./http";

export const REQUEST_PREFIX = "regreq:";
/** Requests expire after 60 days; the builder can ask again. */
export const REQUEST_TTL_S = 60 * 24 * 3600;
/** A request body is tiny: `{source}`. */
export const REQUEST_MAX_BODY = 512;
/** The same source and wallet asking again within this long is not written again. */
export const REQUEST_DEBOUNCE_MS = 10 * 60_000;

export interface RegisterRequest {
  /** Canonical source. */
  source: string;
  /** claim.builder of the proof that was valid when the request was made (lowercase). */
  builder: string;
  requestedAt: string;
}

const key = (source: string) => `${REQUEST_PREFIX}${source}`;

/**
 * The builders network's chain, as src/lib/builders-network.ts picks it (Arc
 * mainnet once its BuilderRegistry is recorded, else testnet). Not imported
 * from there: that module reads process.env, which the Workers runtime lacks.
 */
export const BUILDERS_CHAIN_ID = /^0x[0-9a-fA-F]{40}$/.test(String(mainnet.builders?.BuilderRegistry ?? "")) ? mainnet.chainId : 5042002;

function parseRequest(raw: unknown): RegisterRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.source !== "string" || typeof r.builder !== "string" || typeof r.requestedAt !== "string") return null;
  if (!/^0x[0-9a-f]{40}$/.test(r.builder)) return null;
  return { source: r.source, builder: r.builder, requestedAt: r.requestedAt };
}

export interface RegisterRequestDeps {
  /** The proof file's text, or null when it cannot be read (default: readProofServerSide). */
  readProof?: (source: string) => Promise<string | null>;
  chainId?: number;
  now?: number;
}

async function defaultReadProof(source: string): Promise<string | null> {
  const r = await readProofServerSide(source);
  return r.ok ? r.text : null;
}

/** POST /api/register-requests */
export async function handleRegisterRequest(req: Request, env: Env, deps: RegisterRequestDeps = {}): Promise<Response> {
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  if (Number(req.headers.get("content-length") ?? "0") > REQUEST_MAX_BODY) return errorJson(413, "request too large");
  const body = await readJson(req);
  const raw = (body as { source?: unknown } | undefined)?.source;
  if (typeof raw !== "string" || raw.length > 300) return errorJson(400, "source missing");
  const source = normalizeSource(raw);
  if (!source) return errorJson(400, "not a GitHub repo or a domain");

  const text = await (deps.readProof ?? defaultReadProof)(source);
  if (text === null) return errorJson(422, "No proof file is readable for this project yet. Publish it (step 4), then ask again.");
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return errorJson(422, "The proof file is not valid JSON.");
  }
  const claimed = (file as { claim?: { builder?: unknown } } | null)?.claim?.builder;
  if (typeof claimed !== "string") return errorJson(422, "The proof file does not name a builder wallet.");
  const check = await validateProof(file, { expectedSource: source, onchainOwner: claimed, chainId: deps.chainId ?? BUILDERS_CHAIN_ID });
  if (!check.valid) return errorJson(422, `The proof does not check out: ${check.reason}`);

  const builder = check.claim.builder.toLowerCase();
  const nowMs = deps.now ?? Date.now();
  const prev = parseRequest(safeParse(await env.INVITES.get(key(source))));
  if (prev && prev.builder === builder) {
    const age = nowMs - Date.parse(prev.requestedAt);
    if (Number.isFinite(age) && age >= 0 && age < REQUEST_DEBOUNCE_MS) return json({ ok: true, source, builder, requestedAt: prev.requestedAt });
  }
  const record: RegisterRequest = { source, builder, requestedAt: new Date(nowMs).toISOString() };
  await env.INVITES.put(key(source), JSON.stringify(record), { expirationTtl: REQUEST_TTL_S, metadata: record });
  return json({ ok: true, ...record });
}

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Every open request, oldest first. */
export async function listRegisterRequests(kv: KV): Promise<RegisterRequest[]> {
  const out: RegisterRequest[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list<RegisterRequest>({ prefix: REQUEST_PREFIX, cursor });
    for (const k of page.keys) {
      const r = parseRequest(k.metadata) ?? parseRequest(safeParse(await kv.get(k.name)));
      if (r) out.push(r);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/** GET / DELETE /api/admin/register-requests (the middleware has checked the session and CSRF). */
export async function handleAdminRegisterRequests(req: Request, env: Env): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method === "GET") return json({ requests: await listRegisterRequests(env.INVITES) });
  if (method === "DELETE") {
    const source = normalizeSource(new URL(req.url).searchParams.get("source") ?? "");
    if (!source) return errorJson(400, "source missing");
    await env.INVITES.delete(key(source));
    return json({ deleted: source });
  }
  return errorJson(405, "method not allowed");
}
