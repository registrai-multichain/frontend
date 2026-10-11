/**
 * ABI points pilot sign-in: the builder site's nonce + personal_sign pattern (lib/auth.ts), with its own
 * session. The admin session is restricted to the admin / onboarder allowlists, so the pilot has a separate one:
 *
 *   GET    /api/pilot/auth   -> { nonce }            stateless (NONCE_SECRET), no write
 *   POST   /api/pilot/auth   { message, signature }  -> { address, regi } + cookie
 *   DELETE /api/pilot/auth                           -> 204, every session of the wallet ended
 *
 * Cookie __Host-rb_pilot = "<wallet>.<epoch>.<exp>.<mac>", mac = HMAC-SHA256(PILOT_SESSION_SECRET,
 * "abi-pilot|<wallet>|<epoch>|<exp>"), HttpOnly, Secure, SameSite=Strict, 12 h. A session is valid only while
 * <epoch> equals the account's session_epoch; sign-out bumps it. Mutating calls pass the same CSRF checks as
 * /api/admin. The sign-in message names the wallet; only plain (EOA) signatures that recover to it are accepted
 * (smart-contract wallets are refused). A nonce is single use (D1 used_nonces, written at a successful sign-in).
 *
 * REGI gate (spec §8.4; audit PE-3): balanceOf ≥ PILOT_REGI_MIN REGI (default 1,000,000) at
 * PILOT_REGI_SNAPSHOT_BLOCK (the balance cached permanently per wallet and block, so a changed minimum needs no
 * re-read) AND now (cached ≤ 10 min). An RPC failure is "unknown" (null), never "no REGI", and backs the wallet off
 * the RPC for 30 s. With PILOT_OPEN "1", a missing, malformed, future or pre-REGI snapshot block (or a malformed
 * PILOT_REGI_MIN / PILOT_MAX_LEV) makes the pilot "misconfigured": every order is refused, loudly (audit PE-7).
 */
import { recoverMessageAddress, type Hex } from "viem";
import { issuedFresh } from "../../src/lib/builders-admin";
import {
  ARC_RPC_URL,
  BALANCE_OF_SELECTOR,
  PILOT_LIMITS,
  PILOT_SESSION_COOKIE,
  PILOT_SESSION_TTL_S,
  PILOT_MAX_LEV_DEFAULT,
  REGI_ADDRESS,
  REGI_CACHE_S,
  REGI_DEPLOY_BLOCK,
  REGI_MIN_DEFAULT,
  REGI_UNIT,
  parsePilotLoginMessage,
  type RegiView,
} from "../../src/lib/abi-pilot-api";
import { RULES } from "../../src/lib/abi-pilot";
import { makeNonce, nonceProblem, NONCE_MAX_AGE_MS, NONCE_SECRET_MISSING } from "./auth";
import { readCapped } from "./builders-index";
import type { D1Database, Env } from "./env";
import { csrfFailure, errorJson, getCookie, json, siteOrigin } from "./http";
import { SQL } from "./pilot-sql";

export const PILOT_SEASON = 1;
export const PILOT_UNCONFIGURED = "points pilot is not configured";
export const SMART_WALLET = "Smart-contract wallets aren't supported yet";
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

/** PILOT_REGI_SNAPSHOT_BLOCK as a block number, or null (unset / not a block number). */
export function snapshotBlock(env: Env): number | null {
  const s = (env.PILOT_REGI_SNAPSHOT_BLOCK ?? "").trim();
  return /^\d{1,15}$/.test(s) ? Number(s) : null;
}

/** PILOT_REGI_MIN in whole REGI (unset: REGI_MIN_DEFAULT), or null when it is not a positive integer. */
export function regiMinOf(env: Env): number | null {
  const s = (env.PILOT_REGI_MIN ?? "").trim();
  if (s === "") return REGI_MIN_DEFAULT;
  return /^\d{1,12}$/.test(s) && Number(s) >= 1 ? Number(s) : null;
}

/** PILOT_MAX_LEV as a raw number (unset: PILOT_MAX_LEV_DEFAULT), or null when it is not an integer ≥ 1. */
function maxLevSetting(env: Env): number | null {
  const s = (env.PILOT_MAX_LEV ?? "").trim();
  if (s === "") return PILOT_MAX_LEV_DEFAULT;
  return /^\d{1,4}$/.test(s) && Number(s) >= 1 ? Number(s) : null;
}
/** The pilot's leverage cap as a level of RULES.levels (the highest at or under PILOT_MAX_LEV); 1 when it is invalid. */
export function pilotMaxLev(env: Env): number {
  const n = maxLevSetting(env) ?? 1;
  return RULES.levels.filter((l) => l <= n).pop() ?? 1;
}

/** PILOT_BLOCKED_WALLETS: wallets that may not open positions (audit F4: milestone recorders). */
export function blockedWallet(env: Env, wallet: string): boolean {
  const list = (env.PILOT_BLOCKED_WALLETS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return list.includes(wallet.toLowerCase());
}

/**
 * Why the pilot is misconfigured (PILOT_OPEN "1" only), or null. head: the latest Arc block known (the mark row's);
 * null skips the future-block check (it can't be told yet).
 */
export function pilotProblem(env: Env, head: number | null): string | null {
  if ((env.PILOT_OPEN ?? "").trim() !== "1") return null;
  const raw = (env.PILOT_REGI_SNAPSHOT_BLOCK ?? "").trim();
  const b = snapshotBlock(env);
  if (raw === "") return "PILOT_REGI_SNAPSHOT_BLOCK is empty";
  if (b === null) return `PILOT_REGI_SNAPSHOT_BLOCK is not a block number (${raw.slice(0, 40)})`;
  if (b < REGI_DEPLOY_BLOCK) return `PILOT_REGI_SNAPSHOT_BLOCK ${b} is before REGI existed (block ${REGI_DEPLOY_BLOCK})`;
  if (head !== null && b > head) return `PILOT_REGI_SNAPSHOT_BLOCK ${b} is in the future (head ${head})`;
  if (regiMinOf(env) === null) return `PILOT_REGI_MIN is not a positive whole number of REGI (${(env.PILOT_REGI_MIN ?? "").slice(0, 40)})`;
  if (maxLevSetting(env) === null) return `PILOT_MAX_LEV is not an integer ≥ 1 (${(env.PILOT_MAX_LEV ?? "").slice(0, 40)})`;
  return null;
}

const logged = new Set<string>();
export type PilotState = "closed" | "open" | "misconfigured";
/**
 * closed: the kill switch is off. misconfigured: it is on but a setting is wrong (every order is refused, and the
 * reason is logged once per isolate). open: new orders accepted.
 */
export function pilotState(env: Env, head: number | null): PilotState {
  if ((env.PILOT_OPEN ?? "").trim() !== "1") return "closed";
  const problem = pilotProblem(env, head);
  if (problem === null) return "open";
  if (!logged.has(problem)) {
    logged.add(problem);
    console.error(`pilot misconfigured: ${problem}; every order is refused`);
  }
  return "misconfigured";
}

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
const sessionPayload = (wallet: string, epoch: number, exp: number) => new TextEncoder().encode(`abi-pilot|${wallet}|${epoch}|${exp}`);

export async function makePilotSession(secret: string, wallet: string, epoch: number, nowS: number): Promise<string> {
  const exp = nowS + PILOT_SESSION_TTL_S;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), sessionPayload(wallet, epoch, exp)));
  return `${wallet}.${epoch}.${exp}.${b64url(mac)}`;
}

/** The wallet and epoch of a well-formed, unexpired token with a valid MAC (constant time), or null. The epoch is checked by pilotWallet. */
export async function verifyPilotSession(secret: string, token: string, nowS: number): Promise<{ wallet: string; epoch: number } | null> {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [wallet, epochS, expS, macS] = parts;
  if (!ADDR_RE.test(wallet) || !/^\d{1,9}$/.test(epochS) || !/^\d{1,12}$/.test(expS)) return null;
  const epoch = Number(epochS), exp = Number(expS);
  if (exp <= nowS || exp > nowS + PILOT_SESSION_TTL_S) return null;
  const mac = unb64url(macS);
  if (!mac || mac.length !== 32) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), mac.slice(), sessionPayload(wallet, epoch, exp));
  return ok ? { wallet, epoch } : null;
}

const pilotCookie = (token: string) => `${PILOT_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${PILOT_SESSION_TTL_S}`;
const clearPilotCookie = () => `${PILOT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

const secretOk = (env: Env) => (env.PILOT_SESSION_SECRET ?? "").length >= SECRET_MIN;

export async function sessionOf(req: Request, env: Env, nowS: number): Promise<{ wallet: string; epoch: number } | null> {
  if (!secretOk(env)) return null;
  const token = getCookie(req, PILOT_SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  return verifyPilotSession(env.PILOT_SESSION_SECRET!, token, nowS);
}

/** The signed-in pilot wallet (lowercase), or null: a valid token whose epoch is the account's current one. */
export async function pilotWallet(req: Request, env: Env, nowS: number): Promise<string | null> {
  const s = await sessionOf(req, env, nowS);
  if (!s || !env.PILOT_DB) return null;
  const row = await env.PILOT_DB.prepare("SELECT session_epoch FROM accounts WHERE wallet = ?").bind(s.wallet).first<{ session_epoch: number }>();
  return row && row.session_epoch === s.epoch ? s.wallet : null;
}

// ───────────────────────────── rate limits ─────────────────────────────

/** Counts one call in the current one-minute window; true while the count is within `limit` (atomic upsert). */
export async function rateOk(db: D1Database, key: string, limit: number, nowS: number): Promise<boolean> {
  const r = await db.prepare(SQL.rateHit).bind(key, Math.floor(nowS / 60)).first<{ n: number }>();
  return (r?.n ?? 0) <= limit;
}

export const tooMany = () => errorJson(429, "too many requests; wait a minute");

// ───────────────────────────── REGI ─────────────────────────────

/** balanceOf(wallet) on REGI through the Arc RPC (raw units), at `block` (default latest). Throws when the RPC does not answer cleanly. */
export async function regiBalance(wallet: string, fetchFn: typeof fetch = fetch, block?: number): Promise<bigint> {
  const data = BALANCE_OF_SELECTOR + wallet.slice(2).toLowerCase().padStart(64, "0");
  const tag = block === undefined ? "latest" : `0x${block.toString(16)}`;
  const res = await fetchFn(ARC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: REGI_ADDRESS, data }, tag] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: unknown };
  if (j.error !== undefined || typeof j.result !== "string" || !/^0x[0-9a-fA-F]{0,64}$/.test(j.result)) throw new Error("rpc: bad answer");
  return j.result === "0x" ? 0n : BigInt(j.result);
}
/** Whole REGI (floored), as stored in accounts.regi_snap. */
const wholeRegi = (raw: bigint) => Number(raw / REGI_UNIT > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : raw / REGI_UNIT);

export interface AccountRow {
  wallet: string;
  balance: number;
  season: number;
  created: number;
  regi_ok: number;
  regi_checked: number;
  /** Whole REGI held at regi_snap_block (floored); migration 0001's comment predates this (it was 0/1 for ≥ 1 REGI). */
  regi_snap: number | null;
  regi_snap_block: number | null;
  regi_retry_at: number;
  session_epoch: number;
}

const ACCOUNT_COLS = "wallet, balance, season, created, regi_ok, regi_checked, regi_snap, regi_snap_block, regi_retry_at, session_epoch";

export async function getAccount(db: D1Database, wallet: string): Promise<AccountRow | null> {
  return db.prepare(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE wallet = ?`).bind(wallet).first<AccountRow>();
}

/** The wallet's account, created with the starting balance on first use (once per wallet per season). */
export async function ensureAccount(db: D1Database, wallet: string, nowS: number): Promise<AccountRow> {
  const a = await getAccount(db, wallet);
  if (a) return a;
  await db
    .prepare("INSERT INTO accounts (wallet, balance, season, created) VALUES (?, ?, ?, ?) ON CONFLICT (wallet) DO NOTHING")
    .bind(wallet, RULES.startBalance, PILOT_SEASON, nowS)
    .run();
  return (await getAccount(db, wallet))!;
}

/**
 * The REGI gate for an account: the snapshot answer (the whole-REGI balance at the snapshot block, permanent per
 * block) and the current balance (≤ REGI_CACHE_S old), each from the cache or the RPC, against PILOT_REGI_MIN.
 * ok = both true; false if either is false; else null. During the 30 s back-off after an RPC failure nothing stale is
 * re-read (it stays null).
 */
export async function regiStatus(db: D1Database, acct: AccountRow, env: Env, nowS: number, deps: PilotDeps, opts: { forceNow?: boolean } = {}): Promise<RegiView> {
  const f = deps.fetch ?? fetch;
  const snapBlock = snapshotBlock(env);
  const minWhole = regiMinOf(env) ?? REGI_MIN_DEFAULT;
  const min = BigInt(minWhole) * REGI_UNIT;
  const backoff = acct.regi_retry_at > nowS;
  let snapshot: boolean | null = null, now: boolean | null = null, failed = false;
  if (snapBlock !== null) {
    if (acct.regi_snap !== null && acct.regi_snap_block === snapBlock) snapshot = acct.regi_snap >= minWhole;
    else if (!backoff) {
      try {
        const held = await regiBalance(acct.wallet, f, snapBlock);
        snapshot = held >= min;
        await db.prepare("UPDATE accounts SET regi_snap = ?, regi_snap_block = ? WHERE wallet = ?").bind(wholeRegi(held), snapBlock, acct.wallet).run();
        acct.regi_snap = wholeRegi(held);
        acct.regi_snap_block = snapBlock;
      } catch {
        failed = true;
      }
    }
  }
  const cached = !opts.forceNow && acct.regi_checked > 0 && nowS - acct.regi_checked <= REGI_CACHE_S;
  if (cached) now = acct.regi_ok === 1;
  else if (!backoff && !failed && snapshot !== false) {
    try {
      now = (await regiBalance(acct.wallet, f)) >= min;
      await db.prepare("UPDATE accounts SET regi_ok = ?, regi_checked = ? WHERE wallet = ?").bind(now ? 1 : 0, nowS, acct.wallet).run();
      acct.regi_ok = now ? 1 : 0;
      acct.regi_checked = nowS;
    } catch {
      failed = true;
    }
  }
  if (failed) {
    acct.regi_retry_at = nowS + PILOT_LIMITS.regiRetryS;
    await db.prepare("UPDATE accounts SET regi_retry_at = ? WHERE wallet = ?").bind(acct.regi_retry_at, acct.wallet).run();
  }
  const ok = snapshot === false || now === false ? false : snapshot === true && now === true ? true : null;
  return { ok, snapshot, now };
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

  const text = await readCapped(req, 8192);
  let body: unknown;
  try {
    body = JSON.parse(text ?? "");
  } catch {
    return errorJson(400, "body must be JSON");
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const { message, signature } = b;
  if (typeof message !== "string" || message.length > 1000) return errorJson(400, "message is required");
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return errorJson(400, "signature must be hex");
  // ERC-1271 / ERC-6492 signatures are longer than 65 bytes; only plain (EOA, incl. EIP-7702) signatures are accepted
  if (signature.length !== 132) return errorJson(400, SMART_WALLET);
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
  // a smart account's owner key signs for it: the signature then recovers to a different address
  if (wallet !== login.address) return errorJson(401, SMART_WALLET);
  const used = await db.prepare(SQL.nonceUse).bind(login.nonce, nowS + Math.ceil(NONCE_MAX_AGE_MS / 1000) + 60).run();
  if (used.meta.changes !== 1) return errorJson(401, "nonce already used; sign in again");

  const acct = await ensureAccount(db, wallet, nowS);
  // a misconfigured pilot (audit PE-7) reads no REGI: the account view says so instead
  const regi = pilotState(env, null) === "misconfigured" ? null : await regiStatus(db, acct, env, nowS, deps, { forceNow: true });
  const token = await makePilotSession(env.PILOT_SESSION_SECRET!, wallet, acct.session_epoch, nowS);
  return json({ address: wallet, regi }, 200, { "set-cookie": pilotCookie(token) });
}

/** Sign-out: bumps the wallet's session epoch (every session of it ends), then clears the cookie. */
export async function handlePilotLogout(req: Request, env: Env, deps: PilotDeps = {}): Promise<Response> {
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  const nowS = nowSOf(deps);
  const wallet = await pilotWallet(req, env, nowS);
  if (wallet && env.PILOT_DB) await env.PILOT_DB.prepare(SQL.sessionBump).bind(wallet).run();
  return new Response(null, { status: 204, headers: { "set-cookie": clearPilotCookie(), "cache-control": "no-store" } });
}
