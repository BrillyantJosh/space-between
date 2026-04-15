#!/usr/bin/env bash
#
# space-between deploy — unified pipeline.
#
# Builds the current commit on each target server (so arch matches)
# and stamps the image with a BEING_VERSION env var so running beings
# can announce which code they're from.
#
# Targets:
#   1. LIVING  — root@being2.enlightenedai.org:/opt/apps/space-between/
#                The 2+ month old living being. Container: "space-between".
#                Compose file: docker-compose.prod.yml (build: .).
#                Persisted volumes: data/, knowledge/ (backed up before each deploy).
#
#   2. INCUBATOR BASE — root@178.104.205.253:/opt/beings/space-between/
#                The source tree from which `space-between:latest` docker image
#                is built. Newborn beings (spawned by incubator) inherit this
#                image. Writes /opt/beings/incubator/current-space-between.txt
#                so the incubator API can announce the base version.
#
# Usage:
#   bash deploy.sh                # full deploy, both servers
#   bash deploy.sh --skip-living  # only update incubator base image
#   bash deploy.sh --skip-incubator   # only update living being
#   bash deploy.sh --dry-run      # show what would happen, no changes
#   bash deploy.sh --force        # allow dirty working tree
#
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────
LIVING_HOST="root@being2.enlightenedai.org"
LIVING_DIR="/opt/apps/space-between"
LIVING_HEALTH="https://being2.enlightenedai.org/"
LIVING_CONTAINER="space-between"

INCUB_HOST="root@178.104.205.253"
INCUB_DIR="/opt/beings/space-between"
INCUB_STAMP="/opt/beings/incubator/current-space-between.txt"

BACKUP_DIR="/opt/space-between-backups"
BACKUP_KEEP=5

# ─── Flags ────────────────────────────────────────────────────
SKIP_LIVING=false
SKIP_INCUBATOR=false
DRY_RUN=false
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --skip-living)     SKIP_LIVING=true ;;
    --skip-incubator)  SKIP_INCUBATOR=true ;;
    --dry-run)         DRY_RUN=true ;;
    --force)           FORCE=true ;;
    -h|--help)
      sed -n '1,30p' "$0" | tail -n +2 | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────
say()   { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m⚠\033[0m %s\n' "$*" >&2; }
die()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
run()   { $DRY_RUN && { echo "    [dry] $*"; return 0; } || "$@"; }

# ─── Preflight ────────────────────────────────────────────────
cd "$(dirname "$0")"

# Clean working tree (unless --force)
if [[ "$FORCE" != "true" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "Working tree is dirty. Commit first or pass --force."
  fi
fi

SHA=$(git rev-parse --short HEAD)
DATE=$(date -u +%Y%m%d)
VERSION="${SHA}-${DATE}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

say "Deploying space-between"
echo "    version: $VERSION"
echo "    branch:  $BRANCH"
echo "    living:  $([ "$SKIP_LIVING" = "true" ] && echo 'skip' || echo "$LIVING_HOST")"
echo "    incub:   $([ "$SKIP_INCUBATOR" = "true" ] && echo 'skip' || echo "$INCUB_HOST")"
$DRY_RUN && echo "    mode:    DRY RUN"

# Syntax check before shipping anywhere
say "Syntax-checking src/*.js locally"
for f in src/*.js; do node --check "$f" || die "syntax error in $f"; done
ok "all src/*.js parse clean"

# Files to ship (exclude data/, knowledge/, node_modules, .git)
RSYNC_FLAGS=(-az --delete
  --exclude=node_modules --exclude=.git --exclude=data --exclude=knowledge
  --exclude='.env' --exclude='.DS_Store' --exclude='*.log'
  --exclude='src/config.js'
)

# ─── LIVING BEING ─────────────────────────────────────────────
if [[ "$SKIP_LIVING" != "true" ]]; then
  say "→ Living being ($LIVING_HOST)"

  # 1. Backup data/ + knowledge/ (rolling, keep last N)
  run ssh "$LIVING_HOST" "mkdir -p $BACKUP_DIR && \
    cd $LIVING_DIR && \
    tar czf $BACKUP_DIR/data-$(date +%s)-${SHA}.tgz data/ knowledge/ 2>/dev/null || true && \
    ls -1t $BACKUP_DIR/data-*.tgz 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | xargs -r rm -f"

  # 2. Rsync source
  run rsync "${RSYNC_FLAGS[@]}" ./ "$LIVING_HOST:$LIVING_DIR/"

  # 3. Rebuild + restart with BEING_VERSION baked in
  run ssh "$LIVING_HOST" "cd $LIVING_DIR && \
    docker compose -f docker-compose.prod.yml build --build-arg BEING_VERSION=$VERSION && \
    docker compose -f docker-compose.prod.yml up -d"

  # 4. Health check with exponential backoff
  if ! $DRY_RUN; then
    say "  waiting for health…"
    delay=2
    for attempt in 1 2 3 4 5; do
      if curl -sf -m 5 "$LIVING_HEALTH" >/dev/null 2>&1; then
        ok "  living being responded healthy (attempt $attempt)"
        break
      fi
      [[ $attempt == 5 ]] && die "living being failed health check — aborting (incubator NOT updated)"
      sleep $delay
      delay=$((delay * 2))
    done

    # 5. Confirm BEING_VERSION inside container
    actual=$(ssh "$LIVING_HOST" "docker exec $LIVING_CONTAINER printenv BEING_VERSION 2>/dev/null" || echo "")
    if [[ "$actual" == "$VERSION" ]]; then
      ok "  container reports BEING_VERSION=$actual"
    else
      warn "  container BEING_VERSION=$actual (expected $VERSION)"
    fi
  fi
fi

# ─── INCUBATOR BASE IMAGE ─────────────────────────────────────
if [[ "$SKIP_INCUBATOR" != "true" ]]; then
  say "→ Incubator base image ($INCUB_HOST)"

  # 1. Rsync source
  run rsync "${RSYNC_FLAGS[@]}" --exclude='docs' ./ "$INCUB_HOST:$INCUB_DIR/"

  # 2. Build space-between:latest with version arg
  run ssh "$INCUB_HOST" "cd $INCUB_DIR && \
    docker build --build-arg BEING_VERSION=$VERSION -t space-between:latest ."

  # 3. Write version stamp file for incubator API to read
  run ssh "$INCUB_HOST" "cat > $INCUB_STAMP <<EOF
version=$VERSION
sha=$SHA
date=$DATE
branch=$BRANCH
deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF"

  if ! $DRY_RUN; then
    actual=$(ssh "$INCUB_HOST" "cat $INCUB_STAMP 2>/dev/null | grep ^version= | cut -d= -f2" || echo "")
    if [[ "$actual" == "$VERSION" ]]; then
      ok "  incubator stamped $INCUB_STAMP → version=$actual"
    else
      warn "  incubator stamp mismatch: got '$actual'"
    fi
  fi

  # 4. Sync maintenance scripts (update-all, list, apply-limits) into
  #    /opt/beings/incubator/ so the ops toolbox on 178 stays in lock-step
  #    with the repo.
  say "  syncing ops scripts"
  run rsync -az \
    scripts/update-all.sh scripts/list.sh scripts/apply-limits.sh scripts/birth.sh \
    "$INCUB_HOST:/opt/beings/incubator/"
  run ssh "$INCUB_HOST" "chmod +x /opt/beings/incubator/{update-all,list,apply-limits,birth}.sh"

  # 5. Apply resource limits idempotently to every existing being's compose
  run ssh "$INCUB_HOST" "bash /opt/beings/incubator/apply-limits.sh"

  # 6. Roll every living being forward to the new image
  if ! $DRY_RUN; then
    say "  rolling living beings forward"
    if ssh "$INCUB_HOST" "bash /opt/beings/incubator/update-all.sh"; then
      ok "  rollout complete"
    else
      warn "  some beings failed to restart — run list.sh on $INCUB_HOST"
    fi
  fi
fi

# ─── Summary ──────────────────────────────────────────────────
echo
ok "Deploy complete: $VERSION"
$DRY_RUN && warn "(dry run — nothing actually changed)"
[[ "$SKIP_LIVING"    != "true" ]] && echo "   living:  $LIVING_HEALTH"
[[ "$SKIP_INCUBATOR" != "true" ]] && echo "   newborn beings will now be built from: $VERSION"
