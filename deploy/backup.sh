#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env.production}"
[[ "$COMPOSE_ENV_FILE" == /* ]] || COMPOSE_ENV_FILE="$ROOT_DIR/$COMPOSE_ENV_FILE"
env_parent="$(dirname "$COMPOSE_ENV_FILE")"
[[ -d "$env_parent" ]] || { echo "Compose env parent does not exist: $env_parent" >&2; exit 1; }
COMPOSE_ENV_FILE="$(cd "$env_parent" && pwd -P)/$(basename "$COMPOSE_ENV_FILE")"
[[ -f "$COMPOSE_ENV_FILE" && -r "$COMPOSE_ENV_FILE" && ! -L "$COMPOSE_ENV_FILE" ]] \
  || { echo "Compose env file must be a readable regular non-symlink: $COMPOSE_ENV_FILE" >&2; exit 1; }
[[ -n "${AGE_RECIPIENT:-}" ]] || {
  echo "AGE_RECIPIENT is required; plaintext legacy backups are disabled." >&2
  echo "Usage: AGE_RECIPIENT='age1...' BACKUP_DIR=/secure/lingshu-backups bash deploy/backup.sh" >&2
  exit 1
}

export COMPOSE_ENV_FILE
exec "$ROOT_DIR/scripts/backup-production-data.sh"
