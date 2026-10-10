#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<EOF
Usage:
  $0 (--create-if-missing|--require-existing) [env-file]
  $0 --adopt-legacy <legacy-volume-name> [env-file]

Normal starts and updates must use --require-existing. --create-if-missing is
reserved for an explicit fresh install. --adopt-legacy copies a recognized
unowned legacy PB volume into the new owned volume without modifying the source.
EOF
  exit 64
}

mode="${1:-}"
legacy_volume_name=""
case "$mode" in
  --create-if-missing|--require-existing)
    env_file="${2:-.env.production}"
    [[ $# -le 2 ]] || usage
    ;;
  --adopt-legacy)
    [[ $# -ge 2 && $# -le 3 ]] || usage
    legacy_volume_name="$2"
    env_file="${3:-.env.production}"
    ;;
  *) usage ;;
esac

[[ -r "$env_file" ]] || { echo "Production environment file is not readable: $env_file" >&2; exit 1; }

# Read only the two non-secret identity keys. Never source the production env
# file: provider secrets may contain shell metacharacters and must remain data.
read_env_identity() {
  local key="$1"
  local count value
  count="$(grep -c "^${key}=" "$env_file" || true)"
  value="$(sed -n "s/^${key}=//p" "$env_file" | tr -d '\r')"
  if [[ "$count" -ne 1 || -z "$value" || "$value" == *$'\n'* ]]; then
    echo "$key must appear exactly once and be non-empty in $env_file" >&2
    exit 1
  fi
  printf '%s' "$value"
}

validate_volume_name() {
  local label="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
    echo "$label contains unsupported characters or is too long: $value" >&2
    exit 1
  fi
}

volume_name="$(read_env_identity PB_DATA_VOLUME_NAME)"
volume_owner="$(read_env_identity PB_DATA_VOLUME_OWNER)"
validate_volume_name PB_DATA_VOLUME_NAME "$volume_name"
validate_volume_name PB_DATA_VOLUME_OWNER "$volume_owner"
if [[ "$volume_owner" == *replace-with* || "$volume_owner" == *change-me* ]]; then
  echo "PB_DATA_VOLUME_OWNER is still a placeholder; generate a unique installation owner." >&2
  exit 1
fi

managed_role_key='com.lingshu-ai.data-role'
managed_role='pocketbase'
owner_key='com.lingshu-ai.installation-owner'

inspect_label() {
  local name="$1"
  local key="$2"
  local value
  value="$(docker volume inspect --format "{{ index .Labels \"$key\" }}" "$name")"
  [[ "$value" == '<no value>' ]] && value=""
  printf '%s' "$value"
}

verify_owned_volume() {
  local actual_name data_role actual_owner
  actual_name="$(docker volume inspect --format '{{.Name}}' "$volume_name")"
  data_role="$(inspect_label "$volume_name" "$managed_role_key")"
  actual_owner="$(inspect_label "$volume_name" "$owner_key")"
  if [[ "$actual_name" != "$volume_name" ]]; then
    echo "PocketBase volume identity mismatch: expected $volume_name, got $actual_name" >&2
    exit 1
  fi
  if [[ "$data_role" != "$managed_role" ]]; then
    echo "Refusing Docker volume with the wrong data role: $volume_name" >&2
    echo "Expected label $managed_role_key=$managed_role." >&2
    exit 1
  fi
  if [[ "$actual_owner" != "$volume_owner" ]]; then
    echo "Refusing PocketBase volume owned by another or unknown installation: $volume_name" >&2
    echo "Expected label $owner_key=$volume_owner; got ${actual_owner:-<missing>}." >&2
    exit 1
  fi
}

create_owned_volume() {
  docker volume create \
    --label "$managed_role_key=$managed_role" \
    --label "$owner_key=$volume_owner" \
    "$volume_name" >/dev/null
}

if [[ "$mode" == --adopt-legacy ]]; then
  validate_volume_name legacy-volume-name "$legacy_volume_name"
  [[ "$legacy_volume_name" != "$volume_name" ]] || {
    echo "Legacy source and the new owned volume must have different names." >&2
    exit 1
  }
  if docker volume inspect "$volume_name" >/dev/null 2>&1; then
    echo "Refusing legacy adoption because the target volume already exists: $volume_name" >&2
    exit 1
  fi
  docker volume inspect "$legacy_volume_name" >/dev/null 2>&1 || {
    echo "Legacy PocketBase volume does not exist: $legacy_volume_name" >&2
    exit 1
  }
  legacy_running_containers="$(docker ps -q --filter "volume=$legacy_volume_name")"
  [[ -z "$legacy_running_containers" ]] || {
    echo "Refusing to copy a legacy volume while a container is using it: $legacy_volume_name" >&2
    echo "Stop the old PocketBase stack, then rerun the explicit adoption." >&2
    exit 1
  }
  legacy_actual_name="$(docker volume inspect --format '{{.Name}}' "$legacy_volume_name")"
  legacy_data_role="$(inspect_label "$legacy_volume_name" "$managed_role_key")"
  legacy_owner="$(inspect_label "$legacy_volume_name" "$owner_key")"
  legacy_compose_role="$(inspect_label "$legacy_volume_name" 'com.docker.compose.volume')"
  [[ "$legacy_actual_name" == "$legacy_volume_name" ]] || {
    echo "Legacy volume identity mismatch: expected $legacy_volume_name, got $legacy_actual_name" >&2
    exit 1
  }
  [[ -z "$legacy_owner" ]] || {
    echo "Refusing to adopt a volume already owned by an installation: $legacy_volume_name" >&2
    exit 1
  }
  if [[ "$legacy_data_role" != pocketbase && "$legacy_compose_role" != pb_data && "$legacy_compose_role" != preview_pb_data ]]; then
    echo "Refusing an unrecognized legacy volume: $legacy_volume_name" >&2
    echo "Expected an unowned LingShu PocketBase role or legacy PB Compose volume label." >&2
    exit 1
  fi

  echo "==> Creating owned PocketBase volume for explicit legacy adoption: $volume_name"
  create_owned_volume
  if ! docker run --rm \
    --mount "type=volume,src=$legacy_volume_name,dst=/source,readonly" \
    --mount "type=volume,src=$volume_name,dst=/target" \
    alpine:3.22 sh -eu -c \
      'test -z "$(find /target -mindepth 1 -maxdepth 1 -print -quit)"; cp -a /source/. /target/'; then
    echo "Legacy copy failed; removing only the newly-created target and preserving the source." >&2
    docker volume rm "$volume_name" >/dev/null 2>&1 || true
    exit 1
  fi
  verify_owned_volume
  echo "PocketBase legacy data copied into owned volume: $volume_name (source retained: $legacy_volume_name)"
  exit 0
fi

if ! docker volume inspect "$volume_name" >/dev/null 2>&1; then
  if [[ "$mode" != --create-if-missing ]]; then
    echo "Required PocketBase volume does not exist: $volume_name" >&2
    echo "For a genuinely new empty installation, rerun deploy/start.sh with --fresh-install." >&2
    exit 1
  fi
  echo "==> Creating dedicated PocketBase volume for fresh install: $volume_name"
  create_owned_volume
fi

verify_owned_volume
echo "PocketBase volume verified: $volume_name"
