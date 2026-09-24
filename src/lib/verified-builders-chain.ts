/**
 * Verified builders, read from chain: the builder list (ids 1..nextId-1), each
 * builder's `registrai:` source, its proof (fetched + validated) and its
 * caretaker, folded into a status. Shared by scripts/sync.ts and
 * scripts/onboard-batch.ts so the snapshot and the multisig batch can never
 * disagree about who is pending.
 */
import { parseAbi, zeroAddress, type Address, type Hex } from "viem";
import {
  builderStatus,
  milestoneFeedFor,
  proofUrl as proofUrlFor,
  sourceFromProfileURI,
  validateProof,
  type BuilderStatus,
  type Claim,
  type ProofFetchConfig,
} from "./verified-builders";
import type { BadgeInfo } from "./verified-builder-badge";

export const verifiedBuilderAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function builders(uint256) view returns (address owner, string profileURI, bytes linkedIdentity, uint64 createdAt, bool active)",
  "function builderIdOf(address) view returns (uint256)",
  "function caretakerOf(uint256) view returns (address)",
  "function registerBuilder(string profileURI) returns (uint256 id)",
  "function updateProfile(string profileURI)",
  "function registerFor(address builder, string profileURI) returns (uint256 id)",
  "function setCaretaker(uint256 builderId, address operator)",
]);

/** contracts/src/Registry.sol — the oracle registry the keeper creates milestone feeds on. */
export const feedCreatedEvent = parseAbi([
  "event FeedCreated(bytes32 indexed feedId, address indexed creator, string description, bytes32 methodologyHash, uint256 minBond, uint256 disputeWindow, address resolver)",
])[0];

export interface BuilderRecord {
  builderId: number;
  owner: Address;
  active: boolean;
  profileURI: string;
  /** Canonical source from a `registrai:` profile link, else null. */
  source: string | null;
  caretaker: Address;
  status: BuilderStatus;
  /** From the valid claim only. */
  country: string | null;
  proofUrl: string | null;
  /** Why a `registrai:` builder is lapsed. */
  proofError?: string;
  claim?: Claim;
  /** Registration time (BuilderRegistry.builders().createdAt), unix seconds. */
  createdAt?: number;
}

/** Minimal read surface (a viem PublicClient satisfies it). */
export interface RegistryReader {
  readContract(args: {
    address: Address;
    abi: typeof verifiedBuilderAbi;
    functionName: "nextId" | "builders" | "caretakerOf" | "builderIdOf";
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export type FetchJson = (url: string) => Promise<unknown | null>;

/** GET a proof file. null when it is missing, unreachable or not JSON. */
export function makeFetchJson(opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): FetchJson {
  const f = opts.fetchImpl ?? fetch;
  return async (url) => {
    try {
      const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), cache: "no-store", redirect: "follow" });
      if (!res.ok) return null;
      return JSON.parse(await res.text());
    } catch {
      return null;
    }
  };
}

/** Validate the proof a builder's `registrai:` link points at. */
export async function checkBuilderProof(
  b: { owner: string; source: string },
  opts: { chainId: number; proofConfig?: ProofFetchConfig; fetchJson: FetchJson },
): Promise<{ proofUrl: string; ok: true; claim: Claim } | { proofUrl: string; ok: false; error: string }> {
  const url = proofUrlFor(b.source, opts.proofConfig);
  const file = await opts.fetchJson(url);
  if (file === null) return { proofUrl: url, ok: false, error: "proof file missing or unreadable" };
  const r = await validateProof(file, { expectedSource: b.source, onchainOwner: b.owner, chainId: opts.chainId });
  return r.valid ? { proofUrl: url, ok: true, claim: r.claim } : { proofUrl: url, ok: false, error: `rule ${r.rule}: ${r.reason}` };
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
  const nextId = (await client.readContract({
    address: opts.builderRegistry, abi: verifiedBuilderAbi, functionName: "nextId",
  })) as bigint;
  const out: BuilderRecord[] = [];
  for (let id = 1; id < Number(nextId); id++) {
    const [owner, profileURI, , createdAt, active] = (await client.readContract({
      address: opts.builderRegistry, abi: verifiedBuilderAbi, functionName: "builders", args: [BigInt(id)],
    })) as readonly [Address, string, Hex, bigint, boolean];
    const caretaker = opts.caretakerRegistry
      ? ((await client.readContract({
          address: opts.caretakerRegistry, abi: verifiedBuilderAbi, functionName: "caretakerOf", args: [BigInt(id)],
        })) as Address)
      : zeroAddress;
    const source = sourceFromProfileURI(profileURI);
    let proof: Awaited<ReturnType<typeof checkBuilderProof>> | undefined;
    if (active && source) proof = await checkBuilderProof({ owner, source }, opts);
    const caretakerIsOperator = Boolean(
      opts.operator && caretaker !== zeroAddress && caretaker.toLowerCase() === opts.operator.toLowerCase(),
    );
    const status = builderStatus({ active, profileURI, proofValid: Boolean(proof?.ok), caretakerIsOperator });
    out.push({
      builderId: id,
      owner,
      active,
      profileURI,
      source,
      caretaker,
      status,
      createdAt: Number(createdAt),
      country: proof?.ok ? proof.claim.country : null,
      proofUrl: proof?.proofUrl ?? null,
      ...(proof && !proof.ok ? { proofError: proof.error } : {}),
      ...(proof?.ok ? { claim: proof.claim } : {}),
      ...(status === "lapsed" && !proof ? { proofError: "profile link is not a canonical registrai: source" } : {}),
    });
    await opts.pace?.();
  }
  return out;
}

// ───────────────────────────── snapshot (pure) ─────────────────────────────

/** live-data.json `perennialBuilders[]`. */
export interface PerennialBuilderSnapshot {
  builderId: number;
  owner: string;
  source: string | null;
  status: BuilderStatus;
  country: string | null;
  proofUrl: string | null;
  milestoneFeedId: string | null;
  /** The builder's Verified Builder Badge (sync.ts attaches it when the contract is deployed). */
  badge?: BadgeInfo | null;
}

/** keeper/builders.json — honoured only for legacy (non-`registrai:`) builders. */
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
    let milestoneFeedId: string | null;
    if (r.source) {
      milestoneFeedId = milestoneFeedFor(feeds, r.source);
    } else {
      const kb = legacy.find((k) => k.builderId === r.builderId && k.address.toLowerCase() === r.owner.toLowerCase());
      const repos = [legacyRepoFromURI(r.profileURI), kb?.repo].filter((x): x is string => Boolean(x));
      milestoneFeedId = milestoneFeedFor(feeds, null, repos) ?? kb?.milestoneFeedId ?? null;
    }
    return {
      builderId: r.builderId,
      owner: r.owner.toLowerCase(),
      source: r.source,
      status: r.status,
      country: r.status === "verified" ? r.country : null,
      proofUrl: r.proofUrl,
      milestoneFeedId,
    };
  });
}

/** Only verified builders reach the atlas and season boards. */
export function verifiedOwners(snapshot: Pick<PerennialBuilderSnapshot, "owner" | "status">[]): Set<string> {
  return new Set(snapshot.filter((b) => b.status === "verified").map((b) => b.owner.toLowerCase()));
}
