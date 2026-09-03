#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $# -ne 1 || ! "$1" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <exact-40-character-git-commit>" >&2
  echo "Branch names, tags, short SHAs, and an unpinned git pull are not accepted." >&2
  exit 2
fi

target_revision="$1"
resolved_revision="$(git rev-parse --verify "${target_revision}^{commit}" 2>/dev/null || true)"
[[ "$resolved_revision" == "$target_revision" ]] || {
  echo "The exact target commit is not present in this checkout: $target_revision" >&2
  exit 1
}

cat >&2 <<EOF
deploy/update.sh is intentionally fail-closed and made no production changes.

Target revision validated: ${target_revision}

Use docs/production-readiness-runbook.md in an explicitly authorized change window:
  1. AGE_RECIPIENT='age1...' BACKUP_DIR=/secure/lingshu-backups bash deploy/backup.sh
  2. Check out the exact commit above without modifying .env.production or either external volume.
  3. Run every quality, schema, PocketBase smoke, image-build, and restore-drill gate.
  4. Review the migration and rollback plan, then obtain explicit deployment authorization.

This legacy entry point never pulls code, switches revisions, builds images, runs migrations,
syncs demo accounts, restarts services, or deploys.
EOF
exit 1
