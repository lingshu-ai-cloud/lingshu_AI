#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

# One production backup implementation only. The canonical script snapshots
# PocketBase + application data together, encrypts before persistence and
# emits a checksum manifest. AGE_RECIPIENT is deliberately mandatory.
export BACKUP_SOURCE_MODE=production-docker
exec "$ROOT_DIR/scripts/backup-production-data.sh" "$@"
