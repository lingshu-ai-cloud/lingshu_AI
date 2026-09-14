#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

[[ -f .env.production ]] || { echo ".env.production is missing." >&2; exit 1; }
ENV_FILE="$ROOT_DIR/.env.production"
[[ -n "${AGE_RECIPIENT:-}" ]] || {
  echo "AGE_RECIPIENT is required so the pre-update snapshot is encrypted." >&2
  exit 1
}
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "Refusing to update a dirty production checkout; preserve or remove local changes explicitly first." >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local count value
  count="$(grep -c "^${key}=" "$ENV_FILE" || true)"
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tr -d '\r')"
  [[ "$count" -eq 1 && -n "$value" && "$value" != *$'\n'* ]] || {
    echo "$key must appear exactly once and be non-empty in $ENV_FILE" >&2
    exit 1
  }
  printf '%s' "$value"
}

app_host_port="$(read_env_value APP_HOST_PORT)"
[[ "$app_host_port" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$app_host_port <= 65535 )) || {
  echo "APP_HOST_PORT must be an integer between 1 and 65535" >&2
  exit 1
}
pb_data_volume_name="$(read_env_value PB_DATA_VOLUME_NAME)"
"$ROOT_DIR/deploy/ensure-pb-volume.sh" --require-existing "$ENV_FILE"
compose=(env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME
  "PB_DATA_VOLUME_NAME=$pb_data_volume_name" "APP_HOST_PORT=$app_host_port" "ENV_FILE_PATH=$ENV_FILE"
  docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml" --env-file "$ENV_FILE")

echo "==> Creating encrypted, checksummed pre-update backup"
PB_DATA_VOLUME_NAME="$pb_data_volume_name" APP_HOST_PORT="$app_host_port" ENV_FILE_PATH="$ENV_FILE" \
  COMPOSE_ENV_FILE="$ENV_FILE" BACKUP_SOURCE_MODE=production-docker \
  "$ROOT_DIR/scripts/backup-production-data.sh"

echo "==> Pulling a fast-forward-only update"
git pull --ff-only

echo "==> Building the application and PocketBase images"
"${compose[@]}" build app pocketbase

echo "==> Stopping traffic before database migration"
"${compose[@]}" stop caddy app

echo "==> Starting PocketBase; versioned migrations must complete before account bootstrap"
"${compose[@]}" up -d --force-recreate --wait --wait-timeout 180 pocketbase

echo "==> Idempotently bootstrapping the workbench administrator (record writes only)"
"${compose[@]}" run --rm --no-deps -T app node scripts/bootstrap-workbench-admin.mjs

echo "==> Restarting application services"
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 app caddy

echo "==> Waiting for dependency-aware readiness"
for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${app_host_port}/api/overseas/ready" >/dev/null; then
    "${compose[@]}" ps
    echo "Update completed and readiness passed."
    exit 0
  fi
  sleep 2
done

"${compose[@]}" logs --tail=120 app pocketbase >&2 || true
echo "Update finished building, but readiness did not pass. Services were left running for diagnosis; use the encrypted backup for rollback." >&2
exit 1
