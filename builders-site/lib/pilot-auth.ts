/**
 * ABI points pilot sign-in: the builder site's nonce + personal_sign pattern
 * (lib/auth.ts), with its own session. The admin session is restricted to the
 * admin / onboarder allowlists, so the pilot has a separate, stateless one:
 *
 *   GET    /api/pilot/auth   -> { nonce }            stateless (NONCE_SECRET), no write
 *   POST   /api/pilot/auth   { message, signature }  -> { address, regi } + cookie
 *   DELETE /api/pilot/auth                           -> 204, cookie cleared
 *
 * Cookie __Host-rb_pilot = "<wallet>.<exp>.<mac>", mac = HMAC-SHA256(PILOT_SESSION_SECRET,
 * "abi-pilot|<wallet>|<exp>"), HttpOnly, Secure, SameSite=Strict, 12 h. Mutating calls pass
 * the same CSRF checks as /api/admin (JSON body + Origin = SITE_ORIGIN). A nonce is single
 * use: recorded in D1 (used_nonces) by an INSERT … ON CONFLICT DO NOTHING at a successful
 * sign-in only. The REGI balance is read at sign-in (eth_call balanceOf on Arc) and cached
 * on the account row for at most REGI_CACHE_S.
 */
import { recoverMessageAddress, type Hex } from "viem";
import { issuedFresh } from "../../src/lib/builders-admin";
import {
  ARC_RPC_URL,
  BALANCE_OF_SELECTOR,
  PILOT_LIMITS,
  PILOT_SESSION_COOKIE,
  PILOT_SESSION_TTL_S,
  REGI_ADDRESS,
  REGI_CACHE_S,
  REGI_MIN,
  parsePilotLoginMessage,
} from "../../src/lib/abi-pilot-api";
import { RULES } from "../../src/lib/abi-pilot";
import { makeNonce, nonceProblem, NONCE_MAX_AGE_MS, NONCE_SECRET_MISSING } from "./auth";
import { readCapped } from "./builders-index";
import type { D1Database, Env } from "./env";
import { csrfFailure, errorJson, getCookie, json, siteOrigin } from "./http";

export const PILOT_SEASON = 1;
export const PILOT_UNCONFIGURED = "points pilot is not configured";
const SECRET_MIN = 32;
const ADDR_RE = /^0x[0-9a-f]{40}$/;

/** Injectable clock, network and randomness for the handlers (tests). */
export interface PilotDeps {
  now?: () => number;
  fetch?: typeof fetch;
  random?: () => number;
  cache?: Cache | null;
  waitUntil?: (p: Promise<unknown>) => void;
}
export const nowMsOf = (deps: PilotDeps) => (deps.now ?? Date.now)();
export const nowSOf = (deps: PilotDeps) => Math.floor(nowMsOf(deps) / 1000);

// ───────────────────────────── session cookie ─────────────────────────────

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
const sessionPayload = (wallet: string, exp: number) => new TextEncoder().encode(`abi-pilot|${wallet}|${exp}`);

export async function makePilotSession(secret: string, wallet: string, nowS: number): Promise<string> {
  const exp = nowS + PILOT_SESSION_TTL_S;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), sessionPayload(wallet, exp)));
  return `${wallet}.${exp}.${b64url(mac)}`;
}

/** The wallet of a valid, unexpired pilot session token, or null (MAC checked in constant time). */
export async function verifyPilotSession(secret: string, token: string, nowS: number): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [wallet, expS, macS] = parts;
  if (!ADDR_RE.test(wallet) || !/^\d{1,12}$/.test(expS)) return null;
  const exp = Number(expS);
  if (exp <= nowS || exp > nowS + PILOT_SESSION_TTL_S) return null;
  const mac = unb64url(macS);
  if (!mac || mac.length !== 32) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), mac.slice(), sessionPayload(wallet, exp));
  return ok ? wallet : null;
}

const pilotCookie = (token: string) => `${PILOT_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${PILOT_SESSION_TTL_S}`;
const clearPilotCookie = () => `${PILOT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

const secretOk = (env: Env) => (env.PILOT_SESSION_SECRET ?? "").length >= SECRET_MIN;

/** The signed-in pilot wallet (lowercase), or null. */
export async function pilotWallet(req: Request, env: Env, nowS: number): Promise<string | null> {
  if (!secretOk(env)) return null;
  const token = getCookie(req, PILOT_SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  return verifyPilotSession(env.PILOT_SESSION_SECRET!, token, nowS);
}

// ───────────────────────────── rate limits ─────────────────────────────

/** Counts one call in the current one-minute window; true while the count is within `limit` (atomic upsert). */
export async function rateOk(db: D1Database, key: string, limit: number, nowS: number): Promise<boolean> {
  const slot = Math.floor(nowS / 60);
  const r = await db
    .prepare(
      "INSERT INTO rate (k, slot, n) VALUES (?, ?, 1) ON CONFLICT (k) DO UPDATE SET n = CASE WHEN rate.slot = excluded.slot THEN rate.n + 1 ELSE 1 END, slot = excluded.slot RETURNING n",
    )
    .bind(key, slot)
    .first<{ n: number }>();
  return (r?.n ?? 0) <= limit;
}

export const tooMany = () => errorJson(429, "too many requests; wait a minute", {});

// ───────────────────────────── REGI ─────────────────────────────

/** balanceOf(wallet) on REGI through the Arc RPC ≥ 1 REGI. Throws when the RPC does not answer cleanly. */
export async function regiHeld(wallet: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const data = BALANCE_OF_SELECTOR + wallet.slice(2).toLowerCase().padStart(64, "0");
  const res = await fetchFn(ARC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: REGI_ADDRESS, data }, "latest"] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: unknown };
  if (j.error !== undefined || typeof j.result !== "string" || !/^0x[0-9a-fA-F]{0,64}$/.test(j.result)) throw new Error("rpc: bad answer");
  const v = j.result === "0x" ? 0n : BigInt(j.result);
  return v >= REGI_MIN;
}

export interface AccountRow {
  wallet: string;
  balance: number;
  season: number;
  created: number;
  regi_ok: number;
  regi_checked: number;
}

export async function getAccount(db: D1Database, wallet: string): Promise<AccountRow | null> {
  return db.prepare("SELECT wallet, balance, season, created, regi_ok, regi_checked FROM accounts WHERE wallet = ?").bind(wallet).first<AccountRow>();
}

/** The wallet's account, created with the starting balance on first use (once per wallet per season). */
export async function ensureAccount(db: D1Database, wallet: string, nowS: number): Promise<AccountRow> {
  const a = await getAccount(db, wallet);
  if (a) return a;
  await db
    .prepare("INSERT INTO accounts (wallet, balance, season, created, regi_ok, regi_checked) VALUES (?, ?, ?, ?, 0, 0) ON CONFLICT (wallet) DO NOTHING")
    .bind(wallet, RULES.startBalance, PILOT_SEASON, nowS)
    .run();
  return (await getAccount(db, wallet))!;
}

/**
 * The REGI gate for `wallet`: the cached answer while it is at most REGI_CACHE_S old, else a fresh
 * balanceOf (stored on the row). `null` = unknown (the RPC failed and the cache is stale).
 */
export async function regiStatus(db: D1Database, acct: AccountRow, nowS: number, deps: PilotDeps): Promise<boolean | null> {
  if (acct.regi_checked > 0 && nowS - acct.regi_checked <= REGI_CACHE_S) return acct.regi_ok === 1;
  let ok: boolean;
  try {
    ok = await regiHeld(acct.wallet, deps.fetch ?? fetch);
  } catch {
    return null;
  }
  await db.prepare("UPDATE accounts SET regi_ok = ?, regi_checked = ? WHERE wallet = ?").bind(ok ? 1 : 0, nowS, acct.wallet).run();
  acct.regi_ok = ok ? 1 : 0;
  acct.regi_checked = nowS;
  return ok;
}

// ───────────────────────────── handlers ─────────────────────────────

export async function handlePilotNonce(env: Env, deps: PilotDeps = {}): Promise<Response> {
  if (!env.NONCE_SECRET) return errorJson(500, NONCE_SECRET_MISSING);
  return json({ nonce: await makeNonce(env.NONCE_SECRET, nowMsOf(deps)) });
}

export async function handlePilotLogin(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  const db = env.PILOT_DB;
  if (!db || !secretOk(env)) return errorJson(503, PILOT_UNCONFIGURED);
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  if (!env.NONCE_SECRET) return errorJson(500, NONCE_SECRET_MISSING);
  const nowMs = nowMsOf(deps), nowS = Math.floor(nowMs / 1000);
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  if (!(await rateOk(db, `login:${ip}`, PILOT_LIMITS.loginsPerMin, nowS))) return tooMany();

  const text = await readCapped(req, 4096);
  let body: unknown;
  try {
    body = JSON.parse(text ?? "");
  } catch {
    return errorJson(400, "body must be JSON");
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { message, signature } = b;
  if (typeof message !== "string" || message.length > 1000) return errorJson(400, "message is required");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return errorJson(400, "signature must be a 65-byte hex string");
  const login = parsePilotLoginMessage(message);
  if (!login) return errorJson(400, "not a points pilot sign-in message");
  const problem = await nonceProblem(login.nonce, env.NONCE_SECRET, nowMs);
  if (problem) return errorJson(401, problem);
  const origin = siteOrigin(env);
  if (!origin || login.origin !== origin) return errorJson(401, `message is for ${login.origin}, this site is ${origin || "(SITE_ORIGIN unset)"}`);
  if (!issuedFresh(login.issued, nowMs)) return errorJson(401, "sign-in message expired; sign in again");
  let wallet: string;
  try {
    wallet = (await recoverMessageAddress({ message, signature: signature as Hex })).toLowerCase();
  } catch {
    return errorJson(401, "bad signature");
  }
  // Single use, recorded only at a successful sign-in (atomic: a replay inserts nothing).
  const used = await db
    .prepare("INSERT INTO used_nonces (nonce, exp) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING")
    .bind(login.nonce, nowS + Math.ceil(NONCE_MAX_AGE_MS / 1000) + 60)
    .run();
  if (used.meta.changes !== 1) return errorJson(401, "nonce already used; sign in again");

  const acct = await ensureAccount(db, wallet, nowS);
  acct.regi_checked = 0; // always a fresh balanceOf at sign-in
  const regi = await regiStatus(db, acct, nowS, deps);
  const token = await makePilotSession(env.PILOT_SESSION_SECRET!, wallet, nowS);
  return json({ address: wallet, regi }, 200, { "set-cookie": pilotCookie(token) });
}

export async function handlePilotLogout(req: Request, env: Env): Promise<Response> {
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  return new Response(null, { status: 204, headers: { "set-cookie": clearPilotCookie(), "cache-control": "no-store" } });
}
