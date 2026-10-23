#!/usr/bin/env bash
# Package the transparency dashboard (dashboard.registrai.cc): the /transparency page
# ONLY, served at the site's root, built for Arc MAINNET (npm run deploy:dashboard
# runs next build with NEXT_PUBLIC_PERENNIAL_NETWORK=mainnet first). /transparency
# folds into the root; the shared nav's other pages go to app.registrai.cc, the
# builders site and the bridge (src/lib/public-site.ts dashboardSiteRedirects).
# Deployed to the Pages project `registrai-dashboard`; dashboard.registrai.cc is
# its custom domain.
set -euo pipefail
cd "$(dirname "$0")/.."
D=dist-dashboard
rm -rf "$D"; mkdir -p "$D"
for x in 404 404.html _next _not-found apple-icon.png icon.png \
         mark.png mark-ring.svg mark-ring-512.png wordmark.png wordmark-dark.png; do
  [ -e "out/$x" ] && cp -R "out/$x" "$D/"
done
cp out/transparency/index.html "$D/index.html"
npx tsx -e 'import { dashboardSiteRedirects } from "./src/lib/public-site"; process.stdout.write(dashboardSiteRedirects())' > "$D/_redirects"
printf "User-agent: *\nAllow: /\n" > "$D/robots.txt"
# Security headers for dashboard.registrai.cc (see build-builders-site.sh for why
# script-src needs 'unsafe-inline' with a static export):
#   - connect-src: the Arc mainnet RPC the page reads from, and DexScreener (the
#     REGI price). A new external origin must be added here or the browser blocks it.
cat > "$D/_headers" <<'HEADERS'
/*
  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://rpc.mainnet.arc.io https://api.dexscreener.com; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups
HEADERS
echo "packaged $D: $(find "$D" -type f | wc -l | tr -d ' ') files"
