import type { Verification } from "@/lib/builder-verification";

/**
 * The Verified mark, linking to the builder's published proof file. Inside a
 * button (list rows) pass `link={false}`: a link cannot nest in a button, so
 * the row's detail view carries the link instead.
 */
export function VerifiedBadge({
  verification,
  link = true,
  className = "",
}: {
  verification: Verification | null | undefined;
  link?: boolean;
  className?: string;
}) {
  if (!verification) return null;
  const title = `Verified builder: signed proof for ${verification.source}`;
  if (!link) {
    return <span className={`vbadge ${className}`} title={title}>✓ verified</span>;
  }
  return (
    <a className={`vbadge ${className}`} href={verification.proofUrl} target="_blank" rel="noreferrer" title={title}>
      ✓ verified
    </a>
  );
}

/** The line every milestone market carries. */
export function MilestoneDisclosure({ metric, className = "" }: { metric: string; className?: string }) {
  return (
    <span className={`milestone-disclosure ${className}`}>
      <b>Builder-triggered milestone.</b> This market counts the builder&apos;s own {metric}. The builder decides
      when to ship, so they can move the outcome.
    </span>
  );
}
