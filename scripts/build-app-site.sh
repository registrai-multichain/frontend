#!/usr/bin/env bash
# Package app.registrai.cc, the retired markets app: redirects only, no pages.
# The bridge goes back to registrai.cc, builder pages keep their path on
# builder.registrai.cc, and every other path lands on builder.registrai.cc
# (src/lib/public-site.ts appSiteRedirects). Deployed to the Pages project
# `registrai-app`; app.registrai.cc is its custom domain.
set -euo pipefail
cd "$(dirname "$0")/.."
D=dist-app
rm -rf "$D"; mkdir -p "$D"
npx tsx -e 'import { appSiteRedirects } from "./src/lib/public-site"; process.stdout.write(appSiteRedirects())' > "$D/_redirects"
# Pages needs at least one asset; the catch-all redirect sends every visitor on before it is served.
printf '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=https://builder.registrai.cc/"><title>Registrai</title><a href="https://builder.registrai.cc/">builder.registrai.cc</a>\n' > "$D/index.html"
printf "User-agent: *\nDisallow: /\n" > "$D/robots.txt"
echo "packaged $D: $(find "$D" -type f | wc -l | tr -d ' ') files"
