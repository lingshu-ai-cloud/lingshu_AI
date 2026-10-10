#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT_DIR"

if [ -f .env.production ]; then
  read -r -p ".env.production already exists. Overwrite it? Type yes to continue: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Canceled."
    exit 0
  fi
fi

read -r -p "Customer app domain, for example app.example.com: " app_domain
read -r -p "PocketBase admin email: " pb_email

read -r -s -p "PocketBase admin password. Leave empty to generate one: " pb_password
echo
if [ -z "$pb_password" ]; then
  pb_password="$(openssl rand -base64 24 | tr -d '\n')"
fi

read -r -p "Workbench administrator email: " workbench_admin_email
read -r -s -p "Workbench administrator password. Leave empty to generate one: " workbench_admin_password
echo
if [ -z "$workbench_admin_password" ]; then
  workbench_admin_password="$(openssl rand -base64 24 | tr -d '\n')"
fi

[[ "$app_domain" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "A valid app domain is required." >&2; exit 1; }
[[ "$pb_email" == *@* && "$workbench_admin_email" == *@* ]] || { echo "Valid PocketBase and workbench administrator emails are required." >&2; exit 1; }
[[ "$(printf '%s' "$pb_email" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$workbench_admin_email" | tr '[:upper:]' '[:lower:]')" ]] || {
  echo "PocketBase and workbench administrator emails must be different." >&2
  exit 1
}
volume_slug="$(printf '%s' "$app_domain" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-80)"
[[ -n "$volume_slug" ]] || { echo "Could not derive a PocketBase volume name from the app domain." >&2; exit 1; }
pb_data_volume_name="lingshu-${volume_slug}-pb-data"
pb_data_volume_owner="lingshu-install-$(openssl rand -hex 16)"

read -r -p "Gemini API key. Leave empty if unused (optional visual/auxiliary provider): " gemini_key
read -r -p "DashScope API key (required by core Qwen workflows): " dashscope_key
[[ -n "$dashscope_key" ]] || {
  echo "DashScope is required because customer replies, knowledge retrieval and Studio core workflows currently use Qwen." >&2
  exit 1
}
overseas_llm_backend="qwen"
read -r -p "Seedance API key. Leave empty if unused: " seedance_key
read -r -p "YouTube OAuth Client ID. Leave empty if unused: " youtube_oauth_client_id
read -r -s -p "YouTube OAuth Client Secret. Leave empty if unused: " youtube_oauth_client_secret
echo
read -r -p "Meta App ID. Leave empty if unused: " meta_social_app_id
read -r -s -p "Meta App Secret. Leave empty if unused: " meta_social_app_secret
echo
read -r -p "TikTok Client Key. Leave empty if unused: " tiktok_client_key
read -r -s -p "TikTok Client Secret. Leave empty if unused: " tiktok_client_secret
echo

render_secret="$(openssl rand -hex 32)"
tenant_platform_app_key="$(openssl rand -base64 32 | tr -d '\n')"
support_access_secret="$(openssl rand -base64 32 | tr -d '\n')"
asset_access_secret="$(openssl rand -base64 32 | tr -d '\n')"
oauth_state_secret="$(openssl rand -base64 32 | tr -d '\n')"
product_api_key_pepper="$(openssl rand -base64 48 | tr -d '\n')"

cat > .env.production <<EOF
APP_DOMAIN=${app_domain}
PUBLIC_BASE_URL=https://${app_domain}

PB_VERSION=0.39.5
PB_DATA_VOLUME_NAME=${pb_data_volume_name}
PB_DATA_VOLUME_OWNER=${pb_data_volume_owner}
PB_ADMIN_EMAIL=${pb_email}
PB_ADMIN_PASSWORD=${pb_password}
WORKBENCH_ADMIN_EMAIL=${workbench_admin_email}
WORKBENCH_ADMIN_PASSWORD=${workbench_admin_password}
WORKBENCH_ADMIN_NAME=灵枢管理员

PORT=8788
APP_HOST_PORT=18788
PROCESS_ROLE_SPLIT_ENABLED=true
PROCESS_ROLE=all
RENDER_TOKEN_SECRET=${render_secret}
TENANT_PLATFORM_APP_KEY=${tenant_platform_app_key}
SUPPORT_ACCESS_SECRET=${support_access_secret}
SUPPORT_ACCESS_TTL_MINUTES=30
ASSET_ACCESS_SECRET=${asset_access_secret}
OAUTH_STATE_SECRET=${oauth_state_secret}
# Dedicated HMAC pepper for Product API bearer keys. Rotating this value
# invalidates every issued Product API key, so keep it in the secret manager.
PRODUCT_API_KEY_PEPPER=${product_api_key_pepper}
# The current 198 release has no self-service purchase activation flow. Keep
# the legacy subscription wall disabled until entitlement issuance is live.
SUBSCRIPTION_ENFORCED=false
DISABLE_LOCAL_AUTH_FALLBACK=true
ENABLE_LOCAL_DEV_FALLBACK=false
PB_AUTH_CACHE_TTL_MS=5000
PB_REQUEST_TIMEOUT_MS=10000
RUNTIME_SCHEMA_REPAIR_ENABLED=false
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_REQUESTS=300
TRUST_PROXY_HOPS=1
LEGACY_JSON_UPLOAD_LIMIT_MB=32
VOICE_JSON_UPLOAD_LIMIT_MB=24
READINESS_CACHE_TTL_MS=2000
# The installer configures a text model plus the platform credential key.
# Append optional sold capabilities only after their providers/workers pass
# acceptance; otherwise a fresh base install could never become ready.
REQUIRED_CAPABILITIES=text_generation,qwen_generation,platform_ads

GEMINI_API_KEY=${gemini_key}

OVERSEAS_LLM_BACKEND=${overseas_llm_backend}
DASHSCOPE_API_KEY=${dashscope_key}
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

SEEDANCE_API_KEY=${seedance_key}
SEEDREAM_API_KEY=${seedance_key}
SEEDREAM_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEEDREAM_IMAGE_MODEL=doubao-seedream-5-0-pro-260628
SEEDREAM_FIRST_FRAME_ESTIMATED_CNY=0.22
SEEDANCE_VIDEO_ENABLED=false
SEEDANCE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
SEEDANCE_MODEL=doubao-seedance-2-0-fast-260128
SEEDANCE_REFERENCE_ENABLED=false
SEEDANCE_SENTENCE_ENABLED=false
DIGITAL_HUMAN_MAX_FIRST_FRAMES_PER_VIDEO=3
DIGITAL_HUMAN_FIRST_FRAME_BUDGET_CNY=2
DIGITAL_HUMAN_SEMANTIC_QA_ENABLED=false
QWEN_DIGITAL_HUMAN_QA_MODEL=qwen3-vl-flash
QWEN_FIRST_FRAME_ESTIMATED_CNY=0.22
SEEDANCE_REFERENCE_ESTIMATED_CNY_PER_SECOND=
SEEDANCE_REFERENCE_RESOLUTION=720p
SEEDANCE_REFERENCE_GENERATE_AUDIO=true
SEEDANCE_CNY_PER_1K_TOKENS=

YOUTUBE_API_KEY=
YOUTUBE_OAUTH_CLIENT_ID=${youtube_oauth_client_id}
YOUTUBE_OAUTH_CLIENT_SECRET=${youtube_oauth_client_secret}

META_SOCIAL_APP_ID=${meta_social_app_id}
META_SOCIAL_APP_SECRET=${meta_social_app_secret}

TIKTOK_CLIENT_KEY=${tiktok_client_key}
TIKTOK_CLIENT_SECRET=${tiktok_client_secret}

ADVANCED_MANUAL_CONNECT_ENABLED=false
# Legacy official-account scheduler stays off unless a designated worker is
# enabled after the durable_operation_leases migration and provider rehearsal.
PUBLISH_SCHEDULER_ENABLED=false
PUBLISH_SCHEDULER_LEASE_MS=1800000
LEGACY_EXTERNAL_EFFECT_LEASE_MS=1800000
STARTER_RUN_MUTATION_LEASE_MS=300000
# 默认关闭。完成 starter migrations 与 PB 依赖检查后，仅在指定消费实例开启；
# 跨进程 CAS fencing 完成前不要在多个副本同时开启。
STARTER_198_ORCHESTRATOR_WORKER_ENABLED=false
STARTER_198_ORCHESTRATOR_WORKER_INTERVAL_MS=30000
STARTER_198_ORCHESTRATOR_WORKER_MAX_RUNS=20
# 默认保持关闭。完成 starter migrations、PB 依赖和持久化发布目录检查后，
# 仅在指定的单一消费实例将所需开关显式改为 true。
STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED=false
STARTER_PUBLICATION_PACKAGE_WORKER_INTERVAL_MS=15000
STARTER_PUBLICATION_PACKAGE_WORKER_LEASE_MS=1800000
STARTER_QUOTE_ARTIFACT_WORKER_ENABLED=false
STARTER_QUOTE_ARTIFACT_WORKER_INTERVAL_MS=30000
STARTER_QUOTE_ARTIFACT_WORKER_MAX_DRAFTS=100
STARTER_QUOTE_ARTIFACT_WORKER_MAX_TENANTS=100
QUOTE_SKILL_ENABLED=false
QUOTE_SKILL_TENANT_ALLOWLIST=
HEYGEN_GENERATION_ENABLED=false
APIFY_TOKEN=
R2_PUBLIC_URL=
EOF

chmod 600 .env.production

echo
echo ".env.production created."
echo "PocketBase admin email: ${pb_email}"
echo "PocketBase and workbench administrator passwords were written only to .env.production (mode 0600); they are not echoed to terminal logs."
echo "Move production secrets to your approved secret manager before deployment."
