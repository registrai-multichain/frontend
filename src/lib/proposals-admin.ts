/**
 * Pure logic of the admin review page (builder.registrai.cc/admin/proposals,
 * src/components/admin/ProposalsAdmin.tsx): filters, labels, the client-side
 * checks, the edit draft and the text of the message the admin signs. The model,
 * validation and EIP-712 shapes live in ./market-proposals.
 */
import { isAddress } from "viem";
import {
  EVENT_DISPUTE_S, EVIDENCE_URL_MAX_BYTES, GRID_S, MAX_LEAD_S, MIN_LEAD_S, OUTCOME_GRACE_S, PROPOSAL_ASSETS, PROPOSAL_DOMAIN, SEED, TREASURY,
  outcomeCutoff, utf8Bytes, validateProposal, type ApprovalMessage, type Proposal, type ProposalAsset, type ProposalKind, type ProposalStatus,
} from "./market-proposals";
import { formatUtcDeadline, parseUtcDeadline } from "./propose-form";
import { shortAddr } from "./format";

export type ProposalFilter = "pending" | "approved" | "rejected" | "queued";
export const FILTERS: ReadonlyArray<{ id: ProposalFilter; label: string; count: boolean }> = [
  { id: "pending", label: "Pending", count: true },
  { id: "approved", label: "Approved", count: false },
  { id: "rejected", label: "Rejected", count: false },
  { id: "queued", label: "Phase 2 queue", count: true },
];

/** "Approved" also lists opened proposals: both are signed and immutable. */
export function inFilter(p: Pick<Proposal, "status">, f: ProposalFilter): boolean {
  return f === "approved" ? p.status === "approved" || p.status === "opened" : p.status === f;
}
/** The filter that lists a proposal with this status (the pane follows it after an action). */
export function filterOf(status: ProposalStatus): ProposalFilter {
  return status === "opened" ? "approved" : status;
}

/** Signatures are for Arc mainnet (the typed-data domain's chainId): null when the wallet is on it. */
export function wrongChainMessage(chainId: number | undefined): string | null {
  return chainId === PROPOSAL_DOMAIN.chainId ? null : "Switch your wallet to Arc mainnet to sign.";
}

export function filterCounts(list: readonly Pick<Proposal, "status">[]): Record<ProposalFilter, number> {
  const out: Record<ProposalFilter, number> = { pending: 0, approved: 0, rejected: 0, queued: 0 };
  for (const p of list) for (const f of FILTERS) if (inFilter(p, f.id)) out[f.id]++;
  return out;
}

const KIND_LABEL: Record<ProposalKind, string> = {
  event: "Yes / no event",
  price: "Price at a deadline",
  builder: "Builder market",
  wonder: "Wonder market",
};
export const kindLabel = (k: ProposalKind) => KIND_LABEL[k] ?? k;

/** "submitted 2 h ago"; "" for an unreadable timestamp. */
export function ageLabel(createdAt: string, nowMs: number): string {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (mins < 1) return "submitted just now";
  if (mins < 60) return `submitted ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `submitted ${hours} h ago`;
  if (hours < 48) return "submitted yesterday";
  return `submitted ${Math.floor(hours / 24)} days ago`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "Dec 31, 23:00 UTC" this year, "Jan 5 2027, 09:05 UTC" another year. */
export function shortUtc(s: number, nowS: number): string {
  const t = new Date(s * 1000);
  const year = t.getUTCFullYear() === new Date(nowS * 1000).getUTCFullYear() ? "" : ` ${t.getUTCFullYear()}`;
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}${year}, ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())} UTC`;
}

/** "2026-10-02 14:03" as UTC unix seconds (the exact minute, no grid); null if not a real time. */
export function parseUtcMinute(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+|T)(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(ms).getUTCDate() === d ? ms / 1000 : null;
}

// ───────────────────────────── checks ─────────────────────────────

export interface Check { ok: boolean; text: string }
export interface CheckContext {
  nowS: number;
  /** duplicateOf(): "live market", another proposal's id, or null. */
  duplicate: string | null;
  /** The live market's question when `duplicate` is "live market". */
  liveMatch: string | null;
  /** Contracts and wallets we control (never a creator payee). */
  own: readonly string[];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** The review checklist, computed client-side: deadline, source, duplicates, creator wallet,
 *  then any other submission rule the proposal breaks. */
export function proposalChecks(p: Proposal, ctx: CheckContext): Check[] {
  const out: Check[] = [];
  const lead = p.deadline - ctx.nowS;
  if (p.deadline % GRID_S !== 0) out.push({ ok: false, text: "Deadline is off the 5-minute grid" });
  else if (lead < MIN_LEAD_S) out.push({ ok: false, text: "Deadline is less than 1 day away" });
  else if (lead > MAX_LEAD_S) out.push({ ok: false, text: "Deadline is more than 1 year away" });
  else {
    const days = Math.round(lead / 86_400);
    out.push({ ok: true, text: `Deadline is on the 5-minute grid and ${days} ${days === 1 ? "day" : "days"} away` });
  }

  if (p.kind === "price") out.push({ ok: true, text: "Answer source is the median of Coinbase, Kraken and OKX" });
  else {
    const host = /^https:\/\/\S+$/.test(p.source) ? hostOf(p.source) : null;
    out.push(host ? { ok: true, text: `Answer source is public (${host})` } : { ok: false, text: "Answer source is not a public https link" });
  }

  if (ctx.duplicate === null) out.push({ ok: true, text: "No live market or other proposal asks the same question" });
  else if (ctx.duplicate === "live market")
    out.push({ ok: false, text: `A live market asks the same question${ctx.liveMatch ? `: “${ctx.liveMatch}”` : ""}` });
  else out.push({ ok: false, text: `Proposal ${ctx.duplicate} asks the same question` });

  const payee = p.creatorPayee?.trim() ?? "";
  if (!payee) out.push({ ok: true, text: "No creator wallet: the creator share goes to the treasury" });
  else if (!isAddress(payee)) out.push({ ok: false, text: "Creator wallet is not a valid address (the share would go to the treasury)" });
  else if (payee.toLowerCase() === TREASURY.toLowerCase()) out.push({ ok: true, text: "Creator wallet is the treasury" });
  else if (ctx.own.some((a) => a.toLowerCase() === payee.toLowerCase())) out.push({ ok: false, text: "Creator wallet is a contract we control" });
  else out.push({ ok: true, text: "Creator wallet is a valid address (not a contract we control)" });

  const v = validateProposal(p, ctx.nowS);
  if (!v.ok && !["deadline", "source", "creatorPayee"].includes(v.field ?? "")) out.push({ ok: false, text: v.error });
  return out;
}

// ───────────────────────────── edit draft ─────────────────────────────

export interface Draft {
  question: string;
  rule: string;
  source: string;
  /** "YYYY-MM-DD HH:MM" (UTC), rounded down to the 5-minute grid when read. */
  deadlineText: string;
  creatorPayee: string;
  asset: ProposalAsset;
  comparator: 1 | 3;
  price: string;
}

export function draftOf(p: Proposal): Draft {
  return {
    question: p.question,
    rule: p.rule,
    source: p.source,
    deadlineText: formatUtcDeadline(p.deadline),
    creatorPayee: p.creatorPayee ?? "",
    asset: p.asset ?? "btc-usd",
    comparator: p.comparator ?? 1,
    price: p.price ?? "",
  };
}

/** The proposal as it would be after saving `d` (for the checks and the message preview). */
export function applyDraft(p: Proposal, d: Draft): { proposal: Proposal; deadlineError: string | null } {
  const deadline = parseUtcDeadline(d.deadlineText);
  const next: Proposal = {
    ...p,
    question: d.question.trim(),
    rule: d.rule.trim(),
    source: d.source.trim(),
    deadline: deadline ?? p.deadline,
    creatorPayee: d.creatorPayee.trim() || undefined,
  };
  if (p.kind === "price") Object.assign(next, { asset: d.asset, comparator: d.comparator, price: d.price.trim() });
  return { proposal: next, deadlineError: deadline === null ? "Write the deadline as YYYY-MM-DD HH:MM (UTC)." : null };
}

/** The PATCH body: every editable field of the proposal's kind. */
export function patchBody(p: Proposal, d: Draft): Record<string, unknown> {
  const deadline = parseUtcDeadline(d.deadlineText) ?? p.deadline;
  const body: Record<string, unknown> = {
    question: d.question.trim(), rule: d.rule.trim(), source: d.source.trim(), deadline, creatorPayee: d.creatorPayee.trim(),
  };
  if (p.kind === "price") Object.assign(body, { asset: d.asset, comparator: d.comparator, price: d.price.trim() });
  return body;
}

export const isDirty = (p: Proposal, d: Draft) =>
  JSON.stringify(patchBody(p, d)) !== JSON.stringify(patchBody(p, draftOf(p))) || parseUtcDeadline(d.deadlineText) === null;

// ───────────────────────────── the signed message ─────────────────────────────

const fixed = (v: bigint, decimals: number) => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const frac = decimals ? `.${(a % base).toString().padStart(decimals, "0")}` : "";
  return `${neg ? "-" : ""}${a / base}${frac}`;
};

/** The approval as the admin reads it before signing: every field of the typed data. */
export function approvalText(m: ApprovalMessage, nowS: number, opts: { nonceAtSigning?: boolean } = {}): string {
  const price = m.kind === 2;
  const cmp = m.comparator === 3 ? "≤" : "≥";
  const asset = PROPOSAL_ASSETS[m.asset as ProposalAsset];
  const threshold = price && asset ? `${cmp} ${m.threshold} (${fixed(m.threshold, asset.decimals)} USD)` : `${cmp} ${m.threshold}`;
  const treasury = m.creatorPayee.toLowerCase() === TREASURY.toLowerCase() ? " (treasury)" : "";
  const seed = m.seed === SEED ? "5 USDC" : `${fixed(m.seed, 6)} USDC`;
  return [
    `MarketApproval (Arc mainnet ${PROPOSAL_DOMAIN.chainId}, MarketsV4 ${shortAddr(PROPOSAL_DOMAIN.verifyingContract)})`,
    price ? `  kind       price-at-deadline   asset  ${m.asset}` : "  kind       curated-event",
    `  question   ${m.question}`,
    `  ruleHash   ${m.ruleHash}`,
    `  threshold  ${threshold.padEnd(6)}   expiry  ${m.expiry} (${shortUtc(Number(m.expiry), nowS)})`,
    `  seed       ${seed}   creatorPayee  ${m.creatorPayee}${treasury}`,
    `  proposal   #${m.proposalId}  ${opts.nonceAtSigning ? "nonce set when you sign" : `nonce ${m.nonce}`}`,
  ].join("\n");
}

/** M6: the nonce of the next signature: the clock in ms, but always above the admin's last
 *  used nonce (from the API), so a signature once made on a machine whose clock ran ahead
 *  cannot lock the admin out ("nonce already used"). */
export function nextNonce(nowMs: number, lastNonce: bigint): bigint {
  const now = BigInt(Math.floor(nowMs));
  return now > lastNonce ? now : lastNonce + 1n;
}

// ───────────────────────────── record outcome ─────────────────────────────

/** I1: when an outcome can still be recorded. The agent attests a yes/no proposal's
 *  outcome `attestAt` (the deadline + OUTCOME_GRACE_S), taking what reached it before;
 *  the form (and the API) close at `cutoff`, OUTCOME_PICKUP_S (10 min) earlier, so what
 *  is signed there does reach it. `attested`: the attest time itself has passed. */
export function outcomeWindow(
  deadline: number,
  nowS: number,
): { attestAt: number; cutoff: number; closed: boolean; attested: boolean; pastDeadline: boolean } {
  const cutoff = outcomeCutoff(deadline);
  const attestAt = deadline + OUTCOME_GRACE_S;
  return { attestAt, cutoff, closed: nowS > cutoff, attested: nowS >= attestAt, pastDeadline: nowS > deadline };
}

/** The closed form's text: before the attest time it says the agent attests then (not
 *  that it has), after it that it attested. */
export function tooLateText(deadline: number, nowS: number, recorded: boolean): string {
  const { attestAt, attested } = outcomeWindow(deadline, nowS);
  const when = shortUtc(attestAt, nowS);
  const what = recorded ? "the outcome recorded here" : "no outcome, so the market settles No";
  return attested
    ? `The agent attested this market’s outcome at ${when}, 30 minutes after the deadline, from what it had received by then (${what}). An outcome signed now would never be applied.`
    : `The agent attests this market’s outcome at ${when}, 30 minutes after the deadline, from what it has received by then (${what}). An outcome signed now might not reach it in time, so the form is closed.`;
}

/** The notice after an outcome is recorded: when the agent attests it and when the market settles. */
export function outcomeRecordedText(id: string, yes: boolean, deadline: number, nowS: number): string {
  const { attestAt } = outcomeWindow(deadline, nowS);
  const hours = Math.round(EVENT_DISPUTE_S / 3600);
  return `Outcome recorded for ${id}: ${yes ? "Yes" : "No"}. The agent picks it up within a few minutes and attests it at ${shortUtc(attestAt, nowS)}, 30 minutes after the deadline; the market settles when the ${hours}-hour dispute window after that ends.`;
}

export interface OutcomeProblem {
  field: "value" | "evidence" | "since" | "window";
  error: string;
  /** The field is still empty: signing is blocked but nothing needs saying yet. */
  blank: boolean;
}

/** What stops "Sign outcome", in form order: the window (outcomeWindow), then the fields.
 *  The outcome must be dated by the deadline (the agent ignores a later one): the market
 *  asks whether it happened by then, so a later Yes settles as No. */
export function outcomeProblems(f: { value: boolean | null; evidence: string; sinceText: string; deadline: number; nowS: number }): OutcomeProblem[] {
  const out: OutcomeProblem[] = [];
  if (outcomeWindow(f.deadline, f.nowS).closed)
    out.push({ field: "window", blank: false, error: "Too late — use the dispute process: an outcome signed now might not reach the agent before it attests." });
  if (f.value === null) out.push({ field: "value", blank: true, error: "Pick Yes or No." });
  const evidence = f.evidence.trim();
  if (!/^https:\/\/\S+$/.test(evidence)) out.push({ field: "evidence", blank: !evidence, error: "Give the evidence as a public https link." });
  else if (utf8Bytes(evidence) > EVIDENCE_URL_MAX_BYTES)
    out.push({ field: "evidence", blank: false, error: `Keep the evidence link under ${EVIDENCE_URL_MAX_BYTES} bytes: the agent ignores a longer one.` });
  const since = parseUtcMinute(f.sinceText);
  if (!f.sinceText.trim()) out.push({ field: "since", blank: true, error: "Write when it happened as YYYY-MM-DD HH:MM (UTC)." });
  else if (since === null) out.push({ field: "since", blank: false, error: "Write when it happened as YYYY-MM-DD HH:MM (UTC)." });
  else if (since > f.nowS) out.push({ field: "since", blank: false, error: "That time is in the future." });
  else if (since > f.deadline)
    out.push({
      field: "since",
      blank: false,
      error: f.value === false
        ? "Date a No at or before the deadline (the deadline itself is fine): the agent ignores a later date."
        : "The event must have happened by the deadline; a Yes dated after it settles as No.",
    });
  return out;
}
