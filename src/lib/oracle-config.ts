import { isAddress, type Address } from "viem";

/**
 * The independent dispute resolver the protocol's governor approves on the markets.
 * Common markets (MarketsV4) accept a feed only when its resolver is approved AND is
 * not the feed's own agent (`SelfResolvedFeed`), so a new agent's feed should name
 * this address. Set at build time; null until the owner picks it.
 */
export const APPROVED_DISPUTE_RESOLVER: Address | null = (() => {
  const v = process.env.NEXT_PUBLIC_DISPUTE_RESOLVER;
  return v && isAddress(v) ? (v as Address) : null;
})();

export type ResolverCheck = { ok: true; value: Address } | { ok: false; error: string };

/** A feed's resolver must be a real address and never the agent itself. */
export function validateResolver(raw: string, agent: string | undefined): ResolverCheck {
  const v = raw.trim();
  if (!v) return { ok: false, error: "Enter the feed's dispute resolver." };
  if (!isAddress(v)) return { ok: false, error: "That is not a valid address." };
  if (agent && v.toLowerCase() === agent.toLowerCase()) {
    return {
      ok: false,
      error: "Your own wallet can't be your feed's resolver — a feed that judges its own disputes is refused by the markets.",
    };
  }
  return { ok: true, value: v as Address };
}
