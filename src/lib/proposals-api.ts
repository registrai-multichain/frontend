/** The market proposals API on the builders site (Task 2); CORS allows app.registrai.cc.
 *  Overridable at build time for a local API (`wrangler pages dev`). */
export const PROPOSALS_API = process.env.NEXT_PUBLIC_PROPOSALS_API ?? "https://builder.registrai.cc/api/market-proposals";
