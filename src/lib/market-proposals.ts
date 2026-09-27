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
  approval?: SignedApproval; outcome?: SignedOutcome; marketId?: string; forwarded?: string;
}
export interface ApprovalMessage {
  proposalId: string; kind: number; question: string; ruleHash: `0x${string}`; asset: string; comparator: number;
  threshold: bigint; expiry: bigint; seed: bigint; creatorPayee: `0x${string}`; nonce: bigint;
}
export interface OutcomeMessage { proposalId: string; value: bigint; since: bigint; evidenceUrl: string; nonce: bigint }

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
  if (question.length < 10 || question.length > 300) return bad("question", "Write the question in 10 to 300 characters.");
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
    Object.assign(value, { asset, comparator, price });
  }
  return { ok: true, value };
}

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
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
