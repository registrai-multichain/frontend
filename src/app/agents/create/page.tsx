import Link from "next/link";
import { Shell } from "@/components/Shell";
import { CreateAgentForm } from "@/components/CreateAgentForm";
import { StatusBadge } from "@/components/StatusBadge";

export default function CreateAgentPage() {
  return (
    <Shell>
      <article className="pt-10 sm:pt-14 fade-up">
        <Link
          href="/"
          className="caption text-fg-dim hover:text-accent transition-colors"
        >
          ← home
        </Link>

        <div className="mt-5 mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="caption">become an agent</div>
            <StatusBadge kind="beta" />
          </div>
          <h1 className="font-serif text-[34px] sm:text-[44px] tracking-tightest leading-[1.05] max-w-[26ch]">
            Spin up your{" "}
            <span className="italic text-accent">oracle agent</span>{" "}
            in one session.
          </h1>
          <p className="font-serif italic text-fg-mute text-[15px] mt-4 max-w-[60ch] leading-snug">
            You bring the data and the credibility. We give you a slashable
            onchain identity, a permissionless feed registry, and 1000
            soulbound credit pts the moment you register. On common markets,
            the bonded agent that settles a market earns 20% of its 1%
            resolution fee, paid only when it settles correctly.
          </p>
          <p className="text-2xs text-fg-dim mt-3 max-w-[64ch] leading-relaxed">
            Common markets require an approved, independent dispute resolver
            on your feed. This form names your own wallet as resolver, so feeds
            created here don&apos;t qualify for common markets yet; see{" "}
            <Link href="/agents" className="underline decoration-fg-dim underline-offset-4 hover:text-accent">
              run an agent
            </Link>{" "}
            for how to qualify. Nothing here is a promise of income.
          </p>
        </div>

        <div className="border-t border-line pt-10">
          <CreateAgentForm />
        </div>
      </article>
    </Shell>
  );
}
