"use client";

import { useEffect, useState } from "react";
import { type Address } from "viem";
import { useWallet } from "./WalletProvider";
import { CONTRACTS } from "@/lib/chain";

const pointsAbi = [
  {
    type: "function",
    name: "points",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "dailyTradePts",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const DAILY_TRADE_CAP = 500;

/**
 * Onchain credit balance for the subject address. Reads directly from the
 * RegistraiPoints contract — no backend dependency. Soulbound by design.
 */
export function CreditsBanner({ address: subjectAddr }: { address: Address }) {
  const { publicClient } = useWallet();
  const [points, setPoints] = useState<bigint | undefined>();
  const [dailyTradePts, setDailyTradePts] = useState<bigint | undefined>();

  useEffect(() => {
    const pointsAddr = CONTRACTS.RegistraiPoints;
    if (!pointsAddr) return;
    let cancelled = false;
    Promise.all([
      publicClient.readContract({
        address: pointsAddr,
        abi: pointsAbi,
        functionName: "points",
        args: [subjectAddr],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: pointsAddr,
        abi: pointsAbi,
        functionName: "dailyTradePts",
        args: [subjectAddr],
      }) as Promise<bigint>,
    ])
      .then(([p, d]) => {
        if (cancelled) return;
        setPoints(p);
        setDailyTradePts(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [publicClient, subjectAddr]);

  const pointsAddr = (CONTRACTS as { RegistraiPoints?: Address }).RegistraiPoints;
  if (!pointsAddr) return null;

  const total = points === undefined ? "—" : points.toString();
  const dailyUsed = Number(dailyTradePts ?? 0n);
  const dailyPct = Math.min(100, Math.round((dailyUsed / DAILY_TRADE_CAP) * 100));

  return (
    <section className="mb-8 border border-accent/40 bg-bg-elev/40 p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-4">
        <div>
          <div className="caption text-accent mb-2">onchain credits</div>
          <div className="text-[40px] sm:text-[48px] leading-none tracking-tightest tnum">
            {total}
            <span className="text-[16px] text-fg-mute ml-2">pts</span>
          </div>
          <p className="text-2xs text-fg-dim mt-2 max-w-[52ch] leading-relaxed">
            Soulbound. Earned by registering agents, attesting, creating markets,
            and trading. Read directly from{" "}
            <a
              href={`https://testnet.arcscan.app/address/${pointsAddr}`}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-fg-dim underline-offset-2 hover:text-accent"
            >
              the RegistraiPoints contract
            </a>
            .
          </p>
        </div>

        {dailyUsed > 0 && (
          <div className="text-right sm:ml-auto">
            <div className="caption text-fg-dim mb-2">
              today · trade earnings
            </div>
            <div className="tnum text-fg text-[14px]">
              {dailyUsed} / {DAILY_TRADE_CAP} pts
            </div>
            <div className="w-32 h-1 bg-line mt-2 ml-auto">
              <div
                className="h-1 bg-accent"
                style={{ width: `${dailyPct}%` }}
              />
            </div>
            <p className="text-2xs text-fg-dim mt-1">daily cap resets at 00:00 UTC</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-line/60 text-2xs">
        <Earn label="register agent" v="1000 pts" highlight />
        <Earn label="create market" v="200 pts" />
        <Earn label="attest data" v="50 pts" />
        <Earn label="trade" v="10 pts / USDC" />
      </div>
    </section>
  );
}

function Earn({
  label,
  v,
  highlight,
}: {
  label: string;
  v: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-fg-dim">{label}</div>
      <div className={`tnum ${highlight ? "text-accent" : "text-fg"}`}>{v}</div>
    </div>
  );
}
