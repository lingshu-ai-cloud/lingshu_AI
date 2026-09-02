#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

environment="${1:-}"
[[ "$environment" == "internal" ]] || fail "Inventory reporting is limited to internal."
: "${RELEASE_CONSOLE_URL:?RELEASE_CONSOLE_URL is required}"
: "${RELEASE_INVENTORY_WEBHOOK_SECRET:?RELEASE_INVENTORY_WEBHOOK_SECRET is required}"

deploy_root="${DEPLOY_ROOT:-/opt/lingshu/internal}"
release_file="$deploy_root/.release.env"
compose_file="$deploy_root/compose.release.yml"
[[ -f "$release_file" && -f "$compose_file" ]] || fail "Managed release files are missing."

read_value() {
  sed -n "s/^${1}=//p" "$release_file" | tail -n 1
}

commit_sha="$(read_value DEPLOYED_COMMIT)"
branch_name="$(read_value DEPLOYED_BRANCH)"
compose_project="$(read_value COMPOSE_PROJECT_NAME)"
app_image="$(read_value APP_IMAGE):$(read_value IMAGE_TAG)"
pocketbase_image="$(read_value POCKETBASE_IMAGE):$(read_value IMAGE_TAG)"
app_data_path="$(read_value APP_DATA_PATH)"
pb_data_volume="$(read_value PB_DATA_VOLUME_NAME)"
caddy_data_volume="$(read_value CADDY_DATA_VOLUME_NAME)"
caddy_config_volume="$(read_value CADDY_CONFIG_VOLUME_NAME)"
attested="$(read_value BASELINE_ATTESTED)"

[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "Recorded commit is invalid."
[[ -n "$branch_name" && -n "$compose_project" ]] || fail "Recorded source metadata is incomplete."

compose=(docker compose --project-name "$compose_project" --env-file "$release_file" --file "$compose_file")
app_id="$("${compose[@]}" ps -q app)"
pocketbase_id="$("${compose[@]}" ps -q pocketbase)"
[[ -n "$app_id" && -n "$pocketbase_id" ]] || fail "Managed containers are not running."

running_app_image_id="$(docker inspect --format '{{.Image}}' "$app_id")"
running_pb_image_id="$(docker inspect --format '{{.Image}}' "$pocketbase_id")"
[[ "$running_app_image_id" == "$(docker image inspect --format '{{.Id}}' "$app_image")" ]] \
  || fail "Running app does not match the recorded baseline image."
[[ "$running_pb_image_id" == "$(docker image inspect --format '{{.Id}}' "$pocketbase_image")" ]] \
  || fail "Running PocketBase does not match the recorded baseline image."

for container_id in "$app_id" "$pocketbase_id"; do
  [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")" == "healthy" ]] \
    || fail "A managed container is not healthy."
done

source_known=false
if [[ "$attested" == "true" ]]; then
  source_known=true
else
  app_revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$app_id")"
  pb_revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$pocketbase_id")"
  [[ "$app_revision" == "$commit_sha" && "$pb_revision" == "$commit_sha" ]] && source_known=true
fi
[[ "$source_known" == "true" ]] || fail "Image source cannot be verified."

server_unique_code_count="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Type "bind") (ne .Destination "/app/data")}}{{println .Destination}}{{end}}{{end}}' "$app_id" | sed '/^$/d' | wc -l | tr -d ' ')"
[[ "$server_unique_code_count" == "0" ]] || fail "The app container has server-side code bind mounts."

app_port="$(read_value APP_HOST_PORT)"
curl -fsS --max-time 10 "http://127.0.0.1:${app_port}/api/overseas/health" >/dev/null \
  || fail "Versioned application smoke test failed."
if [[ -n "${PUBLIC_SMOKE_URL:-}" ]]; then
  curl -fsS --max-time 15 "$PUBLIC_SMOKE_URL" >/dev/null || fail "Public smoke test failed."
fi

export INVENTORY_COMMIT="$commit_sha"
export INVENTORY_BRANCH="$branch_name"
export INVENTORY_APP_IMAGE="$app_image"
export INVENTORY_PB_IMAGE="$pocketbase_image"
export INVENTORY_COMPOSE_PROJECT="$compose_project"
export INVENTORY_COMPOSE_WORKDIR="$deploy_root"
export INVENTORY_APP_DATA="$app_data_path"
export INVENTORY_PB_VOLUME="$pb_data_volume"
export INVENTORY_CADDY_DATA="$caddy_data_volume"
export INVENTORY_CADDY_CONFIG="$caddy_config_volume"
export INVENTORY_UNIQUE_COUNT="$server_unique_code_count"
payload="$(node - <<'NODE'
const payload = {
  environment: 'internal',
  currentCommit: process.env.INVENTORY_COMMIT,
  currentBranch: process.env.INVENTORY_BRANCH,
  appImage: process.env.INVENTORY_APP_IMAGE,
  pocketbaseImage: process.env.INVENTORY_PB_IMAGE,
  composeProject: process.env.INVENTORY_COMPOSE_PROJECT,
  composeWorkdir: process.env.INVENTORY_COMPOSE_WORKDIR,
  appDataPath: process.env.INVENTORY_APP_DATA,
  pbDataVolume: process.env.INVENTORY_PB_VOLUME,
  caddyDataVolume: process.env.INVENTORY_CADDY_DATA,
  caddyConfigVolume: process.env.INVENTORY_CADDY_CONFIG,
  serverUniqueCodeCount: Number(process.env.INVENTORY_UNIQUE_COUNT),
  sourceKnown: true,
  rollbackBaselineVerified: true,
  smokePassed: true,
  smokeSummary: 'running image IDs match the reconciled rollback tags; container health and versioned HTTP smoke checks passed',
};
process.stdout.write(JSON.stringify(payload));
NODE
)"

curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $RELEASE_INVENTORY_WEBHOOK_SECRET" \
  --header "Content-Type: application/json" \
  --data-binary "$payload" \
  "${RELEASE_CONSOLE_URL%/}/api/environment-inventory" >/dev/null

echo "Verified internal inventory was accepted by the release console."
