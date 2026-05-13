type Kind = "beta" | "soon" | "live";

interface Props {
  kind: Kind;
  label?: string;
  className?: string;
}

/**
 * Small honest-status chip. Used liberally across the UI so visitors know
 * what's working today vs what's signposted for later.
 *
 *   beta  → working, may have rough edges (default label "BETA")
 *   live  → confirmed working with onchain state (default label "LIVE")
 *   soon  → described but not built yet (default label "SOON")
 */
export function StatusBadge({ kind, label, className }: Props) {
  const text =
    label ?? (kind === "beta" ? "BETA" : kind === "live" ? "LIVE" : "SOON");

  const styles: Record<Kind, string> = {
    beta: "border-accent/50 text-accent",
    live: "border-up/50 text-up",
    soon: "border-line text-fg-dim border-dashed",
  };

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 border ${styles[kind]} text-[9px] tracking-[0.2em] uppercase tnum ${className ?? ""}`}
    >
      {text}
    </span>
  );
}
