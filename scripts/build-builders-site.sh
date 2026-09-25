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
for x in 404 404.html _headers _next _not-found apple-icon.png icon.png admin badge brand builders verify \
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
    case "$d" in _next|_not-found|admin|badge|brand|builders|verify|social|404) ;;
      *) echo "/$d    https://registrai.cc/$d/    302"; echo "/$d/*  https://registrai.cc/$d/:splat  302" ;;
    esac
  done
} > "$D/_redirects"
printf "User-agent: *\nAllow: /\nDisallow: /api/\n" > "$D/robots.txt"
# /admin: never indexed, never cached (the page itself is public static HTML;
# everything it shows comes from the session-gated /api/admin).
printf "\n/admin/*\n  X-Robots-Tag: noindex\n  Cache-Control: no-store\n" >> "$D/_headers"
echo "builders site: $(find "$D" -type f | wc -l | tr -d ' ') files in $D"
