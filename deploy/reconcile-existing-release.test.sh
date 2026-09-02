#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
reconcile="$root/deploy/reconcile-existing-release.sh"
report="$root/deploy/report-environment-inventory.sh"
workflow="$root/.github/workflows/reconcile-internal-baseline.yml"
deploy_workflow="$root/.github/workflows/deploy-environment.yml"
rollback_workflow="$root/.github/workflows/rollback-environment.yml"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT

bash -n "$reconcile"
bash -n "$report"

if bash "$reconcile" presales ignored ignored 0123456789012345678901234567890123456789 ignored 2>/dev/null; then
  echo "Reconciliation unexpectedly accepted presales." >&2
  exit 1
fi

if bash "$report" production 2>/dev/null; then
  echo "Inventory reporting unexpectedly accepted production." >&2
  exit 1
fi

if grep -Eq 'compose.*(stop|start|restart|up|down|kill|rm)' "$reconcile"; then
  echo "The reconciliation path contains a container lifecycle command." >&2
  exit 1
fi

grep -Fq 'runs-on: [self-hosted, linux, x64, internal]' "$workflow"
grep -Fq '[[ "$environment" == "internal" ]]' "$reconcile"
grep -Fq '[[ "$environment" == "internal" ]]' "$report"
grep -Fq 'Running app does not match the recorded baseline image.' "$report"
grep -Fq 'Running PocketBase does not match the recorded baseline image.' "$report"
grep -Fq 'expected_current_sha:' "$deploy_workflow"
grep -Fq 'source_ref:' "$deploy_workflow"
grep -Fq 'expectedCurrentVersion: process.env.EXPECTED_CURRENT_SHA' "$deploy_workflow"
grep -Fq 'sourceRef: process.env.SOURCE_REF' "$deploy_workflow"
grep -Fq 'git merge-base --is-ancestor "$IMAGE_SHA" refs/remotes/origin/release-source' "$deploy_workflow"
grep -Fq 'sudo --preserve-env=APP_IMAGE,POCKETBASE_IMAGE,DEPLOY_ACTOR,DEPLOY_RUN_URL bash deploy/release.sh deploy internal "${{ needs.validate.outputs.image_sha }}" "$EXPECTED_CURRENT_SHA" "$SOURCE_REF"' "$deploy_workflow"
grep -Fq 'expected_current_sha:' "$rollback_workflow"
grep -Fq 'source_ref:' "$rollback_workflow"
grep -Fq 'expectedCurrentVersion: process.env.EXPECTED_CURRENT_SHA' "$rollback_workflow"
grep -Fq 'sudo --preserve-env=DEPLOY_ACTOR,DEPLOY_RUN_URL bash deploy/release.sh rollback internal "$ROLLBACK_VERSION" "$EXPECTED_CURRENT_SHA" "$SOURCE_REF"' "$rollback_workflow"
grep -Fq 'Report verified post-deployment inventory' "$deploy_workflow"
grep -Fq 'Report verified post-rollback inventory' "$rollback_workflow"
grep -Fq 'sudo --preserve-env=RELEASE_CONSOLE_URL,RELEASE_INVENTORY_WEBHOOK_SECRET bash deploy/report-environment-inventory.sh internal' "$deploy_workflow"
grep -Fq 'sudo --preserve-env=RELEASE_CONSOLE_URL,RELEASE_INVENTORY_WEBHOOK_SECRET bash deploy/report-environment-inventory.sh internal' "$rollback_workflow"

mkdir -p "$fixture/bin" "$fixture/compose" "$fixture/deploy"
touch "$fixture/compose/docker-compose.yml" "$fixture/deploy/compose.release.yml"
export MOCK_DOCKER_LOG="$fixture/docker.log"
export MOCK_INVENTORY_PAYLOAD="$fixture/inventory.json"
export MOCK_CURL_LOG="$fixture/curl.log"

cat > "$fixture/bin/docker" <<'MOCK_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "$MOCK_DOCKER_LOG"
printf '\n' >> "$MOCK_DOCKER_LOG"

if [[ "${1:-}" == "compose" && "${2:-}" == "version" ]]; then exit 0; fi
if [[ "${1:-}" == "compose" ]]; then
  service="${@: -1}"
  case "$service" in
    app) echo app-container ;;
    pocketbase) echo pb-container ;;
    caddy) echo caddy-container ;;
  esac
  exit 0
fi
if [[ "${1:-}" == "inspect" ]]; then
  format="${3:-}"
  target="${4:-}"
  case "$format" in
    *State.Health*) echo healthy ;;
    '{{.Image}}') [[ "$target" == app-container ]] \
      && echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
      || echo sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ;;
    *'.Type "bind"'*) echo ;;
    *'/app/data'*) echo /srv/internal/data ;;
    *'/pb/pb_data'*) echo internal_pb_data ;;
    *'eq .Destination "/data"'*) echo internal_caddy_data ;;
    *'eq .Destination "/config"'*) echo internal_caddy_config ;;
    *'org.opencontainers.image.revision'*) echo ;;
    *) echo "unhandled docker inspect format: $format" >&2; exit 9 ;;
  esac
  exit 0
fi
if [[ "${1:-}" == "image" && "${2:-}" == "tag" ]]; then exit 0; fi
if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
  if [[ "$*" == *org.opencontainers.image.revision* ]]; then
    echo "${MOCK_IMAGE_REVISION:-}"
  else
    [[ "${@: -1}" == *app:* ]] \
      && echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
      || echo sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  fi
  exit 0
fi
echo "unhandled docker call: $*" >&2
exit 9
MOCK_DOCKER

cat > "$fixture/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
printf '%q ' "$@" >> "$MOCK_CURL_LOG"
printf '\n' >> "$MOCK_CURL_LOG"
for ((index=0; index<${#args[@]}; index++)); do
  if [[ "${args[$index]}" == "--data-binary" ]]; then
    printf '%s' "${args[$((index+1))]}" > "$MOCK_INVENTORY_PAYLOAD"
  fi
  if [[ "${args[$index]}" == "--output" ]]; then
    printf '<!doctype html><html><body>internal</body></html>\n' > "${args[$((index+1))]}"
  fi
done
MOCK_CURL
cat > "$fixture/bin/flock" <<'MOCK_FLOCK'
#!/usr/bin/env bash
exit 0
MOCK_FLOCK
chmod +x "$fixture/bin/docker" "$fixture/bin/curl" "$fixture/bin/flock"

mkdir -p "$fixture/deploy/reconciliation-archive"
printf 'DEPLOYED_COMMIT=stale\n' > "$fixture/deploy/.release.env"
printf 'DEPLOYED_COMMIT=older\n' > "$fixture/deploy/.previous-release.env"

if PATH="$fixture/bin:$PATH" DEPLOY_ROOT="$fixture/deploy" \
  bash "$reconcile" internal fixture-project "$fixture/compose" \
  f0dde18b1137cea535c1de2052bdbbd84f8a6b91 'bad..branch' 2>/dev/null; then
  echo "Reconciliation unexpectedly accepted an invalid Git branch name." >&2
  exit 1
fi

PATH="$fixture/bin:$PATH" DEPLOY_ROOT="$fixture/deploy" \
  DEPLOY_ACTOR=test-suite APP_HOST_PORT=18788 \
  bash "$reconcile" internal fixture-project "$fixture/compose" \
  f0dde18b1137cea535c1de2052bdbbd84f8a6b91 \
  'codex/吴小姐大改全ui后3-客服agent+状态判定' >/dev/null

grep -Fq 'DEPLOYED_COMMIT=f0dde18b1137cea535c1de2052bdbbd84f8a6b91' "$fixture/deploy/.release.env"
grep -Fq 'DEPLOYED_BRANCH=codex/吴小姐大改全ui后3-客服agent+状态判定' "$fixture/deploy/.release.env"
grep -Fq 'IMAGE_SOURCE=local-baseline' "$fixture/deploy/.release.env"
grep -Fq 'BASELINE_APP_IMAGE_ID=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$fixture/deploy/.release.env"
grep -Fq 'BASELINE_POCKETBASE_IMAGE_ID=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$fixture/deploy/.release.env"
[[ ! -e "$fixture/deploy/.previous-release.env" ]]
[[ "$(find "$fixture/deploy/reconciliation-archive" -type f | wc -l | tr -d ' ')" == "2" ]]
if grep -Eq ' compose .* (stop|start|restart|up|down|kill|rm) ' "$MOCK_DOCKER_LOG"; then
  echo "The reconciliation test observed a container lifecycle call." >&2
  exit 1
fi

PATH="$fixture/bin:$PATH" DEPLOY_ROOT="$fixture/deploy" \
  RELEASE_CONSOLE_URL=https://ops.example.test \
  RELEASE_INVENTORY_WEBHOOK_SECRET=test-secret \
  bash "$report" internal >/dev/null

grep -Fq 'http://127.0.0.1:18788/api/overseas/health' "$MOCK_CURL_LOG"
grep -Fq 'http://127.0.0.1:18788/' "$MOCK_CURL_LOG"
grep -Fq 'http://127.0.0.1:8090/api/health' "$MOCK_CURL_LOG"

node - "$MOCK_INVENTORY_PAYLOAD" <<'NODE'
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (payload.environment !== 'internal') throw new Error('wrong environment');
if (payload.currentCommit !== 'f0dde18b1137cea535c1de2052bdbbd84f8a6b91') throw new Error('wrong commit');
if (payload.sourceKnown !== true || payload.rollbackBaselineVerified !== true || payload.smokePassed !== true) {
  throw new Error('fail-closed readiness flags were not verified');
}
if (payload.serverUniqueCodeCount !== 0) throw new Error('unexpected runtime code mounts');
NODE

registry_rollback_sha="dddddddddddddddddddddddddddddddddddddddd"
cat > "$fixture/deploy/.previous-release.env" <<EOF
DEPLOY_ENV=internal
DEPLOYED_COMMIT=${registry_rollback_sha}
DEPLOYED_BRANCH=main
IMAGE_SOURCE=registry
IMAGE_TAG=sha-${registry_rollback_sha}
APP_IMAGE=ghcr.io/example/app
POCKETBASE_IMAGE=ghcr.io/example/pocketbase
EOF
PATH="$fixture/bin:$PATH" DEPLOY_ROOT="$fixture/deploy" \
  MOCK_IMAGE_REVISION="$registry_rollback_sha" \
  RELEASE_CONSOLE_URL=https://ops.example.test \
  RELEASE_INVENTORY_WEBHOOK_SECRET=test-secret \
  bash "$report" internal >/dev/null

if PATH="$fixture/bin:$PATH" DEPLOY_ROOT="$fixture/deploy" \
  MOCK_IMAGE_REVISION=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee \
  RELEASE_CONSOLE_URL=https://ops.example.test \
  RELEASE_INVENTORY_WEBHOOK_SECRET=test-secret \
  bash "$report" internal >/dev/null 2>&1; then
  echo "Inventory reporting unexpectedly accepted a drifting registry rollback tag." >&2
  exit 1
fi

cat > "$fixture/deploy/.previous-release.env" <<'EOF'
DEPLOY_ENV=internal
DEPLOYED_COMMIT=not-a-commit
DEPLOYED_BRANCH=main
IMAGE_SOURCE=registry
IMAGE_TAG=sha-invalid
APP_IMAGE=ghcr.io/example/app
POCKETBASE_IMAGE=ghcr.io/example/pocketbase
EOF
if PATH="$fixture/bin:$PATH" DEPLOY_ROOT="$fixture/deploy" \
  RELEASE_CONSOLE_URL=https://ops.example.test \
  RELEASE_INVENTORY_WEBHOOK_SECRET=test-secret \
  bash "$report" internal >/dev/null 2>&1; then
  echo "Inventory reporting unexpectedly accepted an invalid previous-release baseline." >&2
  exit 1
fi

echo "Internal-only reconciliation safety checks passed."
