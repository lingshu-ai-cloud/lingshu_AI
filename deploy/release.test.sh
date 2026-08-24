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
