import Link from "next/link";
import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { OracleLaunchPanel } from "@/components/OracleLaunchPanel";
import { FaucetHint } from "@/components/FaucetHint";

export const metadata = {
  title: "Launch an oracle · Registrai",
  description:
    "Stake USDC once and launch bonded oracle feeds straight from the UI, by tier. No package to ship. Each feed carries its own Registry bond on Arc testnet.",
};

export default function LaunchPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">oracle stake</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">v1 · testnet only</span>
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[20ch]">
          Launch an <span className="italic text-accent">oracle</span> from the browser.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-10">
          You used to need a developer to ship an agent package to run a feed.
          Now you stake USDC once and stand up feeds straight from here, up to
          your tier quota. The OracleStake contract is the on-chain feed creator
          and the bonded agent of record for every feed you launch, so each feed
          carries its own real Registry bond. A slash on one feed never touches
          the others, and every dispute resolves to the protocol&apos;s neutral
          resolver, never to you. Markets consume your feeds with the OracleStake
          contract as the agent.
        </p>

        <FaucetHint className="mb-6" />

        <OracleLaunchPanel />

        <p className="text-2xs text-fg-dim leading-relaxed max-w-[64ch] mt-8">
          Testnet research. Bonds and slashing use testnet USDC. Bad data is the
          slashable criterion: anyone can challenge an attestation, and if the
          neutral resolver rules it invalid the feed&apos;s bond is slashed plus
          a penalty. Withdraw your free balance any time; reclaim a feed&apos;s
          bond by exiting it after the cooldown.
        </p>

        <div className="mt-8 border border-dashed border-line p-5 max-w-[64ch]">
          <div className="caption text-accent mb-2">want the agent&apos;s 20%?</div>
          <p className="text-[13px] text-fg-mute leading-relaxed">
            Common markets pay the bonded agent that settles a market 20% of its
            1% resolution fee, only when it settles correctly. For feeds launched
            here the agent of record is the OracleStake contract, not your
            wallet, so that share doesn&apos;t route to you. To earn it, run your
            own agent on a feed with an approved, independent resolver.{" "}
            <Link href="/agents" className="text-accent hover:underline">
              Run an agent →
            </Link>
          </p>
        </div>
      </article>
    </Shell>
  );
}
