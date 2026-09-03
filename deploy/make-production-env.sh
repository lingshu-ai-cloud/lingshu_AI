#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
umask 077
production_env_file="${PRODUCTION_ENV_FILE:-$ROOT_DIR/.env.production}"
[[ "$production_env_file" == /* ]] || production_env_file="$ROOT_DIR/$production_env_file"
bootstrap_secrets_file="${PRODUCTION_BOOTSTRAP_SECRETS_FILE:-${production_env_file}.bootstrap-secrets}"
[[ "$bootstrap_secrets_file" == /* ]] || bootstrap_secrets_file="$ROOT_DIR/$bootstrap_secrets_file"

command -v openssl >/dev/null 2>&1 || { echo "openssl is required." >&2; exit 1; }

if [[ -e "$bootstrap_secrets_file" ]]; then
  echo "One-time bootstrap secrets still exist at $bootstrap_secrets_file." >&2
  echo "Transfer them to the approved password manager and securely remove that file before regenerating configuration." >&2
  exit 1
fi

if [[ -f "$production_env_file" ]]; then
  read -r -p "$production_env_file already exists. Overwrite it? Type yes to continue: " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Canceled; the existing production configuration was not changed."
    exit 0
  fi
fi

require_safe_env_value() {
  local name="$1"
  local candidate="$2"
  if [[ ! "$candidate" =~ ^[A-Za-z0-9._~:/@%+=,!-]+$ ]]; then
    echo "$name contains characters that cannot be written safely to a Compose env file." >&2
    exit 1
  fi
}

require_email() {
  local name="$1"
  local candidate="$2"
  require_safe_env_value "$name" "$candidate"
  [[ "$candidate" =~ ^[^@]+@[^@]+\.[^@]+$ ]] || { echo "$name must be a valid email address." >&2; exit 1; }
  [[ "$candidate" != *example.com ]] || { echo "$name must not use the example.com placeholder domain." >&2; exit 1; }
}

require_password() {
  local name="$1"
  local candidate="$2"
  local lower_candidate
  lower_candidate="$(printf '%s' "$candidate" | tr '[:upper:]' '[:lower:]')"
  require_safe_env_value "$name" "$candidate"
  [[ ${#candidate} -ge 16 ]] || { echo "$name must contain at least 16 characters." >&2; exit 1; }
  [[ "$lower_candidate" != *change-me* && "$lower_candidate" != *placeholder* \
    && "$lower_candidate" != *generate-with* && "$lower_candidate" != test-password* ]] \
    || { echo "$name still looks like a placeholder." >&2; exit 1; }
}

require_provider_key() {
  local name="$1"
  local candidate="$2"
  local lower_candidate
  lower_candidate="$(printf '%s' "$candidate" | tr '[:upper:]' '[:lower:]')"
  require_safe_env_value "$name" "$candidate"
  [[ ${#candidate} -ge 20 ]] || { echo "$name must contain at least 20 characters." >&2; exit 1; }
  [[ "$lower_candidate" != *change-me* && "$lower_candidate" != *placeholder* \
    && "$lower_candidate" != *generate-with* && "$lower_candidate" != test-secret* \
    && "$lower_candidate" != test-key* && "$lower_candidate" != test-token* ]] \
    || { echo "$name still looks like a placeholder." >&2; exit 1; }
}

read -r -p "Customer app domain (for example app.your-company.com): " app_domain
require_safe_env_value APP_DOMAIN "$app_domain"
domain_pattern='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'
[[ "$app_domain" =~ $domain_pattern && "$app_domain" != *.localhost && "$app_domain" != *.local \
  && "$app_domain" != *example.com ]] \
  || { echo "APP_DOMAIN must be the real public DNS name that will receive HTTPS traffic." >&2; exit 1; }

read -r -p "PocketBase superuser email (PocketBase remains private): " pb_email
require_email PB_ADMIN_EMAIL "$pb_email"
read -r -p "Workbench administrator email: " workbench_email
require_email WORKBENCH_ADMIN_EMAIL "$workbench_email"

pb_password_generated=false
read -r -s -p "PocketBase superuser password (leave empty to generate): " pb_password
echo
if [[ -z "$pb_password" ]]; then
  pb_password="$(openssl rand -base64 24 | tr -d '\n')"
  pb_password_generated=true
fi
require_password PB_ADMIN_PASSWORD "$pb_password"

workbench_password_generated=false
read -r -s -p "Workbench administrator password (leave empty to generate): " workbench_password
echo
if [[ -z "$workbench_password" ]]; then
  workbench_password="$(openssl rand -base64 24 | tr -d '\n')"
  workbench_password_generated=true
fi
require_password WORKBENCH_ADMIN_PASSWORD "$workbench_password"
[[ "$workbench_password" != "$pb_password" ]] \
  || { echo "Workbench and PocketBase passwords must be different." >&2; exit 1; }

read -r -p "Text LLM backend [gemini/qwen] (default gemini): " llm_backend
llm_backend="${llm_backend:-gemini}"
[[ "$llm_backend" == "gemini" || "$llm_backend" == "qwen" ]] \
  || { echo "Text LLM backend must be gemini or qwen." >&2; exit 1; }

read -r -s -p "Gemini API key (required when backend=gemini; otherwise optional): " gemini_key
echo
read -r -s -p "DashScope API key (required when backend=qwen; also enables Qwen TTS): " dashscope_key
echo
read -r -s -p "MiniMax API key (required for TTS when DashScope is empty; otherwise optional fallback): " minimax_key
echo

if [[ "$llm_backend" == "gemini" ]]; then require_provider_key GEMINI_API_KEY "$gemini_key";
else require_provider_key DASHSCOPE_API_KEY "$dashscope_key";
fi
if [[ -z "$dashscope_key" && -z "$minimax_key" ]]; then
  echo "Production Studio TTS requires a DashScope or MiniMax API key." >&2
  exit 1
fi
[[ -z "$dashscope_key" ]] || require_provider_key DASHSCOPE_API_KEY "$dashscope_key"
[[ -z "$minimax_key" ]] || require_provider_key MINIMAX_API_KEY "$minimax_key"

read -r -s -p "Seedance API key (optional): " seedance_key
echo
read -r -p "YouTube OAuth Client ID (optional): " youtube_oauth_client_id
read -r -s -p "YouTube OAuth Client Secret (optional): " youtube_oauth_client_secret
echo
read -r -p "Meta App ID (optional): " meta_social_app_id
read -r -s -p "Meta App Secret (optional): " meta_social_app_secret
echo
read -r -p "TikTok Client Key (optional): " tiktok_client_key
read -r -s -p "TikTok Client Secret (optional): " tiktok_client_secret
echo
for optional_pair in \
  "SEEDANCE_API_KEY:$seedance_key" \
  "YOUTUBE_OAUTH_CLIENT_ID:$youtube_oauth_client_id" \
  "YOUTUBE_OAUTH_CLIENT_SECRET:$youtube_oauth_client_secret" \
  "META_SOCIAL_APP_ID:$meta_social_app_id" \
  "META_SOCIAL_APP_SECRET:$meta_social_app_secret" \
  "TIKTOK_CLIENT_KEY:$tiktok_client_key" \
  "TIKTOK_CLIENT_SECRET:$tiktok_client_secret"; do
  optional_name="${optional_pair%%:*}"
  optional_value="${optional_pair#*:}"
  [[ -z "$optional_value" ]] || require_safe_env_value "$optional_name" "$optional_value"
done

read -r -p "PocketBase external volume name [lingshu-production-pb-data]: " pb_volume_name
pb_volume_name="${pb_volume_name:-lingshu-production-pb-data}"
read -r -p "Application-data external volume name [lingshu-production-app-data]: " app_volume_name
app_volume_name="${app_volume_name:-lingshu-production-app-data}"
for volume_name in "$pb_volume_name" "$app_volume_name"; do
  [[ "$volume_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]+$ ]] \
    || { echo "Docker volume names may contain only letters, digits, dot, underscore, and hyphen." >&2; exit 1; }
done
[[ "$pb_volume_name" != "$app_volume_name" ]] \
  || { echo "PocketBase and application data must use different volumes." >&2; exit 1; }

render_secret="$(openssl rand -hex 32)"
asset_access_secret="$(openssl rand -hex 32)"
tenant_platform_app_key="$(openssl rand -hex 32)"
credential_encryption_key="hex:$(openssl rand -hex 32)"
registration_credential_key="$(openssl rand -hex 32)"
support_access_secret="$(openssl rand -hex 32)"
crawl_worker_token="$(openssl rand -hex 32)"
metrics_token="$(openssl rand -hex 32)"

production_env_dir="$(dirname "$production_env_file")"
[[ -d "$production_env_dir" ]] || { echo "Production env directory does not exist: $production_env_dir" >&2; exit 1; }
env_tmp="$(mktemp "$production_env_dir/.env.production.tmp.XXXXXX")"
bootstrap_tmp=""
cleanup() {
  rm -f -- "$env_tmp"
  if [[ -n "$bootstrap_tmp" ]]; then rm -f -- "$bootstrap_tmp"; fi
}
trap cleanup EXIT

cat > "$env_tmp" <<EOF
# Generated by deploy/make-production-env.sh. Keep this file mode 0600.
APP_DOMAIN=${app_domain}
PUBLIC_BASE_URL=https://${app_domain}

PB_VERSION=0.39.9
PB_DATA_VOLUME_NAME=${pb_volume_name}
APP_DATA_VOLUME_NAME=${app_volume_name}
PB_ADMIN_EMAIL=${pb_email}
PB_ADMIN_PASSWORD=${pb_password}
WORKBENCH_ADMIN_EMAIL=${workbench_email}
WORKBENCH_ADMIN_PASSWORD=${workbench_password}
WORKBENCH_ADMIN_NAME=灵枢管理员

PORT=8788
PB_REQUEST_TIMEOUT_MS=5000
GRACEFUL_SHUTDOWN_TIMEOUT_MS=20000
TRUST_PROXY_HOPS=1
APP_DATA_ROOT=/app/data
APP_DATA_MIN_FREE_BYTES=536870912

RENDER_TOKEN_SECRET=${render_secret}
ASSET_ACCESS_SECRET=${asset_access_secret}
TENANT_PLATFORM_APP_KEY=${tenant_platform_app_key}
CREDENTIAL_ENCRYPTION_KEY=${credential_encryption_key}
REGISTRATION_CREDENTIAL_KEY=${registration_credential_key}
SUPPORT_ACCESS_SECRET=${support_access_secret}
CRAWL_WORKER_TOKEN=${crawl_worker_token}
CRAWL_WORKER_TOKEN_PREVIOUS=
METRICS_TOKEN=${metrics_token}
SUBSCRIPTION_ENFORCED=true
DISABLE_LOCAL_AUTH_FALLBACK=true
ENABLE_LOCAL_STORE_FALLBACK=false
ALLOW_NON_ATOMIC_DIGITAL_EMPLOYEE_STORE=false
DISABLE_DESKTOP_OPEN_OUTPUT=true
API_RATE_LIMIT_PER_MINUTE=600
AUTH_RATE_LIMIT_PER_MINUTE=30

OVERSEAS_LLM_BACKEND=${llm_backend}
GEMINI_API_KEY=${gemini_key}
DASHSCOPE_API_KEY=${dashscope_key}
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MINIMAX_API_KEY=${minimax_key}
MINIMAX_BASE_URL=https://api.minimax.io

DIGITAL_EMPLOYEE_VOICEOVER_MODE=required
DIGITAL_EMPLOYEE_TTS_PROVIDER=auto
DIGITAL_EMPLOYEE_TTS_VOICE=v1
DIGITAL_EMPLOYEE_TTS_TIMEOUT_MS=90000
DIGITAL_EMPLOYEE_TTS_MAX_AUDIO_BYTES=15728640
DIGITAL_EMPLOYEE_TTS_MAX_DURATION_SECONDS=60
DIGITAL_EMPLOYEE_TTS_MAX_TEXT_CHARS=5000
DIGITAL_EMPLOYEE_TTS_CACHE_VERSION=1
STUDIO_TTS_MAX_AUDIO_BYTES=15728640
STUDIO_TTS_MAX_SUBTITLE_BYTES=1048576
STUDIO_TTS_ALLOW_LOCAL_FALLBACK=false
DASHSCOPE_TTS_AUDIO_HOST_SUFFIXES=aliyuncs.com
MINIMAX_TTS_ASSET_HOST_SUFFIXES=minimax.io,minimaxi.com,aliyuncs.com

SEEDANCE_API_KEY=${seedance_key}
SEEDANCE_VIDEO_ENABLED=false
SEEDANCE_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
SEEDANCE_MODEL=doubao-seedance-2-0-fast-260128

YOUTUBE_API_KEY=
YOUTUBE_OAUTH_CLIENT_ID=${youtube_oauth_client_id}
YOUTUBE_OAUTH_CLIENT_SECRET=${youtube_oauth_client_secret}
META_SOCIAL_APP_ID=${meta_social_app_id}
META_SOCIAL_APP_SECRET=${meta_social_app_secret}
META_GRAPH_VERSION=v25.0
WHATSAPP_PROVIDER_TIMEOUT_MS=30000
PROVIDER_HTTP_TIMEOUT_MS=30000
WHATSAPP_INBOUND_RECEIPT_LEASE_MS=1800000
TIKTOK_CLIENT_KEY=${tiktok_client_key}
TIKTOK_CLIENT_SECRET=${tiktok_client_secret}
TIKTOK_DIRECT_POST_AUDITED=false
ADVANCED_MANUAL_CONNECT_ENABLED=false

APIFY_TOKEN=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_REGION=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_BUCKET_NAME=
MATERIAL_SIGNED_URL_TTL_SECONDS=900

DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL=
DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS=
DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET=
DIGITAL_EMPLOYEE_EVENT_WEBHOOK_TIMEOUT_MS=5000
DIGITAL_EMPLOYEE_OUTBOX_MAX_ATTEMPTS=8
DIGITAL_EMPLOYEE_OUTBOX_POLL_MS=2000
DIGITAL_EMPLOYEE_OUTBOX_RECONCILE_MS=300000
DIGITAL_EMPLOYEE_OUTBOX_RECONCILE_MAX_RECORDS=250000
DIGITAL_EMPLOYEE_OUTBOX_MAX_BACKLOG=1000
DIGITAL_EMPLOYEE_OUTBOX_MAX_AGE_SECONDS=300
DISABLE_DIGITAL_EMPLOYEE_WORKER=false
DIGITAL_EMPLOYEE_RUN_LEASE_MS=45000
DIGITAL_EMPLOYEE_TASK_LEASE_MS=30000
DIGITAL_EMPLOYEE_TASK_TIMEOUT_MS=120000
DIGITAL_EMPLOYEE_HANDOFF_SAGA_STALE_MS=15000
DIGITAL_EMPLOYEE_RENDER_TASK_TIMEOUT_MS=600000
RENDER_INLINE_ASSET_MAX_BYTES=26214400
RENDER_INLINE_TOTAL_MAX_BYTES=78643200
DIGITAL_EMPLOYEE_RENDER_MAX_ASSET_BYTES=26214400
DIGITAL_EMPLOYEE_RENDER_MAX_TOTAL_BYTES=78643200
DIGITAL_EMPLOYEE_RENDER_MAX_OUTPUT_BYTES=536870912
PUBLISH_SCHEDULER_ENABLED=true
PUBLISH_SCHEDULER_LEASE_MS=900000
PUBLISH_ACCOUNT_TIMEOUT_MS=600000
DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED=false
EOF

chmod 600 "$env_tmp"
[[ -x "$ROOT_DIR/node_modules/.bin/tsx" ]] || {
  echo "node_modules/.bin/tsx is required for production validation; run npm ci first." >&2
  exit 1
}
command -v docker >/dev/null 2>&1 || { echo "docker is required for Compose validation." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "the Docker Compose plugin is required." >&2; exit 1; }

VALIDATE_ENV_FILE="$env_tmp" "$ROOT_DIR/node_modules/.bin/tsx" -e '
  import fs from "node:fs";
  import dotenv from "dotenv";
  import { validateProductionConfiguration } from "./server/ops/productionConfig.ts";
  const parsed = dotenv.parse(fs.readFileSync(process.env.VALIDATE_ENV_FILE || ""));
  const result = validateProductionConfiguration({ ...parsed, NODE_ENV: "production" });
  if (!result.ok) {
    console.error(`Production configuration rejected: ${result.issues.map(issue => `${issue.name}:${issue.reason}`).join(", ")}`);
    process.exit(1);
  }
'
ENV_FILE_PATH="$env_tmp" docker compose --env-file "$env_tmp" config --quiet

if [[ "$pb_password_generated" == "true" || "$workbench_password_generated" == "true" ]]; then
  bootstrap_secrets_dir="$(dirname "$bootstrap_secrets_file")"
  [[ -d "$bootstrap_secrets_dir" ]] || { echo "Bootstrap secrets directory does not exist: $bootstrap_secrets_dir" >&2; exit 1; }
  bootstrap_tmp="$(mktemp "$bootstrap_secrets_dir/.bootstrap-secrets.tmp.XXXXXX")"
  {
    printf '# One-time bootstrap credentials. Transfer to the approved password manager, then securely delete this file.\n'
    if [[ "$pb_password_generated" == "true" ]]; then
      printf 'PB_ADMIN_EMAIL=%s\nPB_ADMIN_PASSWORD=%s\n' "$pb_email" "$pb_password"
    fi
    if [[ "$workbench_password_generated" == "true" ]]; then
      printf 'WORKBENCH_ADMIN_EMAIL=%s\nWORKBENCH_ADMIN_PASSWORD=%s\n' "$workbench_email" "$workbench_password"
    fi
  } > "$bootstrap_tmp"
  chmod 600 "$bootstrap_tmp"
  mv -- "$bootstrap_tmp" "$bootstrap_secrets_file"
  bootstrap_tmp=""
fi
mv -f -- "$env_tmp" "$production_env_file"
trap - EXIT

echo
echo "Production validator and Docker Compose configuration checks passed."
echo "$production_env_file created with mode 0600."
echo "Create the named external volumes before any explicitly authorized start:"
echo "  docker volume create $pb_volume_name"
echo "  docker volume create $app_volume_name"
if [[ "$pb_password_generated" == "true" || "$workbench_password_generated" == "true" ]]; then
  echo "Generated bootstrap credentials were written to $bootstrap_secrets_file with mode 0600."
  echo "This is a one-time handoff file: transfer it to the approved password manager, verify the entries, then securely delete it."
  echo "No generated password was printed to the terminal."
fi
echo "No service was built, started, migrated, or deployed."
