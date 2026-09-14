#!/usr/bin/env bash
set -euo pipefail

if [ -f .env.production ]; then
  read -r -p ".env.production already exists. Overwrite it? Type yes to continue: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Canceled."
    exit 0
  fi
fi

read -r -p "Customer app domain, for example app.example.com: " app_domain
read -r -p "PocketBase admin domain, for example pb.example.com: " pb_domain
read -r -p "PocketBase admin email: " pb_email

read -r -s -p "PocketBase admin password. Leave empty to generate one: " pb_password
echo
if [ -z "$pb_password" ]; then
  pb_password="$(openssl rand -base64 24 | tr -d '\n')"
fi

read -r -p "Gemini API key. Leave empty if you will use Qwen/DashScope: " gemini_key
read -r -p "DashScope API key. Leave empty if unused: " dashscope_key
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
PB_DOMAIN=${pb_domain}
PUBLIC_BASE_URL=https://${app_domain}

PB_VERSION=0.39.5
PB_ADMIN_EMAIL=${pb_email}
PB_ADMIN_PASSWORD=${pb_password}

PORT=8788
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

GEMINI_API_KEY=${gemini_key}

# If using Qwen / DashScope, uncomment OVERSEAS_LLM_BACKEND.
# OVERSEAS_LLM_BACKEND=qwen
DASHSCOPE_API_KEY=${dashscope_key}
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

SEEDANCE_API_KEY=${seedance_key}
SEEDANCE_VIDEO_ENABLED=false
SEEDANCE_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
SEEDANCE_MODEL=doubao-seedance-2-0-fast-260128

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
APIFY_TOKEN=
R2_PUBLIC_URL=
EOF

chmod 600 .env.production

echo
echo ".env.production created."
echo "PocketBase admin email: ${pb_email}"
echo "PocketBase admin password was written only to .env.production (mode 0600); it is not echoed to terminal logs."
echo "Move production secrets to your approved secret manager before deployment."
