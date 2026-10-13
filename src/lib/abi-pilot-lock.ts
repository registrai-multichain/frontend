/**
 * Points pilot: the REGI lock in the browser (plan docs/superpowers/plans/2026-10-13-pilot-regi-usd-gate-and-lock.md
 * R6). The contracts (contracts repo src/regilock): one RegiVault per wallet, made by RegiLockFactory. The wallet locks
 * with REGI.approve(factory, amount) + factory.lock(amount), withdraws with vault.withdraw(amount, to) and claims the
 * REGI holder distributions the locked REGI keeps collecting with vault.claimRewards(to). The pilot only reads.
 *
 * Pure: the ABIs, the reads the panel makes, and the arithmetic the ticket and the lock box share.
 */
import { LOCK_HEADROOM, REGI_UNIT, type PilotAccountView } from "./abi-pilot-api";

/** The RegiLockFactory functions the page uses. */
export const LOCK_FACTORY_ABI = [
  { type: "function", name: "lock", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [{ name: "v", type: "address" }] },
  { type: "function", name: "lockedOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "vaultOf", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "address" }] },
] as const;

/** The RegiVault functions the page uses (owner only). */
export const VAULT_ABI = [
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "to", type: "address" }], outputs: [] },
  { type: "function", name: "claimRewards", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] },
] as const;

/** REGI (ERC-20). */
export const REGI_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

/** What the panel read from Arc for the signed-in wallet (null: not read, or the read failed). */
export interface LockChain {
  /** REGI in the wallet. */
  regi: bigint | null;
  /** REGI in its vault (lockedOf). */
  locked: bigint | null;
  /** Its vault, once made (vaultOf; null before the first lock). */
  vault: string | null;
  /** REGI the factory may move (allowance). */
  allowance: bigint | null;
}
export const NO_CHAIN: LockChain = { regi: null, locked: null, vault: null, allowance: null };

const req = (s: string | null) => (s === null ? null : BigInt(s));

/** Leverage above 1× is unlocked: a factory is set, the price is known and the lock holds at least today's requirement. */
export function leverageUnlocked(view: Pick<PilotAccountView, "lockFactory" | "lockRegi">, chain: LockChain): boolean {
  const need = req(view.lockRegi);
  return view.lockFactory !== null && need !== null && chain.locked !== null && chain.locked >= need;
}

/** The wallet holds the admission amount (null: unknown). */
export function admitted(view: Pick<PilotAccountView, "admitRegi">, chain: LockChain): boolean | null {
  const need = req(view.admitRegi);
  return need === null || chain.regi === null ? null : chain.regi >= need;
}

/** The lock form's default: the requirement + 5%, less what is locked already (whole REGI, rounded up); 0 when enough is locked. */
export function defaultLock(lockRegi: string | null, locked: bigint | null): bigint {
  const need = req(lockRegi);
  if (need === null) return 0n;
  const target = need + (need * BigInt(Math.round(LOCK_HEADROOM * 1000)) + 999n) / 1000n;
  const gap = target - (locked ?? 0n);
  if (gap <= 0n) return 0n;
  return ((gap + REGI_UNIT - 1n) / REGI_UNIT) * REGI_UNIT;
}

/** "1,234,567.5" or "1234567.5" (REGI) → raw; null when it is not a positive amount with at most 18 decimals. */
export function parseRegi(text: string): bigint | null {
  const s = text.replace(/[,\s_]/g, "");
  const m = /^(\d{1,15})(?:\.(\d{1,18}))?$/.exec(s);
  if (!m) return null;
  const raw = BigInt(m[1]) * REGI_UNIT + BigInt((m[2] ?? "").padEnd(18, "0") || "0");
  return raw > 0n ? raw : null;
}

/** Whole REGI for the amount input (no separators). */
export const regiInput = (raw: bigint) => (raw / REGI_UNIT).toString();

/** "≈ $12.34" for a raw REGI amount at a USD-per-REGI price. */
export function usdOf(raw: bigint, price: number | null): string | null {
  if (price === null) return null;
  const usd = (Number(raw / 10n ** 12n) / 1e6) * price;
  return `≈ $${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
