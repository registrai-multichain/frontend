/**
 * Pure logic of the public "Propose a market" form and the proposal status page
 * (src/components/proposals). The shared model and validation live in
 * ./market-proposals; this file only turns form state into the API body and
 * derives what the status page shows.
 */
import { GRID_S, PROPOSAL_ASSETS, TREASURY, validateProposal, type Proposal, type ProposalAsset, type ProposalKind, type ProposalStatus } from "./market-proposals";
import { formatUsdc } from "./perennial-market";
import { BLOCK_SECS, LOG_CHUNK_BLOCKS, ROUNDS, scanLogs } from "./rounds";

/** The fixed settlement source of a price-at-a-deadline market (not an input). */
export const PRICE_SOURCE = "Median of Coinbase, Kraken and OKX, the 1-minute close at the deadline";

export interface ProposeFormState {
  kind: ProposalKind;
  /** Event and phase-2 kinds. */
  question: string;
  rule: string;
  source: string;
  /** "YYYY-MM-DD HH:MM", read as UTC. */
  deadlineText: string;
  why: string;
  creatorPayee: string;
  contact: string;
  /** Price kind. */
  asset: ProposalAsset;
  comparator: 1 | 3;
  price: string;
  /** The proposer's edit of the auto-filled price question; null = use the sentence. */
  priceQuestionEdit: string | null;
  /** Honeypot: a person never sees or fills it. */
  website2: string;
}

export const EMPTY_FORM: ProposeFormState = {
  kind: "event", question: "", rule: "", source: "", deadlineText: "", why: "", creatorPayee: "", contact: "",
  asset: "btc-usd", comparator: 1, price: "", priceQuestionEdit: null, website2: "",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-12-31 23:00" (also with a T or several spaces) as UTC unix seconds,
 *  rounded DOWN to the 5-minute grid; null when it is not a real date and time. */
export function parseUtcDeadline(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+|T)(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(ms).getUTCDate() !== d) return null; // Feb 30 rolls over
  const s = ms / 1000;
  return s - (s % GRID_S);
}

export function formatUtcDeadline(s: number): string {
  const t = new Date(s * 1000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())} ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** "Dec 31, 2026 at 23:00 UTC" */
export function humanUtc(s: number): string {
  const t = new Date(s * 1000);
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()} at ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())} UTC`;
}

const groupPrice = (price: string) => {
  const [int, frac] = price.split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac !== undefined ? `.${frac}` : ""}`;
};

/** "Will BTC be at least $100,000 on Dec 31, 2026 at 23:00 UTC?"; "" until price and deadline are given. */
export function priceQuestion(p: { asset: ProposalAsset; comparator: 1 | 3; price: string; deadline: number | null }): string {
  const price = p.price.trim();
  if (p.deadline === null || !/^\d+(\.\d+)?$/.test(price)) return "";
  const sym = PROPOSAL_ASSETS[p.asset].symbol;
  return `Will ${sym} be ${p.comparator === 3 ? "at most" : "at least"} $${groupPrice(price)} on ${humanUtc(p.deadline)}?`;
}

export type Submission = { ok: true; body: Record<string, unknown> } | { ok: false; error: string; field?: string };

/** Form state -> the POST body, checked with the same validation the API runs.
 *  The first problem reported is the first one in the form's visual order. */
export function prepareSubmission(f: ProposeFormState, nowS: number): Submission {
  const deadline = parseUtcDeadline(f.deadlineText);
  const deadlineError: Submission = { ok: false, field: "deadline", error: "Write the deadline as YYYY-MM-DD HH:MM, in UTC." };
  const common = { deadline: deadline ?? 0, why: f.why, creatorPayee: f.creatorPayee, contact: f.contact, website2: f.website2 };
  let body: Record<string, unknown>;
  if (f.kind === "price") {
    // shown first: asset, comparator, price, deadline; the question is built from them
    if (!/^\d+(\.\d+)?$/.test(f.price.trim())) return { ok: false, field: "price", error: "Give a positive price, e.g. 3000 or 0.52." };
    if (deadline === null) return deadlineError;
    const sentence = priceQuestion({ asset: f.asset, comparator: f.comparator, price: f.price, deadline });
    body = {
      kind: "price", question: f.priceQuestionEdit ?? sentence, rule: sentence, source: PRICE_SOURCE,
      asset: f.asset, comparator: f.comparator, price: f.price.trim(), ...common,
    };
  } else {
    body = { kind: f.kind, question: f.question, rule: f.rule, source: f.source.trim(), ...common };
  }
  const v = validateProposal(body, nowS);
  if (v.ok) return { ok: true, body };
  return v.field === "deadline" && deadline === null ? deadlineError : { ok: false, error: v.error, field: v.field };
}

export const statusHref = (id: string) => `/propose/status/?id=${encodeURIComponent(id)}`;

export type ChipTone = "pending" | "approved" | "opened" | "rejected" | "queued";
/** The status chip; `openedOnChain`: the agent's market for it was found on chain.
 *  Only that says Opened: the API never learns that a market was opened, so its
 *  own "opened" status reads as approved. `delayed` (I3): approved more than
 *  OPENING_DELAY_S ago and the chain, read completely, has no market for it. */
export function statusChip(status: ProposalStatus, openedOnChain: boolean, delayed = false): { label: string; tone: ChipTone } {
  if (openedOnChain) return { label: "Opened", tone: "opened" };
  switch (status) {
    case "approved":
    case "opened": return { label: delayed ? "Approved — opening delayed" : "Approved — opening shortly", tone: "approved" };
    case "rejected": return { label: "Not approved", tone: "rejected" };
    case "queued": return { label: "Phase 2 queue", tone: "queued" };
    default: return { label: "Pending review", tone: "pending" };
  }
}

/** The rounds agent's feed for a proposal: "registrai-data:p-<id>" (key "p-<id>"). */
export const proposalFeedKey = (id: string) => `p-${id}`;
export const proposalFeedDescription = (id: string, prefix = ROUNDS.descriptionPrefix) => `${prefix}${proposalFeedKey(id)}`;

export function sumCreatorFees(logs: readonly { args: { creatorFee?: bigint } }[]): bigint {
  return logs.reduce((s, l) => s + (l.args.creatorFee ?? 0n), 0n);
}

/** First block to scan for the proposal's feed: a little before it was made (the
 *  feed comes after approval), never before the rounds deployment. */
export function proposalScanStart(head: bigint, headTs: number, createdAtS: number, deployBlock: bigint, marginBlocks = 1_200n): bigint {
  const back = BigInt(Math.max(0, Math.ceil((headTs - createdAtS) / BLOCK_SECS))) + marginBlocks;
  const from = head > back ? head - back : 0n;
  return from > deployBlock ? from : deployBlock;
}

/** scanLogs over [from, to] one window at a time, stopping after the first window
 *  where `found(logs so far)` holds (a proposal's feed and market sit close
 *  together, usually long before the head). A failed chunk ends it incomplete. */
export async function scanForward<T>(
  fetchRange: (from: bigint, to: bigint) => Promise<readonly T[]>,
  from: bigint,
  to: bigint,
  found: (logs: readonly T[]) => boolean,
  window = 100_000n,
  chunk: bigint = LOG_CHUNK_BLOCKS,
): Promise<{ logs: T[]; scannedTo: bigint; complete: boolean }> {
  const logs: T[] = [];
  let scannedTo = from - 1n;
  for (let start = from; start <= to; start += window) {
    const end = start + window - 1n < to ? start + window - 1n : to;
    const r = await scanLogs(fetchRange, start, end, chunk);
    logs.push(...r.logs);
    if (r.scannedTo >= start) scannedTo = r.scannedTo;
    if (!r.complete) return { logs, scannedTo, complete: false };
    if (found(logs)) break;
  }
  return { logs, scannedTo, complete: true };
}

// ───────────── bounded status reads (R13) ─────────────

/** Fees are paid only while trading is open: scan FeesPaid up to the market's
 *  expiry block (estimated from its creation time at BLOCK_SECS) plus a 600-block
 *  margin, never past the head. */
export function feesScanEnd(head: bigint, marketBlock: bigint, marketTs: number, expiry: number, blockSecs = BLOCK_SECS, marginBlocks = 600n): bigint {
  const ahead = BigInt(Math.max(0, Math.ceil((expiry - marketTs) / blockSecs)));
  const end = marketBlock + ahead + marginBlocks;
  return end < head ? end : head;
}

/** Scan progress cached per proposal (sessionStorage), so a reload scans only the
 *  new range. Blocks and amounts are decimal strings (bigint is not JSON). */
export interface ScanCache {
  feed: { scannedTo: string; feedId?: string };
  market?: { scannedTo: string; marketId?: string; blockNumber?: string; createdTs?: number; expiry?: number };
  fees?: { scannedTo: string; sum: string };
  /** NanoLedger InternalTransfer(agent -> payee) after the market's block (R37). */
  fwd?: { scannedTo: string; sum: string; payee: string };
}

/** The new "scanned to" after a pass over [from, scannedTo]: it advances only
 *  when the pass continues the cached range without a gap, and never goes back. */
export function mergeScanProgress(prev: bigint | undefined, from: bigint, scannedTo: bigint): bigint | undefined {
  if (prev !== undefined && from > prev + 1n) return prev;
  if (scannedTo < from) return prev;
  return prev === undefined || scannedTo > prev ? scannedTo : prev;
}

/** Add a fee pass over [from, scannedTo] (sum `add`) to the cached total. */
export function mergeFeeProgress(prev: ScanCache["fees"], from: bigint, scannedTo: bigint, add: bigint): NonNullable<ScanCache["fees"]> | undefined {
  const before = prev ? BigInt(prev.scannedTo) : undefined;
  if (scannedTo < from || (before !== undefined && from !== before + 1n)) return prev;
  return { scannedTo: scannedTo.toString(), sum: ((prev ? BigInt(prev.sum) : 0n) + add).toString() };
}

const DEC = /^\d+$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDR = /^0x0{40}$/;

/**
 * Where the agent forwards a proposed market's creator share: the approval's signed
 * creatorPayee (the proposal's before it is signed), and the treasury (RegiFeeSplitter) when it is
 * empty, not an address, the zero address, or one of the agent's own contracts (as
 * the agent's forward_payee does). Lower-case.
 */
export function forwardPayee(
  p: Pick<Proposal, "creatorPayee" | "approval">,
  own: { agent: string; ledger?: string | null; markets?: string | null } = { agent: ROUNDS.agent, ledger: ROUNDS.contracts.NanoLedger, markets: ROUNDS.contracts.MarketsV4 },
  treasury: string = TREASURY,
): string {
  // Once signed, the approval decides (its zero address means the treasury).
  const signed = p.approval?.message;
  const raw = signed ? (typeof signed.creatorPayee === "string" ? signed.creatorPayee : "") : p.creatorPayee ?? "";
  const a = raw.toLowerCase();
  const refused = [own.agent, own.ledger, own.markets].some((x) => x && x.toLowerCase() === a);
  return ADDR.test(a) && !ZERO_ADDR.test(a) && !refused ? a : treasury.toLowerCase();
}
const optStr = (v: unknown) => v === undefined || typeof v === "string";
const optNum = (v: unknown) => v === undefined || (typeof v === "number" && Number.isFinite(v));

/** A stored cache, or null when it is missing or not the expected shape. */
export function parseScanCache(raw: string | null): ScanCache | null {
  if (!raw) return null;
  let c: unknown;
  try {
    c = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const { feed, market, fees } = c as Record<string, Record<string, unknown> | undefined>;
  if (!feed || typeof feed.scannedTo !== "string" || !DEC.test(feed.scannedTo) || !optStr(feed.feedId)) return null;
  if (market !== undefined) {
    if (typeof market.scannedTo !== "string" || !DEC.test(market.scannedTo) || !optStr(market.marketId)) return null;
    if (!(market.blockNumber === undefined || (typeof market.blockNumber === "string" && DEC.test(market.blockNumber)))) return null;
    if (!optNum(market.createdTs) || !optNum(market.expiry)) return null;
  }
  if (fees !== undefined && (typeof fees.scannedTo !== "string" || !DEC.test(fees.scannedTo) || typeof fees.sum !== "string" || !DEC.test(fees.sum))) return null;
  const { fwd } = c as Record<string, Record<string, unknown> | undefined>;
  if (fwd !== undefined) {
    if (typeof fwd.scannedTo !== "string" || !DEC.test(fwd.scannedTo) || typeof fwd.sum !== "string" || !DEC.test(fwd.sum)) return null;
    if (typeof fwd.payee !== "string" || !ADDR.test(fwd.payee)) return null;
  }
  return c as ScanCache;
}

/** A creator-share amount to 4 decimals (rounded down): "0.2791 USDC", "< 0.0001 USDC" for a
 *  share under a hundredth of a cent, "0 USDC". shareExact gives all 6 (the title tooltip). */
export function shareText(v: bigint): string {
  return v > 0n && v < 100n ? "< 0.0001 USDC" : `${formatUsdc(v, 4)} USDC`;
}
/** The exact amount, all 6 decimals: "0.279123 USDC". */
export function shareExact(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0")} USDC`;
}

/** What the status page shows as forwarded for this market (R42): the agent's
 *  transfers to the payee name no market, so their sum counts payouts for the payee's
 *  other markets too (every treasury-bound proposal shares one payee). Shown up to
 *  this market's earned share; unknown (undefined) while either total is unknown. */
export function forwardedShown(forwarded: bigint | null | undefined, earned: bigint | null | undefined): bigint | undefined {
  if (forwarded === null || forwarded === undefined || earned === null || earned === undefined) return undefined;
  return forwarded < earned ? forwarded : earned;
}

/** The payee is the treasury (compare forwardPayee's lower-case result). */
export const isTreasury = (payee: string, treasury: string = TREASURY) => payee.toLowerCase() === treasury.toLowerCase();

