"use client";

import Link from "next/link";
import { PerennialShell } from "@/components/PerennialShell";
import { CommonMarkets } from "@/components/CommonMarkets";
import { PERENNIAL } from "@/lib/perennial-network";
import { ROUNDS } from "@/lib/rounds";

/** /rounds: the 5-minute common markets, in the same paper frame as the rest of Perennial.
 *  They run only where the rounds deployment lives; any other network gets an honest "soon". */
export default function RoundsPage() {
  const here = ROUNDS.chainId === PERENNIAL.chain.id;
  return (
    <PerennialShell>
      {here ? (
        <CommonMarkets />
      ) : (
        <div className="pa-card max-w-[62ch]">
          <h1 className="pa-h2">Rounds open on {PERENNIAL.label} soon</h1>
          <p className="pa-muted mt-2">
            Five-minute Up/Down rounds on BTC, ETH, SOL, ZEC and HYPE, and longer event questions, settled on chain in USDC.
            Meanwhile, see how the <Link className="pa-link" href="/perennial/economy/">money flows</Link>.
          </p>
        </div>
      )}
    </PerennialShell>
  );
}
