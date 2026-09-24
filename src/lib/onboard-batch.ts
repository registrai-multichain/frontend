/**
 * The multisig's onboarding batch, as data. Pure: scripts/onboard-batch.ts does
 * the chain reads and proof fetches, this decides what goes in the batch and
 * renders it as a Safe Transaction Builder file plus a plain calldata list.
 * Nothing here signs or sends. With a badge contract (`--badge`) the batch also
 * issues Verified Builder Badges (VerifiedBuilderBadge.issue, ISSUER_ROLE = the Safe).
 */
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { verifiedBuilderAbi, type BuilderRecord } from "./verified-builders-chain";
import { profileURIFor } from "./verified-builders";
import { badgeAbi } from "./verified-builder-badge";

export interface PlannedTx {
  kind: "setCaretaker" | "registerFor" | "issue" | "revoke";
  to: Address;
  value: "0";
  data: Hex;
  /** One human line: what this call does. */
  label: string;
}

/** A `--register <source>` candidate after its proof was fetched + validated. */
export interface RegistrationCandidate {
  source: string;
  /** claim.builder from a valid proof, or null when the proof was not valid. */
  builder: Address | null;
  proofError?: string;
  /** BuilderRegistry.builderIdOf(builder); 0 = not registered. */
  existingId: number;
}

export interface OnboardingPlan {
  txs: PlannedTx[];
  skipped: { what: string; reason: string }[];
}

export function planOnboarding(opts: {
  records: Pick<BuilderRecord, "builderId" | "status" | "source" | "owner">[];
  registrations: RegistrationCandidate[];
  builderRegistry: Address;
  caretakerRegistry: Address;
  operator: Address;
  /** `--badge`: issue the Verified Builder Badge to every pending builder (right
   *  after its setCaretaker) and to every verified builder without one.
   *  `serials` = serialOf(builderId) as read; a missing entry counts as 0. */
  badge?: { address: Address; serials: ReadonlyMap<number, number> };
}): OnboardingPlan {
  const txs: PlannedTx[] = [];
  const skipped: OnboardingPlan["skipped"] = [];

  // registerFor first: separate builders from the setCaretaker calls (a builder
  // registered here gets its caretaker in the NEXT batch, once its id exists).
  const onChainSources = new Map(opts.records.filter((r) => r.source).map((r) => [r.source!, r.builderId]));
  const queued = new Set<string>();
  for (const c of opts.registrations) {
    const what = `registerFor ${c.source}`;
    if (!c.builder) { skipped.push({ what, reason: c.proofError ?? "proof not valid" }); continue; }
    if (c.existingId !== 0) { skipped.push({ what, reason: `${c.builder} is already builder #${c.existingId}` }); continue; }
    if (onChainSources.has(c.source)) { skipped.push({ what, reason: `source already registered as builder #${onChainSources.get(c.source)}` }); continue; }
    if (queued.has(c.source) || queued.has(c.builder.toLowerCase())) { skipped.push({ what, reason: "duplicate in this batch" }); continue; }
    queued.add(c.source).add(c.builder.toLowerCase());
    txs.push({
      kind: "registerFor",
      to: opts.builderRegistry,
      value: "0",
      data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "registerFor", args: [getAddress(c.builder), profileURIFor(c.source)] }),
      label: `registerFor(${getAddress(c.builder)}, "${profileURIFor(c.source)}")`,
    });
  }

  // Lapsed and unverified builders never get a badge; pending ones get theirs
  // in the same batch that makes them verified, after the setCaretaker.
  const badge = opts.badge;
  for (const r of opts.records) {
    if (r.status !== "pending" && r.status !== "verified") continue;
    if (r.status === "pending") {
      txs.push({
        kind: "setCaretaker",
        to: opts.caretakerRegistry,
        value: "0",
        data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "setCaretaker", args: [BigInt(r.builderId), opts.operator] }),
        label: `setCaretaker(${r.builderId}, ${opts.operator})  # ${r.source}`,
      });
    }
    if (badge && (badge.serials.get(r.builderId) ?? 0) === 0) {
      txs.push({
        kind: "issue",
        to: badge.address,
        value: "0",
        data: encodeFunctionData({ abi: badgeAbi, functionName: "issue", args: [BigInt(r.builderId)] }),
        label: `issue(${r.builderId})  # Verified Builder Badge for ${r.source}`,
      });
    }
  }
  return { txs, skipped };
}

/** Safe Transaction Builder import format. */
export function safeBatchJson(txs: PlannedTx[], opts: { chainId: number; createdAt: number; description?: string; name?: string }) {
  return {
    version: "1.0",
    chainId: String(opts.chainId),
    createdAt: opts.createdAt,
    meta: {
      name: opts.name ?? "Registrai verified builders onboarding",
      description: opts.description ?? batchSummary(txs),
      createdFromSafeAddress: "",
      createdFromOwnerAddress: "",
    },
    transactions: txs.map((t) => ({ to: t.to, value: t.value, data: t.data })),
  };
}

/** "1 registerFor, 2 setCaretaker" (+ ", 2 issue" / ", 1 revoke" when the batch has them). */
export function batchSummary(txs: PlannedTx[]): string {
  const n = (k: PlannedTx["kind"]) => txs.filter((t) => t.kind === k).length;
  const extra = (["issue", "revoke"] as const).map((k) => (n(k) ? `, ${n(k)} ${k}` : "")).join("");
  return `${n("registerFor")} registerFor, ${n("setCaretaker")} setCaretaker${extra}`;
}

/**
 * One badge revoke (VerifiedBuilderBadge.revoke, ISSUER_ROLE = the Safe): burns
 * the soulbound token; its serial is retired for good.
 */
export function revokeBadgeTx(badge: Address, builderId: number, serial?: number): PlannedTx {
  return {
    kind: "revoke",
    to: badge,
    value: "0",
    data: encodeFunctionData({ abi: badgeAbi, functionName: "revoke", args: [BigInt(builderId)] }),
    label: `revoke(${builderId})  # burns badge${serial ? ` No. ${String(serial).padStart(3, "0")}` : ""} of builder #${builderId}`,
  };
}

/** One call per paragraph: what it does, then to / value / data. */
export function calldataList(txs: PlannedTx[]): string {
  if (!txs.length) return "# nothing to do\n";
  return txs.map((t, i) => `# ${i + 1}. ${t.label}\nto=${t.to}\nvalue=0\ndata=${t.data}\n`).join("\n");
}
