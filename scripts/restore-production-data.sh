#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [[ $# -ne 1 ]]; then
  echo "Usage: AGE_IDENTITY=/secure/backup-key.txt $0 <backup.tar.gz.age>" >&2
  exit 1
fi

backup_file="$(cd "$(dirname "$1")" && pwd -P)/$(basename "$1")"
AGE_IDENTITY="${AGE_IDENTITY:-}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
RESTORE_DIR="${RESTORE_DIR:-$ROOT_DIR/restore/$(date -u +%Y%m%dT%H%M%SZ)}"
RESTORE_APPLY="${RESTORE_APPLY:-false}"
RESTORE_CONFIRM="${RESTORE_CONFIRM:-}"
APP_DATA_DIR="${APP_DATA_DIR:-$ROOT_DIR/data}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env.production}"
manifest="${BACKUP_MANIFEST:-${backup_file%.tar.gz.age}.manifest.txt}"

[[ -n "$AGE_IDENTITY" ]] || { echo "AGE_IDENTITY is required." >&2; exit 1; }
[[ -f "$AGE_IDENTITY" ]] || { echo "Age identity not found: $AGE_IDENTITY" >&2; exit 1; }
[[ -f "$backup_file" ]] || { echo "Backup not found: $backup_file" >&2; exit 1; }
[[ -f "$manifest" ]] || { echo "Checksum manifest not found: $manifest" >&2; exit 1; }
command -v age >/dev/null || { echo "age is required." >&2; exit 1; }
command -v tar >/dev/null || { echo "tar is required." >&2; exit 1; }

expected_checksum="$(awk 'NR == 1 { print $1 }' "$manifest")"
[[ "$expected_checksum" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Checksum manifest is invalid." >&2; exit 1; }
actual_checksum="$(shasum -a 256 "$backup_file" | awk '{ print $1 }')"
[[ "$actual_checksum" == "$expected_checksum" ]] || { echo "Backup checksum mismatch." >&2; exit 1; }

staging="$(mktemp -d "${TMPDIR:-/tmp}/lingshu-restore.XXXXXX")"
cleanup() { rm -rf -- "$staging"; }
trap cleanup EXIT INT TERM
archive="$staging/backup.tar.gz"
extracted="$staging/extracted"
mkdir -p "$extracted"
age -d -i "$AGE_IDENTITY" -o "$archive" "$backup_file"

# Member paths alone do not make a tar archive safe: links and special files can
# redirect later copies or create privileged filesystem objects. Accept only
# regular files and directories before extracting into the private staging root.
archive_listing="$(LC_ALL=C tar -tvzf "$archive")" || {
  echo "Backup archive metadata could not be read." >&2
  exit 1
}
while IFS= read -r member_metadata; do
  [[ -n "$member_metadata" ]] || continue
  member_type="${member_metadata:0:1}"
  case "$member_type" in
    -|d) ;;
    l) member_kind=symlink ;;
    h) member_kind=hardlink ;;
    b|c) member_kind=device ;;
    p) member_kind=FIFO ;;
    s) member_kind=socket ;;
    *) member_kind="unknown type $member_type" ;;
  esac
  if [[ "$member_type" != - && "$member_type" != d ]]; then
    echo "Backup contains an unsupported $member_kind member; only regular files and directories are allowed." >&2
    exit 1
  fi
done <<< "$archive_listing"

# Reject absolute paths, parent traversal and unexpected top-level content
# before allowing tar to write anything to disk.
while IFS= read -r member; do
  normalized="${member#./}"
  if [[ -z "$normalized" || "$normalized" == /* || "/$normalized/" == *"/../"* ]]; then
    echo "Backup contains an unsafe path: $member" >&2
    exit 1
  fi
  case "$normalized" in
    pb_data|pb_data/*|data|data/*) ;;
    *) echo "Backup contains an unexpected path: $member" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$archive")

tar -xzf "$archive" -C "$extracted"
chmod -R go-rwx "$extracted"
[[ -d "$extracted/pb_data" && -d "$extracted/data" ]] || { echo "Backup is missing pb_data or data." >&2; exit 1; }

if [[ "$RESTORE_APPLY" != "true" ]]; then
  [[ ! -e "$RESTORE_DIR" ]] || { echo "Restore destination already exists: $RESTORE_DIR" >&2; exit 1; }
  mkdir -p "$(dirname "$RESTORE_DIR")"
  cp -a "$extracted" "$RESTORE_DIR"
  chmod -R go-rwx "$RESTORE_DIR"
  printf 'Checksum and encrypted archive validated; restored into %s.\n' "$RESTORE_DIR"
  printf 'Live data was not changed. Applying requires RESTORE_APPLY=true and RESTORE_CONFIRM=replace-live-data.\n'
  exit 0
fi

[[ "$RESTORE_CONFIRM" == "replace-live-data" ]] || {
  echo "Refusing live replacement: set RESTORE_CONFIRM=replace-live-data after an isolated restore rehearsal." >&2
  exit 1
}
[[ "$APP_DATA_DIR" == "$ROOT_DIR/data" && ! -L "$APP_DATA_DIR" ]] || {
  echo "Live restore only supports the repository data directory: $ROOT_DIR/data" >&2
  exit 1
}
[[ -n "$AGE_RECIPIENT" ]] || {
  echo "AGE_RECIPIENT is also required for the encrypted pre-restore rollback backup." >&2
  exit 1
}
command -v docker >/dev/null || { echo "docker is required when RESTORE_APPLY=true." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose is required when RESTORE_APPLY=true." >&2; exit 1; }

cd "$ROOT_DIR"
[[ "$COMPOSE_ENV_FILE" == "$ROOT_DIR/.env.production" ]] || {
  echo "Live restore only supports the canonical environment file: $ROOT_DIR/.env.production" >&2
  exit 1
}
[[ -r "$COMPOSE_ENV_FILE" ]] || { echo "Production environment file is not readable: $COMPOSE_ENV_FILE" >&2; exit 1; }

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

pb_data_volume_name="$(read_compose_env_value PB_DATA_VOLUME_NAME)"
app_host_port="$(read_compose_env_value APP_HOST_PORT)"
[[ "$app_host_port" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$app_host_port <= 65535 )) || {
  echo "APP_HOST_PORT must be an integer between 1 and 65535" >&2
  exit 1
}

# Pin Compose interpolation to the values just read from the selected
# production env file. Ambient shell variables must not redirect the restore
# to a different volume, env file or host-side readiness port.
compose=(env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME
  "PB_DATA_VOLUME_NAME=$pb_data_volume_name" "APP_HOST_PORT=$app_host_port" "ENV_FILE_PATH=$COMPOSE_ENV_FILE"
  docker compose --project-directory "$ROOT_DIR" -f "$ROOT_DIR/docker-compose.yml" --env-file "$COMPOSE_ENV_FILE")

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
  [[ -n "$ids" && "$ids" != *$'\n'* ]] || {
    echo "Expected exactly one $service container for the canonical production stack." >&2
    exit 1
  }
  printf '%s' "$ids"
}

verify_owned_pocketbase_target() {
  "$ROOT_DIR/deploy/ensure-pb-volume.sh" --require-existing "$COMPOSE_ENV_FILE"
  container="$(resolve_single_compose_container pocketbase)"
  app_container="$(resolve_single_compose_container app)"
  verify_pocketbase_container_mount
  verify_application_container_mount
}

verify_owned_pocketbase_target

echo "Creating an encrypted, checksummed snapshot of current live data before replacement..."
PB_DATA_VOLUME_NAME="$pb_data_volume_name" APP_HOST_PORT="$app_host_port" ENV_FILE_PATH="$COMPOSE_ENV_FILE" \
  BACKUP_DIR="$ROOT_DIR/backups" APP_DATA_DIR="$APP_DATA_DIR" COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" \
  AGE_RECIPIENT="$AGE_RECIPIENT" BACKUP_SOURCE_MODE=production-docker \
  "$ROOT_DIR/scripts/backup-production-data.sh"

# The pre-restore backup stops and starts services. Resolve and verify the
# owned target again so no changed/recreated container can become the live
# restore destination between the snapshot and the destructive replacement.
verify_owned_pocketbase_target

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
app_was_running=0
pb_was_running=0
[[ -n "$("${compose[@]}" ps -q app)" ]] && app_was_running=1
[[ -n "$("${compose[@]}" ps -q pocketbase)" ]] && pb_was_running=1
if [[ "$app_was_running" != "1" || "$pb_was_running" != "1" ]]; then
  echo "Refusing live replacement while app or PocketBase is stopped; both must be running so restored readiness can be verified." >&2
  exit 1
fi

resolve_ready_url() {
  local configured="${RESTORE_READY_URL:-}"
  local port_mapping port mapped_url
  if ! port_mapping="$("${compose[@]}" port app 8788 | head -n 1)" \
    || [[ ! "$port_mapping" =~ ^127\.0\.0\.1:([1-9][0-9]{0,4})$ ]]; then
    echo "Could not resolve app:8788 to a single 127.0.0.1 host port; refusing an unverifiable live restore." >&2
    return 1
  fi
  port="${BASH_REMATCH[1]}"
  (( 10#$port <= 65535 )) || {
    echo "Resolved application readiness port is invalid: $port" >&2
    return 1
  }
  mapped_url="http://127.0.0.1:$port/api/overseas/ready"
  if [[ -n "$configured" && "$configured" != "$mapped_url" ]]; then
    echo "RESTORE_READY_URL must exactly match the running app:8788 loopback mapping: $mapped_url" >&2
    return 1
  fi
  printf '%s' "$mapped_url"
}
resolved_ready_url="$(resolve_ready_url)"

rollback="$staging/rollback"
mkdir -p "$rollback/pb_data"
had_app_data=0

restore_services() {
  local failed=0
  if [[ "$pb_was_running" == "1" ]] && ! "${compose[@]}" start pocketbase >/dev/null; then
    echo "Failed to restart PocketBase after restore." >&2
    failed=1
  fi
  if [[ "$app_was_running" == "1" ]] && ! "${compose[@]}" start app >/dev/null; then
    echo "Failed to restart the application after restore." >&2
    failed=1
  fi
  return "$failed"
}

wait_for_app_readiness() {
  [[ "$app_was_running" == "1" ]] || return 0
  command -v curl >/dev/null || { echo "curl is required to verify restored application readiness." >&2; return 1; }
  local ready_url="$resolved_ready_url"
  for _attempt in $(seq 1 30); do
    if curl -fsS "$ready_url" >/dev/null; then return 0; fi
    sleep 2
  done
  echo "Restored application did not pass readiness at $ready_url." >&2
  return 1
}

clear_pb_volume() {
  docker run --rm --volumes-from "$container" alpine:3.22 \
    sh -eu -c 'find /pb/pb_data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
}

mutation_started=0
apply_complete=0
rollback_ready=0
live_previous="$ROOT_DIR/.pre-restore-live-data-$timestamp"
replacement="$ROOT_DIR/.restore-data-$timestamp"

finalize_apply() {
  local status="$1"
  local recovery_failed=0
  trap - EXIT INT TERM
  set +e
  if [[ "$mutation_started" == "1" && "$apply_complete" != "1" && "$rollback_ready" == "1" ]]; then
    echo "Restore failed after replacement began; restoring the pre-change snapshot..." >&2
    "${compose[@]}" stop app pocketbase >/dev/null 2>&1 || recovery_failed=1
    clear_pb_volume || recovery_failed=1
    docker cp "$rollback/pb_data/." "$container:/pb/pb_data" || recovery_failed=1
    if [[ -e "$APP_DATA_DIR" ]]; then mv "$APP_DATA_DIR" "$staging/failed-app-data"; fi
    if [[ -e "$live_previous" ]]; then
      mv "$live_previous" "$APP_DATA_DIR" || recovery_failed=1
    elif [[ "$had_app_data" == "1" ]]; then
      cp -a "$rollback/data" "$APP_DATA_DIR" || recovery_failed=1
    fi
  fi
  restore_services || recovery_failed=1
  if [[ "$mutation_started" == "1" && "$apply_complete" != "1" && "$rollback_ready" == "1" ]]; then
    wait_for_app_readiness || recovery_failed=1
  fi
  rm -rf -- "$staging"
  if [[ "$recovery_failed" == "1" ]]; then
    echo "Automatic service/data recovery could not be fully verified; keep the encrypted pre-restore backup and escalate immediately." >&2
    status=1
  fi
  exit "$status"
}
trap 'finalize_apply $?' EXIT
trap 'exit 130' INT TERM

services=()
[[ "$app_was_running" == "1" ]] && services+=(app)
[[ "$pb_was_running" == "1" ]] && services+=(pocketbase)
if (( ${#services[@]} > 0 )); then "${compose[@]}" stop "${services[@]}" >/dev/null; fi

docker cp "$container:/pb/pb_data/." "$rollback/pb_data"
if [[ -d "$APP_DATA_DIR" ]]; then
  had_app_data=1
  cp -a "$APP_DATA_DIR" "$rollback/data"
else
  mkdir -p "$rollback/data"
fi
rollback_ready=1

mutation_started=1
clear_pb_volume
docker cp "$extracted/pb_data/." "$container:/pb/pb_data"

[[ ! -e "$replacement" ]] || { echo "Temporary replacement exists: $replacement" >&2; exit 1; }
cp -a "$extracted/data" "$replacement"
if [[ -e "$APP_DATA_DIR" ]]; then
  [[ ! -e "$live_previous" ]] || { echo "Temporary live-data snapshot exists: $live_previous" >&2; exit 1; }
  mv "$APP_DATA_DIR" "$live_previous"
  mv "$replacement" "$APP_DATA_DIR"
else
  mv "$replacement" "$APP_DATA_DIR"
fi

restore_services
wait_for_app_readiness
app_was_running=0
pb_was_running=0
apply_complete=1
if [[ -e "$live_previous" ]]; then rm -rf -- "$live_previous"; fi
printf 'Live data restored from the verified encrypted backup. The encrypted pre-restore backup is retained under %s.\n' "$ROOT_DIR/backups"
