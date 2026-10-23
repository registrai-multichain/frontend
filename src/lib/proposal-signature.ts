/**
 * I4: the app checks the team's signature before it shows a proposed market's words.
 *
 * The proposals API (builders-site, KV) is not trusted: whoever can write a record
 * there could put any question, rule or source on a live market. So a record's words
 * (question, rule, source, asset; the outcome's evidence) are shown only when its
 * MarketApproval (its Outcome, for the evidence) recovers, over the typed data exactly
 * as the admin page signs it (approvalTypedData, PROPOSAL_DOMAIN), to one of the
 * compiled PROPOSAL_APPROVERS: the builders-site admins and the rounds agent's own
 * approvers. Otherwise the page says "Proposal #id" with the raw on-chain terms.
 */
import { isAddress, recoverTypedDataAddress, type Hex } from "viem";
import {
  PROPOSAL_APPROVERS, approvalTypedData, fromJsonApproval, fromJsonOutcome, outcomeTypedData,
  type ApprovalMessageJson, type OutcomeMessageJson,
} from "./market-proposals";
import { parseProposalInfo, type ProposalInfo } from "./rounds";

const APPROVAL_FIELDS = ["asset", "comparator", "creatorPayee", "expiry", "kind", "nonce", "proposalId", "question", "ruleHash", "seed", "threshold"].join();
const OUTCOME_FIELDS = ["evidenceUrl", "nonce", "proposalId", "since", "value"].join();
const SIG = /^0x[0-9a-fA-F]{130}$/;
const B32 = /^0x[0-9a-fA-F]{64}$/;
const UINT = (digits: number) => new RegExp(`^\\d{1,${digits}}$`);
const INT256 = /^-?\d{1,78}$/;
const smallInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255;

const exactKeys = (o: object, fields: string) => Object.keys(o).sort().join() === fields;

/** A MarketApproval message of exactly the typed fields (the wire shape), for proposal `id`. */
function approvalShape(m: unknown, id: string): m is ApprovalMessageJson {
  if (!m || typeof m !== "object" || Array.isArray(m) || !exactKeys(m, APPROVAL_FIELDS)) return false;
  const a = m as Record<string, unknown>;
  return (
    a.proposalId === id &&
    smallInt(a.kind) &&
    typeof a.question === "string" &&
    typeof a.ruleHash === "string" && B32.test(a.ruleHash) &&
    typeof a.asset === "string" &&
    smallInt(a.comparator) &&
    typeof a.threshold === "string" && INT256.test(a.threshold) &&
    typeof a.expiry === "string" && UINT(20).test(a.expiry) &&
    typeof a.seed === "string" && UINT(78).test(a.seed) &&
    typeof a.creatorPayee === "string" && isAddress(a.creatorPayee, { strict: false }) &&
    typeof a.nonce === "string" && UINT(20).test(a.nonce)
  );
}

function outcomeShape(m: unknown, id: string): m is OutcomeMessageJson {
  if (!m || typeof m !== "object" || Array.isArray(m) || !exactKeys(m, OUTCOME_FIELDS)) return false;
  const o = m as Record<string, unknown>;
  return (
    o.proposalId === id &&
    typeof o.value === "string" && INT256.test(o.value) &&
    typeof o.since === "string" && UINT(20).test(o.since) &&
    typeof o.evidenceUrl === "string" &&
    typeof o.nonce === "string" && UINT(20).test(o.nonce)
  );
}

const isApprover = (a: string, approvers: readonly string[]) => approvers.some((x) => x.toLowerCase() === a.toLowerCase());

/** The approval's message when `signed` ({message, signature}) is a MarketApproval for
 *  `id` signed by an approver; null otherwise (missing, malformed, tampered, other signer). */
export async function verifiedApproval(signed: unknown, id: string, approvers: readonly string[] = PROPOSAL_APPROVERS): Promise<ApprovalMessageJson | null> {
  const s = signed as { message?: unknown; signature?: unknown } | null | undefined;
  if (!s || typeof s !== "object" || typeof s.signature !== "string" || !SIG.test(s.signature) || !approvalShape(s.message, id)) return null;
  try {
    const signer = await recoverTypedDataAddress({ ...approvalTypedData(fromJsonApproval(s.message)), signature: s.signature as Hex });
    return isApprover(signer, approvers) ? s.message : null;
  } catch {
    return null;
  }
}

/** The outcome's message when `signed` is an Outcome for `id` signed by an approver; else null. */
export async function verifiedOutcome(signed: unknown, id: string, approvers: readonly string[] = PROPOSAL_APPROVERS): Promise<OutcomeMessageJson | null> {
  const s = signed as { message?: unknown; signature?: unknown } | null | undefined;
  if (!s || typeof s !== "object" || typeof s.signature !== "string" || !SIG.test(s.signature) || !outcomeShape(s.message, id)) return null;
  try {
    const signer = await recoverTypedDataAddress({ ...outcomeTypedData(fromJsonOutcome(s.message)), signature: s.signature as Hex });
    return isApprover(signer, approvers) ? s.message : null;
  } catch {
    return null;
  }
}

/**
 * parseProposalInfo, keeping only what the team's signatures vouch for: without a valid
 * approval the record loses its signed terms (so infoMatchesMarket fails and the market
 * shows as "Proposal #id" with its on-chain terms, no API words at all); without a valid
 * outcome it loses the evidence link.
 */
export async function verifiedProposalInfo(json: unknown, id: string, approvers: readonly string[] = PROPOSAL_APPROVERS): Promise<ProposalInfo | null> {
  const info = parseProposalInfo(json, id);
  if (!info) return null;
  const p = (json as { proposal?: { approval?: unknown; outcome?: unknown } }).proposal;
  const [approval, outcome] = await Promise.all([verifiedApproval(p?.approval, id, approvers), verifiedOutcome(p?.outcome, id, approvers)]);
  const out: ProposalInfo = { ...info };
  if (!approval) delete out.terms;
  if (!outcome || outcome.evidenceUrl !== info.evidenceUrl) delete out.evidenceUrl;
  return out;
}
