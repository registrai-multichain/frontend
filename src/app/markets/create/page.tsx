import { Suspense } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { CreateMarketForm } from "@/components/CreateMarketForm";

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
          <div className="caption mb-3">create a market</div>
          <h1 className="font-serif text-[34px] sm:text-[44px] tracking-tightest leading-[1.05] max-w-[24ch]">
            Spin up a market in{" "}
            <span className="italic text-accent">sixty seconds</span>.
          </h1>
          <p className="font-serif italic text-fg-mute text-[15px] mt-4 max-w-[60ch] leading-snug">
            Pick a feed, set a threshold and an expiry, seed liquidity, and the
            market is live. Resolution is automatic against the agent&apos;s
            attestation at expiry — no human in the loop.
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
