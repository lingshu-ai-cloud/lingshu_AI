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
previous_release_file="$deploy_root/.previous-release.env"
compose_file="$deploy_root/compose.release.yml"
[[ -f "$release_file" && -f "$compose_file" ]] || fail "Managed release files are missing."

read_file_value() {
  sed -n "s/^${1}=//p" "$2" | tail -n 1
}

read_value() {
  read_file_value "$1" "$release_file"
}

verify_recorded_rollback() {
  local rollback_file="$1"
  local rollback_environment rollback_commit rollback_branch rollback_source rollback_tag
  local rollback_app rollback_pb rollback_app_id rollback_pb_id
  local expected_app_id expected_pb_id rollback_app_revision rollback_pb_revision

  rollback_environment="$(read_file_value DEPLOY_ENV "$rollback_file")"
  rollback_commit="$(read_file_value DEPLOYED_COMMIT "$rollback_file")"
  rollback_branch="$(read_file_value DEPLOYED_BRANCH "$rollback_file")"
  rollback_source="$(read_file_value IMAGE_SOURCE "$rollback_file")"
  rollback_tag="$(read_file_value IMAGE_TAG "$rollback_file")"
  rollback_app="$(read_file_value APP_IMAGE "$rollback_file")"
  rollback_pb="$(read_file_value POCKETBASE_IMAGE "$rollback_file")"
  [[ "$rollback_environment" == "$environment" ]] || return 1
  [[ "$rollback_commit" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ -n "$rollback_branch" && -n "$rollback_tag" && -n "$rollback_app" && -n "$rollback_pb" ]] || return 1
  rollback_app_id="$(docker image inspect --format '{{.Id}}' "$rollback_app:$rollback_tag" 2>/dev/null)" || return 1
  rollback_pb_id="$(docker image inspect --format '{{.Id}}' "$rollback_pb:$rollback_tag" 2>/dev/null)" || return 1

  case "$rollback_source" in
    local-baseline)
      [[ "$(read_file_value BASELINE_ATTESTED "$rollback_file")" == "true" ]] || return 1
      [[ "$rollback_tag" =~ ^baseline-[0-9]{8}t[0-9]{6}z$ ]] || return 1
      [[ "$rollback_app" == "lingshu-reconciled-${environment}-app" ]] || return 1
      [[ "$rollback_pb" == "lingshu-reconciled-${environment}-pocketbase" ]] || return 1
      expected_app_id="$(read_file_value BASELINE_APP_IMAGE_ID "$rollback_file")"
      expected_pb_id="$(read_file_value BASELINE_POCKETBASE_IMAGE_ID "$rollback_file")"
      [[ "$expected_app_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
      [[ "$expected_pb_id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
      [[ "$rollback_app_id" == "$expected_app_id" && "$rollback_pb_id" == "$expected_pb_id" ]] || return 1
      ;;
    registry|"")
      rollback_app_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$rollback_app:$rollback_tag" 2>/dev/null)" || return 1
      rollback_pb_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$rollback_pb:$rollback_tag" 2>/dev/null)" || return 1
      [[ "$rollback_app_revision" == "$rollback_commit" && "$rollback_pb_revision" == "$rollback_commit" ]] || return 1
      ;;
    *)
      return 1
      ;;
  esac
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
image_source="$(read_value IMAGE_SOURCE)"
recorded_app_image_id="$(read_value BASELINE_APP_IMAGE_ID)"
recorded_pb_image_id="$(read_value BASELINE_POCKETBASE_IMAGE_ID)"

[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || fail "Recorded commit is invalid."
[[ -n "$branch_name" && -n "$compose_project" ]] || fail "Recorded source metadata is incomplete."

compose=(docker compose --project-name "$compose_project" --env-file "$release_file" --file "$compose_file")
app_id="$("${compose[@]}" ps -q app)"
pocketbase_id="$("${compose[@]}" ps -q pocketbase)"
[[ -n "$app_id" && -n "$pocketbase_id" ]] || fail "Managed containers are not running."

running_app_image_id="$(docker inspect --format '{{.Image}}' "$app_id")"
running_pb_image_id="$(docker inspect --format '{{.Image}}' "$pocketbase_id")"
tagged_app_image_id="$(docker image inspect --format '{{.Id}}' "$app_image")"
tagged_pb_image_id="$(docker image inspect --format '{{.Id}}' "$pocketbase_image")"
[[ "$running_app_image_id" == "$tagged_app_image_id" ]] \
  || fail "Running app does not match the recorded baseline image."
[[ "$running_pb_image_id" == "$tagged_pb_image_id" ]] \
  || fail "Running PocketBase does not match the recorded baseline image."

for container_id in "$app_id" "$pocketbase_id"; do
  [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")" == "healthy" ]] \
    || fail "A managed container is not healthy."
done

source_known=false
if [[ "$attested" == "true" ]]; then
  [[ "$image_source" == "local-baseline" ]] || fail "Attested baseline is missing its local image source marker."
  [[ "$recorded_app_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "Recorded baseline application image ID is invalid."
  [[ "$recorded_pb_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "Recorded baseline PocketBase image ID is invalid."
  [[ "$tagged_app_image_id" == "$recorded_app_image_id" && "$running_app_image_id" == "$recorded_app_image_id" ]] \
    || fail "Attested application baseline tag or running image has drifted."
  [[ "$tagged_pb_image_id" == "$recorded_pb_image_id" && "$running_pb_image_id" == "$recorded_pb_image_id" ]] \
    || fail "Attested PocketBase baseline tag or running image has drifted."
  source_known=true
else
  app_revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$app_id")"
  pb_revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$pocketbase_id")"
  [[ "$app_revision" == "$commit_sha" && "$pb_revision" == "$commit_sha" ]] && source_known=true
fi
[[ "$source_known" == "true" ]] || fail "Image source cannot be verified."

if [[ -f "$previous_release_file" ]]; then
  verify_recorded_rollback "$previous_release_file" \
    || fail "The recorded previous release is not a usable immutable rollback baseline."
else
  [[ "$image_source" == "local-baseline" ]] \
    || fail "No immutable previous release is available as a rollback baseline."
  verify_recorded_rollback "$release_file" \
    || fail "The reconciled current release is not a usable immutable rollback baseline."
fi

server_unique_code_count="$(docker inspect --format '{{range .Mounts}}{{if and (eq .Type "bind") (ne .Destination "/app/data")}}{{println .Destination}}{{end}}{{end}}' "$app_id" | sed '/^$/d' | wc -l | tr -d ' ')"
[[ "$server_unique_code_count" == "0" ]] || fail "The app container has server-side code bind mounts."

app_port="$(read_value APP_HOST_PORT)"
curl -fsS --max-time 10 "http://127.0.0.1:${app_port}/api/overseas/health" >/dev/null \
  || fail "Application API smoke test failed."
root_page="$(mktemp)"
trap 'rm -f -- "$root_page"' EXIT
curl -fsS --max-time 10 --output "$root_page" "http://127.0.0.1:${app_port}/" \
  || fail "Application root-page smoke test failed."
[[ -s "$root_page" ]] || fail "Application root page was empty."
grep -Eiq '<!doctype[[:space:]]+html|<html([[:space:]>])' "$root_page" \
  || fail "Application root page did not contain HTML."
curl -fsS --max-time 10 "http://127.0.0.1:${PB_HOST_PORT:-8090}/api/health" >/dev/null \
  || fail "PocketBase API smoke test failed."
rm -f -- "$root_page"
trap - EXIT
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
  smokeSummary: 'running image IDs match their immutable source evidence; app API, app HTML root page, and PocketBase API smoke checks passed',
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
