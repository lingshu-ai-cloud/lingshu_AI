#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  release.sh deploy <internal|presales|production> <40-character-commit-sha> <expected-current-sha> <source-branch>
  release.sh rollback <internal|presales|production> <expected-rollback-sha> <expected-current-sha> <source-branch>
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

is_local_baseline_release() {
  [[ "$(read_release_value IMAGE_SOURCE "$1")" == "local-baseline" ]]
}

verify_local_baseline_tags() {
  local release_file="$1"
  local recorded_environment image_tag app_image pocketbase_image
  local expected_app_id expected_pocketbase_id actual_app_id actual_pocketbase_id

  recorded_environment="$(read_release_value DEPLOY_ENV "$release_file")"
  image_tag="$(read_release_value IMAGE_TAG "$release_file")"
  app_image="$(read_release_value APP_IMAGE "$release_file")"
  pocketbase_image="$(read_release_value POCKETBASE_IMAGE "$release_file")"
  expected_app_id="$(read_release_value BASELINE_APP_IMAGE_ID "$release_file")"
  expected_pocketbase_id="$(read_release_value BASELINE_POCKETBASE_IMAGE_ID "$release_file")"

  [[ "$recorded_environment" == "$deploy_environment" ]] || {
    echo "Local baseline environment does not match the target environment." >&2
    return 1
  }
  [[ "$(read_release_value BASELINE_ATTESTED "$release_file")" == "true" ]] || {
    echo "Local baseline is missing its attestation marker." >&2
    return 1
  }
  [[ "$image_tag" =~ ^baseline-[0-9]{8}t[0-9]{6}z$ ]] || {
    echo "Local baseline tag has an invalid format." >&2
    return 1
  }
  [[ "$app_image" == "lingshu-reconciled-${deploy_environment}-app" ]] || {
    echo "Local baseline application repository is not trusted." >&2
    return 1
  }
  [[ "$pocketbase_image" == "lingshu-reconciled-${deploy_environment}-pocketbase" ]] || {
    echo "Local baseline PocketBase repository is not trusted." >&2
    return 1
  }
  [[ "$expected_app_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "Local baseline application image ID is invalid." >&2
    return 1
  }
  [[ "$expected_pocketbase_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "Local baseline PocketBase image ID is invalid." >&2
    return 1
  }

  actual_app_id="$(docker image inspect --format '{{.Id}}' "$app_image:$image_tag" 2>/dev/null)" || {
    echo "Local baseline application tag is missing." >&2
    return 1
  }
  actual_pocketbase_id="$(docker image inspect --format '{{.Id}}' "$pocketbase_image:$image_tag" 2>/dev/null)" || {
    echo "Local baseline PocketBase tag is missing." >&2
    return 1
  }
  [[ "$actual_app_id" == "$expected_app_id" ]] || {
    echo "Local baseline application tag has drifted from its recorded image ID." >&2
    return 1
  }
  [[ "$actual_pocketbase_id" == "$expected_pocketbase_id" ]] || {
    echo "Local baseline PocketBase tag has drifted from its recorded image ID." >&2
    return 1
  }
}

verify_running_local_baseline() {
  local release_file="$1"
  local app_id pocketbase_id running_app_id running_pocketbase_id
  local expected_app_id expected_pocketbase_id

  verify_local_baseline_tags "$release_file" || return 1
  app_id="$(compose "$release_file" ps -q app 2>/dev/null)"
  pocketbase_id="$(compose "$release_file" ps -q pocketbase 2>/dev/null)"
  [[ -n "$app_id" && -n "$pocketbase_id" ]] || {
    echo "Local baseline containers are not running." >&2
    return 1
  }
  running_app_id="$(docker inspect --format '{{.Image}}' "$app_id" 2>/dev/null)" || return 1
  running_pocketbase_id="$(docker inspect --format '{{.Image}}' "$pocketbase_id" 2>/dev/null)" || return 1
  expected_app_id="$(read_release_value BASELINE_APP_IMAGE_ID "$release_file")"
  expected_pocketbase_id="$(read_release_value BASELINE_POCKETBASE_IMAGE_ID "$release_file")"
  [[ "$running_app_id" == "$expected_app_id" ]] || {
    echo "Running application does not use the authorized local baseline image ID." >&2
    return 1
  }
  [[ "$running_pocketbase_id" == "$expected_pocketbase_id" ]] || {
    echo "Running PocketBase does not use the authorized local baseline image ID." >&2
    return 1
  }
}

verify_running_registry_release() {
  local release_file="$1"
  local recorded_commit image_tag app_image pocketbase_image
  local app_id pocketbase_id running_app_id running_pocketbase_id
  local tagged_app_id tagged_pocketbase_id app_revision pocketbase_revision

  recorded_commit="$(read_release_value DEPLOYED_COMMIT "$release_file")"
  image_tag="$(read_release_value IMAGE_TAG "$release_file")"
  app_image="$(read_release_value APP_IMAGE "$release_file")"
  pocketbase_image="$(read_release_value POCKETBASE_IMAGE "$release_file")"
  [[ "$recorded_commit" =~ ^[0-9a-f]{40}$ ]] || {
    echo "Current registry release has an invalid recorded commit." >&2
    return 1
  }
  [[ -n "$image_tag" && -n "$app_image" && -n "$pocketbase_image" ]] || {
    echo "Current registry release image metadata is incomplete." >&2
    return 1
  }

  app_id="$(compose "$release_file" ps -q app 2>/dev/null)"
  pocketbase_id="$(compose "$release_file" ps -q pocketbase 2>/dev/null)"
  [[ -n "$app_id" && -n "$pocketbase_id" ]] || {
    echo "Current registry release containers are not running." >&2
    return 1
  }
  running_app_id="$(docker inspect --format '{{.Image}}' "$app_id" 2>/dev/null)" || return 1
  running_pocketbase_id="$(docker inspect --format '{{.Image}}' "$pocketbase_id" 2>/dev/null)" || return 1
  tagged_app_id="$(docker image inspect --format '{{.Id}}' "$app_image:$image_tag" 2>/dev/null)" || {
    echo "Current registry application tag is not available locally." >&2
    return 1
  }
  tagged_pocketbase_id="$(docker image inspect --format '{{.Id}}' "$pocketbase_image:$image_tag" 2>/dev/null)" || {
    echo "Current registry PocketBase tag is not available locally." >&2
    return 1
  }
  [[ "$running_app_id" == "$tagged_app_id" ]] || {
    echo "Running application image does not match the recorded registry tag." >&2
    return 1
  }
  [[ "$running_pocketbase_id" == "$tagged_pocketbase_id" ]] || {
    echo "Running PocketBase image does not match the recorded registry tag." >&2
    return 1
  }

  app_revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$app_id" 2>/dev/null)" || return 1
  pocketbase_revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$pocketbase_id" 2>/dev/null)" || return 1
  [[ "$app_revision" == "$recorded_commit" && "$pocketbase_revision" == "$recorded_commit" ]] || {
    echo "Running registry images are not labeled with the recorded commit SHA." >&2
    return 1
  }
}

verify_running_recorded_release() {
  local release_file="$1"
  local image_source
  image_source="$(read_release_value IMAGE_SOURCE "$release_file")"
  case "$image_source" in
    local-baseline)
      verify_running_local_baseline "$release_file"
      ;;
    registry|"")
      verify_running_registry_release "$release_file"
      ;;
    *)
      echo "Current release has an unsupported image source." >&2
      return 1
      ;;
  esac
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
  local source_branch="$2"
  local candidate_file="$3"

  cat > "$candidate_file" <<EOF
DEPLOY_ENV=${deploy_environment}
IMAGE_SOURCE=registry
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
DEPLOYED_BRANCH=${source_branch}
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

  if is_local_baseline_release "$candidate_file"; then
    candidate_pb_image="$(read_release_value BASELINE_POCKETBASE_IMAGE_ID "$candidate_file")"
  else
    candidate_pb_image="$(read_release_value POCKETBASE_IMAGE "$candidate_file"):$(read_release_value IMAGE_TAG "$candidate_file")"
  fi
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

for command_name in docker curl flock git sed; do
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

rollback_mode=0
expected_current_sha="${4:-}"
source_branch="${5:-}"
[[ "$expected_current_sha" =~ ^[0-9a-f]{40}$ ]] || fail "A full lowercase expected current commit SHA is required."
git check-ref-format --branch "$source_branch" >/dev/null 2>&1 || fail "A valid source branch is required."
[[ -f "$current_release" ]] || fail "No current managed release is recorded for ${deploy_environment}."
recorded_current_sha="$(read_release_value DEPLOYED_COMMIT "$current_release")"
[[ "$recorded_current_sha" == "$expected_current_sha" ]] \
  || fail "The running release metadata no longer matches the authorized current commit SHA."
verify_running_recorded_release "$current_release" \
  || fail "The actual running containers no longer match the authorized current release metadata."

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
  write_candidate_release "$commit_sha" "$source_branch" "$candidate_release"
else
  expected_rollback_sha="${3:-}"
  [[ "$expected_rollback_sha" =~ ^[0-9a-f]{40}$ ]] || fail "A full lowercase expected rollback commit SHA is required."
  [[ -f "$previous_release" ]] || fail "No previous release is recorded for ${deploy_environment}."
  recorded_rollback_sha="$(read_release_value DEPLOYED_COMMIT "$previous_release")"
  [[ "$recorded_rollback_sha" == "$expected_rollback_sha" ]] || fail "Recorded rollback baseline does not match the authorized commit SHA."
  recorded_rollback_branch="$(read_release_value DEPLOYED_BRANCH "$previous_release")"
  [[ "$recorded_rollback_branch" == "$source_branch" ]] || fail "Recorded rollback source branch does not match the authorized source branch."
  cp "$previous_release" "$candidate_release"
  chmod 600 "$candidate_release"
  rollback_mode=1
fi

install -m 0644 "$source_root/deploy/compose.release.yml" "$deploy_root/compose.release.yml"

app_host_port="$(read_release_value APP_HOST_PORT "$candidate_release")"
compose_project="$(read_release_value COMPOSE_PROJECT_NAME "$candidate_release")"
app_data_path="$(read_release_value APP_DATA_PATH "$candidate_release")"
pb_data_volume="$(read_release_value PB_DATA_VOLUME_NAME "$candidate_release")"
caddy_data_volume="$(read_release_value CADDY_DATA_VOLUME_NAME "$candidate_release")"
caddy_config_volume="$(read_release_value CADDY_CONFIG_VOLUME_NAME "$candidate_release")"

[[ -n "$compose_project" ]] || fail "Candidate release is missing COMPOSE_PROJECT_NAME."
[[ -n "$app_data_path" && "$app_data_path" == /* ]] || fail "APP_DATA_PATH must be an absolute path."

candidate_image_source="$(read_release_value IMAGE_SOURCE "$candidate_release")"
case "$candidate_image_source" in
  local-baseline)
    [[ "$rollback_mode" == "1" ]] || fail "A local baseline may only be used for an authorized rollback."
    verify_local_baseline_tags "$candidate_release" \
      || fail "The authorized local rollback baseline is missing or has drifted."
    echo "Using verified local baseline $(read_release_value IMAGE_TAG "$candidate_release") for ${deploy_environment}; remote pull is intentionally disabled."
    ;;
  registry|"")
    echo "Pulling release $(read_release_value IMAGE_TAG "$candidate_release") for ${deploy_environment}"
    compose "$candidate_release" pull app pocketbase
    ;;
  *)
    fail "Candidate release has an unsupported image source."
    ;;
esac

backup_pocketbase "$candidate_release"

if is_local_baseline_release "$candidate_release"; then
  if ! verify_local_baseline_tags "$candidate_release"; then
    compose "$current_release" start pocketbase || true
    fail "The local rollback baseline changed before container replacement."
  fi
fi

set +e
compose "$candidate_release" up -d pocketbase app
deploy_status=$?
if [[ "$deploy_status" == "0" ]]; then
  wait_for_health "$candidate_release"
  deploy_status=$?
fi
if [[ "$deploy_status" == "0" ]] && is_local_baseline_release "$candidate_release"; then
  verify_running_local_baseline "$candidate_release"
  deploy_status=$?
fi
set -e

if [[ "$deploy_status" != "0" ]]; then
  echo "Candidate release failed health checks. Recent logs:" >&2
  compose "$candidate_release" logs --tail=120 app pocketbase caddy >&2 || true

  if [[ -f "$current_release" ]]; then
    echo "Restoring the current release $(read_release_value IMAGE_TAG "$current_release")" >&2
    if ! is_local_baseline_release "$current_release" \
      || verify_local_baseline_tags "$current_release"; then
      compose "$current_release" up -d pocketbase app || true
      wait_for_health "$current_release" || true
      if is_local_baseline_release "$current_release"; then
        verify_running_local_baseline "$current_release" || true
      fi
    else
      echo "Current local baseline could not be verified; refusing to recreate containers from a drifting tag." >&2
    fi
  else
    echo "No previous managed release exists; leaving failed candidate containers for inspection." >&2
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
