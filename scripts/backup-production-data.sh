#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
APP_DATA_DIR="${APP_DATA_DIR:-$ROOT_DIR/data}"
PB_DATA_DIR="${PB_DATA_DIR:-$ROOT_DIR/pb_data}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env.production}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
BACKUP_SOURCE_MODE="${BACKUP_SOURCE_MODE:-production-docker}"

if [[ -z "$AGE_RECIPIENT" ]]; then
  echo "AGE_RECIPIENT is required (the approved backup age public key)." >&2
  exit 1
fi
command -v age >/dev/null || { echo "age is required." >&2; exit 1; }
command -v tar >/dev/null || { echo "tar is required." >&2; exit 1; }
[[ -d "$APP_DATA_DIR" ]] || { echo "Application data directory not found: $APP_DATA_DIR" >&2; exit 1; }
case "$BACKUP_SOURCE_MODE" in
  production-docker|local-filesystem) ;;
  *)
    echo "BACKUP_SOURCE_MODE must be production-docker or local-filesystem." >&2
    exit 64
    ;;
esac

cd "$ROOT_DIR"
compose=()
container=""
app_container=""
pb_data_volume_name=""

read_compose_env_value() {
  local key="$1"
  local count value
  count="$(grep -c "^${key}=" "$COMPOSE_ENV_FILE" || true)"
  value="$(sed -n "s/^${key}=//p" "$COMPOSE_ENV_FILE" | tr -d '\r')"
  [[ "$count" -eq 1 && -n "$value" && "$value" != *$'\n'* ]] || {
    echo "$key must appear exactly once and be non-empty in $COMPOSE_ENV_FILE" >&2
    exit 1
  }
  printf '%s' "$value"
}

verify_pocketbase_container_mount() {
  local mount_identity
  mount_identity="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/pb/pb_data"}}{{printf "%s|%s" .Type .Name}}{{end}}{{end}}' "$container")"
  [[ "$mount_identity" == "volume|$pb_data_volume_name" ]] || {
    echo "Refusing PocketBase container with an unexpected /pb/pb_data mount: $container" >&2
    echo "Expected named volume $pb_data_volume_name; got ${mount_identity:-<missing>}." >&2
    exit 1
  }
}

verify_application_container_mount() {
  local mount_identity
  mount_identity="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{printf "%s|%s" .Type .Source}}{{end}}{{end}}' "$app_container")"
  [[ "$mount_identity" == "bind|$ROOT_DIR/data" ]] || {
    echo "Refusing application container with an unexpected /app/data mount: $app_container" >&2
    echo "Expected bind source $ROOT_DIR/data; got ${mount_identity:-<missing>}." >&2
    exit 1
  }
}

resolve_single_compose_container() {
  local service="$1"
  local ids
  ids="$("${compose[@]}" ps -aq "$service")"
  if [[ -z "$ids" ]]; then
    if [[ "$service" == pocketbase ]]; then
      echo "PocketBase container not found; refusing to fall back to a local pb_data directory for a production backup." >&2
    else
      echo "Application container not found; refusing an unverified application-data snapshot." >&2
    fi
    return 1
  fi
  [[ "$ids" != *$'\n'* ]] || {
    echo "Expected exactly one $service container for the canonical production stack." >&2
    return 1
  }
  printf '%s' "$ids"
}

if [[ "$BACKUP_SOURCE_MODE" == production-docker ]]; then
  command -v docker >/dev/null 2>&1 || { echo "docker is required for a production backup." >&2; exit 1; }
  docker compose version >/dev/null 2>&1 || { echo "docker compose is required for a production backup." >&2; exit 1; }
  [[ "$COMPOSE_ENV_FILE" == "$ROOT_DIR/.env.production" ]] || {
    echo "Production backup only supports the canonical environment file: $ROOT_DIR/.env.production" >&2
    exit 1
  }
  [[ "$APP_DATA_DIR" == "$ROOT_DIR/data" && ! -L "$APP_DATA_DIR" ]] || {
    echo "Production backup only supports the canonical application data directory: $ROOT_DIR/data" >&2
    exit 1
  }
  [[ -r "$COMPOSE_ENV_FILE" ]] || { echo "Production environment file is not readable: $COMPOSE_ENV_FILE" >&2; exit 1; }
  pb_data_volume_name="$(read_compose_env_value PB_DATA_VOLUME_NAME)"
  app_host_port="$(read_compose_env_value APP_HOST_PORT)"
  [[ "$app_host_port" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$app_host_port <= 65535 )) || {
    echo "APP_HOST_PORT must be an integer between 1 and 65535" >&2
    exit 1
  }
  "$ROOT_DIR/deploy/ensure-pb-volume.sh" --require-existing "$COMPOSE_ENV_FILE"
  compose=(env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME
    "PB_DATA_VOLUME_NAME=$pb_data_volume_name" "APP_HOST_PORT=$app_host_port" "ENV_FILE_PATH=$COMPOSE_ENV_FILE"
    docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml" --env-file "$COMPOSE_ENV_FILE")
  container="$(resolve_single_compose_container pocketbase)"
  app_container="$(resolve_single_compose_container app)"
  verify_pocketbase_container_mount
  verify_application_container_mount
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
base_name="lingshu-production-$timestamp"
output="$BACKUP_DIR/$base_name.tar.gz.age"
manifest="$BACKUP_DIR/$base_name.manifest.txt"
[[ ! -e "$output" && ! -e "$manifest" ]] || { echo "Backup target already exists for timestamp $timestamp." >&2; exit 1; }

staging="$(mktemp -d "${TMPDIR:-/tmp}/lingshu-backup.XXXXXX")"
app_was_running=0
pb_was_running=0
compose_available=0
services_restored=0

restart_previous_services() {
  local failed=0
  if [[ "$compose_available" == "1" ]]; then
    if [[ "$pb_was_running" == "1" ]] && ! "${compose[@]}" start pocketbase >/dev/null; then
      echo "Failed to restart PocketBase after backup." >&2
      failed=1
    fi
    if [[ "$app_was_running" == "1" ]] && ! "${compose[@]}" start app >/dev/null; then
      echo "Failed to restart the application after backup." >&2
      failed=1
    fi
  fi
  return "$failed"
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$services_restored" != "1" ]] && ! restart_previous_services; then
    status=1
  fi
  rm -rf -- "$staging"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [[ "$BACKUP_SOURCE_MODE" == production-docker ]]; then
  compose_available=1
  [[ -n "$("${compose[@]}" ps -q pocketbase)" ]] && pb_was_running=1
  [[ -n "$("${compose[@]}" ps -q app)" ]] && app_was_running=1
  services=()
  [[ "$app_was_running" == "1" ]] && services+=(app)
  [[ "$pb_was_running" == "1" ]] && services+=(pocketbase)
  if (( ${#services[@]} > 0 )); then
    echo "Stopping active application services for a consistent snapshot..."
    "${compose[@]}" stop "${services[@]}" >/dev/null
  fi
  mkdir -p "$staging/pb_data"
  docker cp "$container:/pb/pb_data/." "$staging/pb_data"
else
  [[ -d "$PB_DATA_DIR" ]] || { echo "Local PocketBase data directory not found: $PB_DATA_DIR" >&2; exit 1; }
  cp -a "$PB_DATA_DIR" "$staging/pb_data"
fi
cp -a "$APP_DATA_DIR" "$staging/data"

archive="$staging/$base_name.tar.gz.age"
tar -C "$staging" -czf - pb_data data | age -r "$AGE_RECIPIENT" -o "$archive"
mv "$archive" "$output"
(
  cd "$BACKUP_DIR"
  shasum -a 256 "$(basename "$output")" > "$(basename "$manifest")"
)
chmod 600 "$output" "$manifest"

if ! restart_previous_services; then
  echo "The encrypted backup was created, but service recovery failed; backup command is failing closed." >&2
  exit 1
fi
services_restored=1
printf 'Encrypted backup: %s\nChecksum: %s\n' "$output" "$manifest"
