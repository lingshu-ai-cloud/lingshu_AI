#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
workflow="$root/.github/workflows/verify-release-images.yml"

test -f "$workflow"

grep -Fq 'workflow_dispatch:' "$workflow"
if grep -Eq '^[[:space:]]+(push|pull_request|schedule|workflow_call):' "$workflow"; then
  echo "Image verification must only support workflow_dispatch." >&2
  exit 1
fi

grep -Fq 'runs-on: ubuntu-latest' "$workflow"
if grep -Fq 'runs-on: self-hosted' "$workflow" \
  || grep -Eq 'runs-on:.*self-hosted' "$workflow"; then
  echo "Image verification must not use a self-hosted runner." >&2
  exit 1
fi

grep -Fq 'contents: read' "$workflow"
grep -Fq 'packages: read' "$workflow"
grep -Fq 'WORKFLOW_REF: ${{ github.ref }}' "$workflow"
grep -Fq '[[ "$WORKFLOW_REF" != "refs/heads/main" ]]' "$workflow"
grep -Fq '[[ ! "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]' "$workflow"
grep -Fq 'git check-ref-format --branch "$SOURCE_REF"' "$workflow"
grep -Fq '"+refs/heads/${SOURCE_REF}:refs/remotes/origin/release-image-source"' "$workflow"
grep -Fq '[[ "$remote_sha" != "$SOURCE_SHA" ]]' "$workflow"

grep -Fq 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262' "$workflow"
grep -Fq 'docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9' "$workflow"
grep -Fq 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02' "$workflow"
if grep -E '^[[:space:]]+uses:' "$workflow" \
  | grep -Ev '@[0-9a-f]{40}([[:space:]#]|$)'; then
  echo "Every third-party action must be pinned to a full commit SHA." >&2
  exit 1
fi

git check-ref-format --branch '四个agent合并/右下常驻/API和上下文待验证' >/dev/null

grep -Fq 'for image in "$APP_IMAGE" "$POCKETBASE_IMAGE"' "$workflow"
grep -Fq 'docker pull "$image"' "$workflow"
grep -Fq 'org.opencontainers.image.revision' "$workflow"
grep -Fq 'http://127.0.0.1:18788/api/overseas/health' "$workflow"
grep -Fq 'http://127.0.0.1:18788/' "$workflow"
grep -Fq "jq --exit-status 'type == \"object\"'" "$workflow"
grep -Fq 'http://127.0.0.1:18090/api/health' "$workflow"
grep -Fq "jq --exit-status '.code == 200'" "$workflow"
grep -Fq 'name: release-image-attestation-${{ steps.source.outputs.sha }}' "$workflow"
grep -Fq 'retention-days: 30' "$workflow"

if grep -Eq 'docker (build|push|compose)|kubectl|(^|[[:space:]])(ssh|scp)([[:space:]]|$)' "$workflow"; then
  echo "Image verification contains a forbidden build, push, deploy, or remote-host command." >&2
  exit 1
fi
