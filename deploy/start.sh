#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"
ENV_FILE="$ROOT_DIR/.env.production"

volume_mode="--require-existing"
case "${1:-}" in
  "") ;;
  --fresh-install)
    [[ $# -eq 1 ]] || {
      echo "Usage: $0 [--fresh-install]" >&2
      exit 64
    }
    volume_mode="--create-if-missing"
    ;;
  *)
    echo "Usage: $0 [--fresh-install]" >&2
    echo "Normal starts require the existing owned PocketBase volume; use --fresh-install only for a new empty installation." >&2
    exit 64
    ;;
esac

if [ ! -f "$ENV_FILE" ]; then
  echo ".env.production is missing. Run ./deploy/make-production-env.sh first."
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

"$ROOT_DIR/deploy/ensure-pb-volume.sh" "$volume_mode" "$ENV_FILE"
# Pin topology-critical interpolation values to the validated file so ambient
# shell variables cannot select a different volume, env file or probe binding.
compose=(env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME
  "PB_DATA_VOLUME_NAME=$pb_data_volume_name" "APP_HOST_PORT=$app_host_port" "ENV_FILE_PATH=$ENV_FILE"
  docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml" --env-file "$ENV_FILE")

"${compose[@]}" build app worker pocketbase
"${compose[@]}" stop caddy app worker
"${compose[@]}" up -d --force-recreate --wait --wait-timeout 180 pocketbase
"${compose[@]}" run --rm --no-deps -T app node scripts/bootstrap-workbench-admin.mjs
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 worker app caddy
curl -fsS "http://127.0.0.1:${app_host_port}/api/overseas/ready" >/dev/null
"${compose[@]}" ps
echo "All containers are running and the application readiness gate passed."
