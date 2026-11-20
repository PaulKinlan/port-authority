#!/usr/bin/env bash
# Interim deploy: push every file in sites/ into the Worker's KV store.
#   UPLOAD_TOKEN=... scripts/upload.sh https://portauthority.<subdomain>.workers.dev
# Once the project is deployed with `wrangler deploy`, static assets replace this.
set -euo pipefail
base="$1"; cd "$(dirname "$0")/../sites"
find . -type f | sed 's|^\./||' | while read -r f; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --retry 3 -X PUT -H "authorization: Bearer $UPLOAD_TOKEN" --data-binary "@$f" "$base/_upload/$f")
  echo "$code $f"
done
