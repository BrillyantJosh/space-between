#!/bin/bash
# One-glance inventory of living beings on this host: status + memory.
set -euo pipefail
shopt -s nullglob

printf "◈ BEINGS\n─────────────────────────────────────────────────────────────\n"
printf "  %-20s %-10s %-22s %s\n" "NAME" "STATUS" "MEMORY" "DOMAIN"

for dir in /opt/beings/beings/*/; do
  name=$(basename "$dir")
  [ -f "$dir/.env" ] || continue
  domain=$(grep -E '^VIRTUAL_HOST=' "$dir/.env" | cut -d'=' -f2- | tr -d '\r')
  status=$(docker inspect --format='{{.State.Status}}' "$name" 2>/dev/null || echo "stopped")
  if [ "$status" = "running" ]; then
    mem=$(docker stats "$name" --no-stream --format '{{.MemUsage}}' 2>/dev/null || echo "-")
  else
    mem="-"
  fi
  printf "  %-20s %-10s %-22s %s\n" "$name" "$status" "$mem" "$domain"
done
