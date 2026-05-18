/**
 * Inline pill that marks a market or feed as verifiable — bound to an
 * onchain aggregation rule contract whose bytecode is the methodology.
 * Click-through goes to the rule contract on ArcScan so anyone can read
 * the source. Distinct from StatusBadge (which signals shipping state).
 */
import { addrUrl } from "@/lib/chain";

export function VerifiableBadge({
  rule,
  className = "",
}: {
  rule?: `0x${string}`;
  className?: string;
}) {
  if (rule) {
    return (
      <a
        href={addrUrl(rule)}
        target="_blank"
        rel="noreferrer"
        title={`Aggregation is computed onchain by rule contract ${rule} — anyone can re-execute it from the attestation inputs.`}
        className={`inline-flex items-center gap-1 caption text-[10px] text-up border border-up/40 px-1.5 py-0.5 hover:bg-up/10 transition-colors ${className}`}
      >
        <span>verifiable · onchain rule</span>
        <span className="text-up/70">↗</span>
      </a>
    );
  }
  return (
    <span
      title="Aggregation is computed onchain by a rule contract — anyone can re-execute it from the attestation inputs."
      className={`inline-flex items-center caption text-[10px] text-up border border-up/40 px-1.5 py-0.5 ${className}`}
    >
      verifiable · onchain rule
    </span>
  );
}
