/**
 * ProjectNominations (contracts/src/perennial/ProjectNominations.sol): the on-chain
 * list of projects Registrai nominated, the builders gallery's backup. The Safe and
 * the onboarder nominate a canonical source with an optional hash of its public
 * profile (src/lib/projects.ts); no funds, gates nothing.
 */
import { encodeFunctionData, keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import type { PlannedTx } from "./onboard-batch";
import { BUILDERS_NETWORK, BUILDERS_SOURCES } from "./builders-network";
import { publicProfile, type ProjectProfile } from "./projects";

export const nominationsAbi = parseAbi([
  "function nominate(string source, bytes32 profileHash)",
  "function unnominate(string source)",
  "function nominated(bytes32 key) view returns (bool)",
  "function count() view returns (uint256)",
  "function page(uint256 start, uint256 n) view returns (string[] sources, (bool active, bytes32 profileHash, address by, uint64 at)[] ns)",
  "function NOMINATOR_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
]);

const addr = (v: unknown): Address | null => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : null);

/** The contract on the builders network, or null before it is deployed. */
export const NOMINATIONS: Address | null = addr(BUILDERS_SOURCES[BUILDERS_NETWORK].ProjectNominations);

export interface Nomination {
  active: boolean;
  profileHash: Hex;
  by: Address;
  /** unix seconds */
  at: number;
}

/** Minimal read surface (a viem PublicClient satisfies it). */
export interface NominationsReader {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
}

/** Every source ever nominated, with its current state, by source. */
export async function readNominations(client: NominationsReader, address: Address, pageSize = 100): Promise<Map<string, Nomination>> {
  const out = new Map<string, Nomination>();
  const n = Number(await client.readContract({ address, abi: nominationsAbi, functionName: "count" }));
  for (let start = 0; start < n; start += pageSize) {
    const [sources, ns] = (await client.readContract({
      address,
      abi: nominationsAbi,
      functionName: "page",
      args: [BigInt(start), BigInt(pageSize)],
    })) as readonly [readonly string[], readonly { active: boolean; profileHash: Hex; by: Address; at: bigint | number }[]];
    if (!sources.length) break;
    sources.forEach((src, i) => out.set(src, { active: ns[i].active, profileHash: ns[i].profileHash, by: ns[i].by, at: Number(ns[i].at) }));
  }
  return out;
}

/** The hash a nomination records: keccak256 of the PUBLIC profile's canonical JSON
 *  (sorted keys, no red flags or notes), or 0x0 when there is no profile yet. */
export function profileHash(profile: ProjectProfile | null | undefined): Hex {
  if (!profile) return `0x${"00".repeat(32)}`;
  return keccak256(toBytes(canonicalJson(publicProfile(profile))));
}

function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** The nominate / un-nominate call as a planned transaction (for the Safe file and the calldata list). */
export function nominationTx(contract: Address, source: string, on: boolean, hash: Hex = `0x${"00".repeat(32)}`): PlannedTx {
  return {
    kind: "nominate",
    to: contract,
    value: "0",
    data: on
      ? encodeFunctionData({ abi: nominationsAbi, functionName: "nominate", args: [source, hash] })
      : encodeFunctionData({ abi: nominationsAbi, functionName: "unnominate", args: [source] }),
    label: on ? `nominate(${source}, ${hash})  # anchors ${source} as nominated` : `unnominate(${source})`,
  };
}
