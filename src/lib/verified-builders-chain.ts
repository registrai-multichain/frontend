/**
 * Verified builders, read from chain: the builder list (ids 1..nextId-1), each
 * builder's projects (BuilderRegistry.projectsOf), every active project's proof
 * (fetched + validated against the builder's CURRENT owner) and the builder's
 * caretaker, folded into project and builder statuses (spec
 * docs/superpowers/specs/2026-09-24-builder-projects-design.md). Shared by
 * scripts/sync.ts and scripts/onboard-batch.ts so the snapshot and the
 * multisig batch can never disagree about who is pending.
 *
 * The profile link no longer carries a claim and is not parsed here.
 */
import { parseAbi, zeroAddress, type Address, type Hex } from "viem";
import {
  freshProofUrl,
  builderCountry,
  builderStatus,
  milestoneFeedFor,
  normalizeSource,
  projectStatus,
  proofUrl as proofUrlFor,
  parseProofText,
  validateProof,
  type BuilderStatus,
  type Claim,
  type ProjectStatus,
  type ProofFetchConfig,
} from "./verified-builders";
import type { BadgeInfo } from "./verified-builder-badge";

/** BuilderRegistry + CaretakerRegistry (contracts/src/perennial). */
export const verifiedBuilderAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function builders(uint256) view returns (address owner, string profileURI, bytes linkedIdentity, uint64 createdAt, bool active)",
  "function builderIdOf(address) view returns (uint256)",
  "function ownerOf(uint256 id) view returns (address)",
  "function isActiveBuilderId(uint256 id) view returns (bool)",
  "function registerBuilder(string profileURI) returns (uint256 id)",
  "function updateProfile(string profileURI)",
  "function registerFor(address builder, string profileURI) returns (uint256 id)",
  "function setActive(uint256 id, bool active)",
  "event BuilderStatusSet(uint256 indexed id, bool active)",
  // projects
  "function nextProjectId() view returns (uint256)",
  "function projects(uint256) view returns (uint256 builderId, string source, bool active, uint64 addedAt)",
  "function projectsOf(uint256 builderId) view returns (uint256[])",
  "function activeProjectCount(uint256 builderId) view returns (uint256)",
  "function MAX_SOURCE_LEN() view returns (uint256)",
  "function MAX_PROJECTS_PER_BUILDER() view returns (uint256)",
  "function addProject(string source) returns (uint256 projectId)",
  "function registerBuilderWithProject(string profileURI, string source) returns (uint256 builderId, uint256 projectId)",
  "function removeProject(uint256 projectId)",
  "function addProjectFor(uint256 builderId, string source) returns (uint256 projectId)",
  "function setProjectActive(uint256 projectId, bool active)",
  // ownership + recovery
  "function pendingOwner(uint256 builderId) view returns (address)",
  "function proposeOwner(address newOwner)",
  "function acceptOwnership(uint256 builderId)",
  "function recoveryOf(uint256 builderId) view returns (address newOwner, uint64 readyAt)",
  "function RECOVERY_DELAY() view returns (uint256)",
  "function startRecovery(uint256 builderId, address newOwner)",
  "function cancelRecovery(uint256 builderId)",
  "function finishRecovery(uint256 builderId)",
  "event ProjectAdded(uint256 indexed builderId, uint256 indexed projectId, string source)",
  "event ProjectStatusSet(uint256 indexed projectId, bool active)",
  "event OwnerProposed(uint256 indexed builderId, address indexed newOwner)",
  "event RecoveryStarted(uint256 indexed builderId, address indexed newOwner, uint64 readyAt)",
  "event RecoveryCancelled(uint256 indexed builderId)",
  "event OwnerChanged(uint256 indexed builderId, address indexed from, address indexed to, bool recovered)",
  // CaretakerRegistry
  "function caretakerOf(uint256) view returns (address)",
  "function setCaretaker(uint256 builderId, address operator)",
  "function payoutOf(uint256 builderId) view returns (address)",
  "function payoutRecord(uint256 builderId) view returns (address payout, address setBy)",
]);

/** contracts/src/Registry.sol — the oracle registry the keeper creates milestone feeds on. */
export const feedCreatedEvent = parseAbi([
  "event FeedCreated(bytes32 indexed feedId, address indexed creator, string description, bytes32 methodologyHash, uint256 minBond, uint256 disputeWindow, address resolver)",
])[0];

export interface ProjectRecord {
  projectId: number;
  /** As stored on chain (anyone can add any string; see `canonical`). */
  source: string;
  /** The source is canonical (normalizeSource(source) === source). */
  canonical: boolean;
  /** The registry's flag (removeProject / setProjectActive). */
  active: boolean;
  /** ProjectAdded time, unix seconds. */
  addedAt: number;
  status: ProjectStatus;
  /** From the valid claim only. */
  country: string | null;
  proofUrl: string | null;
  /** Why an active project is lapsed. */
  proofError?: string;
  claim?: Claim;
}

export interface BuilderRecord {
  builderId: number;
  owner: Address;
  active: boolean;
  /** Free-form (a display name, a link, or empty); never a claim. */
  profileURI: string;
  /** Every project ever added, in add order. */
  projects: ProjectRecord[];
  /** Projects with the registry's active flag (= activeProjectCount). */
  activeProjectCount: number;
  /** The builder's lead project: its first verified one, else its first active
   *  one, else null. For one-line logs and the market pages (one source each). */
  source: string | null;
  caretaker: Address;
  status: BuilderStatus;
  /** builderCountry over the verified projects' claims. */
  country: string | null;
  /** Registration time (BuilderRegistry.builders().createdAt), unix seconds. */
  createdAt?: number;
}

/** Minimal read surface (a viem PublicClient satisfies it). */
export interface RegistryReader {
  readContract(args: {
    address: Address;
    abi: typeof verifiedBuilderAbi;
    functionName: "nextId" | "builders" | "caretakerOf" | "builderIdOf" | "projectsOf" | "projects";
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export type FetchJson = (url: string) => Promise<unknown | null>;

/** GET a proof file. null when it is missing, unreachable or not JSON. */
export function makeFetchJson(opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): FetchJson {
  const f = opts.fetchImpl ?? fetch;
  return async (url) => {
    try {
      const res = await f(freshProofUrl(url), { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), cache: "no-store", redirect: "follow" });
      if (!res.ok) return null;
      return parseProofText(await res.text());
    } catch {
      return null;
    }
  };
}

/** Validate one project's proof: the file at its source, naming this owner. */
export async function checkProjectProof(
  p: { owner: string; source: string },
  opts: { chainId: number; proofConfig?: ProofFetchConfig; fetchJson: FetchJson },
): Promise<{ proofUrl: string; ok: true; claim: Claim } | { proofUrl: string; ok: false; error: string }> {
  const url = proofUrlFor(p.source, opts.proofConfig);
  const file = await opts.fetchJson(url);
  if (file === null) return { proofUrl: url, ok: false, error: "proof file missing or unreadable" };
  const r = await validateProof(file, { expectedSource: p.source, onchainOwner: p.owner, chainId: opts.chainId });
  return r.valid ? { proofUrl: url, ok: true, claim: r.claim } : { proofUrl: url, ok: false, error: `rule ${r.rule}: ${r.reason}` };
}

/** @deprecated Old name of checkProjectProof. */
export const checkBuilderProof = checkProjectProof;

/** Pure: a builder's lead project source (see BuilderRecord.source). */
export function leadSource(projects: readonly { source: string; active: boolean; status: ProjectStatus; canonical?: boolean }[]): string | null {
  const ok = projects.filter((p) => p.canonical !== false);
  return ok.find((p) => p.status === "verified")?.source ?? ok.find((p) => p.active)?.source ?? null;
}

/** Pure: fold one builder's chain reads and proof checks into its record. */
export function foldBuilderRecord(o: {
  builderId: number;
  owner: Address;
  profileURI: string;
  createdAt: number;
  active: boolean;
  caretaker: Address;
  operator: Address | null;
  projects: {
    projectId: number;
    source: string;
    active: boolean;
    addedAt: number;
    proof?: Awaited<ReturnType<typeof checkProjectProof>>;
  }[];
}): BuilderRecord {
  const projects: ProjectRecord[] = o.projects.map((p) => {
    const canonical = normalizeSource(p.source) === p.source;
    const status = projectStatus({ builderActive: o.active, active: p.active, proofValid: Boolean(p.proof?.ok) });
    const rec: ProjectRecord = {
      projectId: p.projectId,
      source: p.source,
      canonical,
      active: p.active,
      addedAt: p.addedAt,
      status,
      country: p.proof?.ok ? p.proof.claim.country : null,
      proofUrl: p.proof?.proofUrl ?? null,
    };
    if (p.proof && !p.proof.ok) rec.proofError = p.proof.error;
    if (p.proof?.ok) rec.claim = p.proof.claim;
    if (status === "lapsed" && !canonical) rec.proofError = "not a canonical source (github:owner/repo or domain:host)";
    return rec;
  });
  const caretakerIsOperator = Boolean(
    o.operator && o.caretaker !== zeroAddress && o.caretaker.toLowerCase() === o.operator.toLowerCase(),
  );
  const status = builderStatus({ active: o.active, projects, caretakerIsOperator });
  return {
    builderId: o.builderId,
    owner: o.owner,
    active: o.active,
    profileURI: o.profileURI,
    projects,
    activeProjectCount: projects.filter((p) => p.active).length,
    source: leadSource(projects),
    caretaker: o.caretaker,
    status,
    country: builderCountry(projects),
    createdAt: o.createdAt,
  };
}

export async function readBuilderRecords(
  client: RegistryReader,
  opts: {
    builderRegistry: Address;
    caretakerRegistry: Address | null;
    operator: Address | null;
    chainId: number;
    proofConfig?: ProofFetchConfig;
    fetchJson: FetchJson;
    /** Called between builders (rate-limit pacing). */
    pace?: () => Promise<void>;
  },
): Promise<BuilderRecord[]> {
  const read = (functionName: "nextId" | "builders" | "caretakerOf" | "projectsOf" | "projects", address: Address, args?: readonly unknown[]) =>
    client.readContract({ address, abi: verifiedBuilderAbi, functionName, args });
  const nextId = (await read("nextId", opts.builderRegistry)) as bigint;
  const out: BuilderRecord[] = [];
  for (let id = 1; id < Number(nextId); id++) {
    const [owner, profileURI, , createdAt, active] = (await read("builders", opts.builderRegistry, [BigInt(id)])) as readonly [
      Address, string, Hex, bigint, boolean,
    ];
    const caretaker = opts.caretakerRegistry ? ((await read("caretakerOf", opts.caretakerRegistry, [BigInt(id)])) as Address) : zeroAddress;
    let ids: readonly bigint[];
    try {
      ids = (await read("projectsOf", opts.builderRegistry, [BigInt(id)])) as readonly bigint[];
    } catch (e) {
      throw new Error(
        `BuilderRegistry ${opts.builderRegistry} has no projectsOf: it predates builder projects (redeploy it). ${(e as Error).message.split("\n")[0]}`,
      );
    }
    const projects: Parameters<typeof foldBuilderRecord>[0]["projects"] = [];
    for (const pid of ids) {
      const [, source, pActive, addedAt] = (await read("projects", opts.builderRegistry, [pid])) as readonly [bigint, string, boolean, bigint];
      const canonical = normalizeSource(source) === source;
      const proof = active && pActive && canonical ? await checkProjectProof({ owner, source }, opts) : undefined;
      projects.push({ projectId: Number(pid), source, active: pActive, addedAt: Number(addedAt), proof });
    }
    out.push(foldBuilderRecord({ builderId: id, owner, profileURI, createdAt: Number(createdAt), active, caretaker, operator: opts.operator, projects }));
    await opts.pace?.();
  }
  return out;
}

// ───────────────────────────── snapshot (pure) ─────────────────────────────

/** live-data.json `perennialBuilders[].projects[]`. */
export interface PerennialProjectSnapshot {
  id: number;
  source: string;
  status: ProjectStatus;
  /** `registrai-milestone:<source>` from the operator's feeds (milestones are per project). */
  milestoneFeedId: string | null;
}

/** live-data.json `perennialBuilders[]`. */
export interface PerennialBuilderSnapshot {
  builderId: number;
  owner: string;
  /** The lead project (first verified, else first active): the market pages
   *  still show one source per builder.
   *  TODO(spec 2026-09-24-builder-projects-design.md "Phase 2"): markets name a
   *  builder AND one of its projects' feeds; switch the market pages to `projects`. */
  source: string | null;
  status: BuilderStatus;
  country: string | null;
  proofUrl: string | null;
  /** The lead project's milestone feed (first verified project with a feed). */
  milestoneFeedId: string | null;
  /** Canonical-source projects, in add order. */
  projects: PerennialProjectSnapshot[];
  /** The builder's Verified Builder Badge (sync.ts attaches it when the contract is deployed). */
  badge?: BadgeInfo | null;
}

/** keeper/builders.json — honoured only for legacy builders without a project. */
export interface LegacyKeeperBuilder {
  builderId?: number;
  address: string;
  repo: string;
  milestoneFeedId?: string;
}

/** `owner/repo` from a legacy GitHub profile link, case preserved. */
export function legacyRepoFromURI(uri: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i.exec(uri.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

export function perennialBuilderSnapshot(
  records: BuilderRecord[],
  feeds: Record<string, string>,
  legacy: LegacyKeeperBuilder[] = [],
): PerennialBuilderSnapshot[] {
  return records.map((r) => {
    const projects: PerennialProjectSnapshot[] = r.projects
      .filter((p) => p.canonical)
      .map((p) => ({ id: p.projectId, source: p.source, status: p.status, milestoneFeedId: milestoneFeedFor(feeds, p.source) }));
    const lead = projects.find((p) => p.status === "verified" && p.milestoneFeedId) ?? projects.find((p) => p.source === r.source);
    let milestoneFeedId: string | null = lead?.milestoneFeedId ?? null;
    if (!milestoneFeedId && projects.length === 0) {
      const kb = legacy.find((k) => k.builderId === r.builderId && k.address.toLowerCase() === r.owner.toLowerCase());
      const repos = [legacyRepoFromURI(r.profileURI), kb?.repo].filter((x): x is string => Boolean(x));
      milestoneFeedId = milestoneFeedFor(feeds, null, repos) ?? kb?.milestoneFeedId ?? null;
    }
    const leadProject = r.projects.find((p) => p.source === r.source);
    return {
      builderId: r.builderId,
      owner: r.owner.toLowerCase(),
      source: r.source,
      status: r.status,
      country: r.status === "verified" ? r.country : null,
      proofUrl: leadProject?.proofUrl ?? null,
      milestoneFeedId,
      projects,
    };
  });
}

/** Only verified builders reach the atlas and season boards. */
export function verifiedOwners(snapshot: Pick<PerennialBuilderSnapshot, "owner" | "status">[]): Set<string> {
  return new Set(snapshot.filter((b) => b.status === "verified").map((b) => b.owner.toLowerCase()));
}
