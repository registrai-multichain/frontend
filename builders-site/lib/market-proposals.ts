/**
 * Market proposals API (spec: docs/superpowers/specs/2026-09-27-market-proposals-design.md).
 * Stores proposals and admin signatures in KV (`mp:<id>`); has NO authority: the
 * rounds agent verifies every signature against its own approvers.
 *
 * KV budget (C1): the agent polls both feeds every minute and anyone may call them,
 * so no public call lists KV or reads one key per proposal:
 * - `mp-feed:approved` and `mp-feed:outcomes` hold the feeds (JSON arrays), written
 *   only by approve and outcome: a feed call is one read, cached 30 s at the edge;
 * - every `mp:<id>` carries its ProposalSummary as the key's metadata, so the admin
 *   list is one KV list per page (ADMIN_PAGE keys) and no per-key read;
 * - records written before the index existed (no metadata, no feed docs) are
 *   migrated by rebuildFeeds, on POST /api/admin/market-proposals/rebuild (run it once
 *   after deploying) and by the admin paths that find a doc missing (approve, outcome,
 *   the admin list, which also writes metadata to a page's legacy records). A public
 *   feed call never rebuilds (R54 F2): a missing doc is served as an empty feed, uncached;
 * - a request writes each feed doc at most once (R54 F5);
 * - every public handler answers a thrown error (e.g. a KV 429) with a JSON 500 that
 *   carries the CORS header (R54, M4).
 */
import { getAddress, recoverTypedDataAddress, type Hex } from "viem";
import {
  EVIDENCE_URL_MAX_BYTES, LIVE_KINDS, QUESTION_MAX, approvalMessage, approvalTypedData, fromJsonApproval, fromJsonOutcome, newProposalId,
  outcomeCutoff, outcomeTypedData, proposalSummary, toJsonApproval, utf8Bytes, validateProposal,
  type ApprovalMessageJson, type OutcomeMessageJson, type Proposal, type ProposalSummary, type SignedApproval, type SignedOutcome,
} from "../../src/lib/market-proposals";
import type { Env, KV } from "./env";
import { errorJson, json, readJson } from "./http";

const KEY = (id: string) => `mp:${id}`;
const RL = (h: string) => `mp-rl:${h}`;
const NONCE = (a: string) => `mp-nonce:${a.toLowerCase()}`;
const DAY = (nowMs: number) => `mp-day:${new Date(nowMs).toISOString().slice(0, 10)}`;
export const FEED_APPROVED = "mp-feed:approved";
export const FEED_OUTCOMES = "mp-feed:outcomes";
/** Proposals per IP per day. */
export const MP_DAILY_LIMIT = 5;
/** Proposals from everyone per UTC day: per-IP limits alone do not bound the store. */
export const MP_GLOBAL_DAILY_LIMIT = 200;
/** Keys per admin list page: with a legacy record's read and re-write each, a page stays
 *  far inside the 1,000 KV operations one invocation may make. */
export const ADMIN_PAGE = 250;
export const MP_MAX_BODY = 4096;
const ID_RE = /^p[a-z2-7]{10}$/;

function cors(env: Env): Record<string, string> {
  const o = (env.PROPOSALS_ALLOWED_ORIGIN ?? "").trim();
  return o ? { "access-control-allow-origin": o, vary: "origin" } : {};
}
/** R54 (M4): a public handler whose KV call throws still answers JSON with CORS, so the
 *  app shows "try again" instead of a network error. */
async function guarded(env: Env, f: () => Promise<Response>): Promise<Response> {
  try {
    return await f();
  } catch {
    return json({ error: "The proposals service could not answer just now: try again in a minute." }, 500, cors(env));
  }
}

export function handlePreflight(env: Env): Response {
  return new Response(null, { status: 204, headers: { ...cors(env), "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600" } });
}

async function ipHash(req: Request, env: Env): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.NONCE_SECRET ?? "registrai-proposals"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`mp:${ip}`)));
  return Array.from(mac.slice(0, 12), (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function load(env: Env, id: string): Promise<Proposal | null> {
  if (!ID_RE.test(id)) return null;
  const t = await env.INVITES.get(KEY(id));
  if (!t) return null;
  try {
    return JSON.parse(t) as Proposal;
  } catch {
    return null;
  }
}
/** Every record carries its summary as the key's metadata (the admin list reads only that). */
const save = (kv: KV, p: Proposal) => kv.put(KEY(p.id), JSON.stringify(p), { metadata: proposalSummary(p) });
function publicView(p: Proposal): Proposal {
  const out = { ...p };
  delete out.contact;
  return out;
}

/** POST /api/market-proposals. Every answer, errors included, carries the CORS header,
 *  so the app's form can show the message instead of a network error (M4). */
export function handleSubmit(req: Request, env: Env, deps: { now?: number; rand?: (n: number) => Uint8Array } = {}): Promise<Response> {
  return guarded(env, () => submit(req, env, deps));
}
async function submit(req: Request, env: Env, deps: { now?: number; rand?: (n: number) => Uint8Array }): Promise<Response> {
  const h = cors(env);
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status, h);
  const origin = req.headers.get("origin");
  if (!h["access-control-allow-origin"] || origin !== h["access-control-allow-origin"]) return fail(403, "cross-origin request refused");
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/json") return fail(415, "Content-Type must be application/json");
  const text = await req.text();
  if (text.length > MP_MAX_BODY) return fail(413, "request too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "expected JSON");
  }
  const nowMs = deps.now ?? Date.now();
  const v = validateProposal(body, Math.floor(nowMs / 1000));
  if (!v.ok) return fail(400, v.error, v.field ? { field: v.field } : {});
  const kv = env.INVITES;
  const rlKey = RL(await ipHash(req, env));
  const used = Number((await kv.get(rlKey)) ?? "0");
  if (used >= MP_DAILY_LIMIT) return fail(429, "Too many proposals from here today: try again tomorrow.");
  const dayKey = DAY(nowMs);
  const total = Number((await kv.get(dayKey)) ?? "0");
  if (total >= MP_GLOBAL_DAILY_LIMIT) return fail(429, "The team has all the proposals it can review today: try again tomorrow.");
  await kv.put(rlKey, String(used + 1), { expirationTtl: 24 * 3600 });
  await kv.put(dayKey, String(total + 1), { expirationTtl: 2 * 24 * 3600 });
  const id = newProposalId((deps.rand ?? ((n) => crypto.getRandomValues(new Uint8Array(n))))(10));
  const p: Proposal = { ...v.value, id, createdAt: new Date(nowMs).toISOString(), status: LIVE_KINDS.includes(v.value.kind) ? "pending" : "queued" };
  await save(kv, p);
  return json({ id, status: p.status }, 201, h);
}

/** GET /api/market-proposals/<id> (public: no contact). CORS: app.registrai.cc's status page reads this cross-origin. */
export function handleStatus(_req: Request, env: Env, id: string): Promise<Response> {
  return guarded(env, () => status(env, id));
}
async function status(env: Env, id: string): Promise<Response> {
  const p = await load(env, id);
  const h = cors(env);
  return p ? json({ proposal: publicView(p) }, 200, { ...h, "cache-control": "public, max-age=15" }) : json({ error: "no such proposal" }, 404, h);
}

// ───────────────────────────── feed docs ─────────────────────────────

/** A feed doc's entries. `createdAt` orders them (newest proposal first, as before the
 *  index) and is not served. */
interface ApprovedEntry { id: string; createdAt: string; approval: SignedApproval; deadline: number }
interface OutcomeEntry { id: string; createdAt: string; outcome: SignedOutcome }
export interface Feeds { approved: ApprovedEntry[]; outcomes: OutcomeEntry[] }

const newestFirst = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
const approvedEntry = (p: Proposal): ApprovedEntry | null =>
  p.approval && (p.status === "approved" || p.status === "opened") ? { id: p.id, createdAt: p.createdAt, approval: p.approval, deadline: p.deadline } : null;
const outcomeEntry = (p: Proposal): OutcomeEntry | null => (p.outcome ? { id: p.id, createdAt: p.createdAt, outcome: p.outcome } : null);

/** A feed doc, or null when it is missing or unreadable (then it is rebuilt). */
async function readFeed<T>(kv: KV, key: string): Promise<T[] | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}

function parseRecord(raw: string | null): Proposal | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Proposal;
    return p && typeof p.id === "string" && typeof p.status === "string" ? p : null;
  } catch {
    return null;
  }
}

/** The key's metadata as a summary, or null for a record written before metadata existed. */
function summaryOf(name: string, meta: unknown): ProposalSummary | null {
  const m = meta as Partial<ProposalSummary> | undefined;
  return m && typeof m === "object" && m.id === name.slice(3) && typeof m.status === "string" && typeof m.createdAt === "string" ? (m as ProposalSummary) : null;
}
const inApproved = (s: ProposalSummary) => s.status === "approved" || s.status === "opened";

/**
 * Both feeds as the records say (no feed doc written here). One KV list per 1,000 keys;
 * a record is read only when its metadata says it is in a feed, or it has no metadata
 * (a record from before the index: it is written back with its metadata).
 */
async function collectFeeds(kv: KV): Promise<Feeds & { migrated: number }> {
  const feeds: Feeds = { approved: [], outcomes: [] };
  let migrated = 0;
  let cursor: string | undefined;
  do {
    const page = await kv.list<ProposalSummary>({ prefix: "mp:", cursor });
    for (const k of page.keys) {
      const sum = summaryOf(k.name, k.metadata);
      if (sum && !inApproved(sum) && !sum.outcome) continue;
      const p = parseRecord(await kv.get(k.name));
      if (!p) continue;
      if (!sum) {
        await save(kv, p);
        migrated++;
      }
      const a = approvedEntry(p);
      const o = outcomeEntry(p);
      if (a) feeds.approved.push(a);
      if (o) feeds.outcomes.push(o);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  feeds.approved.sort(newestFirst);
  feeds.outcomes.sort(newestFirst);
  return { ...feeds, migrated };
}

/** Both feed docs, rebuilt from the records when either is missing (`rebuilt`: then both
 *  must be written). Admin paths only. */
async function loadFeeds(kv: KV): Promise<{ feeds: Feeds; rebuilt: boolean }> {
  const [approved, outcomes] = await Promise.all([readFeed<ApprovedEntry>(kv, FEED_APPROVED), readFeed<OutcomeEntry>(kv, FEED_OUTCOMES)]);
  if (approved && outcomes) return { feeds: { approved, outcomes }, rebuilt: false };
  const c = await collectFeeds(kv);
  return { feeds: { approved: c.approved, outcomes: c.outcomes }, rebuilt: true };
}

/** The feed with `entry` put in (replacing this proposal's), newest first. */
const upsert = <T extends { id: string; createdAt: string }>(list: readonly T[], entry: T): T[] =>
  [...list.filter((e) => e.id !== entry.id), entry].sort(newestFirst);

/** One put per changed doc (R54 F5). */
async function writeFeeds(kv: KV, feeds: Feeds, which: { approved: boolean; outcomes: boolean }): Promise<void> {
  if (which.approved) await kv.put(FEED_APPROVED, JSON.stringify(feeds.approved));
  if (which.outcomes) await kv.put(FEED_OUTCOMES, JSON.stringify(feeds.outcomes));
}

/** Rebuild both feed docs from the records (idempotent): one put per doc. */
export async function rebuildFeeds(kv: KV): Promise<Feeds & { migrated: number }> {
  const c = await collectFeeds(kv);
  await writeFeeds(kv, c, { approved: true, outcomes: true });
  return c;
}

/** Put one proposal's entry in a feed doc (a missing doc is rebuilt first); each doc is
 *  written once. */
async function putFeedEntry(kv: KV, entry: { approved?: ApprovedEntry; outcome?: OutcomeEntry }): Promise<void> {
  const { feeds, rebuilt } = await loadFeeds(kv);
  if (entry.approved) feeds.approved = upsert(feeds.approved, entry.approved);
  if (entry.outcome) feeds.outcomes = upsert(feeds.outcomes, entry.outcome);
  await writeFeeds(kv, feeds, { approved: rebuilt || Boolean(entry.approved), outcomes: rebuilt || Boolean(entry.outcome) });
}

const FEED_HEADERS = { "cache-control": "public, max-age=30" };
/** A missing feed doc (before POST /rebuild has run): an empty feed, never cached. */
const NOT_BUILT = { "cache-control": "no-store" };

/** GET /api/market-proposals/approved: every approval, for the agent (the signature is the
 *  authority). One KV read; the same bytes as before the index: {approvals: [{id, approval, deadline}]}.
 *  The query string is ignored (the agent sends none). A missing doc is an empty feed
 *  (no-store): the public path never lists KV (R54 F2). */
export function handleApprovedFeed(_req: Request, env: Env): Promise<Response> {
  return guarded(env, async () => {
    const list = await readFeed<ApprovedEntry>(env.INVITES, FEED_APPROVED);
    return json({ approvals: (list ?? []).map((e) => ({ id: e.id, approval: e.approval, deadline: e.deadline })) }, 200, list ? FEED_HEADERS : NOT_BUILT);
  });
}
/** GET /api/market-proposals/outcomes: {outcomes: [{id, outcome}]}, one KV read. */
export function handleOutcomesFeed(_req: Request, env: Env): Promise<Response> {
  return guarded(env, async () => {
    const list = await readFeed<OutcomeEntry>(env.INVITES, FEED_OUTCOMES);
    return json({ outcomes: (list ?? []).map((e) => ({ id: e.id, outcome: e.outcome })) }, 200, list ? FEED_HEADERS : NOT_BUILT);
  });
}

/** The edge cache key of a feed: its path alone (a `?x=` cannot make it miss). */
export function feedCacheKey(requestUrl: string): string {
  const u = new URL(requestUrl);
  return `${u.origin}${u.pathname}`;
}

// ───────────────────────────── admin ─────────────────────────────

/**
 * GET /api/admin/market-proposals?cursor=&status=: one page of summaries from the keys'
 * metadata (one KV list, no read per key), the next page's cursor (null at the end) and
 * the signed-in admin's last used nonce (M6: the next one is max(now, lastNonce + 1)).
 * Records without metadata (written before it) are read, written back with it, and
 * the page's feed entries are checked against the feed docs (a missing doc is rebuilt,
 * a missing entry added): the migration, and a repair should a feed write be lost.
 */
export async function handleAdminList(req: Request, env: Env, admin: string): Promise<Response> {
  const kv = env.INVITES;
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const cursor = url.searchParams.get("cursor") || undefined;
  const page = await kv.list<ProposalSummary>({ prefix: "mp:", cursor, limit: ADMIN_PAGE });
  const out: ProposalSummary[] = [];
  const legacy: Proposal[] = [];
  for (const k of page.keys) {
    const sum = summaryOf(k.name, k.metadata);
    if (sum) {
      out.push(sum);
      continue;
    }
    const p = parseRecord(await kv.get(k.name));
    if (!p) continue;
    await save(kv, p);
    legacy.push(p);
    out.push(proposalSummary(p));
  }
  await repairFeeds(kv, out, legacy);
  const lastNonce = (await kv.get(NONCE(admin))) ?? "0";
  return json({
    proposals: status ? out.filter((p) => p.status === status) : out,
    cursor: page.list_complete ? null : page.cursor ?? null,
    lastNonce,
  });
}

async function repairFeeds(kv: KV, page: readonly ProposalSummary[], legacy: readonly Proposal[]): Promise<void> {
  const { feeds, rebuilt } = await loadFeeds(kv);
  const haveA = new Set(feeds.approved.map((e) => e.id));
  const haveO = new Map(feeds.outcomes.map((e) => [e.id, String(e.outcome?.message?.nonce ?? "")]));
  const known = new Map(legacy.map((p) => [p.id, p]));
  const stale = page.filter((s) => (inApproved(s) && !haveA.has(s.id)) || (s.outcome && haveO.get(s.id) !== s.outcome.nonce));
  const dirty = { approved: rebuilt, outcomes: rebuilt };
  for (const s of stale) {
    const p = known.get(s.id) ?? parseRecord(await kv.get(KEY(s.id)));
    const a = p && approvedEntry(p);
    const o = p && outcomeEntry(p);
    if (a && !haveA.has(a.id)) {
      feeds.approved = upsert(feeds.approved, a);
      dirty.approved = true;
    }
    if (o && haveO.get(o.id) !== String(o.outcome.message.nonce)) {
      feeds.outcomes = upsert(feeds.outcomes, o);
      dirty.outcomes = true;
    }
  }
  await writeFeeds(kv, feeds, dirty);
}

/** POST /api/admin/market-proposals/rebuild: rebuild both feed docs and write metadata to
 *  records without it (idempotent; run once after deploying the index). */
export async function handleAdminRebuild(env: Env): Promise<Response> {
  const r = await rebuildFeeds(env.INVITES);
  return json({ approved: r.approved.length, outcomes: r.outcomes.length, migrated: r.migrated });
}

/** GET /api/admin/market-proposals/<id>: the full record (contact included). */
export async function handleAdminGet(env: Env, id: string): Promise<Response> {
  const p = await load(env, id);
  return p ? json({ proposal: p }) : errorJson(404, "no such proposal");
}

const EDITABLE = ["question", "rule", "source", "deadline", "creatorPayee", "asset", "comparator", "price"] as const;
/** An approved (or already-opened) proposal is immutable: the agent may be mid-open on it (R9). */
const ALREADY_APPROVED = "already approved: the agent opens it within a minute";
const isLocked = (p: Proposal) => p.status === "opened" || p.status === "approved";

/** PATCH /api/admin/market-proposals/<id>: an edit voids any signature (it must be signed again). */
export async function handleAdminPatch(req: Request, env: Env, id: string, _admin: string, deps: { now?: number } = {}): Promise<Response> {
  const p = await load(env, id);
  if (!p) return errorJson(404, "no such proposal");
  if (isLocked(p)) return errorJson(409, ALREADY_APPROVED);
  const patch = (await readJson(req)) as Record<string, unknown> | undefined;
  if (!patch || typeof patch !== "object") return errorJson(400, "expected a JSON object");
  const merged: Record<string, unknown> = { ...p };
  for (const k of EDITABLE) if (k in patch) merged[k] = patch[k];
  const nowMs = deps.now ?? Date.now();
  const v = validateProposal(merged, Math.floor(nowMs / 1000));
  if (!v.ok) return errorJson(400, v.error, v.field ? { field: v.field } : {});
  const next: Proposal = { ...p, ...v.value, status: LIVE_KINDS.includes(v.value.kind) ? "pending" : "queued" };
  delete next.approval;
  delete next.reason;
  await save(env.INVITES, next);
  return json({ proposal: next });
}

/** POST /api/admin/market-proposals/<id>/reject {reason} */
export async function handleAdminReject(req: Request, env: Env, id: string): Promise<Response> {
  const p = await load(env, id);
  if (!p) return errorJson(404, "no such proposal");
  if (isLocked(p)) return errorJson(409, ALREADY_APPROVED);
  const b = (await readJson(req)) as { reason?: unknown } | undefined;
  const reason = typeof b?.reason === "string" ? b.reason.trim().slice(0, 300) : "";
  if (!reason) return errorJson(400, "give a reason (it is shown on the proposal's status page)", { field: "reason" });
  const next: Proposal = { ...p, status: "rejected", reason };
  delete next.approval;
  await save(env.INVITES, next);
  return json({ proposal: next });
}

async function takeNonce(env: Env, admin: string, nonce: bigint): Promise<boolean> {
  const last = BigInt((await env.INVITES.get(NONCE(admin))) ?? "0");
  if (nonce <= last) return false;
  await env.INVITES.put(NONCE(admin), nonce.toString());
  return true;
}
const same = (a: ApprovalMessageJson, b: ApprovalMessageJson) => JSON.stringify(a) === JSON.stringify(b);

/** POST /api/admin/market-proposals/<id>/approve {message, signature}: stores the approval
 *  (approvedAt: the first approval's time) and puts it in the agent's feed doc. */
export async function handleAdminApprove(req: Request, env: Env, id: string, admin: string, deps: { now?: number } = {}): Promise<Response> {
  const p = await load(env, id);
  if (!p) return errorJson(404, "no such proposal");
  // approvalMessage() throws for a phase-2 (builder/wonder) proposal; pending/approved only ever
  // holds a live-kind proposal (a patch that changes kind recomputes the status), so this guard
  // makes that throw unreachable below.
  if (p.status !== "pending" && p.status !== "approved") return errorJson(409, `cannot approve a ${p.status} proposal`);
  const b = (await readJson(req)) as { message?: ApprovalMessageJson; signature?: string } | undefined;
  if (!b?.message || typeof b.signature !== "string") return errorJson(400, "message and signature required");
  // R24: never store a signature the rounds agent would refuse as malformed.
  if (typeof b.message.question !== "string" || b.message.question.length > QUESTION_MAX)
    return errorJson(400, `the question must be at most ${QUESTION_MAX} characters`, { field: "question" });
  let expected: ApprovalMessageJson;
  try {
    expected = toJsonApproval(approvalMessage(p, BigInt(b.message.nonce)));
  } catch {
    return errorJson(400, "bad message");
  }
  if (!same(expected, b.message)) return errorJson(400, "the signed message does not match this proposal (reload it)");
  let signer: string;
  try {
    signer = await recoverTypedDataAddress({ ...approvalTypedData(fromJsonApproval(b.message)), signature: b.signature as Hex });
  } catch {
    return errorJson(400, "bad signature");
  }
  if (signer.toLowerCase() !== admin.toLowerCase()) return errorJson(403, "signed by another wallet than the signed-in admin");
  if (!(await takeNonce(env, admin, BigInt(b.message.nonce)))) return errorJson(409, "nonce already used: reload and sign again");
  const next: Proposal = {
    ...p, status: "approved", approvedAt: p.approvedAt ?? new Date(deps.now ?? Date.now()).toISOString(),
    approval: { message: b.message, signature: b.signature as Hex, signer: getAddress(signer) },
  };
  await save(env.INVITES, next);
  await putFeedEntry(env.INVITES, { approved: approvedEntry(next)! });
  return json({ proposal: next });
}

const OUTCOME_FIELDS = ["evidenceUrl", "nonce", "proposalId", "since", "value"].join();
const UINT64 = /^\d{1,20}$/;

/**
 * POST /api/admin/market-proposals/<id>/outcome {message, signature}. Stores only what the
 * rounds agent applies (M1, R24): a yes/no event's outcome whose message has exactly the
 * Outcome fields, value 0 or 1, since at or before the deadline; and only until
 * outcomeCutoff(deadline): the agent attests OUTCOME_GRACE_S after the deadline (I1), so
 * a later outcome would be recorded here and never applied.
 */
export async function handleAdminOutcome(req: Request, env: Env, id: string, admin: string, deps: { now?: number } = {}): Promise<Response> {
  const p = await load(env, id);
  if (!p) return errorJson(404, "no such proposal");
  if (p.status !== "opened" && p.status !== "approved") return errorJson(409, "only an approved or opened market takes an outcome");
  if (p.kind !== "event") return errorJson(409, "only a yes/no event takes an outcome: a price market settles on the median price");
  const nowS = Math.floor((deps.now ?? Date.now()) / 1000);
  if (nowS > outcomeCutoff(p.deadline))
    return errorJson(409, "too late — use the dispute process: the agent attests the outcome 30 minutes after the deadline, and one recorded now might not reach it in time");
  const b = (await readJson(req)) as { message?: OutcomeMessageJson; signature?: string } | undefined;
  const m = b?.message;
  if (!m || typeof m !== "object" || typeof b?.signature !== "string" || m.proposalId !== id) return errorJson(400, "message and signature for this proposal required");
  if (Object.keys(m).sort().join() !== OUTCOME_FIELDS) return errorJson(400, "the outcome message must have exactly proposalId, value, since, evidenceUrl and nonce");
  if (m.value !== "0" && m.value !== "1") return errorJson(400, "value must be 0 (No) or 1 (Yes)", { field: "value" });
  if (typeof m.since !== "string" || !UINT64.test(m.since) || typeof m.nonce !== "string" || !UINT64.test(m.nonce)) return errorJson(400, "since and nonce must be whole numbers");
  if (Number(m.since) > p.deadline) return errorJson(400, "since must be at or before the deadline: the agent ignores a later one", { field: "since" });
  if (typeof m.evidenceUrl !== "string" || !/^https:\/\//.test(m.evidenceUrl)) return errorJson(400, "evidence must be an https link", { field: "evidenceUrl" });
  // R24: the rounds agent refuses a longer evidenceUrl as malformed; never store one.
  if (utf8Bytes(m.evidenceUrl) > EVIDENCE_URL_MAX_BYTES)
    return errorJson(400, `the evidence link must be at most ${EVIDENCE_URL_MAX_BYTES} bytes`, { field: "evidenceUrl" });
  let signer: string;
  try {
    signer = await recoverTypedDataAddress({ ...outcomeTypedData(fromJsonOutcome(m)), signature: b.signature as Hex });
  } catch {
    return errorJson(400, "bad signature");
  }
  if (signer.toLowerCase() !== admin.toLowerCase()) return errorJson(403, "signed by another wallet than the signed-in admin");
  if (!(await takeNonce(env, admin, BigInt(m.nonce)))) return errorJson(409, "nonce already used");
  const next: Proposal = { ...p, outcome: { message: m, signature: b.signature as Hex, signer: getAddress(signer) } };
  await save(env.INVITES, next);
  await putFeedEntry(env.INVITES, { outcome: outcomeEntry(next)! });
  return json({ proposal: next });
}
