"use client";

import Link from "next/link";
import type { Address } from "viem";
import { CONTRACTS, addrUrl } from "@/lib/chain";
import { DEMO_MARKETS } from "@/lib/markets-demo";
import { shortHash } from "@/lib/format";
import { Row, Stat, EmptyState } from "./PositionsTab";

export function CreatorTab({ address }: { address: Address }) {
  // Markets you created — derived from chain state via sync, role-attributed.
  const marketsCreated = DEMO_MARKETS.filter(
    (m) => m.creator.toLowerCase() === address.toLowerCase(),
  );

  // Creator-only fee earnings: sum the creator-share of fees across only the
  // markets where this address is the creator. This is the right answer even
  // when the same wallet is also the agent on a market.
  const creatorFeesEarned = marketsCreated.reduce(
    (s, m) => s + (m.fees?.creator ?? 0),
    0,
  );

  const grossVolumeOnYourMarkets = marketsCreated.reduce(
    (s, m) => s + (m.fees?.grossVolume ?? 0),
    0,
  );

  const totalLiquidity = marketsCreated.reduce(
    (s, m) => s + (m.yesReserve + m.noReserve) / 2 / 1e6,
    0,
  );

  return (
    <div>
      <div className="grid grid-cols-3 gap-px bg-line mb-8">
        <Stat label="markets created" value={String(marketsCreated.length)} />
        <Stat
          label="total liquidity seeded"
          value={`${totalLiquidity.toFixed(2)} USDC`}
        />
        <Stat
          label="earned as creator"
          value={`${(creatorFeesEarned / 1e6).toFixed(4)} USDC`}
        />
      </div>

      <p className="text-fg-mute text-[13.5px] leading-relaxed max-w-[68ch] mb-8">
        Every trade on a market you created pays you{" "}
        <span className="text-accent">40 bps</span> of the trade size, forever.
        These earnings are <em>only</em> from markets where you are the creator
        — agent earnings are tracked separately on the deployer tab.
        Cumulative volume on your markets:{" "}
        <span className="text-fg tnum">
          {(grossVolumeOnYourMarkets / 1e6).toFixed(2)} USDC
        </span>
        .
      </p>

      <div className="caption mb-3">your markets</div>
      {marketsCreated.length === 0 ? (
        <EmptyState
          message="You haven't created a market yet."
          body="Spin one up in sixty seconds — pick a feed, set the threshold and expiry, seed liquidity. Every trade pays you 0.4%."
          cta={{ href: "/markets/create", label: "create your first market →" }}
        />
      ) : (
        <div className="border border-line">
          <Row head cells={["market", "volume", "your creator fees", "liquidity", ""]} />
          {marketsCreated.map((m) => (
            <Row
              key={m.id}
              cells={[
                <Link href={`/markets/${m.id}`} className="hover:text-accent" key="t">
                  <span className="block truncate max-w-[24ch] sm:max-w-[36ch]">
                    {m.title}
                  </span>
                  <span className="text-2xs text-fg-dim">{shortHash(m.id)}</span>
                </Link>,
                <span className="tnum" key="v">
                  {((m.fees?.grossVolume ?? 0) / 1e6).toFixed(2)} USDC
                </span>,
                <span className="tnum text-up" key="cf">
                  {((m.fees?.creator ?? 0) / 1e6).toFixed(4)} USDC
                </span>,
                <span className="tnum text-fg-mute" key="l">
                  {((m.yesReserve + m.noReserve) / 2 / 1e6).toFixed(2)} USDC
                </span>,
                <Link
                  href={`/markets/${m.id}`}
                  className="text-2xs text-fg-dim hover:text-accent"
                  key="g"
                >
                  view →
                </Link>,
              ]}
            />
          ))}
        </div>
      )}

      <div className="mt-12 border border-dashed border-line/60 p-6 text-[13px] text-fg-mute">
        <span className="font-serif italic">Creator earnings split:</span> when
        a trader buys or sells on a market you made, the contract takes 70 bps
        as a fee — 40 of those go to you, 20 to the agent providing the data,
        10 to the protocol. See the{" "}
        <a href={addrUrl(CONTRACTS.Markets)} className="underline decoration-fg-dim underline-offset-4 hover:text-accent" target="_blank" rel="noreferrer">
          Markets contract on ArcScan
        </a>{" "}
        for live fee flow.
      </div>
    </div>
  );
}
