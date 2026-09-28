#!/usr/bin/env bash
# Package the markets app (app.registrai.cc): Markets, Rounds, Propose, Builders, Atlas and
# How it works ONLY, built for Arc MAINNET (npm run deploy:app runs next build with
# NEXT_PUBLIC_PERENNIAL_NETWORK=mainnet first). Its root opens Markets; the bridge
# goes back to registrai.cc and the builder pages to builder.registrai.cc
# (src/lib/public-site.ts appSiteRedirects); /transparency lives on dashboard.registrai.cc. Deployed to the Pages project
# `registrai-app`; app.registrai.cc is its custom domain.
set -euo pipefail
cd "$(dirname "$0")/.."
D=dist-app
rm -rf "$D"; mkdir -p "$D"
for x in 404 404.html _next _not-found perennial rounds atlas propose apple-icon.png icon.png brand social \
         mark.png mark-ring.svg mark-ring-512.png wordmark.png wordmark-dark.png; do
  [ -e "out/$x" ] && cp -R "out/$x" "$D/"
done
npx tsx -e 'import { appSiteRedirects } from "./src/lib/public-site"; process.stdout.write(appSiteRedirects())' > "$D/_redirects"
printf "User-agent: *\nAllow: /\n" > "$D/robots.txt"
# Security headers for app.registrai.cc, tuned to THIS app (see build-builders-site.sh
# for why script-src needs 'unsafe-inline' with a static export):
#   - connect-src: the Arc RPCs the read client uses, Coinbase (reference prices and
#     the live candle stream on /rounds), builder.registrai.cc (the market proposals
#     API: /propose submits to it and /propose/status reads it).
#   - img-src: GitHub owner avatars and site icons (builder.registrai.cc/api/icon) on the Builders page.
# A new external origin (RPC, image host, price feed) must be added here or the
# browser blocks it.
cat > "$D/_headers" <<'HEADERS'
/*
  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com https://builder.registrai.cc; font-src 'self'; connect-src 'self' https://rpc.mainnet.arc.io https://rpc.testnet.arc.io https://api.exchange.coinbase.com wss://ws-feed.exchange.coinbase.com https://builder.registrai.cc; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups

/social/*
  Cross-Origin-Resource-Policy: cross-origin
HEADERS
echo "packaged $D: $(find "$D" -type f | wc -l | tr -d ' ') files"
