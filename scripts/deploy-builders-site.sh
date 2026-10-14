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
if grep -q REPLACE_WITH_DATA_D1_ID wrangler.toml; then
  echo "builders-site/wrangler.toml: the DATA_DB D1 database id is still the placeholder." >&2
  echo "  (from builders-site/) npx wrangler d1 create registrai-data   # then paste the database_id" >&2
  echo "  npx wrangler d1 migrations apply registrai-data --remote" >&2
  exit 1
fi
if grep -q REPLACE_WITH_D1_ID wrangler.toml; then
  echo "builders-site/wrangler.toml: the PILOT_DB D1 database id is still the placeholder." >&2
  echo "  (from builders-site/) npx wrangler d1 create registrai-pilot   # then paste the database_id" >&2
  echo "  npx wrangler d1 migrations apply registrai-pilot --remote" >&2
  exit 1
fi
[ -f ../dist-builders/builders/index.html ] || { echo "no ../dist-builders: run scripts/build-builders-site.sh first" >&2; exit 1; }
# Release safety (audit OPS-8): deploy only a clean, committed tree, and only a dist-builders packaged from the
# current out/ after the last commit (run from a stale checkout, this refuses instead of shipping an old site).
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "deploy-builders-site: refusing: the working tree has uncommitted changes to tracked files (commit or discard them):" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"; }
[ -f ../out/builders/index.html ] || { echo "deploy-builders-site: refusing: no ../out: run npm run build and scripts/build-builders-site.sh first" >&2; exit 1; }
if [ "$(mtime ../dist-builders/builders/index.html)" -lt "$(mtime ../out/builders/index.html)" ]; then
  echo "deploy-builders-site: refusing: dist-builders is older than out/: run bash scripts/build-builders-site.sh first" >&2
  exit 1
fi
if [ "$(mtime ../dist-builders/builders/index.html)" -lt "$(git log -1 --format=%ct HEAD)" ]; then
  echo "deploy-builders-site: refusing: dist-builders is older than the last commit: run npm run build, then bash scripts/build-builders-site.sh" >&2
  exit 1
fi
echo "deploying commit $(git rev-parse HEAD) ($(git log -1 --format='%h %s' HEAD)) from $(git rev-parse --show-toplevel)"
if grep -Eq '^ADMIN_ADDRESSES = ""' wrangler.toml; then
  echo "note: ADMIN_ADDRESSES is empty in builders-site/wrangler.toml: nobody can sign in to /admin." >&2
fi
echo "reminder: /admin sign-in needs the Pages secret NONCE_SECRET on registrai-builders (see builders-site/wrangler.toml)." >&2
echo "reminder: the ABI points pilot sign-in needs the Pages secret PILOT_SESSION_SECRET (see builders-site/wrangler.toml); PILOT_OPEN=\"1\" opens orders (PILOT_REGI_SNAPSHOT_BLOCK is optional); run builders-site/scripts/d1-guard-check.mjs first." >&2
exec npx wrangler pages deploy --branch=main
