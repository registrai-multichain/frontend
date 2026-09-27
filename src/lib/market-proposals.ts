/**
 * Market proposals: the shared model of the public form (app.registrai.cc/propose),
 * the admin review (builder.registrai.cc/admin/proposals) and the builders-site API.
 * Spec: docs/superpowers/specs/2026-09-27-market-proposals-design.md. No I/O here.
 * The API stores proposals and signatures but has no authority: the rounds agent
 * opens a market only with an EIP-712 approval signed by one of ITS approvers.
 */
import { getAddress, isAddress, keccak256, parseUnits, toBytes, type TypedDataDefinition } from "viem";

export type ProposalKind = "event" | "price" | "builder" | "wonder";
export const KIND_CODE = { event: 1, price: 2 } as const;
export const LIVE_KINDS: readonly ProposalKind[] = ["event", "price"];
export const MARKETS_V4 = "0xBdC4b03bF67b4eF70195b1862303aCe61F0D77cE" as const;
export const TREASURY = "0xd8Dc4Ca674de4571E33040EEb14D487D2Bc37Df7" as const;
export const SEED = 5_000_000n;
export const MIN_LEAD_S = 24 * 3600;
export const MAX_LEAD_S = 366 * 24 * 3600;
export const GRID_S = 300;
/** The form's question cap (UTF-16 units, at most 900 UTF-8 bytes: inside the agent's 1200-byte cap). */
export const QUESTION_MAX = 300;
/** The rounds agent refuses a signed outcome whose evidenceUrl is longer (keeper/proposals.py STRING_MAX_BYTES). */
export const EVIDENCE_URL_MAX_BYTES = 2048;
export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
export const PROPOSAL_ASSETS = {
  "btc-usd": { symbol: "BTC", decimals: 2 },
  "eth-usd": { symbol: "ETH", decimals: 2 },
  "sol-usd": { symbol: "SOL", decimals: 3 },
  "zec-usd": { symbol: "ZEC", decimals: 2 },
  "hype-usd": { symbol: "HYPE", decimals: 3 },
} as const;
export type ProposalAsset = keyof typeof PROPOSAL_ASSETS;

export interface ProposalInput {
  kind: ProposalKind;
  question: string;
  rule: string;
  source: string;
  deadline: number;
  why?: string;
  creatorPayee?: string;
  contact?: string;
  asset?: ProposalAsset;
  comparator?: 1 | 3;
  price?: string;
}
export type ProposalStatus = "pending" | "approved" | "opened" | "rejected" | "queued";
export interface ApprovalMessageJson {
  proposalId: string; kind: number; question: string; ruleHash: `0x${string}`; asset: string;
  comparator: number; threshold: string; expiry: string; seed: string; creatorPayee: `0x${string}`; nonce: string;
}
export interface OutcomeMessageJson { proposalId: string; value: string; since: string; evidenceUrl: string; nonce: string }
export interface SignedApproval { message: ApprovalMessageJson; signature: `0x${string}`; signer: `0x${string}` }
export interface SignedOutcome { message: OutcomeMessageJson; signature: `0x${string}`; signer: `0x${string}` }
export interface Proposal extends ProposalInput {
  id: string; createdAt: string; status: ProposalStatus; reason?: string;
  /** ISO time of the (first) approval: the status page says "opening delayed" when no market follows. */
  approvedAt?: string;
  approval?: SignedApproval; outcome?: SignedOutcome; marketId?: string; forwarded?: string;
}
export interface ApprovalMessage {
  proposalId: string; kind: number; question: string; ruleHash: `0x${string}`; asset: string; comparator: number;
  threshold: bigint; expiry: bigint; seed: bigint; creatorPayee: `0x${string}`; nonce: bigint;
}
export interface OutcomeMessage { proposalId: string; value: bigint; since: bigint; evidenceUrl: string; nonce: bigint }

/**
 * The wallets whose MarketApproval / Outcome signatures the app trusts before it shows
 * a proposed market's words (question, rule, source, asset, evidence). Must equal the
 * builders-site ADMIN_ADDRESSES (builders-site/wrangler.toml) and the rounds agent's
 * `approvers` (keeper config.arc-mainnet-rounds.json): a test checks both.
 */
export const PROPOSAL_APPROVERS: readonly `0x${string}`[] = ["0xb7eCf980a4732B75E57e2eC80903deE3964F2573"];

/**
 * A yes/no proposal's outcome: the agent attests it OUTCOME_GRACE_S after the deadline
 * (keeper OUTCOME_GRACE_SECS), taking a signed outcome dated by the deadline that reached
 * it before then. The admin form and the API close OUTCOME_PICKUP_S earlier, the time the
 * agent may need to see a new outcome (the feed's 30 s cache, KV propagation, its 60 s poll).
 */
export const OUTCOME_GRACE_S = 1800;
export const OUTCOME_PICKUP_S = 300;
/** The last second an outcome is taken for a proposal with this deadline. */
export const outcomeCutoff = (deadline: number) => deadline + OUTCOME_GRACE_S - OUTCOME_PICKUP_S;
/** The rounds agent's dispute window on a yes/no proposal feed (keeper EVENT_DISPUTE_WINDOW). */
export const EVENT_DISPUTE_S = 43_200;

/** The agent opens an approved proposal within minutes; past this with no market on chain,
 *  the status page says "opening delayed" (the agent refused or deferred it, and alerted). */
export const OPENING_DELAY_S = 900;

/** When the proposal was approved (unix seconds): approvedAt, else (a record from before
 *  approvedAt was stored) the approval's nonce, which the admin page takes from the clock
 *  in milliseconds; null when neither is a plausible time. */
export function approvedAtS(p: { approvedAt?: string; approval?: { message?: { nonce?: unknown } } }, nowS: number): number | null {
  const t = p.approvedAt ? Date.parse(p.approvedAt) : NaN;
  if (Number.isFinite(t)) return Math.floor(t / 1000);
  const n = Number(p.approval?.message?.nonce);
  return Number.isSafeInteger(n) && n > 1_600_000_000_000 && n / 1000 <= nowS + 86_400 ? Math.floor(n / 1000) : null;
}

/** Approved more than OPENING_DELAY_S ago (the caller knows no market is on chain). */
export function openingOverdue(p: { status: ProposalStatus; approvedAt?: string; approval?: { message?: { nonce?: unknown } } }, nowS: number): boolean {
  if (p.status !== "approved" && p.status !== "opened") return false;
  const at = approvedAtS(p, nowS);
  return at !== null && nowS - at > OPENING_DELAY_S;
}

/** A proposal as the admin list shows it: the KV key's metadata (at most 1024 bytes), so
 *  listing needs no read per proposal. The full record is read when one is opened. */
export interface ProposalSummary {
  id: string; status: ProposalStatus; createdAt: string; kind: ProposalKind; question: string; deadline: number;
  creatorPayee?: string; reason?: string; approvedAt?: string;
  outcome?: { value: string; nonce: string };
  /** The question was cut to fit the metadata. */
  cut?: true;
}
/** Workers KV caps a key's metadata at 1024 bytes (serialized); keep a margin. */
export const SUMMARY_MAX_BYTES = 1000;

export function proposalSummary(p: Proposal): ProposalSummary {
  const base: ProposalSummary = { id: p.id, status: p.status, createdAt: p.createdAt, kind: p.kind, question: p.question, deadline: p.deadline };
  if (p.creatorPayee) base.creatorPayee = p.creatorPayee;
  if (p.reason) base.reason = Array.from(p.reason).slice(0, 120).join("");
  if (p.approvedAt) base.approvedAt = p.approvedAt;
  if (p.outcome) base.outcome = { value: String(p.outcome.message.value), nonce: String(p.outcome.message.nonce) };
  const fits = (x: ProposalSummary) => utf8Bytes(JSON.stringify(x)) <= SUMMARY_MAX_BYTES;
  if (fits(base)) return base;
  if (base.reason) base.reason = Array.from(base.reason).slice(0, 40).join("");
  const chars = Array.from(p.question);
  for (let n = chars.length; n > 0; n = Math.floor(n * 0.8)) {
    const s: ProposalSummary = { ...base, question: `${chars.slice(0, n).join("")}…`, cut: true };
    if (fits(s)) return s;
  }
  return { ...base, question: "", cut: true };
}

export const PROPOSAL_DOMAIN = { name: "Registrai Market Proposals", version: "1", chainId: 5042, verifyingContract: MARKETS_V4 } as const;
const APPROVAL_TYPES = {
  MarketApproval: [
    { name: "proposalId", type: "string" }, { name: "kind", type: "uint8" }, { name: "question", type: "string" },
    { name: "ruleHash", type: "bytes32" }, { name: "asset", type: "string" }, { name: "comparator", type: "uint8" },
    { name: "threshold", type: "int256" }, { name: "expiry", type: "uint64" }, { name: "seed", type: "uint256" },
    { name: "creatorPayee", type: "address" }, { name: "nonce", type: "uint64" },
  ],
} as const;
const OUTCOME_TYPES = {
  Outcome: [
    { name: "proposalId", type: "string" }, { name: "value", type: "int256" }, { name: "since", type: "uint64" },
    { name: "evidenceUrl", type: "string" }, { name: "nonce", type: "uint64" },
  ],
} as const;

type V = { ok: true; value: ProposalInput } | { ok: false; error: string; field?: string };
const bad = (field: string, error: string): V => ({ ok: false, field, error });
const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");

export function validateProposal(body: unknown, nowS: number): V {
  if (typeof body !== "object" || body === null) return { ok: false, error: "expected an object" };
  const b = body as Record<string, unknown>;
  if (str(b.website2)) return { ok: false, error: "refused" }; // honeypot
  const kind = b.kind as ProposalKind;
  if (!["event", "price", "builder", "wonder"].includes(kind)) return bad("kind", "Pick a market type.");
  const question = str(b.question);
  if (question.length < 10 || question.length > QUESTION_MAX) return bad("question", `Write the question in 10 to ${QUESTION_MAX} characters.`);
  const rule = str(b.rule);
  if (rule.length > 1000) return bad("rule", "Keep the rule under 1000 characters.");
  const source = str(b.source);
  if (kind !== "price" && !/^https:\/\/[^\s]{3,300}$/.test(source)) return bad("source", "Give a public https link where the answer will appear.");
  const deadline = Number(b.deadline);
  if (!Number.isInteger(deadline) || deadline % GRID_S !== 0) return bad("deadline", "Pick a deadline on a 5-minute mark (UTC).");
  if (deadline < nowS + MIN_LEAD_S || deadline > nowS + MAX_LEAD_S) return bad("deadline", "The deadline must be between 1 day and 1 year away.");
  const why = str(b.why);
  if (why.length > 1000) return bad("why", "Keep this under 1000 characters.");
  const contact = str(b.contact);
  if (contact.length > 120) return bad("contact", "Keep the contact under 120 characters.");
  const payee = str(b.creatorPayee);
  if (payee && !isAddress(payee)) return bad("creatorPayee", "That is not a wallet address (0x…, 40 hex characters).");
  const value: ProposalInput = { kind, question, rule, source, deadline, why: why || undefined, contact: contact || undefined, creatorPayee: payee ? getAddress(payee) : undefined };
  if (kind === "price") {
    const asset = str(b.asset) as ProposalAsset;
    if (!(asset in PROPOSAL_ASSETS)) return bad("asset", "Pick BTC, ETH, SOL, ZEC or HYPE.");
    const comparator = Number(b.comparator);
    if (comparator !== 1 && comparator !== 3) return bad("comparator", "Pick at least or at most.");
    const price = str(b.price);
    if (!/^\d{1,9}(\.\d{1,8})?$/.test(price) || Number(price) <= 0) return bad("price", "Give a positive price, e.g. 3000 or 0.52.");
    const assetConfig = PROPOSAL_ASSETS[asset];
    const priceParts = price.split(".");
    if (priceParts.length === 2 && priceParts[1].length > assetConfig.decimals) {
      return bad("price", `Use at most ${assetConfig.decimals} decimals for ${assetConfig.symbol}.`);
    }
    Object.assign(value, { asset, comparator, price });
  }
  return { ok: true, value };
}

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** What `p` duplicates: "live market" when a live market asks the same (normalised)
 *  question, else the id of another proposal that is not rejected and asks it; null if none. */
type QuestionOf = Pick<Proposal, "id" | "status" | "question">;
export function duplicateOf(p: Pick<Proposal, "id" | "question">, others: readonly QuestionOf[], liveQuestions: readonly string[]): string | null {
  const q = normalizeQuestion(p.question);
  if (liveQuestions.some((l) => normalizeQuestion(l) === q)) return "live market";
  const hit = others.find((o) => o.id !== p.id && o.status !== "rejected" && normalizeQuestion(o.question) === q);
  return hit ? hit.id : null;
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function newProposalId(rand: Uint8Array): string {
  let out = "p";
  for (let i = 0; i < 10; i++) out += B32[rand[i] % 32];
  return out;
}

export function thresholdOf(p: Pick<ProposalInput, "kind" | "asset" | "price">): bigint {
  if (p.kind !== "price") return 1n;
  const d = PROPOSAL_ASSETS[p.asset!].decimals;
  return parseUnits(p.price!, d);
}

export function approvalMessage(p: Proposal, nonce: bigint): ApprovalMessage {
  if (!LIVE_KINDS.includes(p.kind)) throw new Error(`cannot approve a ${p.kind} proposal (phase 2)`);
  return {
    proposalId: p.id,
    kind: p.kind === "price" ? KIND_CODE.price : KIND_CODE.event,
    question: p.question,
    ruleHash: keccak256(toBytes(p.rule)),
    asset: p.kind === "price" ? p.asset! : "",
    comparator: p.kind === "price" ? p.comparator! : 1,
    threshold: thresholdOf(p),
    expiry: BigInt(p.deadline),
    seed: SEED,
    creatorPayee: p.creatorPayee && isAddress(p.creatorPayee) ? getAddress(p.creatorPayee) : TREASURY,
    nonce,
  };
}

export function approvalTypedData(message: ApprovalMessage): TypedDataDefinition<typeof APPROVAL_TYPES, "MarketApproval"> {
  return { domain: PROPOSAL_DOMAIN, types: APPROVAL_TYPES, primaryType: "MarketApproval", message };
}
export function outcomeTypedData(message: OutcomeMessage): TypedDataDefinition<typeof OUTCOME_TYPES, "Outcome"> {
  return { domain: PROPOSAL_DOMAIN, types: OUTCOME_TYPES, primaryType: "Outcome", message };
}

export const toJsonApproval = (m: ApprovalMessage): ApprovalMessageJson => ({
  ...m, threshold: m.threshold.toString(), expiry: m.expiry.toString(), seed: m.seed.toString(), nonce: m.nonce.toString(),
});
export const fromJsonApproval = (m: ApprovalMessageJson): ApprovalMessage => ({
  ...m, threshold: BigInt(m.threshold), expiry: BigInt(m.expiry), seed: BigInt(m.seed), nonce: BigInt(m.nonce),
});
export const toJsonOutcome = (m: OutcomeMessage): OutcomeMessageJson => ({ ...m, value: m.value.toString(), since: m.since.toString(), nonce: m.nonce.toString() });
export const fromJsonOutcome = (m: OutcomeMessageJson): OutcomeMessage => ({ ...m, value: BigInt(m.value), since: BigInt(m.since), nonce: BigInt(m.nonce) });
