"use client";

import { createPublicClient, type Address, type Hex, type PublicClient } from "viem";
import useSWR from "swr";
import { useWallet } from "@/components/WalletProvider";
import { badgesOnFor, type BadgeNet } from "@/components/BuilderBadgeCard";
import { BuilderBadgeSection } from "@/components/BuilderBadgeSection";
import { BUILDERS } from "@/lib/builders-network";
import { transportFor } from "@/lib/chains";
import { projectName } from "@/lib/share-card";
import { sourceFromProfileURI } from "@/lib/verified-builders";
import { verifiedBuilderAbi } from "@/lib/verified-builders-chain";

const CHAIN = BUILDERS.chain;
const REG = BUILDERS.contracts.BuilderRegistry;
/** The builders network's badge (Arc mainnet in phase 1, whatever the markets run on). */
const NET: BadgeNet = { chain: CHAIN, badge: BUILDERS.contracts.VerifiedBuilderBadge, network: BUILDERS.badgeNetwork };

/**
 * On /verify: once the connected wallet's builder holds a badge, show it with
 * its share card. Nothing is read without a wallet, a registry and a badge contract.
 */
export function MyBadge() {
  const { address } = useWallet();
  const on = badgesOnFor(NET) && Boolean(REG && address);
  const { data: me } = useSWR(
    on ? ["verify-my-builder", CHAIN.id, address] : null,
    async () => {
      const client = createPublicClient({ chain: CHAIN.viemChain, transport: transportFor(CHAIN) }) as PublicClient;
      const id = Number(await client.readContract({ address: REG!, abi: verifiedBuilderAbi, functionName: "builderIdOf", args: [address!] }));
      if (!id) return null;
      const [owner, profileURI] = (await client.readContract({
        address: REG!, abi: verifiedBuilderAbi, functionName: "builders", args: [BigInt(id)],
      })) as readonly [Address, string, Hex, bigint, boolean];
      return { id, owner, source: sourceFromProfileURI(profileURI) };
    },
    { revalidateOnFocus: false },
  );
  if (!on || !me) return null;
  return (
    <BuilderBadgeSection
      builderId={me.id}
      owner={me.owner}
      name={projectName(me.source, me.id)}
      source={me.source}
      viewer={address}
      net={NET}
    />
  );
}
