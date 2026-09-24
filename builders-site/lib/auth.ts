/**
 * Admin sign-in: an allowlisted wallet signs a one-time message (no
 * transaction); the server keeps a 12h session in KV behind an HttpOnly,
 * __Host- cookie.
 *
 *   GET  /api/auth/nonce   -> { nonce }                stateless: no KV write
 *   POST /api/auth/login   { message, signature }      -> { address } + cookie
 *
 * The nonce is base64url(ts | 16 random bytes | HMAC-SHA256(NONCE_SECRET, ts | rand)),
 * ts = issue time in ms (8 bytes, big-endian). Login checks the MAC and that it
 * is at most 5 minutes old; only a SUCCESSFUL login records it in KV
 * (`used-nonce:<n>`, 5 min), which makes it single-use. So an anonymous caller
 * of /api/auth/nonce costs no KV write at all. NONCE_SECRET is a Pages secret;
 * without it both endpoints fail closed with a 500.
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

const usedNonceKey = (n: string) => `used-nonce:${n}`;
const sessionKey = (t: string) => `session:${t}`;
const TOKEN_RE = /^[0-9a-f]{64}$/;

const NONCE_TS_BYTES = 8;
const NONCE_RAND_BYTES = 16;
const NONCE_MAC_BYTES = 32;
const NONCE_BYTES = NONCE_TS_BYTES + NONCE_RAND_BYTES + NONCE_MAC_BYTES;
/** A nonce is accepted this long after it was issued (and this far in the future: clock skew). */
export const NONCE_MAX_AGE_MS = NONCE_TTL_S * 1000;
const NONCE_MAX_SKEW_MS = 60_000;

export const NONCE_SECRET_MISSING = "NONCE_SECRET is not configured on this deployment (wrangler pages secret put NONCE_SECRET)";

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** A fresh stateless nonce (see the header). */
export async function makeNonce(secret: string, nowMs: number): Promise<string> {
  const body = new Uint8Array(NONCE_TS_BYTES + NONCE_RAND_BYTES);
  new DataView(body.buffer).setBigUint64(0, BigInt(Math.floor(nowMs)));
  body.set(crypto.getRandomValues(new Uint8Array(NONCE_RAND_BYTES)), NONCE_TS_BYTES);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), body));
  const out = new Uint8Array(NONCE_BYTES);
  out.set(body, 0);
  out.set(mac, body.length);
  return b64url(out);
}

/** Why a nonce is not acceptable now, or null: its MAC (constant time) and its age. */
export async function nonceProblem(nonce: string, secret: string, nowMs: number): Promise<string | null> {
  const raw = unb64url(nonce);
  if (!raw || raw.length !== NONCE_BYTES) return "unknown nonce; sign in again";
  const body = raw.slice(0, NONCE_TS_BYTES + NONCE_RAND_BYTES);
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), raw.slice(body.length), body);
  if (!ok) return "unknown nonce; sign in again";
  const ts = Number(new DataView(body.buffer).getBigUint64(0));
  if (nowMs - ts > NONCE_MAX_AGE_MS || ts - nowMs > NONCE_MAX_SKEW_MS) return "sign-in nonce expired; sign in again";
  return null;
}

export async function handleNonce(env: Env, nowMs = Date.now()): Promise<Response> {
  if (!env.NONCE_SECRET) return errorJson(500, NONCE_SECRET_MISSING);
  return json({ nonce: await makeNonce(env.NONCE_SECRET, nowMs) });
}

export type LoginResult = { ok: true; address: string } | { ok: false; status: number; error: string };

/**
 * The sign-in checks, in order: canonical message, nonce ours (MAC) and at
 * most 5 minutes old, nonce not used before, origin = this site, issued within
 * 5 minutes, signature recovers to an allowlisted address. Only when all pass
 * is the nonce recorded as used (KV, 5 min): single use, no write otherwise.
 */
export async function verifyLogin(env: Env, body: unknown, nowMs: number): Promise<LoginResult> {
  const fail = (status: number, error: string): LoginResult => ({ ok: false, status, error });
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { message, signature } = b;
  if (typeof message !== "string" || message.length > 1000) return fail(400, "message is required");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return fail(400, "signature must be a 65-byte hex string");
  const login = parseAdminLoginMessage(message);
  if (!login) return fail(400, "not a Registrai admin sign-in message");
  if (!env.NONCE_SECRET) return fail(500, NONCE_SECRET_MISSING);

  const problem = await nonceProblem(login.nonce, env.NONCE_SECRET, nowMs);
  if (problem) return fail(401, problem);
  const key = usedNonceKey(login.nonce);
  if (await env.INVITES.get(key)) return fail(401, "nonce already used; sign in again");

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
  // Single use: recorded only now, at a successful sign-in.
  await env.INVITES.put(key, "1", { expirationTtl: NONCE_TTL_S });
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
