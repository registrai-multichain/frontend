"use client";

import Link from "next/link";
import { PerennialShell } from "@/components/PerennialShell";
import { CommonMarkets, type RoundsView } from "@/components/CommonMarkets";
import { PERENNIAL } from "@/lib/perennial-network";
import { ROUNDS, roundsStatusLine } from "@/lib/rounds";

/** /rounds and its market pages: the 5-minute common markets, in the same paper
 *  frame as the rest of Perennial. They run only where the rounds deployment
 *  lives; any other network gets an honest "soon". */
export function RoundsPage({ view = { kind: "overview" } }: { view?: RoundsView }) {
  const here = ROUNDS.deployed && ROUNDS.chainId === PERENNIAL.chain.id;
  return (
    <PerennialShell status={roundsStatusLine(ROUNDS, PERENNIAL.chain.id)}>
      {here ? (
        <CommonMarkets view={view} />
      ) : (
        <div className="pa-card pu-card pu-card--static max-w-[62ch]">
          <h1 className="pa-h2 pu-h">Rounds open on {PERENNIAL.label} soon</h1>
          <p className="pa-muted mt-2">
            Five-minute Up/Down rounds on BTC, ETH, SOL, ZEC and HYPE, and longer event questions, settled on chain in USDC.
            Meanwhile, see how the <Link className="pa-link" href="/perennial/economy/">money flows</Link>.
          </p>
        </div>
      )}
    </PerennialShell>
  );
}
