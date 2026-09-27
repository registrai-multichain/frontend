/**
 * Market proposals API (spec: docs/superpowers/specs/2026-09-27-market-proposals-design.md).
 * Stores proposals and admin signatures in KV (`mp:<id>`); has NO authority: the
 * rounds agent verifies every signature against its own approvers.
 */
import { getAddress, recoverTypedDataAddress, type Hex } from "viem";
import {
  EVIDENCE_URL_MAX_BYTES, LIVE_KINDS, QUESTION_MAX, approvalMessage, approvalTypedData, fromJsonApproval, fromJsonOutcome, newProposalId,
  outcomeTypedData, toJsonApproval, utf8Bytes, validateProposal, type ApprovalMessageJson, type OutcomeMessageJson, type Proposal,
} from "../../src/lib/market-proposals";
import type { Env } from "./env";
import { errorJson, json, readJson } from "./http";

const KEY = (id: string) => `mp:${id}`;
const RL = (h: string) => `mp-rl:${h}`;
const NONCE = (a: string) => `mp-nonce:${a.toLowerCase()}`;
export const MP_DAILY_LIMIT = 5;
export const MP_MAX_BODY = 4096;
const ID_RE = /^p[a-z2-7]{10}$/;

function cors(env: Env): Record<string, string> {
  const o = (env.PROPOSALS_ALLOWED_ORIGIN ?? "").trim();
  return o ? { "access-control-allow-origin": o, vary: "origin" } : {};
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
const save = (env: Env, p: Proposal) => env.INVITES.put(KEY(p.id), JSON.stringify(p));
function publicView(p: Proposal): Proposal {
  const out = { ...p };
  delete out.contact;
  return out;
}

/** POST /api/market-proposals */
export async function handleSubmit(req: Request, env: Env, deps: { now?: number; rand?: (n: number) => Uint8Array } = {}): Promise<Response> {
  const h = cors(env);
  const origin = req.headers.get("origin");
  if (!h["access-control-allow-origin"] || origin !== h["access-control-allow-origin"]) return errorJson(403, "cross-origin request refused");
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/json") return errorJson(415, "Content-Type must be application/json");
  const text = await req.text();
  if (text.length > MP_MAX_BODY) return errorJson(413, "request too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorJson(400, "expected JSON");
  }
  const nowMs = deps.now ?? Date.now();
  const v = validateProposal(body, Math.floor(nowMs / 1000));
  if (!v.ok) return json({ error: v.error, ...(v.field ? { field: v.field } : {}) }, 400, h);
  const rlKey = RL(await ipHash(req, env));
  const used = Number((await env.INVITES.get(rlKey)) ?? "0");
  if (used >= MP_DAILY_LIMIT) return json({ error: "Too many proposals from here today: try again tomorrow." }, 429, h);
  await env.INVITES.put(rlKey, String(used + 1), { expirationTtl: 24 * 3600 });
  const id = newProposalId((deps.rand ?? ((n) => crypto.getRandomValues(new Uint8Array(n))))(10));
  const p: Proposal = { ...v.value, id, createdAt: new Date(nowMs).toISOString(), status: LIVE_KINDS.includes(v.value.kind) ? "pending" : "queued" };
  await save(env, p);
  return json({ id, status: p.status }, 201, h);
}

/** GET /api/market-proposals/<id> (public: no contact). CORS: app.registrai.cc's status page reads this cross-origin. */
export async function handleStatus(_req: Request, env: Env, id: string): Promise<Response> {
  const p = await load(env, id);
  const h = cors(env);
  return p ? json({ proposal: publicView(p) }, 200, { ...h, "cache-control": "public, max-age=15" }) : json({ error: "no such proposal" }, 404, h);
}

async function listAll(env: Env): Promise<Proposal[]> {
  const out: Proposal[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.INVITES.list({ prefix: "mp:", cursor });
    for (const k of page.keys) {
      const t = await env.INVITES.get(k.name);
      if (t) {
        try {
          out.push(JSON.parse(t) as Proposal);
        } catch {
          // skip a broken record
        }
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** GET /api/market-proposals/approved: every approval, for the agent (the signature is the authority). */
export async function handleApprovedFeed(_req: Request, env: Env): Promise<Response> {
  const approvals = (await listAll(env))
    .filter((p) => p.approval && (p.status === "approved" || p.status === "opened"))
    .map((p) => ({ id: p.id, approval: p.approval, deadline: p.deadline }));
  return json({ approvals });
}
/** GET /api/market-proposals/outcomes */
export async function handleOutcomesFeed(_req: Request, env: Env): Promise<Response> {
  return json({ outcomes: (await listAll(env)).filter((p) => p.outcome).map((p) => ({ id: p.id, outcome: p.outcome })) });
}

/** GET /api/admin/market-proposals?status= */
export async function handleAdminList(req: Request, env: Env): Promise<Response> {
  const status = new URL(req.url).searchParams.get("status");
  const all = await listAll(env);
  return json({ proposals: status ? all.filter((p) => p.status === status) : all });
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
  await save(env, next);
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
  await save(env, next);
  return json({ proposal: next });
}

async function takeNonce(env: Env, admin: string, nonce: bigint): Promise<boolean> {
  const last = BigInt((await env.INVITES.get(NONCE(admin))) ?? "0");
  if (nonce <= last) return false;
  await env.INVITES.put(NONCE(admin), nonce.toString());
  return true;
}
const same = (a: ApprovalMessageJson, b: ApprovalMessageJson) => JSON.stringify(a) === JSON.stringify(b);

/** POST /api/admin/market-proposals/<id>/approve {message, signature} */
export async function handleAdminApprove(req: Request, env: Env, id: string, admin: string): Promise<Response> {
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
  const next: Proposal = { ...p, status: "approved", approval: { message: b.message, signature: b.signature as Hex, signer: getAddress(signer) } };
  await save(env, next);
  return json({ proposal: next });
}

/** POST /api/admin/market-proposals/<id>/outcome {message, signature} */
export async function handleAdminOutcome(req: Request, env: Env, id: string, admin: string): Promise<Response> {
  const p = await load(env, id);
  if (!p) return errorJson(404, "no such proposal");
  if (p.status !== "opened" && p.status !== "approved") return errorJson(409, "only an approved or opened market takes an outcome");
  const b = (await readJson(req)) as { message?: OutcomeMessageJson; signature?: string } | undefined;
  if (!b?.message || typeof b.signature !== "string" || b.message.proposalId !== id) return errorJson(400, "message and signature for this proposal required");
  if (typeof b.message.evidenceUrl !== "string" || !/^https:\/\//.test(b.message.evidenceUrl)) return errorJson(400, "evidence must be an https link", { field: "evidenceUrl" });
  // R24: the rounds agent refuses a longer evidenceUrl as malformed; never store one.
  if (utf8Bytes(b.message.evidenceUrl) > EVIDENCE_URL_MAX_BYTES)
    return errorJson(400, `the evidence link must be at most ${EVIDENCE_URL_MAX_BYTES} bytes`, { field: "evidenceUrl" });
  let signer: string;
  try {
    signer = await recoverTypedDataAddress({ ...outcomeTypedData(fromJsonOutcome(b.message)), signature: b.signature as Hex });
  } catch {
    return errorJson(400, "bad signature");
  }
  if (signer.toLowerCase() !== admin.toLowerCase()) return errorJson(403, "signed by another wallet than the signed-in admin");
  if (!(await takeNonce(env, admin, BigInt(b.message.nonce)))) return errorJson(409, "nonce already used");
  const next: Proposal = { ...p, outcome: { message: b.message, signature: b.signature as Hex, signer: getAddress(signer) } };
  await save(env, next);
  return json({ proposal: next });
}
