#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  release.sh deploy <internal|presales|production> <40-character-commit-sha>
  release.sh rollback <internal|presales|production>
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

read_release_value() {
  local key="$1"
  local file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

compose() {
  local release_file="$1"
  local release_compose_project
  shift
  release_compose_project="$(read_release_value COMPOSE_PROJECT_NAME "$release_file")"
  [[ -n "$release_compose_project" ]] || release_compose_project="lingshu-${deploy_environment}"
  docker compose \
    --project-name "$release_compose_project" \
    --env-file "$release_file" \
    --file "$deploy_root/compose.release.yml" \
    "$@"
}

wait_for_health() {
  local release_file="$1"
  local attempt app_id pocketbase_id app_health pocketbase_health

  for attempt in $(seq 1 36); do
    app_id="$(compose "$release_file" ps -q app 2>/dev/null || true)"
    pocketbase_id="$(compose "$release_file" ps -q pocketbase 2>/dev/null || true)"

    if [[ -n "$app_id" && -n "$pocketbase_id" ]]; then
      app_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_id" 2>/dev/null || true)"
      pocketbase_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$pocketbase_id" 2>/dev/null || true)"

      if [[ "$app_health" == "healthy" && "$pocketbase_health" == "healthy" ]] \
        && curl -fsS --max-time 5 "http://127.0.0.1:${app_host_port}/api/overseas/health" >/dev/null; then
        return 0
      fi
    fi

    sleep 5
  done

  return 1
}

write_candidate_release() {
  local commit_sha="$1"
  local candidate_file="$2"

  cat > "$candidate_file" <<EOF
DEPLOY_ENV=${deploy_environment}
IMAGE_TAG=sha-${commit_sha}
APP_IMAGE=${APP_IMAGE}
POCKETBASE_IMAGE=${POCKETBASE_IMAGE}
APP_HOST_PORT=${app_host_port}
COMPOSE_PROJECT_NAME=${compose_project}
APP_DATA_PATH=${app_data_path}
PB_DATA_VOLUME_NAME=${pb_data_volume}
CADDY_DATA_VOLUME_NAME=${caddy_data_volume}
CADDY_CONFIG_VOLUME_NAME=${caddy_config_volume}
DEPLOYED_COMMIT=${commit_sha}
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEPLOYED_BY=${DEPLOY_ACTOR:-unknown}
EOF
  chmod 600 "$candidate_file"
}

backup_pocketbase() {
  local candidate_file="$1"
  local backup_name="pb_data_$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  local candidate_pb_image
  local current_was_running=0

  docker volume create "$pb_data_volume" >/dev/null

  if [[ -f "$current_release" && -n "$(compose "$current_release" ps -q pocketbase 2>/dev/null || true)" ]]; then
    compose "$current_release" stop pocketbase
    current_was_running=1
  fi

  candidate_pb_image="$(read_release_value POCKETBASE_IMAGE "$candidate_file"):$(read_release_value IMAGE_TAG "$candidate_file")"
  if ! docker run --rm \
    --entrypoint sh \
    -e BACKUP_NAME="$backup_name" \
    -v "$pb_data_volume:/source:ro" \
    -v "$deploy_root/backups:/backups" \
    "$candidate_pb_image" \
    -c 'tar czf "/backups/$BACKUP_NAME" -C /source .'; then
    if [[ "$current_was_running" == "1" ]]; then
      compose "$current_release" start pocketbase || true
    fi
    fail "PocketBase backup failed; deployment was not started."
  fi

  echo "PocketBase backup: $deploy_root/backups/$backup_name"
}

action="${1:-}"
deploy_environment="${2:-}"

if [[ "$action" != "deploy" && "$action" != "rollback" ]]; then
  usage
  exit 2
fi

case "$deploy_environment" in
  internal|presales|production) ;;
  *) usage; exit 2 ;;
esac

for command_name in docker curl flock sed; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required."
done

docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."

deploy_root="${DEPLOY_ROOT:-/opt/lingshu/${deploy_environment}}"
compose_project="lingshu-${deploy_environment}"
app_host_port="${APP_HOST_PORT:-18788}"
app_data_path="$deploy_root/data"
pb_data_volume="lingshu_${deploy_environment}_pb_data"
caddy_data_volume="lingshu_${deploy_environment}_caddy_data"
caddy_config_volume="lingshu_${deploy_environment}_caddy_config"
current_release="$deploy_root/.release.env"
previous_release="$deploy_root/.previous-release.env"
candidate_release="$deploy_root/.candidate-release.env"
history_file="$deploy_root/deployment-history.tsv"
source_root="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$deploy_root/backups" "$deploy_root/data"
chmod 750 "$deploy_root" "$deploy_root/backups" "$deploy_root/data"

exec 9>"$deploy_root/.deploy.lock"
if ! flock -n 9; then
  fail "Another deployment is already running for ${deploy_environment}."
fi

if [[ ! -f "$deploy_root/.env.runtime" ]]; then
  fail "$deploy_root/.env.runtime is missing. Create it from deploy/runtime.env.example and set mode 600."
fi
chmod 600 "$deploy_root/.env.runtime"

install -m 0644 "$source_root/deploy/compose.release.yml" "$deploy_root/compose.release.yml"
install -m 0644 "$source_root/Caddyfile" "$deploy_root/Caddyfile"

rollback_mode=0
if [[ "$action" == "deploy" ]]; then
  commit_sha="${3:-}"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "A full lowercase 40-character commit SHA is required."
  : "${APP_IMAGE:?APP_IMAGE is required for deploy}"
  : "${POCKETBASE_IMAGE:?POCKETBASE_IMAGE is required for deploy}"
  if [[ -f "$current_release" ]]; then
    app_host_port="$(read_release_value APP_HOST_PORT "$current_release")"
    compose_project="$(read_release_value COMPOSE_PROJECT_NAME "$current_release")"
    app_data_path="$(read_release_value APP_DATA_PATH "$current_release")"
    pb_data_volume="$(read_release_value PB_DATA_VOLUME_NAME "$current_release")"
    caddy_data_volume="$(read_release_value CADDY_DATA_VOLUME_NAME "$current_release")"
    caddy_config_volume="$(read_release_value CADDY_CONFIG_VOLUME_NAME "$current_release")"
    [[ -n "$app_host_port" ]] || fail "Current release is missing APP_HOST_PORT."
    [[ -n "$compose_project" ]] || fail "Current release is missing COMPOSE_PROJECT_NAME."
    [[ -n "$app_data_path" ]] || fail "Current release is missing APP_DATA_PATH."
  fi
  write_candidate_release "$commit_sha" "$candidate_release"
else
  [[ -f "$previous_release" ]] || fail "No previous release is recorded for ${deploy_environment}."
  cp "$previous_release" "$candidate_release"
  chmod 600 "$candidate_release"
  rollback_mode=1
fi

app_host_port="$(read_release_value APP_HOST_PORT "$candidate_release")"
compose_project="$(read_release_value COMPOSE_PROJECT_NAME "$candidate_release")"
app_data_path="$(read_release_value APP_DATA_PATH "$candidate_release")"
pb_data_volume="$(read_release_value PB_DATA_VOLUME_NAME "$candidate_release")"
caddy_data_volume="$(read_release_value CADDY_DATA_VOLUME_NAME "$candidate_release")"
caddy_config_volume="$(read_release_value CADDY_CONFIG_VOLUME_NAME "$candidate_release")"

[[ -n "$compose_project" ]] || fail "Candidate release is missing COMPOSE_PROJECT_NAME."
[[ -n "$app_data_path" && "$app_data_path" == /* ]] || fail "APP_DATA_PATH must be an absolute path."

echo "Pulling release $(read_release_value IMAGE_TAG "$candidate_release") for ${deploy_environment}"
compose "$candidate_release" pull

backup_pocketbase "$candidate_release"

set +e
compose "$candidate_release" up -d --remove-orphans
deploy_status=$?
if [[ "$deploy_status" == "0" ]]; then
  wait_for_health "$candidate_release"
  deploy_status=$?
fi
set -e

if [[ "$deploy_status" != "0" ]]; then
  echo "Candidate release failed health checks. Recent logs:" >&2
  compose "$candidate_release" logs --tail=120 app pocketbase caddy >&2 || true

  if [[ -f "$current_release" ]]; then
    echo "Restoring the current release $(read_release_value IMAGE_TAG "$current_release")" >&2
    compose "$current_release" up -d --remove-orphans || true
    wait_for_health "$current_release" || true
  else
    compose "$candidate_release" down || true
  fi

  rm -f "$candidate_release"
  fail "Deployment failed and the previous image release was restored. The database backup was preserved."
fi

if [[ "$rollback_mode" == "1" ]]; then
  swap_file="$deploy_root/.release-swap.env"
  if [[ -f "$current_release" ]]; then
    mv "$current_release" "$swap_file"
  fi
  mv "$candidate_release" "$current_release"
  if [[ -f "$swap_file" ]]; then
    mv "$swap_file" "$previous_release"
  fi
  history_action="rollback"
else
  if [[ -f "$current_release" ]]; then
    cp "$current_release" "$previous_release"
    chmod 600 "$previous_release"
  fi
  mv "$candidate_release" "$current_release"
  history_action="deploy"
fi

printf '%s\t%s\t%s\t%s\t%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$history_action" \
  "$(read_release_value IMAGE_TAG "$current_release")" \
  "${DEPLOY_ACTOR:-unknown}" \
  "${DEPLOY_RUN_URL:-local}" >> "$history_file"
chmod 640 "$history_file"

compose "$current_release" ps
echo "Release $(read_release_value IMAGE_TAG "$current_release") is healthy in ${deploy_environment}."
