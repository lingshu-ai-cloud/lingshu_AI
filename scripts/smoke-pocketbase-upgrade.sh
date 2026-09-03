#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PB_VERSION="${PB_VERSION:-0.39.9}"
PB_UPGRADE_SMOKE_PORT="${PB_UPGRADE_SMOKE_PORT:-18094}"
PB_BIN="${PB_BIN:-}"
LEGACY_CUTOFF="1788307205"

[[ "$PB_UPGRADE_SMOKE_PORT" =~ ^[0-9]+$ ]] \
  && ((PB_UPGRADE_SMOKE_PORT >= 1024 && PB_UPGRADE_SMOKE_PORT <= 65535)) \
  || { echo "PB_UPGRADE_SMOKE_PORT must be between 1024 and 65535." >&2; exit 1; }
for command_name in curl jq unzip; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required." >&2; exit 1; }
done

smoke_dir="$(mktemp -d "${TMPDIR:-/tmp}/lingshu-pb-upgrade.XXXXXX")"
migrations_dir="$smoke_dir/migrations"
mkdir -p "$migrations_dir"
pb_pid=""

stop_pocketbase() {
  if [[ -n "$pb_pid" ]]; then
    kill "$pb_pid" >/dev/null 2>&1 || true
    wait "$pb_pid" >/dev/null 2>&1 || true
    pb_pid=""
  fi
}

cleanup() {
  stop_pocketbase
  rm -rf -- "$smoke_dir"
}
trap cleanup EXIT

if [[ -z "$PB_BIN" ]]; then
  case "$(uname -s)" in
    Darwin) pb_os=darwin ;;
    Linux) pb_os=linux ;;
    *) echo "Unsupported OS." >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) pb_arch=arm64 ;;
    x86_64|amd64) pb_arch=amd64 ;;
    *) echo "Unsupported architecture." >&2; exit 1 ;;
  esac
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

copy_legacy_migrations() {
  local copied=0
  local source_path filename timestamp
  for source_path in "$ROOT_DIR"/pb_migrations/*.js; do
    filename="${source_path##*/}"
    timestamp="${filename%%_*}"
    if [[ "$timestamp" =~ ^[0-9]+$ ]] && ((10#$timestamp < 10#$LEGACY_CUTOFF)); then
      cp "$source_path" "$migrations_dir/$filename"
      copied=$((copied + 1))
    fi
  done
  ((copied > 0)) || { echo "No legacy migrations were selected." >&2; exit 1; }
}

copy_latest_migrations() {
  local source_path
  for source_path in "$ROOT_DIR"/pb_migrations/*.js; do
    cp "$source_path" "$migrations_dir/${source_path##*/}"
  done
}

pb_url="http://127.0.0.1:$PB_UPGRADE_SMOKE_PORT"
start_pocketbase() {
  local stage="$1"
  "$PB_BIN" serve \
    --http="127.0.0.1:$PB_UPGRADE_SMOKE_PORT" \
    --dir="$smoke_dir/pb_data" \
    --migrationsDir="$migrations_dir" \
    --hooksDir="$ROOT_DIR/pb_hooks" \
    --automigrate=false \
    --hooksWatch=false \
    --dev=false >"$smoke_dir/pocketbase-$stage.log" 2>&1 &
  pb_pid=$!

  for _attempt in $(seq 1 80); do
    curl -fsS --max-time 1 "$pb_url/api/health" >/dev/null 2>&1 && return
    if ! kill -0 "$pb_pid" >/dev/null 2>&1; then
      sed -n '1,240p' "$smoke_dir/pocketbase-$stage.log" >&2
      exit 1
    fi
    sleep 0.25
  done
  sed -n '1,240p' "$smoke_dir/pocketbase-$stage.log" >&2
  echo "PocketBase did not become healthy during $stage." >&2
  exit 1
}

upsert_superuser() {
  "$PB_BIN" superuser upsert upgrade-smoke@example.com 'Upgrade-smoke-pass-123456!' \
    --dir="$smoke_dir/pb_data" \
    --migrationsDir="$migrations_dir" \
    --hooksDir="$ROOT_DIR/pb_hooks" \
    --automigrate=false \
    --hooksWatch=false \
    --dev=false >/dev/null
}

authenticate() {
  curl -fsS -X POST -H 'Content-Type: application/json' \
    --data '{"identity":"upgrade-smoke@example.com","password":"Upgrade-smoke-pass-123456!"}' \
    "$pb_url/api/collections/_superusers/auth-with-password" | jq -er '.token'
}

create_record() {
  local collection="$1"
  local payload="$2"
  curl -fsS -X POST -H "Authorization: $token" -H 'Content-Type: application/json' \
    --data "$payload" "$pb_url/api/collections/$collection/records"
}

read_record() {
  local collection="$1"
  local record_id="$2"
  curl -fsS -H "Authorization: $token" "$pb_url/api/collections/$collection/records/$record_id"
}

copy_legacy_migrations
start_pocketbase legacy
upsert_superuser
token="$(authenticate)"

meta_marker='upgrade-meta-verify-token-plaintext-1234567890'
wecom_marker='upgrade-wecom-callback-token-plaintext-12345'
meta_app_secret='upgrade-meta-app-secret-plaintext'
meta_access_token='upgrade-meta-access-token-plaintext'
wecom_app_secret='upgrade-wecom-app-secret-plaintext'
youtube_client_secret='upgrade-youtube-client-secret-plaintext'
youtube_refresh_token='upgrade-youtube-refresh-token-plaintext'
youtube_access_token='upgrade-youtube-access-token-plaintext'
social_access_token='upgrade-social-access-token-plaintext'
social_refresh_token='upgrade-social-refresh-token-plaintext'
assist_token='upgrade-assist-capability-plaintext'

meta_record="$(create_record tenant_platform_apps "{\"tenant_id\":\"tenant-upgrade\",\"platform\":\"meta\",\"app_id\":\"meta-app-upgrade\",\"app_secret\":\"$meta_app_secret\",\"webhook_verify_token\":\"$meta_marker\",\"access_token\":\"$meta_access_token\",\"status\":\"active\"}")"
meta_id="$(printf '%s' "$meta_record" | jq -er '.id')"
wecom_record="$(create_record tenant_platform_apps "{\"tenant_id\":\"tenant-upgrade\",\"platform\":\"wecom\",\"app_id\":\"wecom-app-upgrade\",\"app_secret\":\"$wecom_app_secret\",\"webhook_verify_token\":\"$wecom_marker\",\"status\":\"active\"}")"
wecom_id="$(printf '%s' "$wecom_record" | jq -er '.id')"
youtube_record="$(create_record youtube_accounts "{\"tenantId\":\"tenant-upgrade\",\"channelId\":\"channel-upgrade\",\"clientId\":\"youtube-client-upgrade\",\"clientSecret\":\"$youtube_client_secret\",\"refreshToken\":\"$youtube_refresh_token\",\"accessToken\":\"$youtube_access_token\",\"status\":\"connected\"}")"
youtube_id="$(printf '%s' "$youtube_record" | jq -er '.id')"
social_record="$(create_record social_accounts "{\"tenantId\":\"tenant-upgrade\",\"platform\":\"instagram\",\"providerAccountId\":\"social-upgrade\",\"accessToken\":\"$social_access_token\",\"refreshToken\":\"$social_refresh_token\",\"status\":\"connected\"}")"
social_id="$(printf '%s' "$social_record" | jq -er '.id')"
assist_record="$(create_record assist_links "{\"token\":\"$assist_token\",\"tenant_id\":\"tenant-upgrade\",\"platform\":\"meta\",\"expires_at\":\"2099-01-01T00:00:00.000Z\",\"created_by\":\"upgrade-smoke\"}")"
assist_id="$(printf '%s' "$assist_record" | jq -er '.id')"

scheduled_hash="$(printf 'a%.0s' {1..64})"
retry_hash="$(printf 'b%.0s' {1..64})"
missing_retry_hash="$(printf 'c%.0s' {1..64})"
scheduled_record="$(create_record posts "$(jq -nc --arg hash "$scheduled_hash" '{
  tenant_id:"tenant-upgrade", platform:"youtube", track_code:"upgrade-scheduled-valid",
  published_at:"2099-01-01T00:00:00.000Z",
  stats:{status:"scheduled", source:"manual", schedulePayloadHash:$hash, directPublish:false}
}')")"
scheduled_id="$(printf '%s' "$scheduled_record" | jq -er '.id')"
ambiguous_record="$(create_record posts "$(jq -nc '{
  tenant_id:"tenant-upgrade", platform:"youtube", track_code:"upgrade-scheduled-ambiguous",
  published_at:"2099-01-01T00:00:00.000Z", stats:{status:"scheduled", source:"manual"}
}')")"
ambiguous_id="$(printf '%s' "$ambiguous_record" | jq -er '.id')"
retry_record="$(create_record posts "$(jq -nc --arg hash "$retry_hash" '{
  tenant_id:"tenant-upgrade", platform:"youtube", track_code:"upgrade-scheduled-retry",
  published_at:"2099-01-01T00:00:00.000Z",
  stats:{status:"failed", source:"manual", schedulePayloadHash:$hash, publishAttempts:1, nextPublishAttemptAt:"2099-01-01T02:00:00.000Z"}
}')")"
retry_id="$(printf '%s' "$retry_record" | jq -er '.id')"
missing_retry_record="$(create_record posts "$(jq -nc --arg hash "$missing_retry_hash" '{
  tenant_id:"tenant-upgrade", platform:"youtube", track_code:"upgrade-failed-missing-retry",
  published_at:"2099-01-01T00:00:00.000Z",
  stats:{status:"failed", source:"manual", schedulePayloadHash:$hash, publishAttempts:1}
}')")"
missing_retry_id="$(printf '%s' "$missing_retry_record" | jq -er '.id')"
direct_record="$(create_record posts "$(jq -nc '{
  tenant_id:"tenant-upgrade", platform:"youtube", track_code:"upgrade-direct-publishing",
  published_at:"2099-01-01T00:00:00.000Z", publish_lease_owner:"upgrade-worker",
  publish_lease_expires_at:"2099-01-01T00:30:00.000Z",
  stats:{status:"publishing", directPublish:true, lastPublishAttemptAt:"2099-01-01T00:10:00.000Z"}
}')")"
direct_id="$(printf '%s' "$direct_record" | jq -er '.id')"
terminal_record="$(create_record posts "$(jq -nc '{
  tenant_id:"tenant-upgrade", platform:"youtube", track_code:"upgrade-published-terminal",
  platform_post_id:"provider-post-upgrade", published_at:"2099-01-01T00:00:00.000Z",
  stats:{status:"published", directPublish:false}
}')")"
terminal_id="$(printf '%s' "$terminal_record" | jq -er '.id')"

stop_pocketbase
copy_latest_migrations
start_pocketbase latest
upsert_superuser
token="$(authenticate)"

NODE_ENV=production \
PB_URL="$pb_url" \
PB_ADMIN_EMAIL='upgrade-smoke@example.com' \
PB_ADMIN_PASSWORD='Upgrade-smoke-pass-123456!' \
WORKBENCH_ADMIN_EMAIL='workbench-upgrade-smoke@lingshu.invalid' \
WORKBENCH_ADMIN_PASSWORD='Workbench-upgrade-smoke-pass-123456!' \
npm --prefix "$ROOT_DIR" run setup:pb >/dev/null

PB_URL="$pb_url" \
PB_ADMIN_EMAIL='upgrade-smoke@example.com' \
PB_ADMIN_PASSWORD='Upgrade-smoke-pass-123456!' \
npm --prefix "$ROOT_DIR" run setup:pb -- --check >/dev/null

meta_after="$(read_record tenant_platform_apps "$meta_id")"
printf '%s' "$meta_after" | jq -e \
  '.app_secret == "" and .access_token == "" and .credential_state == "reconnect_required" and (.webhook_verify_token | test("^sha256:[a-f0-9]{64}$"))' >/dev/null
wecom_after="$(read_record tenant_platform_apps "$wecom_id")"
printf '%s' "$wecom_after" | jq -e \
  '.app_secret == "" and .access_token == "" and .webhook_verify_token == "" and .credential_state == "reconnect_required"' >/dev/null
youtube_after="$(read_record youtube_accounts "$youtube_id")"
printf '%s' "$youtube_after" | jq -e \
  '.clientSecret == "" and .refreshToken == "" and .accessToken == "" and .status == "expired" and .credentialState == "reconnect_required"' >/dev/null
social_after="$(read_record social_accounts "$social_id")"
printf '%s' "$social_after" | jq -e \
  '.accessToken == "" and .refreshToken == "" and .status == "expired" and .credentialState == "reconnect_required"' >/dev/null
assist_after="$(read_record assist_links "$assist_id")"
printf '%s' "$assist_after" | jq -e \
  '.token == "" and .token_hash == "" and .status == "revoked" and (.revoked_at | length > 0)' >/dev/null
scheduled_after="$(read_record posts "$scheduled_id")"
printf '%s' "$scheduled_after" | jq -e \
  '.publish_queue_state == "pending" and .publish_available_at == "2099-01-01T00:00:00.000Z"' >/dev/null
ambiguous_after="$(read_record posts "$ambiguous_id")"
printf '%s' "$ambiguous_after" | jq -e \
  '.publish_queue_state == "blocked" and .publish_available_at == ""' >/dev/null
retry_after="$(read_record posts "$retry_id")"
printf '%s' "$retry_after" | jq -e \
  '.publish_queue_state == "pending" and .publish_available_at == "2099-01-01T02:00:00.000Z"' >/dev/null
missing_retry_after="$(read_record posts "$missing_retry_id")"
printf '%s' "$missing_retry_after" | jq -e \
  '.publish_queue_state == "terminal" and .publish_available_at == ""' >/dev/null
direct_after="$(read_record posts "$direct_id")"
printf '%s' "$direct_after" | jq -e \
  '.publish_queue_state == "direct" and .publish_available_at == "2099-01-01T00:30:00.000Z"' >/dev/null
terminal_after="$(read_record posts "$terminal_id")"
printf '%s' "$terminal_after" | jq -e \
  '.publish_queue_state == "terminal" and .publish_available_at == ""' >/dev/null

# Superuser responses include hidden fields. Confirm that none of the original
# recoverable values survives in the logical records after the upgrade.
upgraded_records="$meta_after$wecom_after$youtube_after$social_after$assist_after"
for plaintext_marker in \
  "$meta_marker" "$wecom_marker" "$meta_app_secret" "$meta_access_token" "$wecom_app_secret" \
  "$youtube_client_secret" "$youtube_refresh_token" "$youtube_access_token" \
  "$social_access_token" "$social_refresh_token" "$assist_token"; do
  if [[ "$upgraded_records" == *"$plaintext_marker"* ]]; then
    echo "Plaintext marker survived the migration: $plaintext_marker" >&2
    exit 1
  fi
done

stop_pocketbase
start_pocketbase restart
token="$(authenticate)"
PB_URL="$pb_url" \
PB_ADMIN_EMAIL='upgrade-smoke@example.com' \
PB_ADMIN_PASSWORD='Upgrade-smoke-pass-123456!' \
npm --prefix "$ROOT_DIR" run setup:pb -- --check >/dev/null
printf '%s' "$(read_record posts "$direct_id")" | jq -e \
  '.publish_queue_state == "direct" and .publish_available_at == "2099-01-01T00:30:00.000Z"' >/dev/null

printf 'PocketBase %s legacy-to-latest migration, queue projection, credential scrubbing, capability revocation, and restart passed.\n' "$PB_VERSION"
