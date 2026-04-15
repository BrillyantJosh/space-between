#!/bin/bash
# Retroactively apply resource limits to every being's docker-compose.yml.
# Idempotent: only adds keys that are missing. Does NOT restart beings —
# deploy.sh's rollout step will recreate them with the new limits.
#
# Defaults (per plan): mem_limit 512m, memswap_limit 768m, cpus 0.5,
#                      NODE_OPTIONS=--max-old-space-size=384
set -euo pipefail
shopt -s nullglob

MEM_LIMIT="${MEM_LIMIT:-512m}"
MEMSWAP_LIMIT="${MEMSWAP_LIMIT:-768m}"
CPUS="${CPUS:-0.5}"
NODE_OPTS="${NODE_OPTS:---max-old-space-size=384}"

patched=0; skipped=0
for compose in /opt/beings/beings/*/docker-compose.yml; do
  [ -f "$compose" ] || continue
  name=$(basename "$(dirname "$compose")")
  if python3 - "$compose" "$MEM_LIMIT" "$MEMSWAP_LIMIT" "$CPUS" "$NODE_OPTS" <<'PY'
import sys, yaml, pathlib

path, mem, swap, cpus, node_opts = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5]
data = yaml.safe_load(pathlib.Path(path).read_text())
services = data.get('services') or {}
if not services:
    print("  no services", end=""); sys.exit(2)

changed = False
for svc_name, svc in services.items():
    if svc.get('mem_limit') != mem:
        svc['mem_limit'] = mem; changed = True
    if svc.get('memswap_limit') != swap:
        svc['memswap_limit'] = swap; changed = True
    if svc.get('cpus') != cpus:
        svc['cpus'] = cpus; changed = True
    env = svc.get('environment')
    want = f"NODE_OPTIONS={node_opts}"
    if isinstance(env, list):
        has = any(e.startswith('NODE_OPTIONS=') for e in env)
        if not has:
            env.append(want); changed = True
    elif isinstance(env, dict):
        if env.get('NODE_OPTIONS') != node_opts:
            env['NODE_OPTIONS'] = node_opts; changed = True
    else:
        svc['environment'] = [want]; changed = True

if changed:
    pathlib.Path(path).write_text(yaml.safe_dump(data, default_flow_style=False, sort_keys=False))
    sys.exit(0)
sys.exit(1)
PY
  then
    echo "  ✎ $name  (patched)"
    patched=$((patched+1))
  else
    rc=$?
    if [ "$rc" -eq 1 ]; then
      echo "  · $name  (already ok)"
    else
      echo "  ✗ $name  (skipped)"
    fi
    skipped=$((skipped+1))
  fi
done

echo "apply-limits: patched $patched, skipped $skipped"
