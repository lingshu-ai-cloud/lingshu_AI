#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"
BACKUP_DIR_INPUT="${BACKUP_DIR:-}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env.production}"
[[ "$COMPOSE_ENV_FILE" == /* ]] || COMPOSE_ENV_FILE="$ROOT_DIR/$COMPOSE_ENV_FILE"

env_parent="$(dirname "$COMPOSE_ENV_FILE")"
[[ -d "$env_parent" ]] || { echo "Compose env parent does not exist: $env_parent" >&2; exit 1; }
COMPOSE_ENV_FILE="$(cd "$env_parent" && pwd -P)/$(basename "$COMPOSE_ENV_FILE")"
[[ -f "$COMPOSE_ENV_FILE" && -r "$COMPOSE_ENV_FILE" && ! -L "$COMPOSE_ENV_FILE" ]] \
  || { echo "Compose env file must be a readable regular non-symlink: $COMPOSE_ENV_FILE" >&2; exit 1; }

[[ "$BACKUP_DIR_INPUT" == /* ]] || {
  echo "BACKUP_DIR must be an explicit absolute path outside the repository." >&2
  exit 1
}
backup_parent_input="$(dirname "$BACKUP_DIR_INPUT")"
[[ -d "$backup_parent_input" ]] || { echo "BACKUP_DIR parent does not exist: $backup_parent_input" >&2; exit 1; }
backup_parent="$(cd "$backup_parent_input" && pwd -P)"
backup_leaf="$(basename "$BACKUP_DIR_INPUT")"
[[ -n "$backup_leaf" && "$backup_leaf" != "." && "$backup_leaf" != ".." && "$backup_leaf" != "/" ]] \
  || { echo "BACKUP_DIR must name a dedicated child directory." >&2; exit 1; }
BACKUP_DIR="$backup_parent/$backup_leaf"
case "$BACKUP_DIR/" in "$ROOT_DIR/"*) echo "BACKUP_DIR must be outside the repository." >&2; exit 1 ;; esac
[[ ! -L "$BACKUP_DIR" ]] || { echo "BACKUP_DIR must not be a symbolic link: $BACKUP_DIR" >&2; exit 1; }
[[ ! -e "$BACKUP_DIR" || -d "$BACKUP_DIR" ]] || { echo "BACKUP_DIR must be a directory: $BACKUP_DIR" >&2; exit 1; }

compose() {
  ENV_FILE_PATH="$COMPOSE_ENV_FILE" docker compose --env-file "$COMPOSE_ENV_FILE" "$@"
}

env_file_value() {
  local name="$1"
  awk -v key="$name" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2); count += 1 }
    END { if (count == 1) print value; else exit 1 }
  ' "$COMPOSE_ENV_FILE"
}

[[ -n "$AGE_RECIPIENT" ]] || { echo "AGE_RECIPIENT is required." >&2; exit 1; }
command -v age >/dev/null || { echo "age is required." >&2; exit 1; }
command -v shasum >/dev/null || { echo "shasum is required." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required for migration-history validation." >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required for a production volume backup." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "the Docker Compose plugin is required." >&2; exit 1; }

pb_volume="${PB_DATA_VOLUME_NAME:-$(env_file_value PB_DATA_VOLUME_NAME || true)}"
app_volume="${APP_DATA_VOLUME_NAME:-$(env_file_value APP_DATA_VOLUME_NAME || true)}"
for volume_name in "$pb_volume" "$app_volume"; do
  [[ "$volume_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] \
    || { echo "Confirmed production volume names are required in $COMPOSE_ENV_FILE or the process environment." >&2; exit 1; }
done
[[ "$pb_volume" != "$app_volume" ]] || { echo "PocketBase and application data must use different volumes." >&2; exit 1; }

pb_container="$(compose ps -q pocketbase)"
app_container="$(compose ps -q app)"
[[ -n "$pb_container" && "$pb_container" != *$'\n'* ]] \
  || { echo "Exactly one running PocketBase container is required; refusing local-directory fallback." >&2; exit 1; }
[[ -n "$app_container" && "$app_container" != *$'\n'* ]] \
  || { echo "Exactly one running application container is required; refusing local-directory fallback." >&2; exit 1; }
mounted_pb_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/pb/pb_data"}}{{.Name}}{{end}}{{end}}' "$pb_container")"
mounted_app_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$app_container")"
[[ "$mounted_pb_volume" == "$pb_volume" ]] \
  || { echo "PocketBase mounts $mounted_pb_volume, not confirmed production volume $pb_volume." >&2; exit 1; }
[[ "$mounted_app_volume" == "$app_volume" ]] \
  || { echo "Application mounts $mounted_app_volume, not confirmed production volume $app_volume." >&2; exit 1; }
[[ "$(docker volume inspect --format '{{.Name}}' "$pb_volume")" == "$pb_volume" ]] \
  || { echo "Confirmed PocketBase volume does not resolve to one exact Docker volume." >&2; exit 1; }
[[ "$(docker volume inspect --format '{{.Name}}' "$app_volume")" == "$app_volume" ]] \
  || { echo "Confirmed application volume does not resolve to one exact Docker volume." >&2; exit 1; }

pb_version_output="$(docker exec "$pb_container" /pb/pocketbase --version 2>/dev/null || true)"
[[ "$pb_version_output" =~ ([0-9]+\.[0-9]+\.[0-9]+) ]] \
  || { echo "Unable to determine the running PocketBase version." >&2; exit 1; }
pb_version="${BASH_REMATCH[1]}"
pb_image_id="$(docker inspect --format '{{.Image}}' "$pb_container")"
app_image_id="$(docker inspect --format '{{.Image}}' "$app_container")"
[[ "$pb_image_id" =~ ^sha256:[0-9a-f]{64}$ && "$app_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || { echo "Unable to resolve immutable image identities for the running services." >&2; exit 1; }

latest_migration_path="$(find "$ROOT_DIR/pb_migrations" -maxdepth 1 -type f -name '*.js' -print | LC_ALL=C sort | tail -n 1)"
[[ -n "$latest_migration_path" ]] || { echo "No PocketBase migration found." >&2; exit 1; }
latest_migration="$(basename "$latest_migration_path" .js)"
[[ "$latest_migration" =~ ^[0-9]+_[a-zA-Z0-9_-]+$ ]] || { echo "Invalid PocketBase migration name: $latest_migration" >&2; exit 1; }

mkdir -m 700 -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="lingshu-production-$timestamp"
output="$BACKUP_DIR/$base.tar.gz.age"
checksum="$BACKUP_DIR/$base.manifest.txt"
[[ ! -e "$output" && ! -e "$checksum" ]] || { echo "Backup artifact already exists for timestamp $timestamp." >&2; exit 1; }
staging="$(mktemp -d "${TMPDIR:-/tmp}/lingshu-backup.XXXXXX")"
publish_staging="$(mktemp -d "$BACKUP_DIR/.lingshu-backup-publish.XXXXXX")"
was_stopped=0
manifest_published=0

wait_ready() {
  local attempt
  for attempt in $(seq 1 30); do
    if compose exec -T app curl -fsS --max-time 3 http://127.0.0.1:8788/api/overseas/readyz >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Application did not become ready after backup restart." >&2
  return 1
}

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" != "0" && "$manifest_published" == "1" && ! -e "$output" ]]; then rm -f -- "$checksum"; fi
  rm -rf -- "$staging"
  rm -rf -- "$publish_staging"
  if [[ "$was_stopped" == "1" ]]; then
    compose start pocketbase >/dev/null || status=1
    compose start app >/dev/null || status=1
    wait_ready || status=1
  fi
  exit "$status"
}
trap cleanup EXIT

echo "Stopping app and PocketBase for a consistent snapshot..."
was_stopped=1
compose stop app >/dev/null
compose stop pocketbase >/dev/null
mkdir -p "$staging/pb_data" "$staging/data"
docker cp "$pb_container:/pb/pb_data/." "$staging/pb_data"
docker cp "$app_container:/app/data/." "$staging/data"

actual_migration="$(python3 - "$staging/pb_data/data.db" "$ROOT_DIR/pb_migrations" "$staging/PB-MIGRATIONS.txt" <<'PY'
import pathlib
import re
import sqlite3
import sys

database = pathlib.Path(sys.argv[1])
migrations_dir = pathlib.Path(sys.argv[2])
history_output = pathlib.Path(sys.argv[3])
if not database.is_file() or database.is_symlink():
    raise SystemExit("PocketBase data.db is missing or unsafe")
connection = sqlite3.connect(str(database))
connection.execute("PRAGMA query_only = ON")
if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
    raise SystemExit("PocketBase quick_check failed")
rows = connection.execute("SELECT file FROM _migrations ORDER BY applied, file").fetchall()
connection.close()
if not rows:
    raise SystemExit("PocketBase migration history is empty")
files = [str(row[0]) for row in rows]
for filename in files:
    if not re.fullmatch(r"[0-9]+_[A-Za-z0-9_-]+\.js", filename):
        raise SystemExit(f"unsafe migration history entry: {filename}")
    source = migrations_dir / filename
    if not source.is_file() or source.is_symlink():
        raise SystemExit(f"migration history is unknown to this checkout: {filename}")
history_output.write_text("".join(f"{name}\n" for name in files), encoding="utf-8")
print(pathlib.Path(files[-1]).stem)
PY
)"
[[ "$actual_migration" =~ ^[0-9]+_[A-Za-z0-9_-]+$ ]] \
  || { echo "Invalid applied PocketBase migration: $actual_migration" >&2; exit 1; }

python3 - "$staging/pb_data" "$staging/data" <<'PY'
import pathlib
import stat
import sys

for root_arg in sys.argv[1:]:
    root = pathlib.Path(root_arg)
    for path in root.rglob("*"):
        relative = path.relative_to(root.parent).as_posix()
        if "\n" in relative or "\r" in relative or "\\" in relative:
            raise SystemExit(f"unsupported character in backup path: {relative!r}")
        mode = path.lstat().st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise SystemExit(f"backup source contains a link or special file: {relative}")
PY

# The snapshot is now independent of the live volumes; minimize downtime by
# restoring service before hashing, compression, and encryption.
compose start pocketbase >/dev/null
compose start app >/dev/null
wait_ready
was_stopped=0

(
  cd "$staging"
  find pb_data data -type f -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 > BACKUP-CONTENTS.sha256
  {
    printf 'format=lingshu-production-backup-v3\n'
    printf 'created_at=%s\n' "$timestamp"
    printf 'pb_schema_migration=%s\n' "$actual_migration"
    printf 'repository_schema_migration=%s\n' "$latest_migration"
    printf 'pocketbase_version=%s\n' "$pb_version"
    printf 'git_revision=%s\n' "$(git rev-parse --verify HEAD)"
    printf 'pb_volume_name=%s\n' "$pb_volume"
    printf 'app_volume_name=%s\n' "$app_volume"
    printf 'pb_image_id=%s\n' "$pb_image_id"
    printf 'app_image_id=%s\n' "$app_image_id"
    printf 'file_count=%s\n' "$(wc -l < BACKUP-CONTENTS.sha256 | tr -d ' ')"
  } > BACKUP-METADATA.txt
  tar -czf "$base.tar.gz" BACKUP-METADATA.txt BACKUP-CONTENTS.sha256 PB-MIGRATIONS.txt pb_data data
)

staged_output="$publish_staging/$base.tar.gz.age"
staged_checksum="$publish_staging/$base.manifest.txt"
age -r "$AGE_RECIPIENT" -o "$staged_output" "$staging/$base.tar.gz"
(
  cd "$publish_staging"
  shasum -a 256 "$(basename "$staged_output")" > "$(basename "$staged_checksum")"
)
chmod 600 "$staged_output" "$staged_checksum"
# Publish the checksum first and the encrypted payload last. Observers never
# see an unverified final payload, and each rename is atomic on BACKUP_DIR.
mv "$staged_checksum" "$checksum"
manifest_published=1
mv "$staged_output" "$output"
printf 'Encrypted backup: %s\nChecksum manifest: %s\n' "$output" "$checksum"
