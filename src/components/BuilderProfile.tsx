import type { ReactNode } from "react";
import directory from "@/lib/directory.json";

// The keeper's per-builder digest (directory.json) shape. Declared explicitly
// because empty arrays in the JSON widen to `never[]`, which would drop the
// element fields; this keeps them typed. All display-layer, nothing on-chain.
export type ProgressState = string;
type ProgressEntry = { entry: number; artifact: string; weight: number; state: ProgressState };
type ChallengeEntry = { kind: string; id: number | string; artifact: string; status: string };
type DigestEntry = {
  name: string;
  repo: string;
  address: string;
  chain: string;
  chainId?: number | null;
  builderId: number;
  bond?: number | null;
  milestoneMarketId?: string | null;
  latestRelease?: string | null;
  summary: string;
  progress?: ProgressEntry[];
  challenges?: ChallengeEntry[];
};

const fmtUsdc = (raw: number, dp = 2) =>
  (raw / 1e6).toFixed(dp).replace(/\.?0+$/, "");

// Visual cue for a progress/challenge state. finalized/resolved-valid read as
// "done" (up); proposed sits in the challenge window (muted); challenged/slashed
// are warnings (down).
function stateCue(state: ProgressState) {
  switch (state) {
    case "finalized":
    case "resolved-valid":
      return { cls: "text-up", label: `✓ ${state}` };
    case "challenged":
      return { cls: "text-down", label: "⚠ challenged" };
    case "slashed":
      return { cls: "text-down", label: "⚠ slashed" };
    case "proposed":
      return { cls: "text-fg-dim", label: "in challenge window" };
    default:
      return { cls: "text-fg-dim", label: state };
  }
}

const entries = directory as unknown as DigestEntry[];

export function findDigest(chainId: number, address: string): DigestEntry | undefined {
  return entries.find((d) =>
    d.chainId === chainId && d.address.toLowerCase() === address.toLowerCase());
}

// Rich per-builder profile rendered in place on the Perennial page. `milestone`
// is the on-chain odds bar, passed from the parent so this stays display-only.
export function BuilderProfile({
  digest,
  milestone,
}: {
  digest: DigestEntry;
  milestone?: ReactNode;
}) {
  const progress = digest.progress ?? [];
  const challenges = digest.challenges ?? [];
  const repoSlug = digest.repo.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");

  return (
    <div className="border border-line bg-bg-elev p-5 space-y-4">
      {/* header */}
      <div>
        <div className="caption text-[10px] text-fg-dim mb-1">builder profile</div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="font-serif text-[18px]">{digest.name}</h3>
          {digest.latestRelease && (
            <span className="text-2xs text-up">release {digest.latestRelease}</span>
          )}
        </div>
        <a
          href={`https://github.com/${repoSlug}`}
          target="_blank"
          rel="noreferrer"
          className="text-2xs text-accent hover:underline"
        >
          github.com/{repoSlug} ↗
        </a>
      </div>

      {/* challenge / dispute banner */}
      {challenges.length > 0 && (
        <div className="border border-down/30 bg-down/5 p-3 space-y-1">
          <div className="caption text-[10px] text-down">open disputes</div>
          {challenges.map((c) => (
            <div key={`${c.kind}-${c.id}`} className="text-2xs text-down flex flex-wrap gap-x-2">
              <span>⚠ {c.kind}</span>
              <span className="text-fg-dim">{c.artifact}</span>
              <span>· {c.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* progress timeline */}
      <div>
        <div className="caption text-[10px] text-fg-dim mb-2">progress timeline</div>
        {progress.length === 0 ? (
          <p className="text-2xs text-fg-dim">no progress yet</p>
        ) : (
          <div className="space-y-px">
            {progress.map((p) => {
              const cue = stateCue(p.state);
              return (
                <div
                  key={p.entry}
                  className="border border-line bg-bg p-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-[13px] truncate">{p.artifact}</span>
                    <span className="text-up tabular-nums text-2xs">+{p.weight}</span>
                  </div>
                  <span className={`text-2xs shrink-0 ${cue.cls}`}>{cue.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* keeper status */}
      <div className="border-t border-line pt-3">
        <div className="caption text-[10px] text-fg-dim mb-2">keeper status</div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-2xs">
          {digest.bond != null && (
            <span className="text-fg-dim">
              operator bond <span className="text-accent tabular-nums">${fmtUsdc(digest.bond)}</span>
            </span>
          )}
          <span className="text-fg-dim">builder #{digest.builderId} · {digest.chain}</span>
        </div>
        {digest.summary && <p className="text-2xs text-fg-dim leading-relaxed mt-2">{digest.summary}</p>}
      </div>

      {/* milestone market (on-chain odds passed in from parent) */}
      {digest.milestoneMarketId && milestone && (
        <div className="border-t border-line pt-3">
          <div className="caption text-[10px] text-fg-dim mb-1">milestone market</div>
          {milestone}
        </div>
      )}
    </div>
  );
}
