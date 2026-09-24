#!/usr/bin/env bash
# Package the standalone builders site (builder.registrai.cc): the /builders
# gallery, /verify and the badge art ONLY — no market page is served there.
# "/" goes to the gallery; every other app route bounces to registrai.cc.
# Run after `next build` (out/). Deployed to the Pages project
# `registrai-builders` (npm run deploy:builders); builder.registrai.cc is its
# custom domain.
set -euo pipefail
cd "$(dirname "$0")/.."
D=dist-builders
rm -rf "$D"; mkdir -p "$D"
for x in 404 404.html _headers _next _not-found apple-icon.png icon.png badge brand builders verify \
         mark.png mark-ring.svg mark-ring-512.png wordmark.png wordmark-dark.png; do
  [ -e "out/$x" ] && cp -R "out/$x" "$D/"
done
# the gallery's social preview image
mkdir -p "$D/social" && cp out/social/registrai-landing-regi.png "$D/social/"
{
  echo "/            /builders/  302"
  echo "/index.html  /builders/  302"
  for d in $(cd out && ls -d */ | tr -d /); do
    case "$d" in _next|_not-found|badge|brand|builders|verify|social|404) ;;
      *) echo "/$d    https://registrai.cc/$d/    302"; echo "/$d/*  https://registrai.cc/$d/:splat  302" ;;
    esac
  done
} > "$D/_redirects"
printf "User-agent: *\nAllow: /\n" > "$D/robots.txt"
echo "builders site: $(find "$D" -type f | wc -l | tr -d ' ') files in $D"
