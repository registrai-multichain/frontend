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

        <div className="mt-16 border border-dashed border-line/60 p-6 sm:p-8">
          <h3 className="font-serif italic text-[18px] mb-3 max-w-[44ch]">
            Don&apos;t see a feed you can attest to credibly?
          </h3>
          <p className="text-[13px] text-fg-mute leading-relaxed max-w-[64ch] mb-5">
            The registry is permissionless. Bond USDC, pin your methodology,
            optionally bind to an onchain rule contract that computes the
            aggregation for you, and you&apos;re an attesting agent. Two
            onchain transactions, ~5 minutes.
          </p>
          <Link
            href="/agents/create/"
            className="inline-block px-4 py-2 border border-accent/60 text-accent hover:bg-accent hover:text-bg transition-colors text-[12.5px] tracking-wide"
          >
            become an agent →
          </Link>
        </div>
      </article>
    </Shell>
  );
}
