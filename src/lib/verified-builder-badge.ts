/**
 * The Verified Builder Badge (contracts/src/perennial/VerifiedBuilderBadge.sol):
 * a soulbound 1:1 token per verified builder (not per project), token id =
 * serial in issue order (spec: docs/superpowers/specs/2026-09-24-verified-builder-badge-design.md,
 * metadata and sync per 2026-09-24-builder-projects-design.md). No project is
 * named on-chain: which project is verified is only known off-chain.
 * Shared by scripts/sync.ts (snapshot), scripts/onboard-batch.ts (issue calls)
 * and the UI (live read, image, explorer link). A null badge address turns
 * every badge feature off: no contract calls, nothing rendered.
 */
import { parseAbi, type Address } from "viem";

export const badgeAbi = parseAbi([
  "function serialOf(uint256 builderId) view returns (uint256)",
  "function builderOf(uint256 serial) view returns (uint256)",
  "function lapsed(uint256 serial) view returns (bool)",
  "function isLapsed(uint256 serial) view returns (bool)",
  "function issuedAt(uint256 serial) view returns (uint64)",
  "function nextSerial() view returns (uint256)",
  "function ownerOf(uint256 serial) view returns (address)",
  "function tokenURI(uint256 serial) view returns (string)",
  "function imageBase() view returns (string)",
  "function BUILDERS() view returns (address)",
  "function issue(uint256 builderId) returns (uint256 serial)",
  "function revoke(uint256 builderId)",
  /** Anyone: after an owner change, burn + re-mint the SAME serial to the builder's current owner. */
  "function sync(uint256 builderId)",
  "event Issued(uint256 indexed builderId, uint256 indexed serial, address indexed owner)",
  "event Revoked(uint256 indexed builderId, uint256 indexed serial)",
  "event LapsedSet(uint256 indexed builderId, uint256 indexed serial, bool lapsed)",
  "event Synced(uint256 indexed builderId, uint256 indexed serial, address from, address to)",
]);

/** Chain id -> the `public/badge/<network>/` path segment (scripts/render-badges.py NETWORKS). */
const NETWORK_KEYS: Record<number, string> = { 5042: "arc", 5042002: "arc-testnet", 31337: "local" };

export function badgeNetworkKey(chainId: number): string | null {
  return NETWORK_KEYS[chainId] ?? null;
}

/** Where the site serves a network's badge art (the contract's imageBase). */
export const BADGE_ORIGIN = "https://registrai.cc";
/** The standalone builders site (the /builders gallery, /verify, badge art). */
export const BUILDERS_ORIGIN = "https://builder.registrai.cc";
export function badgeImageBase(network: string, origin = BADGE_ORIGIN): string {
  return `${origin}/badge/${network}/`;
}

/** Mirrors tokenURI's image: imageBase + serial + ("-lapsed")? + ".jpg". */
export function badgeImageUrl(base: string, serial: number, lapsed: boolean): string {
  return `${base}${serial}${lapsed ? "-lapsed" : ""}.jpg`;
}

/** "007" — the serial as the art prints it. */
export const serialDigits = (serial: number) => String(serial).padStart(3, "0");
/** "No. 007" */
export const serialLabel = (serial: number) => `No. ${serialDigits(serial)}`;

/** The badge's own page on the explorer (Blockscout token instance). */
export function badgeTokenUrl(explorer: string, badge: string, serial: number): string {
  return `${explorer.replace(/\/$/, "")}/token/${badge}/instance/${serial}`;
}

/** The token's external_url: the builders gallery, scrolled to this builder
 *  (DeployBuilders.s.sol BADGE_EXTERNAL_BASE). */
export function builderDeepLink(builderId: number, origin = BUILDERS_ORIGIN): string {
  return `${origin}/builders/?builder=${builderId}`;
}

/** `?builder=<id>` -> a positive builder id, else null. */
export function parseBuilderParam(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,9}$/.test(raw.trim())) return null;
  const id = Number(raw.trim());
  return id > 0 ? id : null;
}

/** live-data.json `perennialBuilders[].badge`. */
export interface BadgeInfo {
  serial: number;
  lapsed: boolean;
  /** Unix seconds. */
  issuedAt: number;
  /** Absolute image URL, as tokenURI reports it. */
  image: string;
}

/** Pure: a snapshot row's badge, or null when absent or malformed. */
export function parseSnapshotBadge(raw: unknown): BadgeInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const serial = b.serial;
  if (typeof serial !== "number" || !Number.isSafeInteger(serial) || serial <= 0) return null;
  if (typeof b.lapsed !== "boolean") return null;
  const issuedAt = typeof b.issuedAt === "number" && b.issuedAt > 0 ? b.issuedAt : 0;
  return { serial, lapsed: b.lapsed, issuedAt, image: typeof b.image === "string" ? b.image : "" };
}

/** Minimal read surface (a viem PublicClient satisfies it). */
export interface BadgeReader {
  readContract(args: {
    address: Address;
    abi: typeof badgeAbi;
    functionName: "serialOf" | "lapsed" | "isLapsed" | "issuedAt" | "nextSerial" | "ownerOf";
    args?: readonly unknown[];
  }): Promise<unknown>;
}

/**
 * What the badge shows: `isLapsed` = the keeper's flag (no verified project
 * remains) OR the builder is deactivated. Badge contracts deployed before that
 * view existed (the first testnet badge) only have the keeper's `lapsed` flag.
 */
export async function readShownLapsed(client: BadgeReader, badge: Address, serial: number): Promise<boolean> {
  try {
    return (await client.readContract({ address: badge, abi: badgeAbi, functionName: "isLapsed", args: [BigInt(serial)] })) as boolean;
  } catch {
    return (await client.readContract({ address: badge, abi: badgeAbi, functionName: "lapsed", args: [BigInt(serial)] })) as boolean;
  }
}

/** One builder's badge, live. null = none (never issued, or revoked). */
export async function readBadge(
  client: BadgeReader,
  badge: Address,
  builderId: number,
  imageBase: string,
): Promise<BadgeInfo | null> {
  const serial = Number(
    await client.readContract({ address: badge, abi: badgeAbi, functionName: "serialOf", args: [BigInt(builderId)] }),
  );
  if (!serial) return null;
  const [lapsed, issuedAt] = await Promise.all([
    readShownLapsed(client, badge, serial),
    client.readContract({ address: badge, abi: badgeAbi, functionName: "issuedAt", args: [BigInt(serial)] }),
  ]);
  return { serial, lapsed, issuedAt: Number(issuedAt), image: badgeImageUrl(imageBase, serial, lapsed) };
}

/** Every builder's badge plus the highest serial issued (render-badges.py renders past it). */
export async function readBuilderBadges(
  client: BadgeReader,
  opts: { badge: Address; builderIds: number[]; imageBase: string; pace?: () => Promise<void> },
): Promise<{ badges: Map<number, BadgeInfo>; maxSerial: number }> {
  const next = Number(await client.readContract({ address: opts.badge, abi: badgeAbi, functionName: "nextSerial" }));
  const badges = new Map<number, BadgeInfo>();
  for (const id of opts.builderIds) {
    const b = await readBadge(client, opts.badge, id, opts.imageBase);
    if (b) badges.set(id, b);
    await opts.pace?.();
  }
  return { badges, maxSerial: Math.max(0, next - 1) };
}

/** Pure: snapshot rows with their badge (null when none) — sync.ts. */
export function attachBadges<T extends { builderId: number }>(
  rows: T[],
  badges: ReadonlyMap<number, BadgeInfo>,
): (T & { badge: BadgeInfo | null })[] {
  return rows.map((r) => ({ ...r, badge: badges.get(r.builderId) ?? null }));
}

/** Pure: the badge sits with another wallet than the builder's registry owner
 *  (an owner change happened): `sync(builderId)` moves it. */
export function badgeNeedsSync(holder: string | null | undefined, owner: string | null | undefined): boolean {
  return Boolean(holder && owner && holder.toLowerCase() !== owner.toLowerCase());
}

/** The wallet holding a serial, or null when it does not exist (revoked / never issued). */
export async function readBadgeHolder(client: BadgeReader, badge: Address, serial: number): Promise<Address | null> {
  try {
    return (await client.readContract({ address: badge, abi: badgeAbi, functionName: "ownerOf", args: [BigInt(serial)] })) as Address;
  } catch {
    return null;
  }
}
