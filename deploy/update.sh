#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

ENV_FILE="$ROOT_DIR/.env.production"
[[ -f "$ENV_FILE" ]] || {
  echo ".env.production is missing. Run ./deploy/make-production-env.sh first." >&2
  exit 1
}

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

# Updates reuse the existing PocketBase volume and never create an empty one.
"$ROOT_DIR/deploy/ensure-pb-volume.sh" --require-existing "$ENV_FILE"

compose=(env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME
  "PB_DATA_VOLUME_NAME=$pb_data_volume_name" "APP_HOST_PORT=$app_host_port" "ENV_FILE_PATH=$ENV_FILE"
  docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml" --env-file "$ENV_FILE")

echo "==> Building changed layers (Docker cache is preserved)"
"${compose[@]}" build app worker pocketbase

echo "==> Pausing application traffic for migrations"
"${compose[@]}" stop caddy app worker

echo "==> Applying PocketBase migrations"
"${compose[@]}" up -d --force-recreate --wait --wait-timeout 180 pocketbase

echo "==> Bootstrapping the workbench administrator"
"${compose[@]}" run --rm --no-deps -T app node scripts/bootstrap-workbench-admin.mjs

echo "==> Updating application services"
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 worker app caddy

"${compose[@]}" exec -T app node scripts/check-runtime-readiness.mjs http://127.0.0.1:8788/api/overseas/ready
"${compose[@]}" ps
echo "Fast update completed and readiness passed."
