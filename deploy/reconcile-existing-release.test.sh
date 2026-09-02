#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
reconcile="$root/deploy/reconcile-existing-release.sh"
report="$root/deploy/report-environment-inventory.sh"
workflow="$root/.github/workflows/reconcile-internal-baseline.yml"
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

mkdir -p "$fixture/bin" "$fixture/compose" "$fixture/deploy"
touch "$fixture/compose/docker-compose.yml" "$fixture/deploy/compose.release.yml"
export MOCK_DOCKER_LOG="$fixture/docker.log"
export MOCK_INVENTORY_PAYLOAD="$fixture/inventory.json"

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
    '{{.Image}}') [[ "$target" == app-container ]] && echo sha256:app || echo sha256:pb ;;
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
  [[ "${@: -1}" == *app:* ]] && echo sha256:app || echo sha256:pb
  exit 0
fi
echo "unhandled docker call: $*" >&2
exit 9
MOCK_DOCKER

cat > "$fixture/bin/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
for ((index=0; index<${#args[@]}; index++)); do
  if [[ "${args[$index]}" == "--data-binary" ]]; then
    printf '%s' "${args[$((index+1))]}" > "$MOCK_INVENTORY_PAYLOAD"
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

PATH="$fixture/bin:$PATH" DEPLOY_ROOT="$fixture/deploy" \
  DEPLOY_ACTOR=test-suite APP_HOST_PORT=18788 \
  bash "$reconcile" internal fixture-project "$fixture/compose" \
  f0dde18b1137cea535c1de2052bdbbd84f8a6b91 \
  codex/test-baseline >/dev/null

grep -Fq 'DEPLOYED_COMMIT=f0dde18b1137cea535c1de2052bdbbd84f8a6b91' "$fixture/deploy/.release.env"
grep -Fq 'BASELINE_APP_IMAGE_ID=sha256:app' "$fixture/deploy/.release.env"
grep -Fq 'BASELINE_POCKETBASE_IMAGE_ID=sha256:pb' "$fixture/deploy/.release.env"
[[ ! -e "$fixture/deploy/.previous-release.env" ]]
[[ "$(find "$fixture/deploy/reconciliation-archive" -type f | wc -l | tr -d ' ')" == "2" ]]
if grep -Eq ' compose .* (stop|start|restart|up|down|kill|rm) ' "$MOCK_DOCKER_LOG"; then
  echo "The reconciliation test observed a container lifecycle call." >&2
  exit 1
fi

PATH="$fixture/bin:$PATH" DEPLOY_ROOT="$fixture/deploy" \
  RELEASE_CONSOLE_URL=https://ops.example.test \
  RELEASE_INVENTORY_WEBHOOK_SECRET=test-secret \
  PUBLIC_SMOKE_URL=https://internal.example.test/api/health \
  bash "$report" internal >/dev/null

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

echo "Internal-only reconciliation safety checks passed."
