"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useWallet } from "../WalletProvider";
import { CONTRACTS } from "@/lib/chain";
import { marketsAbi } from "@/lib/abi";
import { DEMO_MARKETS } from "@/lib/markets-demo";
import { fmtInt, shortHash } from "@/lib/format";
import type { Market } from "@/lib/types";

interface Position {
  market: Market;
  yesShares: bigint;
  noShares: bigint;
  yesPrice: number;
  estimatedValue: number; // mark-to-market in USDC, rough
}

export function PositionsTab({ address }: { address: Address }) {
  const { publicClient } = useWallet();
  const [positions, setPositions] = useState<Position[] | undefined>();

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      DEMO_MARKETS.map(async (m) => {
        const [yes, no] = (await Promise.all([
          publicClient.readContract({
            address: CONTRACTS.Markets,
            abi: marketsAbi,
            functionName: "yesBalance",
            args: [m.id, address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: CONTRACTS.Markets,
            abi: marketsAbi,
            functionName: "noBalance",
            args: [m.id, address],
          }) as Promise<bigint>,
        ])) as [bigint, bigint];
        const yesPrice = m.noReserve / (m.yesReserve + m.noReserve);
        const estValue = (Number(yes) * yesPrice + Number(no) * (1 - yesPrice)) / 1e6;
        return {
          market: m,
          yesShares: yes,
          noShares: no,
          yesPrice,
          estimatedValue: estValue,
        } satisfies Position;
      }),
    ).then((all) => {
      if (cancelled) return;
      setPositions(all.filter((p) => p.yesShares > 0n || p.noShares > 0n));
    });
    return () => {
      cancelled = true;
    };
  }, [address, publicClient]);

  if (positions === undefined) {
    return <div className="caption text-fg-dim py-8">loading positions…</div>;
  }
  if (positions.length === 0) {
    return (
      <EmptyState
        message="No open positions yet."
        body="Buy YES or NO on any market to see it here."
        cta={{ href: "/markets", label: "browse markets →" }}
      />
    );
  }

  const totalEst = positions.reduce((s, p) => s + p.estimatedValue, 0);

  return (
    <div>
      <div className="grid grid-cols-3 gap-px bg-line mb-8">
        <Stat label="open positions" value={String(positions.length)} />
        <Stat label="est. portfolio value" value={`${totalEst.toFixed(2)} USDC`} />
        <Stat
          label="active markets traded"
          value={String(new Set(positions.map((p) => p.market.id)).size)}
        />
      </div>

      <div className="border border-line">
        <Row head cells={["market", "YES shares", "NO shares", "implied value", ""]} />
        {positions.map((p) => (
          <Row
            key={p.market.id}
            cells={[
              <Link
                href={`/markets/${p.market.id}`}
                className="hover:text-accent"
                key="m"
              >
                <span className="block truncate max-w-[24ch] sm:max-w-[36ch]">
                  {p.market.title}
                </span>
                <span className="text-2xs text-fg-dim">{shortHash(p.market.id)}</span>
              </Link>,
              <span className="text-up tnum" key="y">
                {p.yesShares > 0n ? (Number(p.yesShares) / 1e6).toFixed(2) : "—"}
              </span>,
              <span className="text-down tnum" key="n">
                {p.noShares > 0n ? (Number(p.noShares) / 1e6).toFixed(2) : "—"}
              </span>,
              <span className="tnum" key="v">
                {p.estimatedValue.toFixed(2)} USDC
              </span>,
              <Link
                href={`/markets/${p.market.id}`}
                className="text-2xs text-fg-dim hover:text-accent"
                key="g"
              >
                manage →
              </Link>,
            ]}
          />
        ))}
      </div>
      <p className="mt-4 text-2xs text-fg-dim leading-relaxed">
        Implied value uses the current AMM mid-price. Actual sell proceeds will
        differ by slippage. Redeem at resolution pays 1 USDC per winning share.
      </p>
    </div>
  );
}

export function Row({ head, cells }: { head?: boolean; cells: React.ReactNode[] }) {
  return (
    <div
      className={`grid grid-cols-[2.2fr_0.9fr_0.9fr_1fr_0.6fr] gap-2 px-4 py-3 items-center ${
        head
          ? "caption border-b border-line bg-bg-elev/40"
          : "border-b border-line/60 last:border-0 hover:bg-bg-elev/40 transition-colors"
      } text-[12.5px]`}
    >
      {cells.map((c, i) => (
        <div key={i}>{c}</div>
      ))}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg p-5">
      <div className="caption text-fg-dim mb-2">{label}</div>
      <div className="text-[22px] tnum tracking-tightest">{value}</div>
    </div>
  );
}

export function EmptyState({
  message,
  body,
  cta,
}: {
  message: string;
  body?: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="border border-dashed border-line/60 p-8 text-center">
      <p className="font-serif italic text-fg-mute text-[16px] leading-snug max-w-[44ch] mx-auto">
        {message}
      </p>
      {body && <p className="text-2xs text-fg-dim mt-3 max-w-[52ch] mx-auto">{body}</p>}
      {cta && (
        <Link
          href={cta.href}
          className="mt-5 inline-block text-2xs text-accent hover:underline decoration-fg-dim underline-offset-4"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}

export { fmtInt };
