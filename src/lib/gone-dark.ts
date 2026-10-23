/**
 * Projects that went dark after being listed: the team deleted its X account,
 * took its site offline, or both, with no funds involved on chain. Public facts
 * only (what anyone can re-check), recorded by the investigation
 * (docs/superpowers/investigations/). The gallery keeps their cards, stamped, so
 * the record stays visible. "Rugged" is a different, stronger label kept for
 * on-chain proof (liquidity pulled, a dump) with the transaction hashes.
 */
export interface GoneDark {
  /** ISO date the investigation found it gone. */
  since: string;
  /** One line: what is gone. */
  reason: string;
  /** Links anyone can open to see it for themselves. */
  evidence: { label: string; url: string }[];
}

export const GONE_DARK: Readonly<Record<string, GoneDark>> = {
  "domain:cooka.fun": {
    since: "2026-09-27",
    reason: "X account deleted, site offline",
    evidence: [
      { label: "X", url: "https://x.com/cookafun" },
      { label: "site", url: "https://cooka.fun" },
    ],
  },
};

/** The gone-dark record of a source, or null. */
export function goneDarkOf(source: string | null | undefined): GoneDark | null {
  return source ? (GONE_DARK[source] ?? null) : null;
}

/** "27 Sep 2026" from an ISO date, without time-zone drift. */
export function goneDarkDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].at(m - 1);
  return `${d} ${month} ${y}`;
}
