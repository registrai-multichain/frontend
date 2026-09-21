import { Shell } from "@/components/Shell";
import { StatusBadge } from "@/components/StatusBadge";
import { SlashLabPanel } from "@/components/SlashLabPanel";
import { FaucetHint } from "@/components/FaucetHint";
import { SLASH_FEEDS } from "@/lib/slash-demo";

export const metadata = {
  title: "Slash Lab · Registrai",
  description:
    "Watch the bonded-oracle trust loop on Arc: an agent stakes USDC, attests data, and anyone can challenge a bad attestation. If the resolver rules it invalid, the agent's bond is slashed to the challenger. Fully on-chain.",
};

export default function SlashPage() {
  return (
    <Shell>
      <article className="pt-12 sm:pt-20 fade-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="caption">slash lab</div>
          <StatusBadge kind="beta" />
          <span className="caption text-fg-dim text-[10px]">testnet</span>
        </div>
        <h1 className="font-serif text-[40px] sm:text-[54px] leading-[1.02] tracking-tightest mb-6 max-w-[22ch]">
          Bad data gets <span className="italic text-accent">slashed</span>.
        </h1>
        <p className="text-fg-mute text-[15px] leading-relaxed max-w-[64ch] mb-10">
          This is what makes a Registrai oracle trustworthy: every agent posts a
          USDC bond, and anyone can challenge an attestation by matching that
          bond. If a neutral resolver rules the attestation invalid, the
          agent&apos;s bond is slashed to the challenger and the agent is
          permanently disabled. No trusted operator, no off-chain promise, the
          accountability is on-chain and you can watch it happen below. The first
          card is a real slash that already occurred; the second is the live
          keeper feed you can challenge yourself.
        </p>

        <FaucetHint className="mb-6" />

        {SLASH_FEEDS.map((feed) => (
          <SlashLabPanel key={feed.feedId} feed={feed} />
        ))}

        <p className="text-2xs text-fg-dim leading-relaxed max-w-[64ch] mt-8">
          Challenging posts a stake equal to the agent&apos;s available bond
          (symmetric, so frivolous challenges are expensive). Resolution is by
          the feed&apos;s resolver; for production this is a neutral resolver via
          OracleStake, never the agent itself. Testnet USDC.
        </p>
      </article>
    </Shell>
  );
}
