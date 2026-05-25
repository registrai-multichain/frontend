"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { useWallet } from "../WalletProvider";
import { CONTRACTS, addrUrl } from "@/lib/chain";
import { attestationAbi, registryAbi } from "@/lib/abi";
import { DEMO_FEED } from "@/lib/demo";
import { DEMO_MARKETS } from "@/lib/markets-demo";
import { fmtDuration, fmtInt, shortHash } from "@/lib/format";
import { Stat, EmptyState } from "./PositionsTab";
import { Skeleton } from "../Skeleton";

interface AgentRecord {
  feedId: Hex;
  feedSymbol: string;
  bond: bigint;
  lockedBond: bigint;
  active: boolean;
  slashed: boolean;
  attestations: bigint;
  lastAttestationAt: bigint;
  registryVersion: "1.0" | "1.1" | "2.0";
}

export function DeployerTab({ address }: { address: Address }) {
  const { publicClient } = useWallet();
  const [agents, setAgents] = useState<AgentRecord[] | undefined>();

  // Agent fee earnings: sum agent-share of fees only on markets where this
  // address is the agent.
  const marketsAsAgent = DEMO_MARKETS.filter(
    (m) => m.agent.toLowerCase() === address.toLowerCase(),
  );
  const agentFeesEarned = marketsAsAgent.reduce(
    (s, m) => s + (m.fees?.agent ?? 0),
    0,
  );
  const volumeOnAttestedMarkets = marketsAsAgent.reduce(
    (s, m) => s + (m.fees?.grossVolume ?? 0),
    0,
  );

  useEffect(() => {
    let cancelled = false;

    // Discover every (feedId, registry) where this wallet has an AgentRegistered
    // event. Querying v1.0, v1.1, and v2 unions all eras of the protocol so
    // a wallet that registered on v2 (post-launch) AND on v1.x (legacy demo)
    // both show up.
    const targets: Array<{
      registry: Address;
      attestation: Address;
      version: AgentRecord["registryVersion"];
    }> = [
      ...(CONTRACTS.RegistryV2 && CONTRACTS.AttestationV2
        ? [{ registry: CONTRACTS.RegistryV2, attestation: CONTRACTS.AttestationV2, version: "2.0" as const }]
        : []),
      ...(CONTRACTS.RegistryV11 && CONTRACTS.AttestationV11
        ? [{ registry: CONTRACTS.RegistryV11, attestation: CONTRACTS.AttestationV11, version: "1.1" as const }]
        : []),
      { registry: CONTRACTS.Registry, attestation: CONTRACTS.Attestation, version: "1.0" as const },
    ];

    (async () => {
      const allAgents: AgentRecord[] = [];
      // Arc RPC caps eth_getLogs at 100k blocks; older ranges are pruned.
      const tip = await publicClient.getBlockNumber();
      const fromBlock = tip > 99_000n ? tip - 99_000n : 0n;
      for (const t of targets) {
        try {
          const logs = await publicClient.getLogs({
            address: t.registry,
            event: {
              type: "event",
              name: "AgentRegistered",
              inputs: [
                { name: "feedId", type: "bytes32", indexed: true },
                { name: "agent", type: "address", indexed: true },
                { name: "methodologyHash", type: "bytes32", indexed: false },
                { name: "bond", type: "uint256", indexed: false },
              ],
            },
            args: { agent: address },
            fromBlock,
            toBlock: "latest",
            strict: false,
          });
          // Pull live state for each discovered feedId.
          for (const ll of logs) {
            const feedId = (ll.topics[1] ?? ll.args?.feedId) as Hex | undefined;
            if (!feedId) continue;
            const agent = (await publicClient.readContract({
              address: t.registry,
              abi: registryAbi,
              functionName: "getAgent",
              args: [feedId, address],
            })) as {
              agentMethodologyHash: Hex;
              bond: bigint;
              lockedBond: bigint;
              registeredAt: bigint;
              lastAttestationAt: bigint;
              active: boolean;
              slashed: boolean;
            };
            const attestations = (await publicClient.readContract({
              address: t.attestation,
              abi: attestationAbi,
              functionName: "historyLength",
              args: [feedId, address],
            })) as bigint;
            // For known feeds use their nice symbol; fall back to shortHash for ad-hoc feeds.
            const known = feedId === DEMO_FEED.id ? DEMO_FEED.symbol : shortHash(feedId);
            allAgents.push({
              feedId,
              feedSymbol: known,
              bond: agent.bond,
              lockedBond: agent.lockedBond,
              active: agent.active,
              slashed: agent.slashed,
              attestations,
              lastAttestationAt: agent.lastAttestationAt,
              registryVersion: t.version,
            });
          }
        } catch {
          // Skip this registry; partial results are fine.
        }
        // Silently skip — chain may have transient issues; partial data is fine.
      }
      if (!cancelled) setAgents(allAgents);
    })();

    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  if (agents === undefined) {
    return (
      <div>
        <div className="grid grid-cols-3 gap-px bg-line mb-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-bg p-5">
              <Skeleton width="60%" height="0.7em" className="mb-3" />
              <Skeleton width="40%" height="1.4em" />
            </div>
          ))}
        </div>
        <div className="border border-line p-5">
          <Skeleton width="40%" height="0.7em" className="mb-4" />
          <Skeleton width="80%" />
        </div>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <EmptyState
        message="You don't operate an agent on any feed."
        body="Layer 1 is for builders. Write an agent with the SDK, pin a methodology to IPFS, post a bond — every market created against your feed pays you 20 bps of trading fees forever."
        cta={{ href: "/docs#register", label: "read the integration guide →" }}
      />
    );
  }

  const totalBond = agents.reduce((s, a) => s + Number(a.bond) / 1e6, 0);

  return (
    <div>
      <div className="grid grid-cols-3 gap-px bg-line mb-8">
        <Stat label="feeds attesting" value={String(agents.length)} />
        <Stat label="total bonded" value={`${totalBond.toFixed(2)} USDC`} />
        <Stat
          label="earned as agent"
          value={`${(agentFeesEarned / 1e6).toFixed(4)} USDC`}
        />
      </div>

      <p className="text-fg-mute text-[13.5px] leading-relaxed max-w-[68ch] mb-8">
        Every trade on a market that resolves against one of your agents pays
        you <span className="text-accent">20 bps</span> of the trade size,
        forever. These earnings are <em>only</em> from markets you attest for —
        creator earnings are tracked separately on the creator tab.
        Cumulative volume on markets resolving against your agents:{" "}
        <span className="text-fg tnum">
          {(volumeOnAttestedMarkets / 1e6).toFixed(2)} USDC
        </span>
        .
      </p>

      <div className="caption mb-3">your agents</div>
      <div className="space-y-4">
        {agents.map((a) => (
          <div key={a.feedId} className="border border-line p-5">
            <div className="flex items-baseline justify-between mb-3">
              <Link href={`/feed/${a.feedId}`} className="caption text-accent hover:underline">
                {a.feedSymbol}
              </Link>
              <span className="text-2xs text-fg-dim">{shortHash(a.feedId)}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-6 text-[13px]">
              <Spec label="status" value={
                a.slashed ? (
                  <span className="text-down">slashed</span>
                ) : a.active ? (
                  <span className="text-up">● active</span>
                ) : (
                  <span className="text-fg-mute">inactive</span>
                )
              } />
              <Spec label="bond" value={`${(Number(a.bond) / 1e6).toFixed(2)} USDC`} />
              <Spec
                label="locked"
                value={`${(Number(a.lockedBond) / 1e6).toFixed(2)} USDC`}
                hint={a.lockedBond > 0n ? "open dispute" : "no disputes"}
              />
              <Spec label="attestations" value={fmtInt(Number(a.attestations))} />
            </div>
            <div className="mt-4 text-2xs text-fg-dim">
              last attestation:{" "}
              {a.lastAttestationAt > 0n
                ? `${fmtDuration(Math.floor(Date.now() / 1000) - Number(a.lastAttestationAt))} ago`
                : "—"}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute">
        <span className="font-serif italic">Agent earnings split:</span> on
        every trade against your feed, the contract pays you 20 bps. Combined
        with creator-attractive economics, this turns Layer 1 into a real dev
        revenue stream. See the{" "}
        <a
          href={addrUrl(CONTRACTS.MarketsV2 ?? CONTRACTS.Markets)}
          className="underline decoration-fg-dim underline-offset-4 hover:text-accent"
          target="_blank"
          rel="noreferrer"
        >
          Markets contract
        </a>{" "}
        for live fee flow.
      </div>
    </div>
  );
}

function Spec({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="caption text-fg-dim mb-1">{label}</div>
      <div className="text-fg">{value}</div>
      {hint && <div className="text-2xs text-fg-dim mt-0.5">{hint}</div>}
    </div>
  );
}
