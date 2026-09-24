#!/usr/bin/env bash
# Deploy the packaged builders site (dist-builders/, from build-builders-site.sh)
# to the Pages project `registrai-builders`, FROM builders-site/: wrangler then
# picks up builders-site/functions (the admin API) and builders-site/wrangler.toml
# (project name, output dir, the INVITES KV binding, ADMIN_ADDRESSES, SITE_ORIGIN).
# The main site's deploy (`npm run deploy`, from frontend/) never sees them.
#
# One SECRET must exist on the Pages project (it is not in wrangler.toml and
# survives deploys): NONCE_SECRET, the HMAC key of the /admin sign-in nonces.
# Without it /admin sign-in answers 500 (fail closed). Set it once:
#   openssl rand -base64 48 | npx wrangler pages secret put NONCE_SECRET --project-name=registrai-builders
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
echo "reminder: /admin sign-in needs the Pages secret NONCE_SECRET on registrai-builders (see builders-site/wrangler.toml)." >&2
exec npx wrangler pages deploy --branch=main
