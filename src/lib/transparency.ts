/**
 * app.registrai.cc/transparency: who holds which key, where fees go, the REGI
 * buyback, the contracts and the public record, for Arc MAINNET. Everything
 * here is either read from the deployment file or live from chain; the prose is
 * what each wallet/role is for, so a reader can check it against the explorer.
 */
import { keccak256, toBytes, type Address, type Hex } from "viem";
import deployment from "./deployments/arc-mainnet.json";
import record from "../data/transparency-record.json";
import { shortHex } from "./perennial-market";
import { REGI_CONTRACT, REGI_DEXSCREENER_URL } from "./regi";

const B = deployment.builders as unknown as {
  BuilderRegistry: Address;
  CaretakerRegistry: Address;
  VerifiedBuilderBadge: Address;
  operator: Address;
  deployBlock: number;
  deployedAt: string;
  roles: { adminSafe: Address; onboarder: Address; deployer: Address };
};

export type WalletKey = "safe" | "operator" | "onboarder" | "deployer";
export interface WalletInfo { key: WalletKey; label: string; address: Address; isSafe: boolean; what: string; cannot: string }

export const WALLETS: WalletInfo[] = [
  {
    key: "safe", label: "Admin Safe", address: B.roles.adminSafe, isSafe: true,
    what: "Grants and removes every role, registers builders who ask for gas-free registration, revokes badges, and recovers builders who lost their key.",
    cannot: "Act alone: every transaction needs 2 of its 3 owners to sign.",
  },
  {
    key: "operator", label: "Keeper operator", address: B.operator, isSafe: false,
    what: "Runs the builders keeper every 10 minutes: re-checks every project proof and marks a badge lapsed, or verified again, to match.",
    cannot: "Issue or revoke badges, register builders, or grant roles.",
  },
  {
    key: "onboarder", label: "Onboarder", address: B.roles.onboarder, isSafe: false,
    what: "Onboards a verified builder: links it to the keeper and issues its Verified Builder Badge.",
    cannot: "Revoke badges, register builders, or grant roles. The Safe can remove its roles at any time.",
  },
  {
    key: "deployer", label: "Deployer", address: B.roles.deployer, isSafe: false,
    what: `Deployed the three contracts on ${B.deployedAt}.`,
    cannot: "Anything: it gave up every role after the deploy.",
  },
];

const byAddress = new Map(WALLETS.map((w) => [w.address.toLowerCase(), w]));
/** A known wallet's name, else a short address. */
export const holderLabel = (address: string) => byAddress.get(address.toLowerCase())?.label ?? shortHex(address);

export type ContractKey = "registry" | "caretakers" | "badge";
export interface ContractInfo { key: ContractKey; name: string; address: Address; what: string; audit: string }

export const CONTRACTS: ContractInfo[] = [
  { key: "registry", name: "BuilderRegistry", address: B.BuilderRegistry, audit: "audited",
    what: "Every builder and project: who claimed it, with which wallet, and whether it is active." },
  { key: "caretakers", name: "CaretakerRegistry", address: B.CaretakerRegistry, audit: "audited",
    what: "Which keeper looks after each builder's milestones." },
  { key: "badge", name: "VerifiedBuilderBadge", address: B.VerifiedBuilderBadge, audit: "audited",
    what: "The soulbound Verified Builder Badge: one per builder, numbered in the order they were verified." },
];
export const DEPLOY = { block: B.deployBlock, date: B.deployedAt };

const role = (name: string, what: string) => ({
  name,
  hash: (name === "DEFAULT_ADMIN_ROLE" ? `0x${"0".repeat(64)}` : keccak256(toBytes(name))) as Hex,
  what,
});
export const ROLES: Record<ContractKey, { name: string; hash: Hex; what: string }[]> = {
  registry: [role("DEFAULT_ADMIN_ROLE", "grants and removes roles"), role("REGISTRAR_ROLE", "registers builders and adds projects for them")],
  caretakers: [role("DEFAULT_ADMIN_ROLE", "grants and removes roles"), role("GOVERNOR_ROLE", "links a builder to its keeper")],
  badge: [
    role("DEFAULT_ADMIN_ROLE", "grants and removes roles"),
    role("ISSUER_ROLE", "issues a badge"),
    role("STATUS_ROLE", "marks a badge lapsed or verified again"),
    role("REVOKER_ROLE", "revokes a badge for good"),
  ],
};

export const FEE_SPLITS = [
  {
    market: "Perennial markets (about builders)",
    legs: [
      { pct: 50, to: "the builder the market is about, paid out after each epoch (a progressive tax funds the season pool)" },
      { pct: 30, to: "whoever opened the market" },
      { pct: 20, to: "the agent that settles it, held until it does" },
    ],
  },
  {
    market: "Common markets (5-minute rounds and events)",
    legs: [
      { pct: 50, to: "the Registrai treasury (part of it funds the REGI buyback and burn)" },
      { pct: 30, to: "whoever opened the market" },
      { pct: 20, to: "the agent that settles it" },
    ],
  },
];

export const BUYBACK = {
  triggerUsdc: 500,
  chunkUsdc: 100,
  /** Share of the treasury's fee income; null until announced. */
  shareOfTreasuryPct: null as number | null,
  burnAddress: "0x000000000000000000000000000000000000dEaD" as Address,
  token: REGI_CONTRACT as Address,
  poolUrl: REGI_DEXSCREENER_URL,
};

export interface RecordEntry { date: string; title: string; detail?: string; tx?: string; address?: string }
export const RECORD: RecordEntry[] = [...(record as RecordEntry[])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

/** Arc's native gas token is USDC with 18 decimals; the site's money helpers use 6. */
export const nativeToUsdc = (v: bigint) => v / 1_000_000_000_000n;
