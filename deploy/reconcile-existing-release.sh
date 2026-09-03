#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

environment="${1:-}"
compose_project="${2:-}"
compose_directory="${3:-}"
commit_sha="${4:-}"
branch_name="${5:-}"

[[ "$environment" == "internal" ]] || fail "Reconciliation is limited to internal."
[[ -n "$compose_project" ]] || fail "Compose project is required."
[[ "$compose_directory" == /* ]] || fail "Compose directory must be absolute."
[[ -f "$compose_directory/docker-compose.yml" ]] || fail "docker-compose.yml was not found."
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "A full lowercase commit SHA is required."

for command_name in docker curl flock git install; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required."
done
git check-ref-format --branch "$branch_name" >/dev/null 2>&1 || fail "Branch name is invalid."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."

deploy_root="${DEPLOY_ROOT:-/opt/lingshu/internal}"
current_release="$deploy_root/.release.env"
previous_release="$deploy_root/.previous-release.env"
compose_file="$compose_directory/docker-compose.yml"
source_root="$(cd "$(dirname "$0")/.." && pwd)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

install -d -m 0750 "$deploy_root" "$deploy_root/backups" "$deploy_root/reconciliation-archive"
exec 9>"$deploy_root/.deploy.lock"
flock -n 9 || fail "Another deployment operation is running."
install -m 0644 "$source_root/deploy/compose.release.yml" "$deploy_root/compose.release.yml"

compose=(docker compose --project-name "$compose_project" --file "$compose_file")
app_id="$("${compose[@]}" ps -q app)"
pocketbase_id="$("${compose[@]}" ps -q pocketbase)"
caddy_id="$("${compose[@]}" ps -q caddy)"
[[ -n "$app_id" && -n "$pocketbase_id" && -n "$caddy_id" ]] \
  || fail "App, PocketBase, and Caddy must all be running."

for container_id in "$app_id" "$pocketbase_id"; do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  [[ "$health" == "healthy" ]] || fail "Container $container_id is not healthy."
done

app_image_id="$(docker inspect --format '{{.Image}}' "$app_id")"
pocketbase_image_id="$(docker inspect --format '{{.Image}}' "$pocketbase_id")"
app_bind_address="$(docker inspect --format '{{with (index .NetworkSettings.Ports "8788/tcp")}}{{(index . 0).HostIp}}{{end}}' "$app_id")"
app_data_path="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$app_id")"
pb_data_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/pb/pb_data"}}{{.Name}}{{end}}{{end}}' "$pocketbase_id")"
caddy_data_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$caddy_id")"
caddy_config_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Name}}{{end}}{{end}}' "$caddy_id")"

[[ "$app_data_path" == /* ]] || fail "The /app/data bind mount could not be identified."
[[ "$app_bind_address" =~ ^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)[0-9.]+$ ]] \
  || fail "The application host binding is not a private IPv4 address."
[[ -n "$pb_data_volume" && -n "$caddy_data_volume" && -n "$caddy_config_volume" ]] \
  || fail "One or more persistent volumes could not be identified."

curl -fsS --max-time 10 "http://${app_bind_address}:${APP_HOST_PORT:-18788}/api/overseas/health" >/dev/null \
  || fail "Current application smoke test failed."

image_tag="baseline-$(printf '%s' "$timestamp" | tr '[:upper:]' '[:lower:]')"
app_image="lingshu-reconciled-internal-app"
pocketbase_image="lingshu-reconciled-internal-pocketbase"
docker image tag "$app_image_id" "$app_image:$image_tag"
docker image tag "$pocketbase_image_id" "$pocketbase_image:$image_tag"

[[ "$(docker image inspect --format '{{.Id}}' "$app_image:$image_tag")" == "$app_image_id" ]] \
  || fail "Application baseline tag verification failed."
[[ "$(docker image inspect --format '{{.Id}}' "$pocketbase_image:$image_tag")" == "$pocketbase_image_id" ]] \
  || fail "PocketBase baseline tag verification failed."

candidate="$(mktemp "$deploy_root/.release.env.tmp.XXXXXX")"
trap 'rm -f -- "$candidate"' EXIT
chmod 600 "$candidate"
cat > "$candidate" <<EOF
DEPLOY_ENV=internal
IMAGE_SOURCE=local-baseline
IMAGE_TAG=${image_tag}
APP_IMAGE=${app_image}
POCKETBASE_IMAGE=${pocketbase_image}
APP_HOST_PORT=${APP_HOST_PORT:-18788}
APP_BIND_ADDRESS=${app_bind_address}
COMPOSE_PROJECT_NAME=${compose_project}
APP_DATA_PATH=${app_data_path}
PB_DATA_VOLUME_NAME=${pb_data_volume}
CADDY_DATA_VOLUME_NAME=${caddy_data_volume}
CADDY_CONFIG_VOLUME_NAME=${caddy_config_volume}
DEPLOYED_COMMIT=${commit_sha}
DEPLOYED_BRANCH=${branch_name}
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEPLOYED_BY=${DEPLOY_ACTOR:-reconcile-existing-release}
BASELINE_ATTESTED=true
BASELINE_APP_IMAGE_ID=${app_image_id}
BASELINE_POCKETBASE_IMAGE_ID=${pocketbase_image_id}
EOF

for stale_file in "$current_release" "$previous_release"; do
  if [[ -f "$stale_file" ]]; then
    install -m 0600 "$stale_file" "$deploy_root/reconciliation-archive/$(basename "$stale_file").${timestamp}"
  fi
done
rm -f "$previous_release"
mv "$candidate" "$current_release"
trap - EXIT
chmod 600 "$current_release"

echo "Internal baseline reconciled without stopping or recreating containers."
echo "Application image ID: $app_image_id"
echo "PocketBase image ID: $pocketbase_image_id"
echo "Recorded source: $branch_name @ $commit_sha"
