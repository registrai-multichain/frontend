/**
 * Admin sign-in: an allowlisted wallet signs a one-time message (no
 * transaction); the server keeps a 12h session in KV behind an HttpOnly,
 * __Host- cookie.
 *
 *   GET  /api/auth/nonce   -> { nonce }                (KV nonce:<n>, 5 min)
 *   POST /api/auth/login   { message, signature }      -> { address } + cookie
 *   POST /api/auth/logout                              -> 204, cookie cleared
 *   GET  /api/auth/me      -> { service, address | null }
 */
import { recoverMessageAddress, type Hex } from "viem";
import {
  ADMIN_SERVICE,
  NONCE_TTL_S,
  SESSION_COOKIE,
  SESSION_TTL_S,
  issuedFresh,
  parseAdminAllowlist,
  parseAdminLoginMessage,
} from "../../src/lib/builders-admin";
import type { Env } from "./env";
import {
  clearSessionCookie,
  csrfFailure,
  errorJson,
  getCookie,
  isMutating,
  json,
  randomHex,
  readJson,
  sessionCookie,
  siteOrigin,
} from "./http";

const nonceKey = (n: string) => `nonce:${n}`;
const sessionKey = (t: string) => `session:${t}`;
const TOKEN_RE = /^[0-9a-f]{64}$/;

export async function handleNonce(env: Env): Promise<Response> {
  const nonce = randomHex(16);
  await env.INVITES.put(nonceKey(nonce), "1", { expirationTtl: NONCE_TTL_S });
  return json({ nonce });
}

export type LoginResult = { ok: true; address: string } | { ok: false; status: number; error: string };

/**
 * The sign-in checks, in order: canonical message, nonce known (and consumed —
 * single use, whatever happens next), origin = this site, issued within 5
 * minutes, signature recovers to an allowlisted address.
 */
export async function verifyLogin(env: Env, body: unknown, nowMs: number): Promise<LoginResult> {
  const fail = (status: number, error: string): LoginResult => ({ ok: false, status, error });
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { message, signature } = b;
  if (typeof message !== "string" || message.length > 1000) return fail(400, "message is required");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return fail(400, "signature must be a 65-byte hex string");
  const login = parseAdminLoginMessage(message);
  if (!login) return fail(400, "not a Registrai admin sign-in message");

  const key = nonceKey(login.nonce);
  const known = await env.INVITES.get(key);
  if (!known) return fail(401, "unknown or already used nonce; sign in again");
  await env.INVITES.delete(key);

  const origin = siteOrigin(env);
  if (!origin || login.origin !== origin) return fail(401, `message is for ${login.origin}, this site is ${origin || "(SITE_ORIGIN unset)"}`);
  if (!issuedFresh(login.issued, nowMs)) return fail(401, "sign-in message expired; sign in again");

  let signer: string;
  try {
    signer = (await recoverMessageAddress({ message, signature: signature as Hex })).toLowerCase();
  } catch {
    return fail(401, "bad signature");
  }
  if (!parseAdminAllowlist(env.ADMIN_ADDRESSES).has(signer)) return fail(403, `${signer} is not an admin`);
  return { ok: true, address: signer };
}

export async function handleLogin(req: Request, env: Env, nowMs = Date.now()): Promise<Response> {
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  const r = await verifyLogin(env, await readJson(req), nowMs);
  if (!r.ok) return errorJson(r.status, r.error);
  const token = randomHex(32);
  await env.INVITES.put(sessionKey(token), r.address, { expirationTtl: SESSION_TTL_S });
  return json({ address: r.address }, 200, { "set-cookie": sessionCookie(token) });
}

/** The signed-in admin's address, or null (no / unknown / expired session, or no longer allowlisted). */
export async function sessionAddress(req: Request, env: Env): Promise<string | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token || !TOKEN_RE.test(token)) return null;
  const address = await env.INVITES.get(sessionKey(token));
  if (!address) return null;
  return parseAdminAllowlist(env.ADMIN_ADDRESSES).has(address) ? address : null;
}

export async function handleLogout(req: Request, env: Env): Promise<Response> {
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  const token = getCookie(req, SESSION_COOKIE);
  if (token && TOKEN_RE.test(token)) await env.INVITES.delete(sessionKey(token));
  return new Response(null, { status: 204, headers: { "set-cookie": clearSessionCookie(), "cache-control": "no-store" } });
}

export async function handleMe(req: Request, env: Env): Promise<Response> {
  return json({ service: ADMIN_SERVICE, address: await sessionAddress(req, env) });
}

/**
 * /api/admin/* gate: a live session, and for a mutating request the CSRF
 * checks. Returns the admin's address, or the refusal.
 */
export async function adminGate(req: Request, env: Env): Promise<{ address: string } | Response> {
  const address = await sessionAddress(req, env);
  if (!address) return errorJson(401, "sign in first");
  if (isMutating(req.method)) {
    const csrf = csrfFailure(req, siteOrigin(env));
    if (csrf) return errorJson(403, csrf);
  }
  return { address };
}
