"use client";

import { useEffect, useMemo, useState } from "react";
import { createPublicClient, http, type Hex } from "viem";
import { DEFAULT_CHAIN } from "@/lib/chains";
import { CONTRACTS, addrUrl } from "@/lib/chain";
import { CREATABLE_FEEDS } from "@/lib/demo";
import { registryAbi, agentIdentityAbi } from "@/lib/abi";
import { VerifiableBadge } from "./VerifiableBadge";

interface Row {
  feedId: Hex;
  feedSymbol: string;
  feedName: string;
  agent: Hex;
  bond?: bigint;
  lockedBond?: bigint;
  active?: boolean;
  slashed?: boolean;
  lastAttestationAt?: bigint;
  rule?: `0x${string}`;
  registryVersion?: string;
  isFirstParty: boolean;
  // From AgentIdentity (optional — many agents won't have one yet)
  profileName?: string;
  profileDescription?: string;
  profileUrl?: string;
  profileContact?: string;
}

const CHUNK = 100_000n;
const LOOKBACK = 600_000n;

const agentRegisteredEvent = {
  type: "event", name: "AgentRegistered", anonymous: false,
  inputs: [
    { name: "feedId", type: "bytes32", indexed: true },
    { name: "agent", type: "address", indexed: true },
    { name: "methodologyHash", type: "bytes32", indexed: false },
    { name: "bond", type: "uint256", indexed: false },
  ],
} as const;

const FEEDS_BY_ID = new Map(CREATABLE_FEEDS.map((f) => [f.id.toLowerCase(), f]));

export function AgentRegistryGrid() {
  const client = useMemo(
    () =>
      createPublicClient({
        chain: DEFAULT_CHAIN.viemChain,
        transport: http(DEFAULT_CHAIN.rpcUrls[0]),
      }),
    [],
  );

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [discoveryDone, setDiscoveryDone] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Seed with first-party registrations from the static manifest —
        // render these immediately so the page is never empty.
        const seeded: Row[] = CREATABLE_FEEDS.map((f) => ({
          feedId: f.id,
          feedSymbol: f.symbol,
          feedName: f.name,
          agent: f.agent,
          rule: f.rule,
          registryVersion: f.registryVersion,
          isFirstParty: true,
        }));
        if (!cancelled) {
          setRows(seeded);
          setLoading(false);
        }

        // Scan AgentRegistered events from both Registry v1.0 and v1.1.
        const latest = await client.getBlockNumber();
        const earliest = latest > LOOKBACK ? latest - LOOKBACK : 0n;
        const registries: Array<{ addr: Hex; version: string }> = [];
        if (CONTRACTS.Registry) registries.push({ addr: CONTRACTS.Registry, version: "1.0" });
        if (CONTRACTS.RegistryV11) registries.push({ addr: CONTRACTS.RegistryV11, version: "1.1" });

        const discovered = new Map<string, Row>();
        for (const seed of seeded) {
          discovered.set(`${seed.feedId.toLowerCase()}:${seed.agent.toLowerCase()}`, seed);
        }

        for (const reg of registries) {
          for (let to = latest; to > earliest; ) {
            const from = to - CHUNK > earliest ? to - CHUNK : earliest;
            try {
              const events = await client.getLogs({
                address: reg.addr, event: agentRegisteredEvent,
                fromBlock: from, toBlock: to,
              });
              for (const e of events) {
                const feedId = (e.args.feedId as Hex)!.toLowerCase() as Hex;
                const agent = (e.args.agent as Hex)!.toLowerCase() as Hex;
                const key = `${feedId}:${agent}`;
                if (discovered.has(key)) continue;
                const meta = FEEDS_BY_ID.get(feedId);
                discovered.set(key, {
                  feedId,
                  agent,
                  feedSymbol: meta?.symbol ?? "(custom feed)",
                  feedName: meta?.name ?? "Custom feed",
                  rule: meta?.rule,
                  registryVersion: meta?.registryVersion ?? reg.version,
                  isFirstParty: false,
                });
              }
            } catch {
              // chunk failed (RPC range cap); continue.
            }
            if (from === earliest) break;
            to = from - 1n;
          }
        }

        // Hydrate live state per (feedId, agent) via Registry.getAgent +
        // optional AgentIdentity profile.
        const profileCache = new Map<string, {
          name: string; description: string; url: string; contact: string; exists: boolean;
        }>();
        async function loadProfile(agentAddr: Hex) {
          const key = agentAddr.toLowerCase();
          if (profileCache.has(key)) return profileCache.get(key);
          if (!CONTRACTS.AgentIdentity) return undefined;
          try {
            const p = (await client.readContract({
              address: CONTRACTS.AgentIdentity, abi: agentIdentityAbi,
              functionName: "getProfile", args: [agentAddr],
            })) as { name: string; description: string; url: string; contact: string; exists: boolean };
            profileCache.set(key, p);
            return p;
          } catch {
            return undefined;
          }
        }

        const hydrated = await Promise.all(
          Array.from(discovered.values()).map(async (r) => {
            const registryAddr =
              r.registryVersion === "1.1" && CONTRACTS.RegistryV11
                ? CONTRACTS.RegistryV11
                : CONTRACTS.Registry;
            const [agentState, profile] = await Promise.all([
              client.readContract({
                address: registryAddr, abi: registryAbi, functionName: "getAgent",
                args: [r.feedId, r.agent],
              }).then((a) => a as {
                bond: bigint; lockedBond: bigint; lastAttestationAt: bigint;
                active: boolean; slashed: boolean;
              }).catch(() => undefined),
              loadProfile(r.agent),
            ]);
            return {
              ...r,
              bond: agentState?.bond,
              lockedBond: agentState?.lockedBond,
              lastAttestationAt: agentState?.lastAttestationAt,
              active: agentState?.active,
              slashed: agentState?.slashed,
              profileName: profile?.exists ? profile.name : undefined,
              profileDescription: profile?.exists ? profile.description : undefined,
              profileUrl: profile?.exists ? profile.url : undefined,
              profileContact: profile?.exists ? profile.contact : undefined,
            };
          }),
        );

        if (!cancelled) {
          setRows(hydrated.sort((a, b) => {
            if (a.isFirstParty !== b.isFirstParty) return a.isFirstParty ? -1 : 1;
            return Number((b.bond ?? 0n) - (a.bond ?? 0n));
          }));
          setDiscoveryDone(true);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setDiscoveryDone(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  if (loading && rows.length === 0) {
    return (
      <div className="border border-dashed border-line/60 p-8 text-center">
        <p className="caption text-fg-dim">loading agents…</p>
      </div>
    );
  }
  if (error && rows.length === 0) {
    return (
      <div className="border border-dashed border-down/40 p-8 text-2xs text-down">
        Could not load registry: {error}
      </div>
    );
  }
  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-line">
        {rows.map((r) => (
          <AgentCard key={`${r.feedId}:${r.agent}`} row={r} />
        ))}
      </div>
      {!discoveryDone && (
        <div className="mt-3 text-2xs text-fg-dim flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent dot-pulse" />
          discovering community agents from chain events…
        </div>
      )}
    </div>
  );
}

function AgentCard({ row }: { row: Row }) {
  const bondUsdc = row.bond ? (Number(row.bond) / 1e6).toFixed(2) : "—";
  const lastAttested = row.lastAttestationAt && row.lastAttestationAt > 0n
    ? relTime(Number(row.lastAttestationAt))
    : "never";

  return (
    <div className="bg-bg p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="caption text-accent">{row.feedSymbol}</span>
          {row.rule && <VerifiableBadge rule={row.rule} />}
          {row.registryVersion && (
            <span className="caption text-[10px] text-fg-dim">
              v{row.registryVersion}
            </span>
          )}
        </div>
        <span className="text-2xs text-fg-dim">
          {row.isFirstParty ? "first-party" : "community"}
        </span>
      </div>

      <div>
        {row.profileName && (
          <div className="font-serif italic text-[16px] text-fg mb-1">
            {row.profileName}
          </div>
        )}
        <h3 className="font-serif text-[17px] leading-snug max-w-[34ch]">
          {row.feedName}
        </h3>
        {row.profileDescription && (
          <p className="text-2xs text-fg-mute leading-relaxed mt-2 max-w-[44ch]">
            {row.profileDescription}
          </p>
        )}
        {(row.profileUrl || row.profileContact) && (
          <div className="flex flex-wrap gap-3 mt-2 text-2xs">
            {row.profileUrl && (
              <a
                href={row.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {row.profileUrl.replace(/^https?:\/\//, "").slice(0, 36)} ↗
              </a>
            )}
            {row.profileContact && (
              <span className="text-fg-dim">{row.profileContact}</span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px] mt-1">
        <Cell label="agent">
          <a
            href={addrUrl(row.agent)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-2xs text-fg-mute hover:text-accent tnum"
          >
            {row.agent.slice(0, 8)}…{row.agent.slice(-6)} ↗
          </a>
        </Cell>
        <Cell label="bond">
          <span className="tnum">{bondUsdc} USDC</span>
        </Cell>
        <Cell label="last attested">
          <span className="text-fg-mute">{lastAttested}</span>
        </Cell>
        <Cell label="status">
          {row.slashed ? (
            <span className="text-down">slashed</span>
          ) : row.active ? (
            <span className="text-up">active</span>
          ) : (
            <span className="text-fg-dim">inactive</span>
          )}
        </Cell>
      </div>

      <div className="text-2xs mt-1 pt-3 border-t border-line/60 flex items-center justify-between">
        <span className="text-fg-dim">feed</span>
        <a
          href={`/feed/${row.feedId}/`}
          className="text-accent hover:underline tnum"
        >
          {row.feedId.slice(0, 10)}… →
        </a>
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="caption text-fg-dim text-[10px] mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
