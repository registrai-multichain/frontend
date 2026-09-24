"use client";

import { createPublicClient, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import useSWR from "swr";
import { BUILDERS } from "@/lib/builders-network";
import { transportFor } from "@/lib/chains";
import {
  LIVE_MAX_BUILDERS,
  browserProjectProof,
  readLiveProjects,
  type GalleryReader,
  type ProjectProofState,
} from "@/lib/builders-gallery";
import { pendingFor } from "@/lib/builder-ownership";
import { verifiedBuilderAbi } from "@/lib/verified-builders-chain";
import { badgeAbi, readBadgeHolder, type BadgeReader } from "@/lib/verified-builder-badge";
import type { MyBuilder } from "@/lib/verify-plan";

const CHAIN = BUILDERS.chain;
const REG = BUILDERS.contracts.BuilderRegistry;
const BADGE = BUILDERS.badgesOn ? BUILDERS.contracts.VerifiedBuilderBadge : null;

let client: PublicClient | null = null;
export function buildersClient(): PublicClient {
  client ??= createPublicClient({ chain: CHAIN.viemChain, transport: transportFor(CHAIN, { batch: true }) }) as PublicClient;
  return client;
}

/** The connected wallet on the builders network, as /verify needs it. */
export interface MyBuilderState {
  /** null = this wallet holds no builder. */
  builder: MyBuilder | null;
  /** Proposed new owner of this wallet's builder (null = none). */
  pendingOwner: Address | null;
  /** Pending REGISTRAR recovery of this wallet's builder (null = none). */
  recovery: { newOwner: Address; readyAt: number } | null;
  /** This builder's badge and the wallet holding it (null = no badge / badges off). */
  badge: { serial: number; holder: Address | null } | null;
  /** Builders this (unregistered) wallet was proposed as the new owner of. */
  acceptable: number[];
}

async function readMe(address: Address): Promise<MyBuilderState> {
  const c = buildersClient();
  const read = (functionName: string, args?: readonly unknown[]) =>
    c.readContract({ address: REG!, abi: verifiedBuilderAbi, functionName: functionName as never, args: args as never });
  const id = Number(await read("builderIdOf", [address]));
  if (!id) {
    // Not registered: is this wallet someone's proposed new owner? A scan of
    // pendingOwner over every builder (batched), fine at phase-1 sizes.
    const nextId = Number(await read("nextId"));
    const ids = Array.from({ length: Math.max(0, Math.min(nextId - 1, LIVE_MAX_BUILDERS)) }, (_, i) => i + 1);
    const pending = new Map<number, string>(
      await Promise.all(ids.map(async (i) => [i, (await read("pendingOwner", [BigInt(i)])) as string] as [number, string])),
    );
    return { builder: null, pendingOwner: null, recovery: null, badge: null, acceptable: pendingFor(address, pending) };
  }
  const [row, projects, pendingOwner, recovery, serial] = await Promise.all([
    read("builders", [BigInt(id)]) as Promise<readonly [Address, string, Hex, bigint, boolean]>,
    readLiveProjects(c as unknown as GalleryReader, REG!, id),
    read("pendingOwner", [BigInt(id)]) as Promise<Address>,
    read("recoveryOf", [BigInt(id)]) as Promise<readonly [Address, bigint]>,
    BADGE ? (c.readContract({ address: BADGE, abi: badgeAbi, functionName: "serialOf", args: [BigInt(id)] }) as Promise<bigint>) : Promise.resolve(0n),
  ]);
  const [owner, profileURI, , , active] = row;
  const holder = BADGE && serial ? await readBadgeHolder(c as unknown as BadgeReader, BADGE, Number(serial)) : null;
  return {
    builder: { id, owner, active, profileURI, projects: projects.map((p) => ({ id: p.id, source: p.source, active: p.active })) },
    pendingOwner: pendingOwner.toLowerCase() === zeroAddress ? null : pendingOwner,
    recovery: recovery[0].toLowerCase() === zeroAddress ? null : { newOwner: recovery[0], readyAt: Number(recovery[1]) },
    badge: serial ? { serial: Number(serial), holder } : null,
    acceptable: [],
  };
}

/** The connected wallet's builder (SWR: every component using it shares one read). */
export function useMyBuilder(address: string | undefined) {
  return useSWR(REG && address ? ["verify-me", CHAIN.id, REG, address.toLowerCase()] : null, () => readMe(address as Address), {
    revalidateOnFocus: false,
  });
}

/** Each active project's proof as the browser sees it, for this owner. */
export function useProjectProofs(b: MyBuilder | null | undefined) {
  const active = (b?.projects ?? []).filter((p) => p.active);
  return useSWR(
    b ? ["verify-proofs", CHAIN.id, b.id, b.owner.toLowerCase(), active.map((p) => `${p.id}:${p.source}`).join(",")] : null,
    async () => {
      const out = new Map<number, ProjectProofState>();
      await Promise.all(
        active.map(async (p) => {
          out.set(p.id, await browserProjectProof({ owner: b!.owner, source: p.source }, { chainId: CHAIN.id }));
        }),
      );
      return out;
    },
    { revalidateOnFocus: false },
  );
}
