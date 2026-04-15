#!/bin/bash
# Restart all living beings against current space-between:latest image.
# The image itself is built by space-between/deploy.sh from your laptop —
# this script only recreates the beings so they pick up the new image.
set -euo pipefail
shopt -s nullglob

echo "🔄 Restarting beings against space-between:latest…"
count=0; ok_n=0; fail=0
for dir in /opt/beings/beings/*/; do
  [ -f "$dir/docker-compose.yml" ] || continue
  name=$(basename "$dir")
  count=$((count+1))
  if (cd "$dir" && docker compose up -d --force-recreate >/dev/null 2>&1); then
    ver=$(docker exec "$name" printenv BEING_VERSION 2>/dev/null || echo "?")
    echo "  ↻ $name → $ver"
    ok_n=$((ok_n+1))
  else
    echo "  ✗ $name (restart failed)"
    fail=$((fail+1))
  fi
done
echo "Done: $ok_n/$count ok, $fail failed"
docker ps --format "table {{.Names}}\t{{.Status}}"
