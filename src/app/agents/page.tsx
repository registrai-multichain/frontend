import Link from "next/link";
import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { AgentRegistryGrid } from "@/components/AgentRegistryGrid";

export default function AgentsIndexPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">agent registry</div>
          <StatusBadge kind="beta" />
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[22ch]">
          Every onchain{" "}
          <span className="italic text-accent">oracle agent</span>,
          discoverable.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-12">
          Every agent registered against any feed shows up here. Each row is a
          live onchain record — addresses, bonds, methodology hashes, optional
          rule-contract bindings. Click into an agent to see their attestation
          history and the exact contract calls behind each value they publish.
        </p>

        <AgentRegistryGrid />

        <div className="mt-16 border border-dashed border-line p-6 sm:p-8">
          <div className="caption text-accent mb-3">run an agent</div>
          <h3 className="font-serif italic text-[20px] mb-3 max-w-[44ch]">
            Settle common markets. Earn 20% of the resolution fee on every
            market you settle correctly.
          </h3>
          <div className="space-y-3 text-[13px] text-fg-mute leading-relaxed max-w-[64ch] mb-5">
            <p>
              Common markets charge no trading fee. They take 1% once, at
              settlement: 30% to the market creator, 20% to the bonded agent
              that settles it, 50% to the Registrai treasury. They are open to
              any bonded agent whose feed uses an approved, independent dispute
              resolver (never the agent itself). What you earn depends entirely
              on which markets use your feed and how much trades in them.
              Nothing here is a promise of income.
            </p>
            <p>
              The bond is real risk. Anyone can challenge an attestation by
              matching your bond; if the resolver rules it Invalid, your bond is
              slashed to the challenger, and if the market then can&apos;t
              settle, it voids and your 20% goes to that challenger too.
              Perennial builder markets work differently: the protocol&apos;s
              own bonded milestone agent settles them.
            </p>
            <p className="text-2xs text-fg-dim">
              Your feed needs an independent dispute resolver — never your own
              wallet — and common markets only accept one the governor has
              approved. The create form pre-fills the approved resolver where
              one is configured and checks it onchain before you sign.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/agents/create/"
              className="inline-block px-4 py-2 border border-accent/60 text-accent hover:bg-accent hover:text-bg transition-colors text-[12.5px] tracking-wide"
            >
              become an agent →
            </Link>
            <Link
              href="/docs#register"
              className="inline-block px-4 py-2 border border-line text-fg-mute hover:text-accent transition-colors text-[12.5px] tracking-wide"
            >
              read the agent guide →
            </Link>
          </div>
        </div>
      </article>
    </Shell>
  );
}
