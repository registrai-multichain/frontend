"use client";

/**
 * Dynamic market viewer — loads any market by id directly from chain.
 *
 * Static export can't pre-render arbitrary marketIds, so this page reads
 * `?id=0x…` from the URL and queries every Markets contract version (v2
 * first, then v1.1, then v1.0) until it finds the market. Lets a user view
 * a market they just created without rebuilding the static manifest.
 *
 * For statically pre-rendered markets (the 12 in live-data.json), the route
 * /markets/[id]/ continues to serve a richer page with history + sparkline.
 * This view is the chain-truthy fallback for everything else.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type Address, type Hex } from "viem";
import { Shell } from "@/components/Shell";
import { TradePanel } from "@/components/TradePanel";
import { FaucetHint } from "@/components/FaucetHint";
import { useWallet } from "@/components/WalletProvider";
import { CONTRACTS, addrUrl } from "@/lib/chain";
import { marketsAbi } from "@/lib/abi";
import { fmtInt, isoDate, isoDateTime, shortAddr, shortHash } from "@/lib/format";
import type { Comparator, Market, MarketPhase } from "@/lib/types";
import { MarketDescriptionLive } from "@/components/MarketDescriptionLive";
import { DEMO_FEED } from "@/lib/demo";

interface ChainMarket {
  feedId: Hex;
  agent: Address;
  threshold: bigint;
  comparator: number;
  expiry: bigint;
  creator: Address;
  yesReserve: bigint;
  noReserve: bigint;
  phase: number;
  yesWon: boolean;
  createdAt: bigint;
}

function ViewMarketInner() {
  const sp = useSearchParams();
  const id = sp?.get("id") as Hex | null;
  const { publicClient } = useWallet();

  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "loaded"; market: Market; marketsVersion: "1.0" | "1.1" | "2.0" }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    if (!id || !/^0x[0-9a-fA-F]{64}$/.test(id)) {
      setState({ kind: "error", message: "invalid or missing market id" });
      return;
    }

    const targets: Array<{
      addr: Address | undefined;
      version: "1.0" | "1.1" | "2.0";
    }> = [
      { addr: CONTRACTS.MarketsV2, version: "2.0" },
      { addr: CONTRACTS.MarketsV11, version: "1.1" },
      { addr: CONTRACTS.Markets, version: "1.0" },
    ];

    let cancelled = false;
    (async () => {
      for (const t of targets) {
        if (!t.addr) continue;
        try {
          const m = (await publicClient.readContract({
            address: t.addr,
            abi: marketsAbi,
            functionName: "getMarket",
            args: [id],
          })) as ChainMarket;
          // createdAt === 0 ⇒ market doesn't exist on this contract.
          if (m.createdAt === 0n) continue;
          if (cancelled) return;
          setState({
            kind: "loaded",
            market: chainToMarket(id, m, t.version),
            marketsVersion: t.version,
          });
          return;
        } catch {
          // Try the next version.
        }
      }
      if (!cancelled) setState({ kind: "missing" });
    })();

    return () => {
      cancelled = true;
    };
  }, [id, publicClient]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <article className="pt-12 sm:pt-20 fade-up max-w-[680px]">
          <Link href="/markets/" className="caption text-fg-dim hover:text-accent">← markets</Link>
          <div className="mt-6 caption text-fg-mute">loading market from chain…</div>
        </article>
      </Shell>
    );
  }

  if (state.kind === "error") {
    return (
      <Shell>
        <article className="pt-12 sm:pt-20 fade-up max-w-[680px]">
          <Link href="/markets/" className="caption text-fg-dim hover:text-accent">← markets</Link>
          <div className="mt-6 border border-down/40 p-5 text-2xs text-down">{state.message}</div>
        </article>
      </Shell>
    );
  }

  if (state.kind === "missing") {
    return (
      <Shell>
        <article className="pt-12 sm:pt-20 fade-up max-w-[680px]">
          <Link href="/markets/" className="caption text-fg-dim hover:text-accent">← markets</Link>
          <h1 className="font-serif text-[28px] mt-4">Market not found.</h1>
          <p className="text-fg-mute mt-3 text-[14px] leading-relaxed">
            No Markets contract on Arc has a record of this id. Check the id, or
            view{" "}
            <a
              href={`https://testnet.arcscan.app/tx/${id}`}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              the related transaction on ArcScan
            </a>
            .
          </p>
        </article>
      </Shell>
    );
  }

  const market = state.market;
  const daysToExpiry = Math.max(0, Math.ceil((market.expiry - Date.now() / 1000) / 86_400));

  return (
    <Shell>
      <article className="pt-10 sm:pt-14 fade-up">
        <Link href="/markets/" className="caption text-fg-dim hover:text-accent">← markets</Link>

        <div className="mt-4 mb-6">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="caption">market · {shortHash(market.id)}</div>
            <span className="caption text-[10px] text-fg-dim border border-line px-1.5 py-0.5">
              v{state.marketsVersion}
            </span>
          </div>
          <h1 className="font-serif text-[26px] sm:text-[32px] tracking-tightest leading-[1.1] max-w-[42ch]">
            {market.title}
          </h1>
          <div className="mt-4 flex items-center gap-3 text-2xs text-fg-mute flex-wrap">
            <span>resolves against</span>
            <span className="border border-line px-2 py-1 tnum">
              {shortHash(market.feedId)}
            </span>
            <span className="text-fg-dim">·</span>
            <span>
              {daysToExpiry}d to expiry · {isoDate(market.expiry)}
            </span>
          </div>
        </div>

        <FaucetHint className="mb-8" />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 mb-12">
          {/* LEFT — context */}
          <div className="space-y-8 min-w-0">
            <section>
              <div className="caption mb-3">description</div>
              <div className="border border-line bg-bg-elev/30 p-5">
                <MarketDescriptionLive marketId={market.id} fallback={undefined} />
              </div>
            </section>

            <section>
              <div className="caption mb-3">resolution rule</div>
              <div className="border border-line bg-bg-elev/40 p-5">
                <p className="text-[13.5px] leading-relaxed text-fg">
                  At <span className="text-accent tnum">{isoDateTime(market.expiry)}</span>{" "}
                  UTC, the market reads{" "}
                  <code className="text-fg-mute break-all">
                    Attestation.valueAt({shortHash(market.feedId)},{" "}
                    {shortAddr(market.agent)}, {market.expiry})
                  </code>
                  . If the returned value{" "}
                  <span className="text-accent">{market.comparator}</span>{" "}
                  <span className="text-accent tnum">{fmtInt(market.threshold)}</span>
                  , <span className="text-up">YES wins</span>. Otherwise{" "}
                  <span className="text-down">NO wins</span>.
                </p>
                <p className="text-[12.5px] leading-relaxed text-fg-mute mt-4">
                  Anyone can call <code>resolve(marketId)</code> after expiry —
                  permissionless. The attestation must be finalized (past its
                  dispute window).
                </p>
              </div>
            </section>

            <section className="grid grid-cols-2 sm:grid-cols-3 gap-y-5 gap-x-6 text-[12.5px]">
              <Spec label="feed" value={shortHash(market.feedId)} />
              <Spec
                label="agent"
                value={
                  <a
                    href={addrUrl(market.agent)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent transition-colors tnum"
                  >
                    {shortAddr(market.agent)}
                  </a>
                }
              />
              <Spec label="threshold" value={`${fmtInt(market.threshold)}`} />
              <Spec label="comparator" value={market.comparator} />
              <Spec label="expiry" value={isoDate(market.expiry)} />
              <Spec
                label="initial liquidity"
                value={`${fmtInt(market.liquidity / 1e6)} USDC`}
              />
              <Spec label="phase" value={market.phase} />
              <Spec
                label="creator"
                value={
                  <a
                    href={addrUrl(market.creator)}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent transition-colors tnum"
                  >
                    {shortAddr(market.creator)}
                  </a>
                }
              />
            </section>
          </div>

          {/* RIGHT — trade */}
          <aside className="lg:sticky lg:top-24 h-fit">
            <TradePanel market={market} />
          </aside>
        </div>
      </article>
    </Shell>
  );
}

export default function ViewMarketPage() {
  return (
    <Suspense fallback={null}>
      <ViewMarketInner />
    </Suspense>
  );
}

/** Convert chain Market tuple → frontend Market type. */
function chainToMarket(
  id: Hex,
  m: ChainMarket,
  version: "1.0" | "1.1" | "2.0",
): Market {
  const comparator = ([">", ">=", "<", "<="] as Comparator[])[
    Number(m.comparator)
  ] ?? ">";
  const phase: MarketPhase = m.phase === 1 ? "resolved" : "trading";
  // For markets in the static manifest we'd have nice feed metadata; for
  // ad-hoc markets created via the UI we have only the feedId on chain.
  const feedSymbol =
    m.feedId === DEMO_FEED.id ? DEMO_FEED.symbol : shortHash(m.feedId);
  const threshold = Number(m.threshold);
  const title = `Will ${feedSymbol} ${comparator} ${threshold} by ${isoDate(
    Number(m.expiry),
  )}?`;
  return {
    id,
    feedId: m.feedId,
    feedSymbol,
    agent: m.agent,
    threshold,
    comparator,
    expiry: Number(m.expiry),
    creator: m.creator,
    yesReserve: Number(m.yesReserve),
    noReserve: Number(m.noReserve),
    liquidity: Number(m.yesReserve), // approximate — pool starts symmetric, drifts on trades
    phase,
    yesWon: m.yesWon,
    history: [],
    title,
    unit: "",
    marketsVersion: version,
  };
}

function Spec({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="caption mb-1.5">{label}</div>
      <div className="text-fg">{value}</div>
    </div>
  );
}
