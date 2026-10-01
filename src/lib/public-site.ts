/**
 * What the PUBLIC registrai.cc serves: the landing and the USDC bridge. The
 * builder registry lives on builder.registrai.cc and the markets app (Markets,
 * Rounds, Propose, Builders, Atlas, How it works) on app.registrai.cc, built for mainnet;
 * every other app route runs on testnet and redirects to the landing (the team uses the full app at testnet.registrai.cc, behind
 * Cloudflare Access). scripts/write-public-redirects.ts writes the Pages
 * `_redirects` from this at deploy time (registrai-web only, never the
 * testnet copy). Every src/app route must be listed in exactly one place
 * (public-site.test.ts), so a new testnet page cannot go public by accident.
 */

export const BUILDERS_SITE = "https://builder.registrai.cc";
export const APP_SITE = "https://app.registrai.cc";
export const DASHBOARD_SITE = "https://dashboard.registrai.cc";
export const PUBLIC_SITE = "https://registrai.cc";

/** App routes the public site keeps. */
export const PUBLIC_ROUTES = ["bridge"] as const;

/** App routes that move to the builders site (same path). */
export const BUILDERS_SITE_ROUTES = ["builders", "verify", "admin", "guide", "suggest", "project"] as const;

/** App routes that move to the markets app, app.registrai.cc (same path; built for mainnet). */
export const APP_SITE_ROUTES = ["atlas", "perennial", "rounds", "propose"] as const;

/** App routes served by the transparency dashboard, dashboard.registrai.cc (at its root; built for mainnet). */
export const DASHBOARD_SITE_ROUTES = ["transparency"] as const;

/** Every dashboard route lands on the dashboard's root: it is a one-page site. */
const toDashboard = (lines: string[]) => {
  for (const r of DASHBOARD_SITE_ROUTES) lines.push(`/${r} ${DASHBOARD_SITE}/ 302`, `/${r}/* ${DASHBOARD_SITE}/ 302`);
};

/** App routes that run on testnet: redirected to the landing on the public site. */
export const TESTNET_ROUTES = [
  "about",
  "agents",
  "borrow",
  "devlog",
  "docs",
  "domains",
  "feed",
  "launch",
  "lending",
  "markets",
  "nanopay",
  "pool",
  "pools",
  "profile",
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
  for (const r of APP_SITE_ROUTES) {
    lines.push(`/${r} ${APP_SITE}/${r}/ 302`, `/${r}/* ${APP_SITE}/${r}/:splat 302`);
  }
  toDashboard(lines);
  for (const r of [...new Set([...TESTNET_ROUTES, ...TESTNET_STATIC, "seasons"])].sort()) {
    lines.push(`/${r} / 302`, `/${r}/* / 302`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Pure: the `_redirects` of app.registrai.cc (scripts/build-app-site.sh): its
 * root opens Markets; the bridge goes back to registrai.cc and the builder
 * pages to builder.registrai.cc. The app's own routes are served, not redirected.
 */
export function appSiteRedirects(): string {
  const lines = ["# Written by scripts/build-app-site.sh (src/lib/public-site.ts). app.registrai.cc only.", "/ /perennial/ 302", "/index.html /perennial/ 302"];
  for (const r of PUBLIC_ROUTES) lines.push(`/${r} ${PUBLIC_SITE}/${r}/ 302`, `/${r}/* ${PUBLIC_SITE}/${r}/:splat 302`);
  for (const r of BUILDERS_SITE_ROUTES) lines.push(`/${r} ${BUILDERS_SITE}/${r}/ 302`, `/${r}/* ${BUILDERS_SITE}/${r}/:splat 302`);
  toDashboard(lines);
  return `${lines.join("\n")}\n`;
}

/**
 * Pure: the `_redirects` of dashboard.registrai.cc (scripts/build-dashboard-site.sh).
 * Its root IS the transparency page, so /transparency folds into it; the shared
 * nav's other pages go to the app, the builders site and the bridge.
 */
export function dashboardSiteRedirects(): string {
  const lines = ["# Written by scripts/build-dashboard-site.sh (src/lib/public-site.ts). dashboard.registrai.cc only."];
  for (const r of DASHBOARD_SITE_ROUTES) lines.push(`/${r} / 301`, `/${r}/* / 301`);
  for (const r of APP_SITE_ROUTES) lines.push(`/${r} ${APP_SITE}/${r}/ 302`, `/${r}/* ${APP_SITE}/${r}/:splat 302`);
  for (const r of BUILDERS_SITE_ROUTES) lines.push(`/${r} ${BUILDERS_SITE}/${r}/ 302`, `/${r}/* ${BUILDERS_SITE}/${r}/:splat 302`);
  for (const r of PUBLIC_ROUTES) lines.push(`/${r} ${PUBLIC_SITE}/${r}/ 302`, `/${r}/* ${PUBLIC_SITE}/${r}/:splat 302`);
  return `${lines.join("\n")}\n`;
}
