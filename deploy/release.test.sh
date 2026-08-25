#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
cp "$repository_root/deploy/runtime.env.example" "$test_root/.env.runtime"

docker() {
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
  if [[ "$1" == "inspect" ]]; then
    if [[ "${MOCK_FAIL_HEALTH:-0}" == "1" ]]; then
      printf '%s\n' "unhealthy"
    else
      printf '%s\n' "healthy"
    fi
    return 0
  fi
  if [[ "$1" == "compose" ]]; then
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

sha_one="1111111111111111111111111111111111111111"
sha_two="2222222222222222222222222222222222222222"
sha_three="3333333333333333333333333333333333333333"

mkdir -p "$test_root/existing-data"
cat > "$test_root/.release.env" <<EOF
DEPLOY_ENV=internal
IMAGE_TAG=sha-0000000000000000000000000000000000000000
APP_IMAGE=local/adopted-app
POCKETBASE_IMAGE=local/adopted-pocketbase
APP_HOST_PORT=18788
COMPOSE_PROJECT_NAME=legacy-project
APP_DATA_PATH=$test_root/existing-data
PB_DATA_VOLUME_NAME=legacy_pb_data
CADDY_DATA_VOLUME_NAME=legacy_caddy_data
CADDY_CONFIG_VOLUME_NAME=legacy_caddy_config
DEPLOYED_COMMIT=0000000000000000000000000000000000000000
EOF

APP_IMAGE="ghcr.io/example/app" \
POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
DEPLOY_ROOT="$test_root" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_one"

APP_IMAGE="ghcr.io/example/app" \
POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
DEPLOY_ROOT="$test_root" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_two"

grep -q "^IMAGE_TAG=sha-${sha_two}$" "$test_root/.release.env"
grep -q "^IMAGE_TAG=sha-${sha_one}$" "$test_root/.previous-release.env"
grep -q "^COMPOSE_PROJECT_NAME=legacy-project$" "$test_root/.release.env"
grep -q "^APP_DATA_PATH=$test_root/existing-data$" "$test_root/.release.env"
grep -q "^PB_DATA_VOLUME_NAME=legacy_pb_data$" "$test_root/.release.env"

DEPLOY_ROOT="$test_root" \
  bash "$repository_root/deploy/release.sh" rollback internal

grep -q "^IMAGE_TAG=sha-${sha_one}$" "$test_root/.release.env"
grep -q "^IMAGE_TAG=sha-${sha_two}$" "$test_root/.previous-release.env"

if MOCK_FAIL_HEALTH=1 \
  APP_IMAGE="ghcr.io/example/app" \
  POCKETBASE_IMAGE="ghcr.io/example/pocketbase" \
  DEPLOY_ROOT="$test_root" \
  bash "$repository_root/deploy/release.sh" deploy internal "$sha_three"; then
  echo "Expected failed health check to return non-zero." >&2
  exit 1
fi

grep -q "^IMAGE_TAG=sha-${sha_one}$" "$test_root/.release.env"
[[ "$(wc -l < "$test_root/deployment-history.tsv" | tr -d ' ')" == "3" ]]

echo "release state-machine simulation passed"
