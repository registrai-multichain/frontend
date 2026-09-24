"use client";

import { useWallet } from "@/components/WalletProvider";
import { badgesOnFor, type BadgeNet } from "@/components/BuilderBadgeCard";
import { BuilderBadgeSection } from "@/components/BuilderBadgeSection";
import { BUILDERS } from "@/lib/builders-network";
import { plainProfileName } from "@/lib/builders-gallery";
import { projectName } from "@/lib/share-card";
import { useMyBuilder, useProjectProofs } from "./useMyBuilder";

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
  const { data } = useMyBuilder(on ? address : undefined);
  const b = data?.builder ?? null;
  const { data: proofs } = useProjectProofs(on ? b : null);
  if (!on || !b) return null;
  // The share card names the first project whose proof checks out for this wallet, else the first active one.
  const lead = b.projects.find((p) => p.active && proofs?.get(p.id)?.state === "valid") ?? b.projects.find((p) => p.active) ?? null;
  const source = lead?.source ?? null;
  return (
    <BuilderBadgeSection
      builderId={b.id}
      owner={b.owner}
      name={plainProfileName(b.profileURI) ?? projectName(source, b.id)}
      source={source}
      viewer={address}
      net={NET}
    />
  );
}
