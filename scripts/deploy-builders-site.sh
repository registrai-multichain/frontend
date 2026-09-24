#!/usr/bin/env bash
# Deploy the packaged builders site (dist-builders/, from build-builders-site.sh)
# to the Pages project `registrai-builders`, FROM builders-site/: wrangler then
# picks up builders-site/functions (the admin API) and builders-site/wrangler.toml
# (project name, output dir, the INVITES KV binding, ADMIN_ADDRESSES, SITE_ORIGIN).
# The main site's deploy (`npm run deploy`, from frontend/) never sees them.
set -euo pipefail
cd "$(dirname "$0")/../builders-site"
if grep -q REPLACE_WITH_KV_ID wrangler.toml; then
  echo "builders-site/wrangler.toml: the INVITES KV namespace id is still the placeholder." >&2
  echo "  npx wrangler kv namespace create registrai-builders-invites   # then paste the id" >&2
  exit 1
fi
[ -f ../dist-builders/builders/index.html ] || { echo "no ../dist-builders: run scripts/build-builders-site.sh first" >&2; exit 1; }
if grep -Eq '^ADMIN_ADDRESSES = ""' wrangler.toml; then
  echo "note: ADMIN_ADDRESSES is empty in builders-site/wrangler.toml: nobody can sign in to /admin." >&2
fi
exec npx wrangler pages deploy --branch=main
