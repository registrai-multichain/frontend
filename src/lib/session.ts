/**
 * One-click betting on the common markets: a session key the page keeps in this
 * browser. The owner signs once (a ledger allowance and MarketsV4.setSession,
 * which also forwards a little native USDC for gas); afterwards the page sends
 * buyFor / sellFor / redeemFor from the session key with no wallet pop-ups.
 *
 * The key only ever acts FOR the owner: positions, proceeds and payouts land in
 * the owner's ledger balance, buys are capped (spend cap) and everything stops
 * at the session's expiry or when the owner revokes it. What the key itself
 * holds is its gas money, which "End" sends back.
 */
import type { Address, Hex } from "viem";

/** Native value forwarded as the session key's gas (Arc's native USDC has 18 decimals): 0.25 USDC. */
export const SESSION_GAS = 250_000_000_000_000_000n;
/** Default session: 24 hours, up to 50 USDC of buys. */
export const SESSION_SECS = 24 * 3600;
export const SESSION_CAP = 50_000_000n;
/** Below this much gas left, the page asks for a new session (≈ 5 trades at 25 gwei). */
export const SESSION_GAS_LOW = 40_000_000_000_000_000n;
/** Don't start a trade on a session that ends within this many seconds. */
const EXPIRY_MARGIN = 30;

export interface LocalSession {
  /** The session key (never leaves this browser). */
  pk: Hex;
  delegate: Address;
  owner: Address;
  chainId: number;
  /** Unix seconds, as granted. */
  expiry: number;
}

/** On-chain state of the session: MarketsV4.sessions(owner, delegate) and the key's gas. */
export interface SessionChain {
  spendLeft: bigint;
  expiry: number;
  gas: bigint;
}

export const storageKey = (chainId: number, owner: Address) => `registrai.session.${chainId}.${owner.toLowerCase()}`;

export function parseSession(raw: string | null, chainId: number, owner: Address): LocalSession | undefined {
  if (!raw) return undefined;
  try {
    const s = JSON.parse(raw) as Partial<LocalSession>;
    if (
      typeof s.pk !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(s.pk) ||
      typeof s.delegate !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(s.delegate) ||
      typeof s.expiry !== "number" || s.chainId !== chainId ||
      typeof s.owner !== "string" || s.owner.toLowerCase() !== owner.toLowerCase()
    ) {
      return undefined;
    }
    return s as LocalSession;
  } catch {
    return undefined;
  }
}

export function loadSession(chainId: number, owner: Address): LocalSession | undefined {
  try {
    return parseSession(localStorage.getItem(storageKey(chainId, owner)), chainId, owner);
  } catch {
    return undefined;
  }
}

export function saveSession(s: LocalSession): void {
  try {
    localStorage.setItem(storageKey(s.chainId, s.owner), JSON.stringify(s));
  } catch {
    /* private mode: the session still works until the page closes */
  }
}

export function clearSession(chainId: number, owner: Address): void {
  try {
    localStorage.removeItem(storageKey(chainId, owner));
  } catch {
    /* nothing stored */
  }
}

export type SessionStatus = "none" | "pending" | "active" | "expired" | "spent" | "low-gas";

/** Where a stored session stands against the chain. "pending": stored here, not
 *  (yet) granted on chain (the setSession did not land). */
export function sessionStatus(local: LocalSession | undefined, chain: SessionChain | undefined, now: number): SessionStatus {
  if (!local) return "none";
  if (!chain || chain.expiry === 0) return "pending";
  if (now + EXPIRY_MARGIN >= chain.expiry) return "expired";
  if (chain.gas < SESSION_GAS_LOW) return "low-gas";
  if (chain.spendLeft === 0n) return "spent";
  return "active";
}

/** Can the session carry this trade without the wallet? A buy needs the spend
 *  cap and the owner's ledger allowance to cover it; a sell or a claim only a live session. */
export function sessionCovers(
  status: SessionStatus,
  chain: SessionChain | undefined,
  mode: "buy" | "sell" | "redeem",
  amount: bigint,
  allowance: bigint,
): boolean {
  if (!chain || (status !== "active" && status !== "spent")) return false;
  if (mode !== "buy") return true;
  return status === "active" && amount <= chain.spendLeft && amount <= allowance;
}
