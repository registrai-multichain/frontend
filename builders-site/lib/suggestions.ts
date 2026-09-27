/**
 * Public project suggestions (spec: src/lib/suggestions.ts).
 *
 *   POST   /api/suggestions                  public (same-origin JSON only), wallet-signed, rate-limited
 *   GET    /api/admin/suggestions            every open suggestion, most suggested first
 *   DELETE /api/admin/suggestions?source=    dismiss one
 *
 * One KV record per project (`suggest:<source>`), kept SUGGEST_TTL_S after its
 * latest suggestion. The first suggestion's details stand; later ones only fill
 * fields still empty, so nobody can overwrite a good suggestion with junk.
 *
 * Friction against spam: the suggester signs the suggestion with a wallet
 * (suggestionMessage, EIP-191, free), the signature must be fresh, the wallet must
 * have sent at least one transaction on Arc mainnet (a throwaway wallet needs gas
 * first), and each wallet and each IP is rate-limited. The count is of distinct
 * wallets; IPs are only ever stored as keyed hashes, for the rate limit. A
 * suggestion carries no authority: /admin decides whether to invite.
 */
import { isAddress, verifyMessage, type Address, type Hex } from "viem";
import { inviteKey } from "../../src/lib/builders-admin";
import { suggestionMessage, validateSuggestion, type AdminSuggestion } from "../../src/lib/suggestions";
import { normalizeSource } from "../../src/lib/verified-builders";
import type { Env, KV } from "./env";
import { csrfFailure, errorJson, json, siteOrigin } from "./http";

export const SUGGEST_PREFIX = "suggest:";
const RATE_PREFIX = "suggest-rl:";
const WALLET_PREFIX = "suggest-wl:";
/** A suggestion is dropped 90 days after it was last made. */
export const SUGGEST_TTL_S = 90 * 24 * 3600;
export const SUGGEST_MAX_BODY = 2048;
/** Suggestions one visitor may send per hour. */
export const SUGGEST_RATE_LIMIT = 5;
const RATE_WINDOW_S = 3600;
/** Suggestions one wallet may send per day. */
export const SUGGEST_WALLET_DAILY = 3;
const WALLET_WINDOW_S = 24 * 3600;
/** How old (or how far in the future) a signed suggestion may be. */
export const SUGGEST_SIG_MAX_AGE_MS = 10 * 60_000;
const MAX_WALLETS = 200;
const MAX_BY = 10;
/** Arc mainnet, Circle's official RPC: where a suggesting wallet must have transacted. */
const ARC_MAINNET_RPC = "https://rpc.mainnet.arc.io";

export type SuggestionRecord = AdminSuggestion;
export type PublicSuggestion = AdminSuggestion;

export interface SuggestDeps {
  now?: number;
  /** The wallet's transaction count on Arc mainnet (default: eth_getTransactionCount there). */
  getNonce?: (address: Address) => Promise<number>;
}

async function arcNonce(address: Address): Promise<number> {
  const res = await fetch(ARC_MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [address, "latest"] }),
  });
  const body = (await res.json()) as { result?: string };
  if (!res.ok || typeof body.result !== "string") throw new Error(`nonce read failed (${res.status})`);
  return Number(BigInt(body.result));
}

const key = (source: string) => `${SUGGEST_PREFIX}${source}`;

async function visitorId(req: Request, env: Env): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const secret = env.NONCE_SECRET ?? "registrai-suggestions";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`suggest:${ip}`)));
  return Array.from(mac.slice(0, 12), (x) => x.toString(16).padStart(2, "0")).join("");
}

function parseRecord(text: string | null): SuggestionRecord | null {
  if (!text) return null;
  try {
    const r = JSON.parse(text) as SuggestionRecord;
    if (typeof r?.source !== "string" || typeof r.name !== "string") return null;
    return { ...r, by: Array.isArray(r.by) ? r.by : [], wallets: Array.isArray(r.wallets) ? r.wallets : [] };
  } catch {
    return null;
  }
}

function publicView(r: SuggestionRecord): PublicSuggestion {
  const out = { ...r } as SuggestionRecord & { voters?: unknown };
  delete out.voters; // records from before wallet signing held IP hashes here
  return out;
}

/** POST /api/suggestions */
export async function handleSuggest(req: Request, env: Env, deps: SuggestDeps = {}): Promise<Response> {
  const csrf = csrfFailure(req, siteOrigin(env));
  if (csrf) return errorJson(403, csrf);
  if (Number(req.headers.get("content-length") ?? "0") > SUGGEST_MAX_BODY) return errorJson(413, "request too large");
  const text = await req.text();
  if (text.length > SUGGEST_MAX_BODY) return errorJson(413, "request too large");
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return errorJson(400, "expected a JSON object");
    body = parsed as Record<string, unknown>;
  } catch {
    return errorJson(400, "expected JSON");
  }
  const v = validateSuggestion(body);
  if (!v.ok) return errorJson(400, v.error, v.field ? { field: v.field } : {});
  const s = v.value;
  const nowMs = deps.now ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // The wallet's signature over exactly this suggestion, recently.
  const { wallet, signature, issuedAt } = body as { wallet?: unknown; signature?: unknown; issuedAt?: unknown };
  if (typeof wallet !== "string" || !isAddress(wallet) || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature) || typeof issuedAt !== "string") {
    return errorJson(401, "Sign the suggestion with your wallet first.");
  }
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs) || Math.abs(nowMs - issuedMs) > SUGGEST_SIG_MAX_AGE_MS) {
    return errorJson(401, "The signature has expired: sign again.");
  }
  let valid = false;
  try {
    valid = await verifyMessage({ address: wallet as Address, message: suggestionMessage(s, issuedAt), signature: signature as Hex });
  } catch {
    valid = false;
  }
  if (!valid) return errorJson(401, "The signature does not match this suggestion and wallet.");
  const addr = wallet.toLowerCase();

  if (await env.INVITES.get(inviteKey(s.source))) return json({ ok: true, source: s.source, invited: true });

  const voter = await visitorId(req, env);
  const rateKey = `${RATE_PREFIX}${voter}`;
  const rate = safeRate(await env.INVITES.get(rateKey), nowMs, RATE_WINDOW_S);
  if (rate.n >= SUGGEST_RATE_LIMIT) return errorJson(429, "Too many suggestions from here: try again in an hour.");
  const walletKey = `${WALLET_PREFIX}${addr}`;
  const wrate = safeRate(await env.INVITES.get(walletKey), nowMs, WALLET_WINDOW_S);
  if (wrate.n >= SUGGEST_WALLET_DAILY) return errorJson(429, `A wallet can suggest ${SUGGEST_WALLET_DAILY} projects a day: try again tomorrow.`);

  // A wallet that has never transacted on Arc mainnet costs a spammer nothing.
  let nonce: number;
  try {
    nonce = await (deps.getNonce ?? arcNonce)(wallet as Address);
  } catch {
    return errorJson(503, "Couldn't check your wallet on Arc right now: try again in a minute.");
  }
  if (nonce < 1) return errorJson(403, "Use a wallet that has made at least one transaction on Arc mainnet.");

  const prev = parseRecord(await env.INVITES.get(key(s.source)));
  const rec: SuggestionRecord = prev ?? { source: s.source, name: s.name, website: s.website, by: [], wallets: [], count: 0, firstAt: nowIso, lastAt: nowIso };
  // First details stand; a later suggestion only fills what is missing.
  for (const f of ["github", "x", "social", "why"] as const) if (!rec[f] && s[f]) rec[f] = s[f];
  if (s.by && !rec.by.includes(s.by) && rec.by.length < MAX_BY) rec.by.push(s.by);
  if (!rec.wallets.includes(addr)) {
    rec.count += 1;
    if (rec.wallets.length < MAX_WALLETS) rec.wallets.push(addr);
  }
  rec.lastAt = nowIso;

  await env.INVITES.put(key(s.source), JSON.stringify(rec), {
    expirationTtl: SUGGEST_TTL_S,
    metadata: { source: rec.source, count: rec.count, lastAt: rec.lastAt },
  });
  await bump(env.INVITES, rateKey, rate, nowMs, RATE_WINDOW_S);
  await bump(env.INVITES, walletKey, wrate, nowMs, WALLET_WINDOW_S);
  return json({ ok: true, source: rec.source, count: rec.count });
}

async function bump(kv: KV, k: string, r: { n: number; since: number }, nowMs: number, windowS: number): Promise<void> {
  await kv.put(k, JSON.stringify({ n: r.n + 1, since: r.since }), {
    expirationTtl: Math.max(60, Math.ceil((r.since + windowS * 1000 - nowMs) / 1000)),
  });
}

function safeRate(text: string | null, nowMs: number, windowS: number): { n: number; since: number } {
  try {
    const r = text ? (JSON.parse(text) as { n?: unknown; since?: unknown }) : null;
    if (r && typeof r.n === "number" && typeof r.since === "number" && nowMs - r.since < windowS * 1000) return { n: r.n, since: r.since };
  } catch {
    // a fresh window
  }
  return { n: 0, since: nowMs };
}

/** Every open suggestion, most suggested first, then the most recent. */
export async function listSuggestions(kv: KV): Promise<PublicSuggestion[]> {
  const out: PublicSuggestion[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: SUGGEST_PREFIX, cursor });
    for (const k of page.keys) {
      const r = parseRecord(await kv.get(k.name));
      if (r) out.push(publicView(r));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** GET / DELETE /api/admin/suggestions (the middleware has checked the session and CSRF). */
export async function handleAdminSuggestions(req: Request, env: Env): Promise<Response> {
  const method = req.method.toUpperCase();
  if (method === "GET") return json({ suggestions: await listSuggestions(env.INVITES) });
  if (method === "DELETE") {
    const source = normalizeSource(new URL(req.url).searchParams.get("source") ?? "");
    if (!source) return errorJson(400, "source missing");
    await env.INVITES.delete(key(source));
    return json({ deleted: source });
  }
  return errorJson(405, "method not allowed");
}
