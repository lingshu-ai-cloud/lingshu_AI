#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
workflow="$root/.github/workflows/build-release-images.yml"

test -f "$workflow"

grep -Fq 'pull_request:' "$workflow"
grep -Fq "if: github.event_name != 'pull_request'" "$workflow"
grep -Fq 'name: Smoke-check published release pair' "$workflow"
grep -Fq '      - verify' "$workflow"
grep -Fq '      - publish' "$workflow"

grep -Fq 'for image in "$APP_IMAGE" "$POCKETBASE_IMAGE"' "$workflow"
grep -Fq 'org.opencontainers.image.revision' "$workflow"
grep -Fq 'docker network create "$smoke_network"' "$workflow"
grep -Fq 'PB_URL=http://${pocketbase_container}:8090' "$workflow"
grep -Fq 'PB_ADMIN_EMAIL=$smoke_admin_email' "$workflow"
grep -Fq 'PB_ADMIN_PASSWORD=$smoke_admin_password' "$workflow"
grep -Fq 'TENANT_PLATFORM_APP_KEY=release-pair-smoke-tenant-platform-key-2026' "$workflow"
grep -Fq 'http://127.0.0.1:18090/api/health' "$workflow"
grep -Fq 'http://127.0.0.1:18788/api/overseas/health' "$workflow"
grep -Fq 'http://127.0.0.1:18788/' "$workflow"
grep -Fq "jq --exit-status '.code == 200'" "$workflow"
grep -Fq "jq --exit-status 'type == \"object\"'" "$workflow"

if grep -Eq 'runs-on:.*self-hosted' "$workflow"; then
  echo "Release image builds and smoke checks must not use a self-hosted runner." >&2
  exit 1
fi

if grep -E '^[[:space:]]+uses:' "$workflow" \
  | grep -Ev '@[0-9a-f]{40}([[:space:]#]|$)'; then
  echo "Every third-party action must be pinned to a full commit SHA." >&2
  exit 1
fi
