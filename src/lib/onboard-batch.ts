/**
 * The multisig's onboarding batch, as data. Pure: scripts/onboard-batch.ts does
 * the chain reads and proof fetches, this decides what goes in the batch and
 * renders it as a Safe Transaction Builder file plus a plain calldata list.
 * Nothing here signs or sends. With a badge contract (`--badge`) the batch also
 * issues Verified Builder Badges (VerifiedBuilderBadge.issue, ISSUER_ROLE = the Safe).
 *
 * Onboarding is per BUILDER (spec 2026-09-24-builder-projects-design.md): a
 * builder with ≥1 verified project is pending until the Safe sets its
 * caretaker; the badge is one per builder and `issue` needs ≥1 active project.
 * Also here: the single-transaction Safe files the /admin page downloads
 * (badge revoke, recovery start / cancel, project deactivation).
 */
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { verifiedBuilderAbi, type BuilderRecord } from "./verified-builders-chain";
import { sourceLabel } from "./verified-builders";
import { badgeAbi } from "./verified-builder-badge";

export interface PlannedTx {
  kind:
    | "setCaretaker"
    | "registerFor"
    | "addProjectFor"
    | "issue"
    | "revoke"
    | "startRecovery"
    | "cancelRecovery"
    | "setProjectActive"
    | "setActive"
    | "nominate"
    | "cancelRelease";
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
  /** The existing builder's ACTIVE project sources (empty when not registered). */
  existingSources?: string[];
  /** The existing builder's project count, every project ever added (the 16 cap). */
  existingProjectCount?: number;
  /** The existing builder is active (a deactivated builder cannot take projects). */
  existingActive?: boolean;
}

export interface OnboardingPlan {
  txs: PlannedTx[];
  skipped: { what: string; reason: string }[];
}

/** What onboarding needs of a builder record. */
export type OnboardingRecord = Pick<BuilderRecord, "builderId" | "status" | "owner" | "activeProjectCount"> & {
  /** Verified project sources, for the batch labels. */
  verifiedSources?: string[];
};

/** Pure: a record's verified project sources (for labels). */
export function verifiedSourcesOf(r: Pick<BuilderRecord, "projects">): string[] {
  return r.projects.filter((p) => p.status === "verified").map((p) => p.source);
}

const MAX_PROJECTS = 16;

const sourcesText = (sources: string[] | undefined) => (sources?.length ? sources.map(sourceLabel).join(", ") : "");

export function planOnboarding(opts: {
  records: OnboardingRecord[];
  registrations: RegistrationCandidate[];
  builderRegistry: Address;
  caretakerRegistry: Address;
  operator: Address;
  /** `--badge`: issue the Verified Builder Badge to every pending builder (right
   *  after its setCaretaker) and to every verified builder without one — only
   *  while it has an active project (`issue` reverts NoProject otherwise).
   *  `serials` = serialOf(builderId) as read; a missing entry counts as 0. */
  badge?: { address: Address; serials: ReadonlyMap<number, number> };
  /** Builders whose badge was revoked and that were not reactivated since
   *  (revokedBuilders): never re-onboarded, never re-issued a badge. */
  revoked?: ReadonlySet<number>;
}): OnboardingPlan {
  const txs: PlannedTx[] = [];
  const skipped: OnboardingPlan["skipped"] = [];

  // Registrations first (claims DM'd by builders without Arc gas). A new
  // wallet gets registerFor(builder, "") now and its project via
  // addProjectFor in the NEXT batch (its id exists only once this one runs);
  // a registered one gets addProjectFor(id, source) now. The proof names the
  // wallet, so a source some other builder also lists never blocks this one.
  const queued = new Set<string>();
  const added = new Map<number, number>(); // builderId -> projects queued in this batch
  for (const c of opts.registrations) {
    const what = `register ${c.source}`;
    if (!c.builder) { skipped.push({ what, reason: c.proofError ?? "proof not valid" }); continue; }
    const key = `${c.builder.toLowerCase()}|${c.source}`;
    if (queued.has(key) || (c.existingId === 0 && queued.has(c.builder.toLowerCase()))) {
      skipped.push({ what, reason: "duplicate in this batch" });
      continue;
    }
    if (c.existingId === 0) {
      queued.add(key).add(c.builder.toLowerCase());
      txs.push({
        kind: "registerFor",
        to: opts.builderRegistry,
        value: "0",
        data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "registerFor", args: [getAddress(c.builder), ""] }),
        label: `registerFor(${getAddress(c.builder)}, "")  # then addProjectFor(<new id>, "${c.source}") in the next batch`,
      });
      continue;
    }
    if (c.existingActive === false) { skipped.push({ what, reason: `builder #${c.existingId} is deactivated` }); continue; }
    if (c.existingSources?.includes(c.source)) { skipped.push({ what, reason: `already a project of builder #${c.existingId}` }); continue; }
    const count = (c.existingProjectCount ?? 0) + (added.get(c.existingId) ?? 0);
    if (count >= MAX_PROJECTS) { skipped.push({ what, reason: `builder #${c.existingId} has ${MAX_PROJECTS} projects (the limit)` }); continue; }
    queued.add(key);
    added.set(c.existingId, (added.get(c.existingId) ?? 0) + 1);
    txs.push({
      kind: "addProjectFor",
      to: opts.builderRegistry,
      value: "0",
      data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "addProjectFor", args: [BigInt(c.existingId), c.source] }),
      label: `addProjectFor(${c.existingId}, "${c.source}")`,
    });
  }

  // Lapsed and unverified builders never get a badge; pending ones get theirs
  // in the same batch that makes them verified, after the setCaretaker.
  const badge = opts.badge;
  for (const r of opts.records) {
    if (r.status !== "pending" && r.status !== "verified") continue;
    if (opts.revoked?.has(r.builderId)) {
      skipped.push({ what: `builder #${r.builderId}`, reason: "its badge was revoked and it was not reactivated since: not re-onboarded" });
      continue;
    }
    const names = sourcesText(r.verifiedSources);
    if (r.status === "pending") {
      txs.push({
        kind: "setCaretaker",
        to: opts.caretakerRegistry,
        value: "0",
        data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "setCaretaker", args: [BigInt(r.builderId), opts.operator] }),
        label: `setCaretaker(${r.builderId}, ${opts.operator})${names ? `  # ${names}` : ""}`,
      });
    }
    if (badge && (badge.serials.get(r.builderId) ?? 0) === 0) {
      if (r.activeProjectCount <= 0) {
        skipped.push({ what: `issue(${r.builderId})`, reason: "no active project (the badge would revert NoProject)" });
        continue;
      }
      txs.push({
        kind: "issue",
        to: badge.address,
        value: "0",
        data: encodeFunctionData({ abi: badgeAbi, functionName: "issue", args: [BigInt(r.builderId)] }),
        label: `issue(${r.builderId})  # Verified Builder Badge for builder #${r.builderId}${names ? `: ${names}` : ""}`,
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

/** "1 registerFor, 2 setCaretaker" (+ ", 1 addProjectFor" / ", 2 issue" / … when the batch has them). */
export function batchSummary(txs: PlannedTx[]): string {
  const n = (k: PlannedTx["kind"]) => txs.filter((t) => t.kind === k).length;
  const extra = (["addProjectFor", "issue", "revoke", "setActive", "startRecovery", "cancelRecovery", "setProjectActive"] as const)
    .map((k) => (n(k) ? `, ${n(k)} ${k}` : ""))
    .join("");
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

/** REGISTRAR (the Safe): switch a builder off (or back on). A deactivated
 *  builder is never onboarded; its badge reads lapsed. */
export function setBuilderActiveTx(registry: Address, builderId: number, active: boolean): PlannedTx {
  return {
    kind: "setActive",
    to: registry,
    value: "0",
    data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "setActive", args: [BigInt(builderId), active] }),
    label: `setActive(${builderId}, ${active})  # ${active ? "reactivates" : "deactivates"} builder #${builderId}`,
  };
}

/** REGISTRAR (the Safe): start moving a builder to `newOwner` (lost / stolen
 *  key). The current owner may cancel it for RECOVERY_DELAY (7 days); then
 *  anyone may finishRecovery. */
export function startRecoveryTx(registry: Address, builderId: number, newOwner: Address): PlannedTx {
  return {
    kind: "startRecovery",
    to: registry,
    value: "0",
    data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "startRecovery", args: [BigInt(builderId), getAddress(newOwner)] }),
    label: `startRecovery(${builderId}, ${getAddress(newOwner)})  # builder #${builderId} moves to ${getAddress(newOwner)} after 7 days unless cancelled`,
  };
}

/** REGISTRAR (or the owner): cancel a pending recovery. */
export function cancelRecoveryTx(registry: Address, builderId: number): PlannedTx {
  return {
    kind: "cancelRecovery",
    to: registry,
    value: "0",
    data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "cancelRecovery", args: [BigInt(builderId)] }),
    label: `cancelRecovery(${builderId})`,
  };
}

/** REGISTRAR: switch one project off (e.g. a fraudulent claim) or back on. */
export function setProjectActiveTx(registry: Address, projectId: number, active: boolean, source?: string): PlannedTx {
  return {
    kind: "setProjectActive",
    to: registry,
    value: "0",
    data: encodeFunctionData({ abi: verifiedBuilderAbi, functionName: "setProjectActive", args: [BigInt(projectId), active] }),
    label: `setProjectActive(${projectId}, ${active})${source ? `  # ${source}` : ""}`,
  };
}

/** A one-transaction Safe file. */
export function singleTxSafeFile(tx: PlannedTx, o: { chainId: number; createdAt: number; name: string }) {
  return safeBatchJson([tx], { chainId: o.chainId, createdAt: o.createdAt, name: o.name, description: tx.label });
}

/** One call per paragraph: what it does, then to / value / data. */
export function calldataList(txs: PlannedTx[]): string {
  if (!txs.length) return "# nothing to do\n";
  return txs.map((t, i) => `# ${i + 1}. ${t.label}\nto=${t.to}\nvalue=0\ndata=${t.data}\n`).join("\n");
}

// ───────────────────────────── CLI network defaults ─────────────────────────────

/** scripts/onboard-batch.ts --network defaults (every one can be overridden on the command line). */
export interface OnboardNetworkDefaults {
  rpc: string;
  chainId: number;
  builderRegistry: string | null;
  caretakerRegistry: string | null;
  operator: string | null;
  /** The badge the batch issues by default (null = opt in with --badge). */
  badge: string | null;
  /** First block of the builder contracts: the revocation history starts here. */
  deployBlock: number | null;
}

type BuildersBlock = {
  BuilderRegistry?: string | null;
  CaretakerRegistry?: string | null;
  VerifiedBuilderBadge?: string | null;
  operator?: string | null;
  deployBlock?: number | null;
};

/**
 * Pure: the mainnet defaults from deployments/arc-mainnet.json. Phase 1 fills
 * only its `builders` block (DeployBuilders.s.sol: the two registries and the
 * badge), so each address falls back to it — as perennial-network.ts
 * mainnetPerennialSource does — and the badge is on by default: phase 1 exists
 * to issue it.
 */
export function mainnetOnboardDefaults(d: {
  contracts?: { BuilderRegistry?: string | null; CaretakerRegistry?: string | null; VerifiedBuilderBadge?: string | null } | null;
  operator?: string | null;
  deployBlock?: number | null;
  builders?: BuildersBlock | null;
}): OnboardNetworkDefaults {
  const c = d.contracts ?? {};
  const b = d.builders ?? {};
  return {
    rpc: "https://rpc.mainnet.arc.io",
    chainId: 5042,
    builderRegistry: c.BuilderRegistry ?? b.BuilderRegistry ?? null,
    caretakerRegistry: c.CaretakerRegistry ?? b.CaretakerRegistry ?? null,
    operator: d.operator ?? b.operator ?? null,
    badge: c.VerifiedBuilderBadge ?? b.VerifiedBuilderBadge ?? null,
    deployBlock: d.deployBlock ?? b.deployBlock ?? null,
  };
}
