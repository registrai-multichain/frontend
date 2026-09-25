/**
 * What the PUBLIC registrai.cc serves while markets are not on Arc mainnet:
 * the landing and the USDC bridge. The builder registry lives on
 * builder.registrai.cc; every other app route runs on testnet and redirects
 * to the landing (the team uses the full app at testnet.registrai.cc, behind
 * Cloudflare Access). scripts/write-public-redirects.ts writes the Pages
 * `_redirects` from this at deploy time (registrai-web only, never the
 * testnet copy). Every src/app route must be listed in exactly one place
 * (public-site.test.ts), so a new testnet page cannot go public by accident.
 */

export const BUILDERS_SITE = "https://builder.registrai.cc";

/** App routes the public site keeps. */
export const PUBLIC_ROUTES = ["bridge"] as const;

/** App routes that move to the builders site (same path). */
export const BUILDERS_SITE_ROUTES = ["builders", "verify", "admin", "guide"] as const;

/** App routes that run on testnet: redirected to the landing on the public site. */
export const TESTNET_ROUTES = [
  "about",
  "agents",
  "atlas",
  "borrow",
  "devlog",
  "docs",
  "domains",
  "feed",
  "launch",
  "lending",
  "markets",
  "nanopay",
  "perennial",
  "pool",
  "pools",
  "profile",
  "rounds",
  "slash",
  "vault",
] as const;

/** Static folders under public/ that are testnet material (served by no app route). */
export const TESTNET_STATIC = ["data", "docs", "legacy", "methodology"] as const;

/** Pure: the Cloudflare Pages `_redirects` file for the public site. */
export function publicRedirects(): string {
  const lines = [
    "# Written by scripts/write-public-redirects.ts at deploy (src/lib/public-site.ts). Public registrai.cc only.",
  ];
  for (const r of BUILDERS_SITE_ROUTES) {
    lines.push(`/${r} ${BUILDERS_SITE}/${r}/ 302`, `/${r}/* ${BUILDERS_SITE}/${r}/:splat 302`);
  }
  for (const r of [...new Set([...TESTNET_ROUTES, ...TESTNET_STATIC, "seasons"])].sort()) {
    lines.push(`/${r} / 302`, `/${r}/* / 302`);
  }
  return `${lines.join("\n")}\n`;
}
