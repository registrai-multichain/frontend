import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  parseAbi,
  type Abi,
  type Hex,
  type PublicClient,
} from "viem";
import { builderFundAbi, builderRegistryAbi, marketsPerennialAbi, marketsV4Abi, nanoLedgerAbi, seasonPoolAbi } from "./abi";

/**
 * Custom errors we know how to explain, by name. Covers MarketsPerennial /
 * MarketsV4 (incl. SettlementPolicy), NanoLedger, BuilderRegistry, BuilderFund, SeasonPool,
 * plus errors the next contract release adds (AgentNotApproved,
 * ResolverNotApproved) so they read well before abi.ts is regenerated.
 *
 * Fee model v3 (1% trading fee, agent share escrowed) removes no error: the
 * removed members (FEE_BPS_TOTAL, setFeeSplit, forfeitSink, ...) were views and
 * setters, BadSplit only guarded setFeeSplit (never user-facing), and
 * AgentNotApproved survives on MarketsPerennial (MarketsV4 agents become
 * permissionless). A void pays out through redeem, whose "nothing to pay"
 * revert is still InsufficientShares.
 */
const ERROR_MESSAGES: Record<string, string> = {
  // markets: lifecycle
  MarketMissing: "That market does not exist on this contract.",
  MarketExists: "A market with these exact parameters already exists.",
  NotTrading: "This market is no longer trading.",
  MarketExpired: "Trading on this market has closed (it reached expiry).",
  MarketNotExpired: "The market has not reached expiry yet.",
  AlreadyResolved: "This market has already been settled.",
  NotResolved: "This market has not been settled yet — nothing to redeem or claim.",
  SettlementPending:
    "No finalized attestation settles this market yet. It can be resolved once the agent's first attestation after expiry finalizes.",
  NotVoidable:
    "This market can't be voided: its settlement window is still open, or a valid attestation already settles it.",
  FeedUnsettleable:
    "That feed can't settle markets: its dispute window is longer than the market's resolution grace, so an honest agent could be voided out of its fee.",
  // markets: trading
  SlippageExceeded: "The price moved past your slippage tolerance. Refresh the quote and try again, or raise the tolerance.",
  AmountTooLow: "Amount too small to trade — it would round to zero shares.",
  LiquidityTooLow: "Amount too low. Markets need at least 5 USDC of liquidity, and trades must be above zero.",
  InsufficientShares: "You don't hold enough shares for that (or have nothing left to redeem or refund).",
  NoLPShares: "This address has no liquidity to claim in this market (already claimed, or never provided).",
  BadExpiry: "Expiry must be in the future.",
  // markets: who may create
  BuilderInactive:
    "That builder is not active on the registry: markets about it can't be opened, and its income and season rewards can't be paid until it is reactivated.",
  AgentNotRegistered: "That agent is not an active, bonded agent on this feed. Register and bond it on the feed first.",
  AgentNotApproved: "That feed/agent pair is not approved for new markets.",
  ResolverNotApproved: "That feed's dispute resolver is not approved for new markets.",
  SelfResolvedFeed: "That feed's agent is also its own dispute resolver, so it can't back a market.",
  ReserveDepleted: "That trade would empty one side of the pool. Try a smaller amount.",
  ZeroAddress: "An address this call needs was empty (zero address).",
  // ledger
  InsufficientBalance: "Not enough balance in your trading account. Deposit first.",
  InsufficientAllowance: "Trading-account allowance too low. Try again — the approval step runs first.",
  ZeroAmount: "Enter an amount above zero.",
  // builders
  AlreadyRegistered: "This address is already registered.",
  NotRegistered: "This address is not registered.",
  NotOwner: "Only the builder's owner can do that.",
  // builder income (BuilderFund) and the season pool (SeasonPool)
  AlreadyClaimed: "Already claimed (this epoch's income, or this season's reward, was paid).",
  EpochNotEnded: "That epoch has not ended yet: its income becomes claimable once it does.",
  NoIncome: "This builder earned no income in that epoch, so there is nothing to claim.",
  UnknownSeason: "That season has not been published.",
  SeasonClosed: "That season's claim deadline has passed.",
  AboveCap: "That amount is above the season's 20% per-builder cap.",
  InvalidProof: "The merkle proof does not match the season's published root.",
  ExceedsSeason: "That claim would pay out more than the season's total.",
  // builder projects, ownership, recovery (BuilderRegistry) and the badge
  TooLong: "That text is too long for the registry (a project source is at most 128 bytes).",
  EmptySource: "The project source is empty.",
  TooManyProjects: "This builder has used all 16 project slots (removed projects keep theirs).",
  UnknownProject: "That project does not exist.",
  InactiveBuilder: "This builder is deactivated on the registry.",
  NotPendingOwner: "This wallet is not the proposed new owner of that builder.",
  NoRecovery: "There is no pending recovery for that builder.",
  RecoveryNotReady: "The recovery's 7-day waiting period has not passed yet.",
  NoBadge: "This builder has no Verified Builder Badge.",
  NoProject: "The builder needs at least one active project for a badge.",
  AlreadyIssued: "This builder already has a badge.",
};

const EXTRA_ERRORS = parseAbi([
  "error AgentNotApproved()",
  "error ResolverNotApproved()",
  "error TooLong()",
  "error EmptySource()",
  "error TooManyProjects()",
  "error UnknownProject()",
  "error InactiveBuilder()",
  "error NotPendingOwner()",
  "error NoRecovery()",
  "error RecoveryNotReady()",
  "error NoBadge()",
  "error NoProject()",
  "error AlreadyIssued()",
  "error Error(string)",
]);

const DECODE_ABIS: Abi[] = [
  marketsPerennialAbi as Abi,
  marketsV4Abi as Abi,
  nanoLedgerAbi as Abi,
  builderRegistryAbi as Abi,
  builderFundAbi as Abi,
  seasonPoolAbi as Abi,
  EXTRA_ERRORS as Abi,
];

/** Decode raw revert data against every ABI we know. */
export function decodeRevertData(data: Hex | undefined): string | undefined {
  if (!data || data === "0x" || data.length < 10) return undefined;
  for (const abi of DECODE_ABIS) {
    try {
      const r = decodeErrorResult({ abi, data });
      if (r.errorName === "Error" && Array.isArray(r.args)) return `Error:${String(r.args[0])}`;
      return r.errorName;
    } catch {
      // try the next ABI
    }
  }
  return undefined;
}

/** Best-effort custom-error name from a viem / wallet error. */
export function revertName(e: unknown): string | undefined {
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted?.data?.errorName) return reverted.data.errorName;
    if (reverted?.raw) {
      const n = decodeRevertData(reverted.raw);
      if (n) return n;
    }
    const withData = e.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | null;
    const n = decodeRevertData(withData?.data);
    if (n) return n;
  }
  const raw = e instanceof Error ? e.message : String(e ?? "");
  for (const name of Object.keys(ERROR_MESSAGES)) {
    if (new RegExp(`\\b${name}\\b`).test(raw)) return name;
  }
  return undefined;
}

function messageForName(name: string): string | undefined {
  if (name.startsWith("Error:")) return `Transaction reverted: ${name.slice(6)}`;
  return ERROR_MESSAGES[name];
}

export interface HumanizeOptions {
  /** Whether the relevant network is a testnet (drives faucet hints). */
  testnet?: boolean;
  /** Network name for "wrong network" copy, e.g. "Arc testnet". */
  networkName?: string;
}

/**
 * Map raw viem / wallet errors into a single sentence a non-dev user can act on.
 * Falls through to a generic message rather than the raw stack trace so the
 * UI never displays "ContractFunctionExecutionError: execution reverted…"
 * to a fresh visitor.
 */
export function humanizeError(e: unknown, opts: HumanizeOptions = {}): string {
  const testnet = opts.testnet ?? true;
  const network = opts.networkName ?? (testnet ? "Arc testnet" : "Arc");
  const raw =
    e instanceof Error
      ? `${e.message}`
      : typeof e === "string"
        ? e
        : String(e);
  const s = raw.toLowerCase();

  // Wallet-side rejections (most common case)
  if (s.includes("user rejected") || s.includes("user denied") || s.includes("rejected the request"))
    return "Signature cancelled in your wallet.";

  // Custom errors — decoded from revert data when present.
  const name = revertName(e);
  if (name) {
    const m = messageForName(name);
    if (m) return m;
  }

  if (s.includes("eip-1193")) return "Wallet refused the request.";

  // No funds
  if (s.includes("transfer amount exceeds balance") || s.includes("insufficient balance"))
    return testnet
      ? "Not enough testnet USDC in your wallet. Grab some from faucet.circle.com."
      : "Not enough USDC in your wallet.";
  if (s.includes("insufficient funds") || s.includes("exceeds the balance"))
    return testnet
      ? "Not enough gas. Top up testnet USDC at faucet.circle.com (gas is paid in USDC on Arc)."
      : "Not enough USDC for gas (gas is paid in USDC on Arc). Keep a little USDC in your wallet.";
  if (s.includes("erc20: transfer amount exceeds allowance"))
    return "Token allowance too low. Try again — the approval step should run first.";

  // Slippage / market state (string fallback for wallets that flatten errors)
  if (s.includes("slippageexceeded")) return ERROR_MESSAGES.SlippageExceeded;
  if (s.includes("marketexpired")) return ERROR_MESSAGES.MarketExpired;
  if (s.includes("marketnotexpired") || s.includes("nottrading"))
    return "Market not in tradable state.";
  if (s.includes("alreadyresolved")) return ERROR_MESSAGES.AlreadyResolved;

  // Bonding / agents
  if (s.includes("bondtoolow"))
    return "Bond is below the feed's minimum (10 USDC for first-party feeds).";
  if (s.includes("alreadyregistered"))
    return "This address is already registered as an agent on this feed.";
  if (s.includes("agentinactive"))
    return "Agent is not active — likely missing bond or slashed.";
  if (s.includes("agenthasrule"))
    return "Agent is rule-bound — use the verifiable submission path.";
  if (s.includes("agenthasnorule"))
    return "Agent is not rule-bound — use the plain submission path.";

  // RPC / network
  // Some third-party Arc endpoints (often pre-configured in wallets from
  // hackathon docs) reject writes with this error. Point the wallet's Arc
  // network at Circle's official RPC instead.
  if (
    s.includes("version of json-rpc protocol is not supported") ||
    s.includes("json-rpc protocol is not supported") ||
    s.includes("jsonrpc version")
  )
    return `Your wallet's Arc RPC is rejecting the transaction. In your wallet's network settings for ${network}, set the RPC URL to Circle's official endpoint (${testnet ? "https://rpc.testnet.arc.io" : "https://rpc.mainnet.arc.io"}) and retry.`;
  if (s.includes("network") && (s.includes("disconnected") || s.includes("error")))
    return "Network issue. Check your RPC and try again.";
  if (s.includes("nonce too low"))
    return "Nonce out of sync. Refresh and try again.";
  if (s.includes("execution reverted"))
    return "Transaction reverted onchain. The conditions weren't met — try smaller size or different parameters.";

  // Connection
  if (s.includes("no wallet"))
    return "No wallet detected. Install MetaMask or Rabby first.";
  if (s.includes("chain mismatch") || s.includes("unrecognized chain"))
    return `Wrong network. Switch your wallet to ${network}.`;

  // Fall through — clip the raw message
  const generic = raw.replace(/\n.*/s, "").slice(0, 140);
  return generic || "Something went wrong.";
}

/**
 * A transaction was mined but reverted. Replay it as an eth_call at its block
 * to recover the custom error, so the user sees *why* (not just "reverted").
 * Best effort: state at the end of the block can differ from the tx's position.
 */
export async function explainMinedRevert(
  client: PublicClient,
  hash: Hex,
  opts: HumanizeOptions = {},
): Promise<string> {
  try {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash }),
      client.getTransactionReceipt({ hash }),
    ]);
    await client.call({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      blockNumber: receipt.blockNumber,
    });
  } catch (e) {
    const name = revertName(e);
    const m = name ? messageForName(name) : undefined;
    if (m) return m;
    return humanizeError(e, opts);
  }
  return "The transaction reverted onchain (the reason could not be recovered).";
}
