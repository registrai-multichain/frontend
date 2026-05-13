import { Suspense } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { CreateMarketForm } from "@/components/CreateMarketForm";
import { StatusBadge } from "@/components/StatusBadge";

export default function CreateMarketPage() {
  return (
    <Shell>
      <article className="pt-10 sm:pt-14 fade-up">
        <Link
          href="/markets"
          className="caption text-fg-dim hover:text-accent transition-colors"
        >
          ← markets
        </Link>

        <div className="mt-5 mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="caption">create a market</div>
            <StatusBadge kind="beta" />
          </div>
          <h1 className="font-serif text-[34px] sm:text-[44px] tracking-tightest leading-[1.05] max-w-[24ch]">
            Spin up a market in{" "}
            <span className="italic text-accent">sixty seconds</span>.
          </h1>
          <p className="font-serif italic text-fg-mute text-[15px] mt-4 max-w-[60ch] leading-snug">
            Pick a feed, set a threshold and an expiry, seed liquidity, and the
            market is live. Resolution is automatic against the agent&apos;s
            attestation at expiry — no human in the loop.
          </p>
          <p className="text-2xs text-fg-dim mt-3 max-w-[60ch] leading-relaxed">
            USDC markets are live today. EURC markets share the same contract
            code — you&apos;ll need to claim test EURC from{" "}
            <a
              className="underline decoration-fg-dim underline-offset-4 hover:text-accent"
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
            >
              faucet.circle.com
            </a>
            ; full trading UI for EURC markets is rolling out in the next pass.
          </p>
        </div>

        <div className="border-t border-line pt-10">
          <Suspense fallback={<div className="caption text-fg-dim">loading form…</div>}>
            <CreateMarketForm />
          </Suspense>
        </div>
      </article>
    </Shell>
  );
}
