/** The market proposals API on the builders site (Task 2); CORS allows app.registrai.cc. */
export const DEFAULT_PROPOSALS_API = "https://builder.registrai.cc/api/market-proposals";

/** The API base: a build-time override (NEXT_PUBLIC_PROPOSALS_API, e.g. a local
 *  `wrangler pages dev`) or the production default; empty counts as unset. */
export function proposalsApiBase(override: string | undefined): string {
  return override?.trim() || DEFAULT_PROPOSALS_API;
}

export const PROPOSALS_API = proposalsApiBase(process.env.NEXT_PUBLIC_PROPOSALS_API);
