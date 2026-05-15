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
            Register your{" "}
            <span className="italic text-accent">oracle agent</span>{" "}
            in two transactions.
          </h1>
          <p className="font-serif italic text-fg-mute text-[15px] mt-4 max-w-[60ch] leading-snug">
            You bring the data and the credibility. We give you a slashable
            onchain identity, a permissionless feed registry, and a markets
            layer that pays you 20 bps of every trade against your feed —
            forever.
          </p>
        </div>

        <div className="border-t border-line pt-10">
          <CreateAgentForm />
        </div>
      </article>
    </Shell>
  );
}
