#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  adopt-existing-release.sh <internal|presales|production> <compose-project> <compose-directory> <40-character-commit-sha>

This records an already-running Compose installation as the rollback baseline.
It does not restart, stop, or recreate containers. The current app and
PocketBase images are tagged locally so the first managed deployment can
restore them if its health checks fail.
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

environment="${1:-}"
compose_project="${2:-}"
compose_directory="${3:-}"
commit_sha="${4:-}"

case "$environment" in
  internal|presales|production) ;;
  *) usage; exit 2 ;;
esac

[[ -n "$compose_project" ]] || { usage; exit 2; }
[[ "$compose_directory" == /* && -f "$compose_directory/docker-compose.yml" ]] \
  || fail "compose-directory must be an absolute directory containing docker-compose.yml."
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "A full lowercase 40-character commit SHA is required."

for command_name in docker flock install sed; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required."
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."

deploy_root="${DEPLOY_ROOT:-/opt/lingshu/${environment}}"
current_release="$deploy_root/.release.env"
compose_file="$compose_directory/docker-compose.yml"

install -d -m 0750 "$deploy_root" "$deploy_root/backups"
exec 9>"$deploy_root/.deploy.lock"
flock -n 9 || fail "Another deployment or adoption is already running for ${environment}."
[[ ! -e "$current_release" ]] || fail "$current_release already exists; refusing to overwrite it."

compose=(docker compose --project-name "$compose_project" --file "$compose_file")
app_id="$("${compose[@]}" ps -q app)"
pocketbase_id="$("${compose[@]}" ps -q pocketbase)"
[[ -n "$app_id" && -n "$pocketbase_id" ]] || fail "The existing app and pocketbase services must both be running."

for container_id in "$app_id" "$pocketbase_id"; do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
  [[ "$health" == "healthy" ]] || fail "Existing container $container_id is not healthy."
done

app_image_id="$(docker inspect --format '{{.Image}}' "$app_id")"
pocketbase_image_id="$(docker inspect --format '{{.Image}}' "$pocketbase_id")"
app_data_path="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$app_id")"
pb_data_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/pb/pb_data"}}{{.Name}}{{end}}{{end}}' "$pocketbase_id")"

[[ "$app_data_path" == /* ]] || fail "Could not discover the existing /app/data bind mount."
[[ -n "$pb_data_volume" ]] || fail "Could not discover the existing PocketBase volume."

caddy_id="$("${compose[@]}" ps -q caddy)"
[[ -n "$caddy_id" ]] || fail "The existing caddy service must be running."
caddy_data_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$caddy_id")"
caddy_config_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Name}}{{end}}{{end}}' "$caddy_id")"
[[ -n "$caddy_data_volume" && -n "$caddy_config_volume" ]] || fail "Could not discover the existing Caddy volumes."

image_tag="sha-${commit_sha}"
app_image="lingshu-adopted-${environment}-app"
pocketbase_image="lingshu-adopted-${environment}-pocketbase"
docker image tag "$app_image_id" "$app_image:$image_tag"
docker image tag "$pocketbase_image_id" "$pocketbase_image:$image_tag"

candidate="$(mktemp "$deploy_root/.release.env.tmp.XXXXXX")"
trap 'rm -f -- "$candidate"' EXIT
chmod 600 "$candidate"
cat > "$candidate" <<EOF
DEPLOY_ENV=${environment}
IMAGE_TAG=${image_tag}
APP_IMAGE=${app_image}
POCKETBASE_IMAGE=${pocketbase_image}
APP_HOST_PORT=${APP_HOST_PORT:-18788}
COMPOSE_PROJECT_NAME=${compose_project}
APP_DATA_PATH=${app_data_path}
PB_DATA_VOLUME_NAME=${pb_data_volume}
CADDY_DATA_VOLUME_NAME=${caddy_data_volume}
CADDY_CONFIG_VOLUME_NAME=${caddy_config_volume}
DEPLOYED_COMMIT=${commit_sha}
DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEPLOYED_BY=${DEPLOY_ACTOR:-adopt-existing-release}
EOF
mv "$candidate" "$current_release"
trap - EXIT
chmod 600 "$current_release"

echo "Existing ${environment} release adopted without restarting containers."
echo "Rollback baseline: ${image_tag}"
