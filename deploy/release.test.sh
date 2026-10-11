#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT

export MOCK_DOCKER_LOG="$test_root/docker.log"
export MOCK_BASELINE_APP_ID="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
export MOCK_BASELINE_PB_ID="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
export MOCK_IMAGE_STATE_DIR="$test_root/image-state"
mkdir -p "$MOCK_IMAGE_STATE_DIR"
: > "$MOCK_DOCKER_LOG"

docker() {
  printf '%q ' "$@" >> "$MOCK_DOCKER_LOG"
  printf '\n' >> "$MOCK_DOCKER_LOG"

  if [[ "$1" == "compose" && "$2" == "version" ]]; then
    return 0
  fi
  if [[ "$1" == "volume" && "$2" == "create" ]]; then
    printf '%s\n' "$3"
    return 0
  fi
  if [[ "$1" == "run" ]]; then
    return 0
  fi
  if [[ "$1" == "image" && "$2" == "inspect" ]]; then
    local reference="${@: -1}"
    local format="${4:-}"
    local reference_sha="${reference##*:sha-}"
    if [[ "$format" == *org.opencontainers.image.revision* ]]; then
      if [[ -n "${MOCK_BAD_CANDIDATE_REVISION_SHA:-}" \
        && "$reference_sha" == "$MOCK_BAD_CANDIDATE_REVISION_SHA" ]]; then
        printf '%s\n' "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
      else
        printf '%s\n' "$reference_sha"
      fi
    elif [[ "${MOCK_DRIFT_LOCAL_TAG:-0}" == "1" && "$reference" == lingshu-reconciled-*-app:* ]]; then
      printf '%s\n' "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    elif [[ -n "${MOCK_DRIFT_AFTER_RECORD_SHA:-}" \
      && "$reference_sha" == "$MOCK_DRIFT_AFTER_RECORD_SHA" \
      && ( "$reference" == *-app:* || "$reference" == */app:* ) ]]; then
      local counter_file="$MOCK_IMAGE_STATE_DIR/${reference_sha}.app-count"
      local inspect_count=0
      [[ -f "$counter_file" ]] && inspect_count="$(cat "$counter_file")"
      inspect_count=$((inspect_count + 1))
      printf '%s\n' "$inspect_count" > "$counter_file"
      if [[ "$inspect_count" -ge 2 ]]; then
        printf '%s\n' "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      else
        printf '%s\n' "$MOCK_BASELINE_APP_ID"
      fi
    elif [[ "$reference" == *-app:* || "$reference" == */app:* ]]; then
      printf '%s\n' "$MOCK_BASELINE_APP_ID"
    else
      printf '%s\n' "$MOCK_BASELINE_PB_ID"
    fi
    return 0
  fi
  if [[ "$1" == "inspect" ]]; then
    local format="${3:-}"
    local target="${4:-}"
    if [[ "$format" == *org.opencontainers.image.revision* ]]; then
      if [[ -n "${MOCK_ACTIVE_COMMIT:-}" ]]; then
        printf '%s\n' "$MOCK_ACTIVE_COMMIT"
      else
        sed -n 's/^DEPLOYED_COMMIT=//p' "$DEPLOY_ROOT/.release.env" | tail -n 1
      fi
    elif [[ "$format" == "{{.Image}}" ]]; then
      if [[ "$target" == "mock-app" ]]; then
        printf '%s\n' "${MOCK_RUNNING_APP_IMAGE_ID:-$MOCK_BASELINE_APP_ID}"
      else
        printf '%s\n' "${MOCK_RUNNING_PB_IMAGE_ID:-$MOCK_BASELINE_PB_ID}"
      fi
    elif [[ "${MOCK_FAIL_HEALTH:-0}" == "1" ]]; then
      printf '%s\n' "unhealthy"
    else
      printf '%s\n' "healthy"
    fi
    return 0
  fi
  if [[ "$1" == "compose" ]]; then
    if [[ "$*" == *" up -d pocketbase app"* ]]; then
      local compose_env_file=""
      local previous_argument=""
      local argument
      for argument in "$@"; do
        if [[ "$previous_argument" == "--env-file" ]]; then
          compose_env_file="$argument"
          break
        fi
        previous_argument="$argument"
      done
      [[ -n "$compose_env_file" ]] || return 1
      MOCK_ACTIVE_COMMIT="$(sed -n 's/^DEPLOYED_COMMIT=//p' "$compose_env_file" | tail -n 1)"
    fi
    case "$*" in
      *" ps -q app") printf '%s\n' "mock-app" ;;
      *" ps -q pocketbase") printf '%s\n' "mock-pocketbase" ;;
      *) return 0 ;;
    esac
    return 0
  fi
  printf 'Unexpected docker call: %s\n' "$*" >&2
  return 1
}

curl() {
  [[ "${MOCK_FAIL_HEALTH:-0}" != "1" ]]
}

sleep() {
  :
}

flock() {
  return 0
}

export -f docker curl sleep flock

sha_zero="0000000000000000000000000000000000000000"
sha_one="1111111111111111111111111111111111111111"
sha_two="2222222222222222222222222222222222222222"
sha_three="3333333333333333333333333333333333333333"
source_one="codex/吴小姐大改全ui后3-客服agent+状态判定"
source_two="四个agent合并/右下常驻/API和上下文待验证"

mkdir -p "$test_root/registry/existing-data"
cp "$repository_root/deploy/runtime.env.example" "$test_root/registry/.env.runtime"
cat > "$test_root/registry/.release.env" <<EOF
DEPLOY_ENV=internal
IMAGE_SOURCE=registry
IMAGE_TAG=sha-${sha_zero}
APP_IMAGE=ghcr.io/example/app
POCKETBASE_IMAGE=ghcr.io/example/pocketbase
APP_HOST_PORT=18788
APP_BIND_ADDRESS=172.17.0.1
COMPOSE_PROJECT_NAME=legacy-project
APP_DATA_PATH=$test_root/registry/existing-data
PB_DATA_VOLUME_NAME=legacy_pb_data
CADDY_DATA_VOLUME_NAME=legacy_caddy_data
CADDY_CONFIG_VOLUME_NAME=legacy_caddy_config
DEPLOYED_COMMIT=${sha_zero}
DEPLOYED_BRANCH=legacy/main
REGISTRY_APP_IMAGE_ID=${MOCK_BASELINE_APP_ID}
REGISTRY_POCKETBASE_IMAGE_ID=${MOCK_BASELINE_PB_ID}
EOF

APP_IMAGE="ghcr.io/example/app" \
POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_one" "$sha_zero" "$source_one"

APP_IMAGE="ghcr.io/example/app" \
POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_two" "$sha_one" "$source_one"

grep -q "^IMAGE_TAG=sha-${sha_two}$" "$test_root/registry/.release.env"
grep -q "^IMAGE_TAG=sha-${sha_one}$" "$test_root/registry/.previous-release.env"
grep -q "^DEPLOYED_BRANCH=${source_one}$" "$test_root/registry/.release.env"
grep -q '^IMAGE_SOURCE=registry$' "$test_root/registry/.release.env"
grep -q "^REGISTRY_APP_IMAGE_ID=${MOCK_BASELINE_APP_ID}$" "$test_root/registry/.release.env"
grep -q "^REGISTRY_POCKETBASE_IMAGE_ID=${MOCK_BASELINE_PB_ID}$" "$test_root/registry/.release.env"
grep -q '^COMPOSE_PROJECT_NAME=legacy-project$' "$test_root/registry/.release.env"
grep -q '^APP_BIND_ADDRESS=172.17.0.1$' "$test_root/registry/.release.env"
grep -q "^APP_DATA_PATH=$test_root/registry/existing-data$" "$test_root/registry/.release.env"

pulls_before_stale="$(grep -c ' pull app pocketbase' "$MOCK_DOCKER_LOG" || true)"
if APP_IMAGE="ghcr.io/example/app" \
  POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
  DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_three" "$sha_zero" "$source_two"; then
  echo "Expected deployment with stale current-version authorization to fail." >&2
  exit 1
fi
pulls_after_stale="$(grep -c ' pull app pocketbase' "$MOCK_DOCKER_LOG" || true)"
[[ "$pulls_after_stale" == "$pulls_before_stale" ]]

pulls_before_runtime_drift="$(grep -c ' pull app pocketbase' "$MOCK_DOCKER_LOG" || true)"
mutations_before_runtime_drift="$(grep -Ec '^run | stop pocketbase| up -d ' "$MOCK_DOCKER_LOG" || true)"
if MOCK_RUNNING_APP_IMAGE_ID="sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" \
  APP_IMAGE="ghcr.io/example/app" \
  POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
  DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_three" "$sha_two" "$source_two"; then
  echo "Expected deployment with a running-image mismatch to fail before pull or backup." >&2
  exit 1
fi
pulls_after_runtime_drift="$(grep -c ' pull app pocketbase' "$MOCK_DOCKER_LOG" || true)"
mutations_after_runtime_drift="$(grep -Ec '^run | stop pocketbase| up -d ' "$MOCK_DOCKER_LOG" || true)"
[[ "$pulls_after_runtime_drift" == "$pulls_before_runtime_drift" ]]
[[ "$mutations_after_runtime_drift" == "$mutations_before_runtime_drift" ]]

mutations_before_bad_revision="$(grep -Ec '^run | stop pocketbase| up -d ' "$MOCK_DOCKER_LOG" || true)"
if MOCK_BAD_CANDIDATE_REVISION_SHA="$sha_three" \
  APP_IMAGE="ghcr.io/example/app" \
  POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
  DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_three" "$sha_two" "$source_two"; then
  echo "Expected registry images with the wrong OCI revision to fail before backup or stop." >&2
  exit 1
fi
mutations_after_bad_revision="$(grep -Ec '^run | stop pocketbase| up -d ' "$MOCK_DOCKER_LOG" || true)"
[[ "$mutations_after_bad_revision" == "$mutations_before_bad_revision" ]]

rm -f "$MOCK_IMAGE_STATE_DIR/${sha_three}.app-count"
up_before_tag_drift="$(grep -c ' up -d pocketbase app' "$MOCK_DOCKER_LOG" || true)"
if MOCK_DRIFT_AFTER_RECORD_SHA="$sha_three" \
  APP_IMAGE="ghcr.io/example/app" \
  POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
  DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_three" "$sha_two" "$source_two"; then
  echo "Expected a registry tag/image-ID drift before replacement to fail closed." >&2
  exit 1
fi
up_after_tag_drift="$(grep -c ' up -d pocketbase app' "$MOCK_DOCKER_LOG" || true)"
[[ "$up_after_tag_drift" == "$up_before_tag_drift" ]]
grep -q ' start pocketbase' "$MOCK_DOCKER_LOG"

if DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" rollback internal "$sha_three" "$sha_two" "$source_one"; then
  echo "Expected rollback with a mismatched authorized target SHA to fail." >&2
  exit 1
fi
grep -q "^IMAGE_TAG=sha-${sha_two}$" "$test_root/registry/.release.env"

if DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" rollback internal "$sha_one" "$sha_two" "$source_two"; then
  echo "Expected rollback with a mismatched authorized source branch to fail." >&2
  exit 1
fi

pulls_before="$(grep -c ' pull app pocketbase' "$MOCK_DOCKER_LOG" || true)"
DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" rollback internal "$sha_one" "$sha_two" "$source_one"
pulls_after="$(grep -c ' pull app pocketbase' "$MOCK_DOCKER_LOG" || true)"
[[ "$pulls_after" -eq $((pulls_before + 1)) ]]

grep -q "^IMAGE_TAG=sha-${sha_one}$" "$test_root/registry/.release.env"
grep -q "^IMAGE_TAG=sha-${sha_two}$" "$test_root/registry/.previous-release.env"

if MOCK_FAIL_HEALTH=1 \
  APP_IMAGE="ghcr.io/example/app" \
  POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
  DEPLOY_ROOT="$test_root/registry" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_three" "$sha_one" "$source_two"; then
  echo "Expected failed health check to return non-zero." >&2
  exit 1
fi

grep -q "^IMAGE_TAG=sha-${sha_one}$" "$test_root/registry/.release.env"
[[ "$(wc -l < "$test_root/registry/deployment-history.tsv" | tr -d ' ')" == "3" ]]
! grep -Eq ' (pull|up|stop|start|down|kill|rm).*caddy' "$MOCK_DOCKER_LOG"
! grep -q -- '--remove-orphans' "$MOCK_DOCKER_LOG"

make_local_fixture() {
  local root="$1"
  mkdir -p "$root/existing-data"
  cp "$repository_root/deploy/runtime.env.example" "$root/.env.runtime"
  cat > "$root/.release.env" <<EOF
DEPLOY_ENV=internal
IMAGE_SOURCE=registry
IMAGE_TAG=sha-${sha_two}
APP_IMAGE=ghcr.io/example/app
POCKETBASE_IMAGE=ghcr.io/example/pocketbase
APP_HOST_PORT=18788
APP_BIND_ADDRESS=172.17.0.1
COMPOSE_PROJECT_NAME=legacy-project
APP_DATA_PATH=$root/existing-data
PB_DATA_VOLUME_NAME=legacy_pb_data
CADDY_DATA_VOLUME_NAME=legacy_caddy_data
CADDY_CONFIG_VOLUME_NAME=legacy_caddy_config
DEPLOYED_COMMIT=${sha_two}
DEPLOYED_BRANCH=${source_two}
REGISTRY_APP_IMAGE_ID=${MOCK_BASELINE_APP_ID}
REGISTRY_POCKETBASE_IMAGE_ID=${MOCK_BASELINE_PB_ID}
EOF
  cat > "$root/.previous-release.env" <<EOF
DEPLOY_ENV=internal
IMAGE_SOURCE=local-baseline
IMAGE_TAG=baseline-20260902t010203z
APP_IMAGE=lingshu-reconciled-internal-app
POCKETBASE_IMAGE=lingshu-reconciled-internal-pocketbase
APP_HOST_PORT=18788
APP_BIND_ADDRESS=172.17.0.1
COMPOSE_PROJECT_NAME=legacy-project
APP_DATA_PATH=$root/existing-data
PB_DATA_VOLUME_NAME=legacy_pb_data
CADDY_DATA_VOLUME_NAME=legacy_caddy_data
CADDY_CONFIG_VOLUME_NAME=legacy_caddy_config
DEPLOYED_COMMIT=${sha_one}
DEPLOYED_BRANCH=${source_one}
BASELINE_ATTESTED=true
BASELINE_APP_IMAGE_ID=${MOCK_BASELINE_APP_ID}
BASELINE_POCKETBASE_IMAGE_ID=${MOCK_BASELINE_PB_ID}
EOF
}

make_local_fixture "$test_root/local"
: > "$MOCK_DOCKER_LOG"
MOCK_RUNNING_APP_IMAGE_ID="$MOCK_BASELINE_APP_ID" \
MOCK_RUNNING_PB_IMAGE_ID="$MOCK_BASELINE_PB_ID" \
DEPLOY_ROOT="$test_root/local" \
  bash "$repository_root/deploy/release.sh" rollback internal "$sha_one" "$sha_two" "$source_one"

! grep -q ' pull ' "$MOCK_DOCKER_LOG"
grep -q "^run .*${MOCK_BASELINE_PB_ID}" "$MOCK_DOCKER_LOG"
grep -q ' up -d pocketbase app' "$MOCK_DOCKER_LOG"
! grep -Eq ' (pull|up|stop|start|down|kill|rm).*caddy' "$MOCK_DOCKER_LOG"
! grep -q -- '--remove-orphans' "$MOCK_DOCKER_LOG"
grep -q '^IMAGE_SOURCE=local-baseline$' "$test_root/local/.release.env"
grep -q "^BASELINE_APP_IMAGE_ID=${MOCK_BASELINE_APP_ID}$" "$test_root/local/.release.env"

make_local_fixture "$test_root/drift"
: > "$MOCK_DOCKER_LOG"
if MOCK_DRIFT_LOCAL_TAG=1 \
  DEPLOY_ROOT="$test_root/drift" \
  bash "$repository_root/deploy/release.sh" rollback internal "$sha_one" "$sha_two" "$source_one"; then
  echo "Expected a drifting local baseline tag to fail closed." >&2
  exit 1
fi
! grep -q ' pull ' "$MOCK_DOCKER_LOG"
! grep -q ' up -d ' "$MOCK_DOCKER_LOG"
grep -q "^IMAGE_TAG=sha-${sha_two}$" "$test_root/drift/.release.env"

echo "release state-machine and local-baseline rollback simulations passed"
