"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Override via NEXT_PUBLIC_PROPOSALS_URL at build time for forks running their
// own worker.
const WORKER_URL =
  process.env.NEXT_PUBLIC_PROPOSALS_URL ??
  "https://registrai-agents.guanyidu98.workers.dev/proposals";

type Comparator = ">" | ">=" | "<" | "<=";
const COMPARATOR_INDEX: Record<Comparator, number> = { ">": 0, ">=": 1, "<": 2, "<=": 3 };
const COMPARATOR_VERB: Record<Comparator, string> = {
  ">": "exceed",
  ">=": "be at or above",
  "<": "be below",
  "<=": "be at or below",
};

interface Proposal {
  threshold: number;
  comparator: Comparator;
  expiryDays: number;
  rationale: string;
}

interface ProposalSet {
  generatedAt: string;
  feedSymbol: string;
  proposals: Proposal[];
  source: "claude" | "heuristic";
}

export function ProposalsPanel() {
  const [data, setData] = useState<ProposalSet | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    fetch(WORKER_URL, { cache: "no-store" })
      .then((r) => r.json() as Promise<ProposalSet>)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return null;
  if (!data || data.proposals.length === 0) return null;

  const generatedAgo = humanAgo(new Date(data.generatedAt));

  return (
    <section className="mt-12 fade-up">
      <div className="flex items-baseline justify-between mb-5">
        <div className="flex items-baseline gap-3">
          <h2 className="caption">agent-proposed markets</h2>
          <span className="text-2xs text-accent">
            ● {data.source === "claude" ? "claude · live" : "heuristic"}
          </span>
        </div>
        <span className="text-2xs text-fg-dim">refreshed {generatedAgo}</span>
      </div>

      <p className="font-serif italic text-fg-mute text-[14.5px] leading-snug max-w-[68ch] mb-6">
        An autonomous agent scans the live attestation, the existing markets,
        and recent values, then proposes new markets every six hours. One click
        deploys them.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {data.proposals.map((p, i) => (
          <ProposalCard key={i} p={p} feedSymbol={data.feedSymbol} />
        ))}
      </div>
    </section>
  );
}

function ProposalCard({ p, feedSymbol }: { p: Proposal; feedSymbol: string }) {
  const cmpIdx = COMPARATOR_INDEX[p.comparator];
  const deployHref = `/markets/create/?threshold=${p.threshold}&comparator=${cmpIdx}&days=${p.expiryDays}`;

  return (
    <div className="border border-line bg-bg-elev/30 p-5 flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <span className="caption text-fg-dim">{feedSymbol}</span>
        <span className="text-2xs text-fg-dim">{p.expiryDays}d</span>
      </div>
      <div className="font-serif text-[17px] leading-snug mb-3 max-w-[28ch]">
        Will {COMPARATOR_VERB[p.comparator]}{" "}
        <span className="text-accent tnum">{p.threshold.toLocaleString("en-US").replace(/,/g, " ")}</span>
        ?
      </div>
      <p className="text-[12.5px] text-fg-mute leading-relaxed mb-4 flex-1">
        {p.rationale}
      </p>
      <Link
        href={deployHref}
        className="text-[12px] tracking-wide text-accent hover:underline decoration-fg-dim underline-offset-4"
      >
        deploy this market →
      </Link>
    </div>
  );
}

function humanAgo(d: Date): string {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
