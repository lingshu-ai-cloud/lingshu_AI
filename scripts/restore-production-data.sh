#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

if [[ $# -ne 1 ]]; then
  echo "Usage: AGE_IDENTITY=/secure/backup-key.txt $0 <backup.tar.gz.age>" >&2
  exit 1
fi

backup_input="$1"
backup_parent_input="$(dirname "$backup_input")"
[[ -d "$backup_parent_input" ]] || { echo "Backup parent does not exist: $backup_parent_input" >&2; exit 1; }
backup="$(cd "$backup_parent_input" && pwd -P)/$(basename "$backup_input")"
AGE_IDENTITY="${AGE_IDENTITY:-}"
RESTORE_DIR_INPUT="${RESTORE_DIR:-$(dirname "$ROOT_DIR")/lingshu-restore}"
RESTORE_APPLY="${RESTORE_APPLY:-false}"
checksum="${BACKUP_CHECKSUM_FILE:-${backup%.tar.gz.age}.manifest.txt}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env.production}"
[[ "$COMPOSE_ENV_FILE" == /* ]] || COMPOSE_ENV_FILE="$ROOT_DIR/$COMPOSE_ENV_FILE"
RESTORE_HELPER_IMAGE="alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce"
[[ "$RESTORE_APPLY" == "false" || "$RESTORE_APPLY" == "true" ]] \
  || { echo "RESTORE_APPLY must be exactly true or false." >&2; exit 1; }

compose() {
  ENV_FILE_PATH="$COMPOSE_ENV_FILE" docker compose --env-file "$COMPOSE_ENV_FILE" "$@"
}

[[ -n "$AGE_IDENTITY" && -f "$AGE_IDENTITY" && -r "$AGE_IDENTITY" ]] || { echo "A readable AGE_IDENTITY is required." >&2; exit 1; }
[[ -f "$backup" && -r "$backup" && ! -L "$backup" ]] || { echo "Backup must be a readable regular non-symlink: $backup" >&2; exit 1; }
checksum_parent_input="$(dirname "$checksum")"
[[ -d "$checksum_parent_input" ]] || { echo "Checksum parent does not exist: $checksum_parent_input" >&2; exit 1; }
checksum="$(cd "$checksum_parent_input" && pwd -P)/$(basename "$checksum")"
[[ -f "$checksum" && -r "$checksum" && ! -L "$checksum" ]] || { echo "Checksum manifest must be a readable regular non-symlink: $checksum" >&2; exit 1; }
command -v age >/dev/null || { echo "age is required." >&2; exit 1; }
command -v shasum >/dev/null || { echo "shasum is required." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required for archive and schema validation." >&2; exit 1; }

[[ "$RESTORE_DIR_INPUT" == /* ]] || {
  echo "RESTORE_DIR must be an absolute path outside the repository." >&2
  exit 1
}
restore_parent_input="$(dirname "$RESTORE_DIR_INPUT")"
[[ -d "$restore_parent_input" ]] || {
  echo "RESTORE_DIR parent does not exist: $restore_parent_input" >&2
  exit 1
}
restore_parent="$(cd "$restore_parent_input" && pwd -P)"
restore_leaf="$(basename "$RESTORE_DIR_INPUT")"
[[ -n "$restore_leaf" && "$restore_leaf" != "." && "$restore_leaf" != ".." && "$restore_leaf" != "/" ]] \
  || { echo "RESTORE_DIR must name a dedicated child directory." >&2; exit 1; }
RESTORE_DIR="$restore_parent/$restore_leaf"
case "$RESTORE_DIR/" in
  "$ROOT_DIR/"*)
    echo "RESTORE_DIR must be outside the repository: $ROOT_DIR" >&2
    exit 1
    ;;
esac
[[ ! -L "$RESTORE_DIR" ]] || { echo "RESTORE_DIR must not be a symbolic link: $RESTORE_DIR" >&2; exit 1; }
[[ ! -e "$RESTORE_DIR" ]] || { echo "RESTORE_DIR must not already exist: $RESTORE_DIR" >&2; exit 1; }

checksum_line="$(awk 'NF { line=$0; count += 1 } END { if (count == 1) print line; else exit 1 }' "$checksum" || true)"
[[ "$checksum_line" =~ ^([0-9a-fA-F]{64})[[:space:]][[:space:]]([^/]+)$ ]] \
  || { echo "Checksum manifest must contain exactly one safe artifact entry." >&2; exit 1; }
expected_checksum="$(printf '%s' "${BASH_REMATCH[1]}" | tr 'A-F' 'a-f')"
manifest_artifact="${BASH_REMATCH[2]}"
[[ "$manifest_artifact" == "$(basename "$backup")" ]] \
  || { echo "Checksum manifest does not identify the selected backup." >&2; exit 1; }
actual_checksum="$(shasum -a 256 "$backup" | awk '{print $1}')"
[[ "$actual_checksum" == "$expected_checksum" ]] || { echo "Encrypted backup checksum mismatch." >&2; exit 1; }

staging="$(mktemp -d "${TMPDIR:-/tmp}/lingshu-restore.XXXXXX")"
restore_publish_staging=""
rollback=""
services_stopped=0
data_replacement_started=0
rollback_evidence_preserved=0
cleanup() {
  local status=$?
  local rollback_ok=1
  trap - EXIT
  set +e
  if [[ "$status" != "0" && "$data_replacement_started" == "1" && -n "$rollback" && -d "$rollback/pb_data" && -d "$rollback/data" ]]; then
    echo "Restore failed after data replacement started; applying rollback snapshot." >&2
    compose stop app >/dev/null 2>&1 || true
    compose stop pocketbase >/dev/null 2>&1 || true
    [[ "$(docker inspect --format '{{.State.Running}}' "$app_container" 2>/dev/null)" == "false" ]] || rollback_ok=0
    [[ "$(docker inspect --format '{{.State.Running}}' "$pb_container" 2>/dev/null)" == "false" ]] || rollback_ok=0
    if [[ "$rollback_ok" == "1" ]]; then
      if wipe_pb_volume; then install_pb_data "$rollback" || rollback_ok=0; else rollback_ok=0; fi
      if wipe_app_volume; then install_app_data "$rollback" || rollback_ok=0; else rollback_ok=0; fi
    fi
    if [[ "$rollback_ok" == "1" ]]; then
      compose start pocketbase >/dev/null 2>&1 || rollback_ok=0
      compose start app >/dev/null 2>&1 || rollback_ok=0
      if [[ "$rollback_ok" == "1" ]]; then wait_ready || rollback_ok=0; fi
    fi
    if [[ "$rollback_ok" != "1" ]]; then
      # A partial rollback must stay fail-closed. Best-effort stop both services
      # and retain the snapshot so an operator can finish recovery manually.
      compose stop app >/dev/null 2>&1 || true
      compose stop pocketbase >/dev/null 2>&1 || true
      services_stopped=1
      rollback_evidence_preserved=1
      chmod -R go-rwx "$rollback"
      {
        printf 'restore_status=%s\n' "$status"
        printf 'rollback_failed_at=%s\n' "$(date -u +%Y%m%dT%H%M%SZ)"
        printf 'pb_container=%s\n' "$pb_container"
        printf 'app_container=%s\n' "$app_container"
        printf 'pb_volume=%s\n' "$pb_volume"
        printf 'app_volume=%s\n' "$app_volume"
      } > "$rollback/RESTORE-FAILURE.txt"
      chmod 600 "$rollback/RESTORE-FAILURE.txt"
      echo "AUTOMATIC ROLLBACK FAILED. Plaintext rollback evidence is retained at: $rollback" >&2
      echo "Restrict access, copy it to an approved incident location, and do not retry blindly." >&2
    else
      services_stopped=0
      echo "Automatic rollback completed and readiness passed." >&2
    fi
  elif [[ "$status" != "0" && "$services_stopped" == "1" ]]; then
    compose start pocketbase >/dev/null 2>&1
    compose start app >/dev/null 2>&1
    services_stopped=0
    wait_ready || echo "Services restarted after restore failure but readiness is failing." >&2
  fi
  rm -rf -- "$staging"
  if [[ -n "$restore_publish_staging" && -d "$restore_publish_staging" ]]; then rm -rf -- "$restore_publish_staging"; fi
  if [[ -n "$rollback" && "$rollback_evidence_preserved" != "1" ]]; then rm -rf -- "$rollback"; fi
  exit "$status"
}
trap cleanup EXIT

decrypted="$staging/backup.tar.gz"
extracted="$staging/extracted"
mkdir -p "$extracted"
age -d -i "$AGE_IDENTITY" -o "$decrypted" "$backup"

python3 - "$decrypted" <<'PY'
import pathlib
import tarfile
import sys

seen = set()
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for member in archive.getmembers():
        name = member.name
        path = pathlib.PurePosixPath(name)
        if (not name or "\n" in name or "\r" in name or "\\" in name or name.startswith("/")
                or ".." in path.parts or name in seen):
            raise SystemExit(f"unsafe or duplicate archive member: {name!r}")
        seen.add(name)
        if not (member.isfile() or member.isdir()):
            raise SystemExit(f"archive link or special file is forbidden: {name}")
        top = path.parts[0] if path.parts else ""
        if top not in {"BACKUP-METADATA.txt", "BACKUP-CONTENTS.sha256", "PB-MIGRATIONS.txt", "pb_data", "data"}:
            raise SystemExit(f"unexpected archive member: {name}")
PY

tar -xzf "$decrypted" -C "$extracted" --no-same-owner
[[ -d "$extracted/pb_data" && -d "$extracted/data" ]] || { echo "Backup is missing pb_data or data." >&2; exit 1; }
[[ -f "$extracted/BACKUP-CONTENTS.sha256" && -f "$extracted/BACKUP-METADATA.txt" ]] || { echo "Backup v2 integrity metadata is missing." >&2; exit 1; }

metadata_value() {
  local name="$1"
  awk -v key="$name" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2); count += 1 }
    END { if (count == 1) print value; else exit 1 }
  ' "$extracted/BACKUP-METADATA.txt"
}

backup_format="$(metadata_value format || true)"
legacy_v2=0
case "$backup_format" in
  lingshu-production-backup-v3) ;;
  lingshu-production-backup-v2) legacy_v2=1 ;;
  *) echo "Unsupported backup format: $backup_format" >&2; exit 1 ;;
esac
created_at="$(metadata_value created_at || true)"
backup_migration="$(metadata_value pb_schema_migration || true)"
[[ "$created_at" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "Backup has an invalid created_at." >&2; exit 1; }
[[ "$backup_migration" =~ ^[0-9]+_[A-Za-z0-9_-]+$ ]] || { echo "Backup has an invalid schema migration." >&2; exit 1; }
backup_migration_file="$ROOT_DIR/pb_migrations/$backup_migration.js"
[[ -f "$backup_migration_file" && ! -L "$backup_migration_file" ]] \
  || { echo "Backup schema is unknown to this checkout: $backup_migration" >&2; exit 1; }

backup_pb_version=""
if [[ "$legacy_v2" == "0" ]]; then
  [[ -f "$extracted/PB-MIGRATIONS.txt" && ! -L "$extracted/PB-MIGRATIONS.txt" ]] \
    || { echo "Backup v3 migration history is missing." >&2; exit 1; }
  backup_pb_version="$(metadata_value pocketbase_version || true)"
  repository_migration="$(metadata_value repository_schema_migration || true)"
  backup_git_revision="$(metadata_value git_revision || true)"
  source_pb_volume="$(metadata_value pb_volume_name || true)"
  source_app_volume="$(metadata_value app_volume_name || true)"
  source_pb_image="$(metadata_value pb_image_id || true)"
  source_app_image="$(metadata_value app_image_id || true)"
  [[ "$backup_pb_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Backup has an invalid PocketBase version." >&2; exit 1; }
  [[ "$repository_migration" =~ ^[0-9]+_[A-Za-z0-9_-]+$ && -f "$ROOT_DIR/pb_migrations/$repository_migration.js" ]] \
    || { echo "Backup repository schema is unknown to this checkout." >&2; exit 1; }
  [[ "$backup_git_revision" =~ ^[0-9a-f]{40}$ ]] || { echo "Backup has an invalid git revision." >&2; exit 1; }
  for volume_name in "$source_pb_volume" "$source_app_volume"; do
    [[ "$volume_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] || { echo "Backup has an invalid source volume identity." >&2; exit 1; }
  done
  [[ "$source_pb_volume" != "$source_app_volume" ]] || { echo "Backup source volumes must be distinct." >&2; exit 1; }
  [[ "$source_pb_image" =~ ^sha256:[0-9a-f]{64}$ && "$source_app_image" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || { echo "Backup has invalid source image identities." >&2; exit 1; }

  history_last=""
  history_seen="$staging/history-seen.txt"
  : > "$history_seen"
  while IFS= read -r migration_file; do
    [[ "$migration_file" =~ ^[0-9]+_[A-Za-z0-9_-]+\.js$ ]] || { echo "Unsafe migration history entry." >&2; exit 1; }
    ! grep -Fqx -- "$migration_file" "$history_seen" || { echo "Duplicate migration history entry: $migration_file" >&2; exit 1; }
    printf '%s\n' "$migration_file" >> "$history_seen"
    [[ -f "$ROOT_DIR/pb_migrations/$migration_file" && ! -L "$ROOT_DIR/pb_migrations/$migration_file" ]] \
      || { echo "Backup requires an unavailable migration: $migration_file" >&2; exit 1; }
    history_last="${migration_file%.js}"
  done < "$extracted/PB-MIGRATIONS.txt"
  [[ "$history_last" == "$backup_migration" ]] || { echo "Backup migration history does not match metadata." >&2; exit 1; }
fi
manifest_paths="$staging/manifest-paths.txt"
: > "$manifest_paths"
while IFS= read -r checksum_line; do
  [[ "$checksum_line" =~ ^[0-9a-fA-F]{64}[[:space:]][[:space:]](.+)$ ]] || { echo "Invalid content checksum entry." >&2; exit 1; }
  content_path="${BASH_REMATCH[1]}"
  case "$content_path" in
    pb_data/*|data/*) ;;
    *) echo "Unsafe content checksum path: $content_path" >&2; exit 1 ;;
  esac
  [[ "$content_path" != *\\* ]] || { echo "Backslashes are forbidden in content checksum paths." >&2; exit 1; }
  case "$content_path" in *'/../'*|../*|*/..|..) echo "Unsafe content checksum path: $content_path" >&2; exit 1 ;; esac
  [[ -f "$extracted/$content_path" ]] || { echo "Checksum references a missing regular file: $content_path" >&2; exit 1; }
  printf '%s\n' "$content_path" >> "$manifest_paths"
done < "$extracted/BACKUP-CONTENTS.sha256"

metadata_count="$(sed -n 's/^file_count=//p' "$extracted/BACKUP-METADATA.txt")"
[[ "$metadata_count" =~ ^[0-9]+$ ]] || { echo "Backup metadata has an invalid file_count." >&2; exit 1; }
manifest_count="$(wc -l < "$manifest_paths" | tr -d ' ')"
[[ "$manifest_count" == "$metadata_count" ]] || { echo "Backup manifest count does not match metadata." >&2; exit 1; }
actual_count=0
while IFS= read -r -d '' actual_path; do
  [[ "$actual_path" != *$'\n'* && "$actual_path" != *$'\r'* ]] || { echo "Backup contains an unsupported newline in a filename." >&2; exit 1; }
  grep -Fqx -- "$actual_path" "$manifest_paths" || { echo "Backup contains an unmanifested file: $actual_path" >&2; exit 1; }
  actual_count=$((actual_count + 1))
done < <(cd "$extracted" && find pb_data data -type f -print0)
[[ "$actual_count" == "$manifest_count" ]] || { echo "Backup manifest contains duplicate or missing paths." >&2; exit 1; }
(
  cd "$extracted"
  shasum -a 256 -c BACKUP-CONTENTS.sha256
)

database_migration="$(python3 - "$extracted/pb_data/data.db" "${legacy_v2}" "$extracted/PB-MIGRATIONS.txt" <<'PY'
import pathlib
import re
import sqlite3
import sys

database = pathlib.Path(sys.argv[1])
legacy = sys.argv[2] == "1"
history_path = pathlib.Path(sys.argv[3])
if not database.is_file() or database.is_symlink():
    raise SystemExit("Restored PocketBase data.db is missing or unsafe")
connection = sqlite3.connect(str(database))
connection.execute("PRAGMA query_only = ON")
if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
    raise SystemExit("Restored PocketBase quick_check failed")
files = [str(row[0]) for row in connection.execute("SELECT file FROM _migrations ORDER BY applied, file")]
connection.close()
if not files or any(not re.fullmatch(r"[0-9]+_[A-Za-z0-9_-]+\.js", item) for item in files):
    raise SystemExit("Restored PocketBase migration history is invalid")
if not legacy:
    declared = history_path.read_text(encoding="utf-8").splitlines()
    if files != declared:
        raise SystemExit("Restored database migration history differs from the backup manifest")
print(pathlib.Path(files[-1]).stem)
PY
)"
[[ "$database_migration" =~ ^[0-9]+_[A-Za-z0-9_-]+$ ]] || { echo "Restored database migration is invalid." >&2; exit 1; }
[[ -f "$ROOT_DIR/pb_migrations/$database_migration.js" && ! -L "$ROOT_DIR/pb_migrations/$database_migration.js" ]] \
  || { echo "Restored database schema is unknown to this checkout: $database_migration" >&2; exit 1; }
if [[ "$legacy_v2" == "0" ]]; then
  [[ "$database_migration" == "$backup_migration" ]] || { echo "Database schema does not match backup metadata." >&2; exit 1; }
else
  # v2 recorded the checkout head rather than the database history. Use the
  # inspected DB value for extraction diagnostics; live apply remains refused.
  backup_migration="$database_migration"
fi

restore_publish_staging="$(mktemp -d "$restore_parent/.lingshu-restore-publish.XXXXXX")"
cp -a "$extracted/." "$restore_publish_staging/"
chmod -R go-rwx "$restore_publish_staging"
# A same-parent rename makes the validated restore tree visible as one unit.
mv "$restore_publish_staging" "$RESTORE_DIR"
restore_publish_staging=""

if [[ "$RESTORE_APPLY" != "true" ]]; then
  printf 'Checksum, archive safety, file integrity, and schema metadata verified. Restored into %s.\n' "$RESTORE_DIR"
  if [[ "$legacy_v2" == "1" ]]; then
    printf 'Legacy v2 verified for extraction only; live apply requires a v3 backup with runtime history.\n'
  fi
  printf 'Set RESTORE_APPLY=true with exact volume confirmations to replace live data.\n'
  exit 0
fi

command -v docker >/dev/null || { echo "docker is required when RESTORE_APPLY=true." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "the Docker Compose plugin is required." >&2; exit 1; }
[[ "$legacy_v2" == "0" ]] || { echo "Live restore refuses legacy v2 backups without PocketBase runtime history." >&2; exit 1; }

env_parent="$(dirname "$COMPOSE_ENV_FILE")"
[[ -d "$env_parent" ]] || { echo "Compose env parent does not exist: $env_parent" >&2; exit 1; }
COMPOSE_ENV_FILE="$(cd "$env_parent" && pwd -P)/$(basename "$COMPOSE_ENV_FILE")"
[[ -f "$COMPOSE_ENV_FILE" && -r "$COMPOSE_ENV_FILE" && ! -L "$COMPOSE_ENV_FILE" ]] \
  || { echo "Compose env file must be a readable regular non-symlink: $COMPOSE_ENV_FILE" >&2; exit 1; }
env_file_value() {
  local name="$1"
  awk -v key="$name" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2); count += 1 }
    END { if (count == 1) print value; else exit 1 }
  ' "$COMPOSE_ENV_FILE"
}
pb_volume="${PB_DATA_VOLUME_NAME:-$(env_file_value PB_DATA_VOLUME_NAME || true)}"
app_volume="${APP_DATA_VOLUME_NAME:-$(env_file_value APP_DATA_VOLUME_NAME || true)}"
for volume_name in "$pb_volume" "$app_volume"; do
  [[ "$volume_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] \
    || { echo "Confirmed target volume names are required in the Compose env file or process environment." >&2; exit 1; }
done
[[ "$pb_volume" != "$app_volume" ]] || { echo "PocketBase and application restore volumes must be distinct." >&2; exit 1; }
[[ -n "$pb_volume" && "$pb_volume" == "${RESTORE_CONFIRM_PB_VOLUME:-}" ]] || {
  echo "RESTORE_CONFIRM_PB_VOLUME must exactly match PB_DATA_VOLUME_NAME." >&2; exit 1;
}
[[ -n "$app_volume" && "$app_volume" == "${RESTORE_CONFIRM_APP_VOLUME:-}" ]] || {
  echo "RESTORE_CONFIRM_APP_VOLUME must exactly match APP_DATA_VOLUME_NAME." >&2; exit 1;
}

pb_container="$(compose ps -aq pocketbase)"
app_container="$(compose ps -aq app)"
[[ -n "$pb_container" && "$pb_container" != *$'\n'* ]] \
  || { echo "Exactly one PocketBase container is required for restore." >&2; exit 1; }
[[ -n "$app_container" && "$app_container" != *$'\n'* ]] \
  || { echo "Exactly one application container is required for restore." >&2; exit 1; }
mounted_pb_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/pb/pb_data"}}{{.Name}}{{end}}{{end}}' "$pb_container")"
mounted_app_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$app_container")"
[[ "$mounted_pb_volume" == "$pb_volume" ]] || { echo "PocketBase container mounts $mounted_pb_volume, not confirmed volume $pb_volume." >&2; exit 1; }
[[ "$mounted_app_volume" == "$app_volume" ]] || { echo "App container mounts $mounted_app_volume, not confirmed volume $app_volume." >&2; exit 1; }
[[ "$(docker volume inspect --format '{{.Name}}' "$pb_volume")" == "$pb_volume" ]] \
  || { echo "Confirmed PocketBase restore volume is not one exact Docker volume." >&2; exit 1; }
[[ "$(docker volume inspect --format '{{.Name}}' "$app_volume")" == "$app_volume" ]] \
  || { echo "Confirmed application restore volume is not one exact Docker volume." >&2; exit 1; }

target_pb_image="$(docker inspect --format '{{.Image}}' "$pb_container")"
[[ "$target_pb_image" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Target PocketBase image identity is invalid." >&2; exit 1; }
target_version_output="$(docker run --rm --network none --read-only --entrypoint /pb/pocketbase "$target_pb_image" --version 2>/dev/null || true)"
[[ "$target_version_output" =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]] \
  || { echo "Unable to determine target PocketBase runtime version." >&2; exit 1; }
target_major="${BASH_REMATCH[1]}"; target_minor="${BASH_REMATCH[2]}"; target_patch="${BASH_REMATCH[3]}"
[[ "$backup_pb_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]
backup_major="${BASH_REMATCH[1]}"; backup_minor="${BASH_REMATCH[2]}"; backup_patch="${BASH_REMATCH[3]}"
if [[ "$target_major" != "$backup_major" || "$target_minor" != "$backup_minor" ]] \
  || ! ((10#$target_patch >= 10#$backup_patch)); then
  echo "Target PocketBase $target_major.$target_minor.$target_patch is incompatible with backup runtime $backup_pb_version." >&2
  exit 1
fi
docker run --rm --network none --read-only --entrypoint /bin/sh "$target_pb_image" \
  -c 'test -f "$1"' sh "/pb/pb_migrations/$backup_migration.js" \
  || { echo "Target PocketBase image does not contain backup migration $backup_migration." >&2; exit 1; }

rollback="$(mktemp -d "${TMPDIR:-/tmp}/lingshu-restore-rollback.XXXXXX")"
mkdir -p "$rollback/pb_data" "$rollback/data"

wait_ready() {
  local attempt
  for attempt in $(seq 1 45); do
    if compose exec -T app curl -fsS --max-time 3 http://127.0.0.1:8788/api/overseas/readyz >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

wipe_pb_volume() {
  docker run --rm --volumes-from "$pb_container" "$RESTORE_HELPER_IMAGE" sh -c 'find /pb/pb_data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
}

wipe_app_volume() {
  docker run --rm --volumes-from "$app_container" "$RESTORE_HELPER_IMAGE" sh -c 'find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
}

wipe_volumes() {
  wipe_pb_volume
  wipe_app_volume
}

install_pb_data() {
  local source="$1"
  docker cp "$source/pb_data/." "$pb_container:/pb/pb_data" \
    && docker run --rm --volumes-from "$pb_container" "$RESTORE_HELPER_IMAGE" chown -R 10001:10001 /pb/pb_data
}

install_app_data() {
  local source="$1"
  docker cp "$source/data/." "$app_container:/app/data" \
    && docker run --rm --volumes-from "$app_container" "$RESTORE_HELPER_IMAGE" chown -R 1000:1000 /app/data
}

install_data() {
  local source="$1"
  install_pb_data "$source"
  install_app_data "$source"
}

echo "Stopping services and taking a local rollback snapshot..."
services_stopped=1
compose stop app >/dev/null
compose stop pocketbase >/dev/null
docker cp "$pb_container:/pb/pb_data/." "$rollback/pb_data"
docker cp "$app_container:/app/data/." "$rollback/data"
[[ -f "$rollback/pb_data/data.db" && ! -L "$rollback/pb_data/data.db" ]] \
  || { echo "Rollback snapshot is missing PocketBase data.db; live replacement was not started." >&2; exit 1; }

data_replacement_started=1
wipe_volumes
install_data "$RESTORE_DIR"
compose start pocketbase >/dev/null
compose start app >/dev/null
services_stopped=0

if ! wait_ready; then
  echo "Restored application did not become ready; automatic rollback will run." >&2
  exit 1
fi
data_replacement_started=0

printf 'Live data restored and readiness passed. Validated copy remains at %s.\n' "$RESTORE_DIR"
