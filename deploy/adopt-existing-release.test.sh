#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/legacy/data" "$test_root/deploy-root"
: > "$test_root/legacy/docker-compose.yml"

export ADOPT_APP_DATA="$test_root/legacy/data"
export ADOPT_DOCKER_LOG="$test_root/docker.log"

docker() {
  if [[ "$1" == "compose" && "$2" == "version" ]]; then
    return 0
  fi
  if [[ "$1" == "compose" ]]; then
    case "$*" in
      *" ps -q app") printf '%s\n' "existing-app" ;;
      *" ps -q pocketbase") printf '%s\n' "existing-pocketbase" ;;
      *" ps -q caddy") printf '%s\n' "existing-caddy" ;;
      *) return 0 ;;
    esac
    return 0
  fi
  if [[ "$1" == "inspect" ]]; then
    case "$*" in
      *"State.Health"*) printf '%s\n' "healthy" ;;
      *"{{.Image}}"*"existing-app") printf '%s\n' "sha256:app" ;;
      *"{{.Image}}"*"existing-pocketbase") printf '%s\n' "sha256:pocketbase" ;;
      *'.NetworkSettings.Ports "8788/tcp"'*) printf '%s\n' "172.17.0.1" ;;
      *'Destination "/app/data"'*) printf '%s\n' "$ADOPT_APP_DATA" ;;
      *'Destination "/pb/pb_data"'*) printf '%s\n' "legacy_pb_data" ;;
      *'Destination "/data"'*) printf '%s\n' "legacy_caddy_data" ;;
      *'Destination "/config"'*) printf '%s\n' "legacy_caddy_config" ;;
      *) printf 'Unexpected inspect call: %s\n' "$*" >&2; return 1 ;;
    esac
    return 0
  fi
  if [[ "$1" == "image" && "$2" == "tag" ]]; then
    printf '%s\n' "$*" >> "$ADOPT_DOCKER_LOG"
    return 0
  fi
  printf 'Unexpected docker call: %s\n' "$*" >&2
  return 1
}

flock() {
  return 0
}

export -f docker flock

sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
DEPLOY_ROOT="$test_root/deploy-root" APP_HOST_PORT=18788 \
  bash "$repository_root/deploy/adopt-existing-release.sh" \
  internal legacy-project "$test_root/legacy" "$sha"

release_file="$test_root/deploy-root/.release.env"
grep -q '^COMPOSE_PROJECT_NAME=legacy-project$' "$release_file"
grep -q "^APP_DATA_PATH=$ADOPT_APP_DATA$" "$release_file"
grep -q '^PB_DATA_VOLUME_NAME=legacy_pb_data$' "$release_file"
grep -q '^APP_BIND_ADDRESS=172.17.0.1$' "$release_file"
grep -q '^CADDY_DATA_VOLUME_NAME=legacy_caddy_data$' "$release_file"
grep -q '^CADDY_CONFIG_VOLUME_NAME=legacy_caddy_config$' "$release_file"
grep -q "^IMAGE_TAG=sha-${sha}$" "$release_file"
[[ "$(stat -f '%Lp' "$release_file" 2>/dev/null || stat -c '%a' "$release_file")" == "600" ]]
[[ "$(wc -l < "$ADOPT_DOCKER_LOG" | tr -d ' ')" == "2" ]]

if DEPLOY_ROOT="$test_root/deploy-root" \
  bash "$repository_root/deploy/adopt-existing-release.sh" \
  internal legacy-project "$test_root/legacy" "$sha"; then
  echo "Expected adoption to refuse overwriting the release baseline." >&2
  exit 1
fi

echo "existing release adoption simulation passed"
