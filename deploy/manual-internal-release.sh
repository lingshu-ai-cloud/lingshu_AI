#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

source_branch="${1:-}"
expected_sha="${2:-}"

[[ "$source_branch" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "A valid source branch is required."
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail "A full lowercase commit SHA is required."

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
actual_sha="$(git -C "$repo_root" rev-parse HEAD)"
[[ "$actual_sha" == "$expected_sha" ]] \
  || fail "Checked out $actual_sha instead of $expected_sha."
[[ -z "$(git -C "$repo_root" status --porcelain)" ]] \
  || fail "The deployment checkout is not clean."

release_script="${RELEASE_SCRIPT:-/opt/actions-runner/_work/lingshu_AI/lingshu_AI/deploy/release.sh}"
release_root="${DEPLOY_ROOT:-/opt/lingshu/internal}"
[[ -x "$release_script" || -f "$release_script" ]] \
  || fail "Managed release script is missing: $release_script"
[[ -f "$release_root/.release.env" ]] \
  || fail "Managed current release metadata is missing."

if [[ "$EUID" == "0" ]]; then
  sudo_command=()
  docker_command=(docker)
else
  command -v sudo >/dev/null 2>&1 || fail "sudo is required."
  sudo -n true >/dev/null 2>&1 || fail "Passwordless sudo is required."
  sudo_command=(sudo)
  docker_command=(sudo docker)
fi

command -v curl >/dev/null 2>&1 || fail "curl is required."
"${docker_command[@]}" info >/dev/null

registry_name="lingshu-manual-release-registry"
registry_port="15000"
app_image="127.0.0.1:${registry_port}/lingshu-ai-app"
pocketbase_image="127.0.0.1:${registry_port}/lingshu-ai-pocketbase"
image_tag="sha-${expected_sha}"

cleanup_registry() {
  "${docker_command[@]}" rm -f "$registry_name" >/dev/null 2>&1 || true
}
trap cleanup_registry EXIT

cleanup_registry
"${docker_command[@]}" run --detach \
  --name "$registry_name" \
  --publish "127.0.0.1:${registry_port}:5000" \
  registry:2 >/dev/null

for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 2 \
    "http://127.0.0.1:${registry_port}/v2/" >/dev/null; then
    break
  fi
  [[ "$attempt" != "20" ]] || fail "Temporary local registry did not become ready."
  sleep 1
done

"${docker_command[@]}" build \
  --label "org.opencontainers.image.revision=${expected_sha}" \
  --label "org.opencontainers.image.source=https://github.com/lingshu-ai-cloud/lingshu_AI" \
  --tag "${app_image}:${image_tag}" \
  --file "$repo_root/Dockerfile" \
  "$repo_root"

"${docker_command[@]}" build \
  --label "org.opencontainers.image.revision=${expected_sha}" \
  --label "org.opencontainers.image.source=https://github.com/lingshu-ai-cloud/lingshu_AI" \
  --tag "${pocketbase_image}:${image_tag}" \
  --file "$repo_root/Dockerfile.pocketbase" \
  "$repo_root"

"${docker_command[@]}" push "${app_image}:${image_tag}"
"${docker_command[@]}" push "${pocketbase_image}:${image_tag}"

current_sha="$("${sudo_command[@]}" sed -n 's/^DEPLOYED_COMMIT=//p' \
  "$release_root/.release.env" | tail -n 1)"
[[ "$current_sha" =~ ^[0-9a-f]{40}$ ]] \
  || fail "The currently deployed commit is missing or invalid."

"${sudo_command[@]}" env \
  APP_IMAGE="$app_image" \
  POCKETBASE_IMAGE="$pocketbase_image" \
  DEPLOY_ACTOR="manual-ssh" \
  DEPLOY_RUN_URL="manual-ssh" \
  DEPLOY_ROOT="$release_root" \
  bash "$release_script" \
  deploy internal "$expected_sha" "$current_sha" "$source_branch"

deployed_sha="$("${sudo_command[@]}" sed -n 's/^DEPLOYED_COMMIT=//p' \
  "$release_root/.release.env" | tail -n 1)"
[[ "$deployed_sha" == "$expected_sha" ]] \
  || fail "Managed release metadata was not updated to the requested commit."

cleanup_registry
trap - EXIT
"${docker_command[@]}" builder prune --all --force
"${docker_command[@]}" image prune --force

ready_output="$(curl --fail --silent --show-error --max-time 20 \
  https://lingshu.site/api/overseas/ready)"
printf '%s\n' "$ready_output"
printf '%s' "$ready_output" | grep -Eq \
  '"status"[[:space:]]*:[[:space:]]*"ready"' \
  || fail "The public readiness endpoint did not report ready."

echo "Manual internal deployment completed successfully: ${expected_sha}"
