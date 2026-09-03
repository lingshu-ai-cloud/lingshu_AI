#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PB_VERSION="${PB_VERSION:-0.39.9}"
PB_SMOKE_PORT="${PB_SMOKE_PORT:-18093}"
PB_BIN="${PB_BIN:-}"

[[ "$PB_SMOKE_PORT" =~ ^[0-9]+$ ]] && ((PB_SMOKE_PORT >= 1024 && PB_SMOKE_PORT <= 65535)) \
  || { echo "PB_SMOKE_PORT must be between 1024 and 65535." >&2; exit 1; }
for command_name in curl jq unzip; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done

smoke_dir="$(mktemp -d "${TMPDIR:-/tmp}/lingshu-pb-atomic.XXXXXX")"
pb_pid=""
cleanup() {
  if [[ -n "$pb_pid" ]]; then
    kill "$pb_pid" >/dev/null 2>&1 || true
    wait "$pb_pid" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$smoke_dir"
}
trap cleanup EXIT

if [[ -z "$PB_BIN" ]]; then
  case "$(uname -s)" in Darwin) pb_os=darwin ;; Linux) pb_os=linux ;; *) echo "Unsupported OS." >&2; exit 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) pb_arch=arm64 ;; x86_64|amd64) pb_arch=amd64 ;; *) echo "Unsupported architecture." >&2; exit 1 ;; esac
  archive="pocketbase_${PB_VERSION}_${pb_os}_${pb_arch}.zip"
  release="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}"
  curl -fsSL --retry 3 -o "$smoke_dir/$archive" "$release/$archive"
  curl -fsSL --retry 3 -o "$smoke_dir/checksums.txt" "$release/checksums.txt"
  expected_line="$(grep " $archive\$" "$smoke_dir/checksums.txt")"
  [[ -n "$expected_line" ]] || { echo "Release checksum is missing $archive." >&2; exit 1; }
  if command -v shasum >/dev/null; then
    (cd "$smoke_dir" && printf '%s\n' "$expected_line" | shasum -a 256 -c -)
  else
    command -v sha256sum >/dev/null || { echo "shasum or sha256sum is required." >&2; exit 1; }
    (cd "$smoke_dir" && printf '%s\n' "$expected_line" | sha256sum -c -)
  fi
  unzip -q "$smoke_dir/$archive" -d "$smoke_dir/bin"
  PB_BIN="$smoke_dir/bin/pocketbase"
fi
[[ -x "$PB_BIN" ]] || { echo "PB_BIN is not executable: $PB_BIN" >&2; exit 1; }

pb_url="http://127.0.0.1:$PB_SMOKE_PORT"
"$PB_BIN" serve \
  --http="127.0.0.1:$PB_SMOKE_PORT" \
  --dir="$smoke_dir/pb_data" \
  --migrationsDir="$ROOT_DIR/pb_migrations" \
  --hooksDir="$ROOT_DIR/pb_hooks" \
  --automigrate=false \
  --hooksWatch=false \
  --dev=false >"$smoke_dir/pocketbase.log" 2>&1 &
pb_pid=$!

for _attempt in $(seq 1 60); do
  curl -fsS --max-time 1 "$pb_url/api/health" >/dev/null 2>&1 && break
  if ! kill -0 "$pb_pid" >/dev/null 2>&1; then
    sed -n '1,200p' "$smoke_dir/pocketbase.log" >&2
    exit 1
  fi
  sleep 0.25
done
curl -fsS --max-time 2 "$pb_url/api/health" >/dev/null || { sed -n '1,200p' "$smoke_dir/pocketbase.log" >&2; exit 1; }

"$PB_BIN" superuser upsert smoke@example.com 'Smoke-pass-123456!' \
  --dir="$smoke_dir/pb_data" \
  --migrationsDir="$ROOT_DIR/pb_migrations" \
  --hooksDir="$ROOT_DIR/pb_hooks" \
  --automigrate=false \
  --hooksWatch=false \
  --dev=false >/dev/null

auth_json="$(curl -fsS -X POST -H 'Content-Type: application/json' \
  --data '{"identity":"smoke@example.com","password":"Smoke-pass-123456!"}' \
  "$pb_url/api/collections/_superusers/auth-with-password")"
token="$(printf '%s' "$auth_json" | jq -er '.token')"

# Exercise the exact application-container bootstrap before checking the
# migration-only critical schema. A check-only smoke can miss incompatible
# legacy field definitions that make `npm run setup:pb` fail at startup.
NODE_ENV=production \
PB_URL="$pb_url" \
PB_ADMIN_EMAIL='smoke@example.com' \
PB_ADMIN_PASSWORD='Smoke-pass-123456!' \
WORKBENCH_ADMIN_EMAIL='workbench-smoke@lingshu.invalid' \
WORKBENCH_ADMIN_PASSWORD='Workbench-smoke-pass-123456!' \
npm --prefix "$ROOT_DIR" run setup:pb >/dev/null

# A migrated and bootstrapped fresh database must contain every canonical
# collection and index before the application accepts traffic.
PB_URL="$pb_url" \
PB_ADMIN_EMAIL='smoke@example.com' \
PB_ADMIN_PASSWORD='Smoke-pass-123456!' \
npm --prefix "$ROOT_DIR" run setup:pb -- --check >/dev/null

# Exercise the real PocketBase filter/skipTotal contract used by global queue
# workers. This also proves that a fresh migration created both projection
# fields before canonical readiness validation.
queue_due="$(curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' \
  --data '{"tenant_id":"tenant-smoke","platform":"youtube","track_code":"queue-due","published_at":"2026-09-02T00:00:00.000Z","publish_queue_state":"pending","publish_available_at":"2026-09-02T00:00:00.000Z","stats":{"status":"scheduled"}}' \
  "$pb_url/api/collections/posts/records")"
queue_due_id="$(printf '%s' "$queue_due" | jq -er '.id')"
queue_due_tie="$(curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' \
  --data '{"tenant_id":"tenant-smoke","platform":"youtube","track_code":"queue-due-tie","published_at":"2026-09-02T00:00:00.000Z","publish_queue_state":"pending","publish_available_at":"2026-09-02T00:00:00.000Z","stats":{"status":"scheduled"}}' \
  "$pb_url/api/collections/posts/records")"
queue_due_tie_id="$(printf '%s' "$queue_due_tie" | jq -er '.id')"
curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' \
  --data '{"tenant_id":"tenant-smoke","platform":"youtube","track_code":"queue-future","published_at":"2099-01-01T00:00:00.000Z","publish_queue_state":"pending","publish_available_at":"2099-01-01T00:00:00.000Z","stats":{"status":"scheduled"}}' \
  "$pb_url/api/collections/posts/records" >/dev/null
queue_list="$(curl -fsS -G -H "Authorization: $token" \
  --data-urlencode 'filter=publish_queue_state = "pending" && publish_available_at <= "2026-09-02T12:00:00.000Z"' \
  --data-urlencode 'sort=publish_available_at,id' --data-urlencode 'perPage=10' --data-urlencode 'skipTotal=1' \
  "$pb_url/api/collections/posts/records")"
queue_first_id="$(printf '%s\n%s\n' "$queue_due_id" "$queue_due_tie_id" | sort | sed -n '1p')"
queue_second_id="$(printf '%s\n%s\n' "$queue_due_id" "$queue_due_tie_id" | sort | sed -n '2p')"
printf '%s' "$queue_list" | jq -e --arg first "$queue_first_id" --arg second "$queue_second_id" \
  '.items | length == 2 and .[0].id == $first and .[1].id == $second' >/dev/null
printf '%s' "$queue_list" | jq -e '.totalItems == -1 and .totalPages == -1' >/dev/null

unauthorized_status="$(curl -sS -o "$smoke_dir/unauthorized.json" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' --data '{"expected":{"revision":0},"data":{"revision":1}}' \
  "$pb_url/api/lingshu/atomic/compare-and-set/workflow_runs/aaaaaaaaaaaaaaa")"
[[ "$unauthorized_status" == "401" ]]

created="$(curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' \
  --data '{"tenant_id":"tenant-smoke","goal_id":"goal-smoke","plan_id":"plan-smoke","status":"running","started_at":"2026-09-02T00:00:00.000Z","revision":0,"lease_owner":"","idempotency_key":"smoke-run-1"}' \
  "$pb_url/api/collections/workflow_runs/records")"
record_id="$(printf '%s' "$created" | jq -er '.id')"

cas="$(curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' \
  --data '{"expected":{"status":"running","revision":0,"lease_owner":""},"data":{"lease_owner":"worker-smoke","revision":1}}' \
  "$pb_url/api/lingshu/atomic/compare-and-set/workflow_runs/$record_id")"
printf '%s' "$cas" | jq -e '.record.lease_owner == "worker-smoke" and .record.revision == 1' >/dev/null

stale_status="$(curl -sS -o "$smoke_dir/stale.json" -w '%{http_code}' -X POST \
  -H "Authorization: $token" -H 'Content-Type: application/json' \
  --data '{"expected":{"revision":0},"data":{"lease_owner":"worker-stale"}}' \
  "$pb_url/api/lingshu/atomic/compare-and-set/workflow_runs/$record_id")"
[[ "$stale_status" == "409" ]]
jq -e '.reason == "conflict" and .current.revision == 1' "$smoke_dir/stale.json" >/dev/null

create_payload='{"uniqueWhere":{"tenant_id":"tenant-smoke","idempotency_key":"smoke-run-concurrent"},"data":{"tenant_id":"tenant-smoke","goal_id":"goal-concurrent","plan_id":"plan-concurrent","status":"running","started_at":"2026-09-02T00:00:00.000Z","revision":0}}'
curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' --data "$create_payload" \
  "$pb_url/api/lingshu/atomic/create-if-absent/workflow_runs" >"$smoke_dir/create-a.json" &
first_pid=$!
curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' --data "$create_payload" \
  "$pb_url/api/lingshu/atomic/create-if-absent/workflow_runs" >"$smoke_dir/create-b.json" &
second_pid=$!
wait "$first_pid"
wait "$second_pid"
created_count="$(jq -s '[.[].created] | map(select(. == true)) | length' "$smoke_dir/create-a.json" "$smoke_dir/create-b.json")"
unique_ids="$(jq -rs '[.[].record.id] | unique | length' "$smoke_dir/create-a.json" "$smoke_dir/create-b.json")"
[[ "$created_count" == "1" && "$unique_ids" == "1" ]]

# Two callers with different browser idempotency keys but the same durable
# tenant/platform/account/content fence must converge on one reservation.
publish_fence_payload_a='{"uniqueWhere":{"fence_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"data":{"tenant_id":"tenant-smoke","fence_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","platform":"youtube","account_id":"account-smoke","content_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","owner_key":"browser-a-request","post_id":"","state":"reserved","revision":0,"created_at":"2026-09-02T00:00:00.000Z","updated_at":"2026-09-02T00:00:00.000Z"}}'
publish_fence_payload_b='{"uniqueWhere":{"fence_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"data":{"tenant_id":"tenant-smoke","fence_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","platform":"youtube","account_id":"account-smoke","content_digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","owner_key":"browser-b-request","post_id":"","state":"reserved","revision":0,"created_at":"2026-09-02T00:00:00.000Z","updated_at":"2026-09-02T00:00:00.000Z"}}'
curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' --data "$publish_fence_payload_a" \
  "$pb_url/api/lingshu/atomic/create-if-absent/publish_content_fences" >"$smoke_dir/publish-fence-a.json" &
publish_fence_first_pid=$!
curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' --data "$publish_fence_payload_b" \
  "$pb_url/api/lingshu/atomic/create-if-absent/publish_content_fences" >"$smoke_dir/publish-fence-b.json" &
publish_fence_second_pid=$!
wait "$publish_fence_first_pid"
wait "$publish_fence_second_pid"
publish_fence_created_count="$(jq -s '[.[].created] | map(select(. == true)) | length' "$smoke_dir/publish-fence-a.json" "$smoke_dir/publish-fence-b.json")"
publish_fence_unique_ids="$(jq -rs '[.[].record.id] | unique | length' "$smoke_dir/publish-fence-a.json" "$smoke_dir/publish-fence-b.json")"
[[ "$publish_fence_created_count" == "1" && "$publish_fence_unique_ids" == "1" ]]

# Revision counters deliberately start at zero. PocketBase treats a required
# number with value 0 as empty, so these creates guard against accidentally
# reintroducing an incompatible `required` flag in canonical migrations.
receipt_payload='{"uniqueWhere":{"tenant_id":"tenant-smoke","provider":"meta","message_id":"wamid.smoke"},"data":{"tenant_id":"tenant-smoke","provider":"meta","message_id":"wamid.smoke","status":"processing","revision":0,"received_at":"2026-09-02T00:00:00.000Z","updated_at":"2026-09-02T00:00:00.000Z","claim_expires_at":"2026-09-02T00:30:00.000Z"}}'
receipt_created="$(curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' --data "$receipt_payload" \
  "$pb_url/api/lingshu/atomic/create-if-absent/webhook_message_receipts")"
printf '%s' "$receipt_created" | jq -e '.created == true and .record.revision == 0 and .record.status == "processing"' >/dev/null

assist_payload='{"uniqueWhere":{"token_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"data":{"token_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","token_prefix":"smoke1","token_last4":"0001","tenant_id":"tenant-smoke","platform":"meta","status":"pending","expires_at":"2099-01-01T00:00:00.000Z","revision":0}}'
assist_created="$(curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' --data "$assist_payload" \
  "$pb_url/api/lingshu/atomic/create-if-absent/assist_links")"
printf '%s' "$assist_created" | jq -e '.created == true and .record.revision == 0 and .record.status == "pending"' >/dev/null

# crawl_jobs is intentionally on the CAS allow-list: two /next pollers can
# observe the same queued record, but PocketBase must grant only one lease.
crawl_created="$(curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' \
  --data '{"tenantId":"tenant-smoke","requestedBy":"smoke","platform":"youtube","mode":"keyword","keyword":"sensor","limit":1,"status":"queued","workerId":"","attempts":0,"resultJson":"","error":"","createdAt":"2026-09-02T00:00:00.000Z","updatedAt":"2026-09-02T00:00:00.000Z","leasedUntil":"","finishedAt":"","leaseToken":"","revision":0}' \
  "$pb_url/api/collections/crawl_jobs/records")"
crawl_id="$(printf '%s' "$crawl_created" | jq -er '.id')"
crawl_expected='{"expected":{"status":"queued","workerId":"","leasedUntil":"","leaseToken":"","revision":0},"data":{"status":"running","workerId":"worker-a","leaseToken":"11111111-1111-4111-8111-111111111111","leasedUntil":"2099-01-01T00:00:00.000Z","revision":1}}'
curl -sS -o "$smoke_dir/crawl-claim-a.json" -w '%{http_code}' -X POST \
  -H "Authorization: $token" -H 'Content-Type: application/json' --data "$crawl_expected" \
  "$pb_url/api/lingshu/atomic/compare-and-set/crawl_jobs/$crawl_id" >"$smoke_dir/crawl-claim-a.status" &
crawl_first_pid=$!
crawl_expected_b='{"expected":{"status":"queued","workerId":"","leasedUntil":"","leaseToken":"","revision":0},"data":{"status":"running","workerId":"worker-b","leaseToken":"22222222-2222-4222-8222-222222222222","leasedUntil":"2099-01-01T00:00:00.000Z","revision":1}}'
curl -sS -o "$smoke_dir/crawl-claim-b.json" -w '%{http_code}' -X POST \
  -H "Authorization: $token" -H 'Content-Type: application/json' --data "$crawl_expected_b" \
  "$pb_url/api/lingshu/atomic/compare-and-set/crawl_jobs/$crawl_id" >"$smoke_dir/crawl-claim-b.status" &
crawl_second_pid=$!
wait "$crawl_first_pid"
wait "$crawl_second_pid"
crawl_statuses="$(printf '%s\n%s\n' "$(cat "$smoke_dir/crawl-claim-a.status")" "$(cat "$smoke_dir/crawl-claim-b.status")" | sort | tr '\n' ' ')"
[[ "$crawl_statuses" == "200 409 " ]]
jq -s -e '[.[] | select(.record)] | length == 1 and .[0].record.revision == 1 and .[0].record.status == "running"' \
  "$smoke_dir/crawl-claim-a.json" "$smoke_dir/crawl-claim-b.json" >/dev/null

printf 'PocketBase %s fresh canonical schema, hook auth, CAS conflict, and concurrent create-if-absent passed.\n' "$PB_VERSION"
