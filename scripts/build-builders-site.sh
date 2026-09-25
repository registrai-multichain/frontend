#!/usr/bin/env bash
# Package the standalone builders site (builder.registrai.cc): the /builders
# gallery, /verify, /admin and the badge art ONLY — no market page is served there.
# "/" goes to the gallery; every other app route bounces to registrai.cc.
# Run after `next build` (out/). Deployed to the Pages project
# `registrai-builders` (npm run deploy:builders, which deploys from
# builders-site/ so its Pages Functions — the admin API — ship with it);
# builder.registrai.cc is its custom domain.
set -euo pipefail
cd "$(dirname "$0")/.."
D=dist-builders
rm -rf "$D"; mkdir -p "$D"
for x in 404 404.html _headers _next _not-found apple-icon.png icon.png admin badge brand builders guide verify \
         mark.png mark-ring.svg mark-ring-512.png wordmark.png wordmark-dark.png; do
  [ -e "out/$x" ] && cp -R "out/$x" "$D/"
done
# The badge art (public/badge, rendered by scripts/render-badges.py) includes the
# generic pictures builders-site/functions/badge serves for a serial not
# rendered yet. Mainnet's imageBase is https://builder.registrai.cc/badge/arc/.
for n in arc arc-testnet; do
  [ -f "$D/badge/$n/badge-generic.jpg" ] && [ -f "$D/badge/$n/badge-generic-lapsed.jpg" ] || {
    echo "build-builders-site: no generic badge art in $D/badge/$n: run python3 scripts/render-badges.py (then next build) first" >&2
    exit 1
  }
done
# the gallery's social preview image
mkdir -p "$D/social" && cp out/social/registrai-landing-regi.png "$D/social/"
{
  echo "/            /builders/  302"
  echo "/index.html  /builders/  302"
  for d in $(cd out && ls -d */ | tr -d /); do
    case "$d" in _next|_not-found|admin|badge|brand|builders|guide|verify|social|404) ;;
      *) echo "/$d    https://registrai.cc/$d/    302"; echo "/$d/*  https://registrai.cc/$d/:splat  302" ;;
    esac
  done
} > "$D/_redirects"
printf "User-agent: *\nAllow: /\nDisallow: /api/\n" > "$D/robots.txt"
# Security headers for the standalone builders site (builder.registrai.cc).
# Written fresh here (not inherited from public/_headers) so the mainnet site
# ships an explicit, tight policy. The CSP is tuned to THIS app only:
#   - all scripts are self-hosted /_next chunks, but Next's static export also
#     emits inline hydration <script> blocks (self.__next_f…) that change every
#     build, so script-src needs 'unsafe-inline' (no stable hash/nonce is
#     possible with output:export); the app has no eval/WebAssembly.
#   - connect-src is tight: same-origin (/api/proof, /api/invites) plus the Arc
#     RPCs the read client uses and raw.githubusercontent.com (proof fallback).
#     The injected wallet (window.ethereum) does its own RPC, so it needs none.
#   - img-src allows GitHub owner avatars, plus data:/blob: for the share card.
#   - frame-ancestors/X-Frame-Options stop the app being framed (clickjacking a
#     wallet prompt).
# If the app gains a new external origin (a new RPC, an image host, an analytics
# endpoint), add it to the matching directive here or the browser will block it.
cat > "$D/_headers" <<'HEADERS'
/*
  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self' https://rpc.mainnet.arc.io https://rpc.testnet.arc.io https://raw.githubusercontent.com; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin-allow-popups

# No global Cross-Origin-Resource-Policy: Cloudflare _headers COMBINES a header
# set on both /* and a more specific path (it does not override), so a global
# "same-origin" would emit "same-origin, cross-origin" on the badges below and
# break their cross-origin embedding. Assets are embeddable by default anyway.

# Verified Builder Badge art. The token's on-chain image points here and wallets
# / explorers embed it cross-origin, so it must be readable from any origin.
/badge/*
  Cache-Control: public, max-age=3600
  Cross-Origin-Resource-Policy: cross-origin

# The gallery's social preview image is embedded by social scrapers.
/social/*
  Cross-Origin-Resource-Policy: cross-origin

# /admin: never indexed, never cached (the page itself is public static HTML;
# everything it shows comes from the session-gated /api/admin).
/admin/*
  X-Robots-Tag: noindex
  Cache-Control: no-store
HEADERS
echo "builders site: $(find "$D" -type f | wc -l | tr -d ' ') files in $D"
