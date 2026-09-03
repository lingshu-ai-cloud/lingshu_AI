/**
 * Idempotent PocketBase provisioning for the overseas-workbench backend.
 *
 * Creates the collections the app reads/writes and ensures `users.tenantId`
 * exists (the multi-tenant auth field). Safe to re-run: existing collections
 * and fields are left untouched.
 *
 * Usage:  npx tsx scripts/setup-pb.ts
 * Reads PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD from .env.
 *
 * This is the single source of truth for the overseas PB schema — run it
 * against any fresh instance (local dev OR the Singapore cloud deploy).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  CANONICAL_COLLECTIONS,
  CANONICAL_INDEXES,
  ORGANIZATION_ROLE_VALUES,
  mergeCanonicalCollections,
  validateCanonicalPocketBaseSchema,
} from '../server/storage/canonicalSchema.js';
import { DELIVERY_COLLECTION_SPECS } from '../server/storage/ensureDeliveryCollections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PB_URL = (process.env.PB_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';
const WORKBENCH_ADMIN_EMAIL = String(process.env.WORKBENCH_ADMIN_EMAIL ?? '').trim().toLowerCase();
const WORKBENCH_ADMIN_PASSWORD = String(process.env.WORKBENCH_ADMIN_PASSWORD ?? '');
const WORKBENCH_ADMIN_NAME = String(process.env.WORKBENCH_ADMIN_NAME ?? '灵枢管理员').trim() || '灵枢管理员';

type Field = { name: string; type: string; required?: boolean; [k: string]: unknown };

/** Collection definitions, derived from what the route handlers write/read. */
const BASE_COLLECTIONS: { name: string; fields: Field[] }[] = [
  {
    name: 'assistant_threads',
    fields: [
      { name: 'tenantId', type: 'text', required: true },
      { name: 'agentId', type: 'text', required: true },
      { name: 'messages', type: 'json', maxSize: 2000000 },
      { name: 'draftInput', type: 'text', max: 200000 },
      { name: 'scrollPosition', type: 'number' },
      { name: 'unreadCount', type: 'number' },
      { name: 'updatedAt', type: 'text' },
    ],
  },
  {
    name: 'studio_projects',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'legacy_id', type: 'text' },
      { name: 'title', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'spec', type: 'json', maxSize: 2000000 },
      { name: 'thumb_seed', type: 'text' },
      { name: 'created_at', type: 'text' },
      { name: 'updated_at', type: 'text' },
    ],
  },
  {
    // 租户（按公司订阅）；subscription.ts 读这几个字段
    name: 'tenants',
    fields: [
      { name: 'name', type: 'text' },
      { name: 'companyName', type: 'text' },
      { name: 'contactName', type: 'text' },
      { name: 'contact', type: 'text' },
      { name: 'industry', type: 'text' },
      { name: 'notes', type: 'text' },
      { name: 'inviteCode', type: 'text' },
      { name: 'registrationInviteCode', type: 'text' },
      { name: 'registeredEmail', type: 'text' },
      { name: 'registeredAt', type: 'text' },
      { name: 'registrationClaimToken', type: 'text' },
      { name: 'registrationClaimedAt', type: 'text' },
      { name: 'registrationClaimEmail', type: 'text' },
      { name: 'subscriptionStatus', type: 'text' },     // active/trialing/past_due/canceled/expired/none
      { name: 'subscriptionPlan', type: 'text' },
      { name: 'subscriptionExpiresAt', type: 'text' },  // ISO；空=不过期
      { name: 'createdAt', type: 'text' },
    ],
  },
  {
    name: 'trend_videos',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'platform', type: 'text' },
      { name: 'title', type: 'text' },
      { name: 'thumbnailUrl', type: 'text' },
      { name: 'videoFileId', type: 'text' },
      { name: 'duration', type: 'number' },
      { name: 'sourceUrl', type: 'text' },
      { name: 'tags', type: 'text' },
      { name: 'aiAnalysis', type: 'text', max: 1000000 },
      { name: 'status', type: 'text' },
      { name: 'crawledAt', type: 'text' },
      // The raw video blob — stored on PB disk, not in the SQLite row.
      { name: 'videoFile', type: 'file', maxSelect: 1, maxSize: 104857600 },
      // 封面同样跟着记录走。此前封面只落在各自代码副本的 data/media/ 里，
      // 而 PocketBase 是共用的，换一份工作目录跑就会让所有 /media/*.thumb.jpg 变 404。
      { name: 'thumbnailFile', type: 'file', maxSelect: 1, maxSize: 5242880, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
      { name: 'contentFormat', type: 'select', values: ['video', 'image'] },
    ],
  },
  {
    // Shared, licensed production footage used by the AI material picker.
    // Keep the schema in the normal bootstrap path so a fresh production
    // PocketBase does not come up with an empty material library.
    name: 'materials',
    fields: [
      // 私有素材归属；历史共享素材可为空，因此不能设 required。
      { name: 'tenantId', type: 'text' },
      { name: 'title', type: 'text', required: true },
      { name: 'folder', type: 'text', required: true },
      { name: 'type', type: 'text', required: true },
      { name: 'duration', type: 'number' },
      { name: 'width', type: 'number' },
      { name: 'height', type: 'number' },
      { name: 'sizeBytes', type: 'number' },
      { name: 'sha256', type: 'text', required: true },
      { name: 'tags', type: 'text' },
      { name: 'industry', type: 'text' },
      { name: 'shotFunction', type: 'text' },
      { name: 'applicability', type: 'text' },
      { name: 'scope', type: 'text', required: true },
      { name: 'usage', type: 'text', required: true },
      { name: 'sourceType', type: 'text' },
      { name: 'sourceName', type: 'text' },
      { name: 'videoFile', type: 'file', required: true, maxSelect: 1, maxSize: 104857600 },
      { name: 'posterFile', type: 'file', required: true, maxSelect: 1, maxSize: 5242880 },
      // 分镜匹配所需：素材要先切成片段，才能与对标视频的分镜比对。
      // 缺这三个字段时云端素材永远进不了匹配池，可复制性恒为「弱」。
      { name: 'pinned', type: 'bool' },
      { name: 'segmentAnalysisStatus', type: 'text' },
      { name: 'segmentAnalysisError', type: 'text' },
      { name: 'segments', type: 'json', maxSize: 2000000 },
    ],
  },
  {
    name: 'scripts',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'userId', type: 'text' },
      { name: 'sourceVideoId', type: 'text' },
      { name: 'type', type: 'text' },
      { name: 'language', type: 'text' },
      { name: 'content', type: 'text' },
      { name: 'productInfo', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'createdAt', type: 'text' },
    ],
  },
  {
    name: 'generated_assets',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'scriptId', type: 'text' },
      { name: 'sceneIndex', type: 'number' },
      { name: 'type', type: 'text' },
      { name: 'fileId', type: 'text' },
      { name: 'prompt', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'createdAt', type: 'text' },
    ],
  },
  {
    name: 'daily_trends',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'date', type: 'text' },
      { name: 'videoIds', type: 'text' },
      { name: 'selectedIds', type: 'text' },
      { name: 'status', type: 'text' },
    ],
  },
  {
    name: 'tenant_profiles',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'profile', type: 'json', required: true },
      { name: 'updated_by', type: 'text' },
    ],
  },
  {
    name: 'style_memory',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'customer_id', type: 'text' },
      { name: 'trigger_message', type: 'text' },
      { name: 'draft_original', type: 'text' },
      { name: 'final_sent', type: 'text' },
      { name: 'edited', type: 'bool' },
      { name: 'category', type: 'text' },
      { name: 'outcome', type: 'text' },
      { name: 'strategy_ids', type: 'json' },
    ],
  },
  {
    name: 'response_strategy_memory',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'strategy_id', type: 'text', required: true },
      { name: 'adjustment', type: 'text' },
      { name: 'evidence_count', type: 'number' },
      // The historical PocketBase collection was created with a select field.
      // Keeping the bootstrap definition type-compatible is required because
      // PocketBase deliberately refuses in-place field type changes.
      { name: 'status', type: 'select', values: ['candidate', 'active', 'paused', 'archived'] },
      { name: 'source', type: 'text' },
      { name: 'scenario', type: 'text' },
      { name: 'signals', type: 'json' },
      { name: 'intent', type: 'text' },
      { name: 'strategy_steps', type: 'json' },
      { name: 'risk_link', type: 'text' },
      { name: 'escalate', type: 'text' },
    ],
  },
  {
    name: 'style_adoption_stats',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'week', type: 'text', required: true },
      { name: 'total', type: 'text' },
      { name: 'direct_sent', type: 'text' },
      { name: 'rate', type: 'text' },
    ],
  },
  {
    name: 'tenant_platform_apps',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'platform', type: 'text', required: true },
      { name: 'app_id', type: 'text' },
      { name: 'app_secret', type: 'text' },
      { name: 'wa_config_id', type: 'text' },
      { name: 'waba_id', type: 'text' },
      { name: 'phone_number_id', type: 'text' },
      { name: 'wa_public_number', type: 'text' },
      { name: 'webhook_verify_token', type: 'text' },
      { name: 'token_type', type: 'text' },
      { name: 'access_token', type: 'text' },
      { name: 'refresh_token', type: 'text' },
      { name: 'token_expires_at', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'last_checked_at', type: 'text' },
      { name: 'test_results', type: 'json' },
      { name: 'delivery_checklist', type: 'json' },
      { name: 'notes', type: 'text' },
      { name: 'credential_version', type: 'text' },
      { name: 'credential_state', type: 'text' },
      { name: 'credential_revision', type: 'number' },
    ],
  },
  {
    name: 'tenant_orders',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'order_no', type: 'text', required: true },
      { name: 'order', type: 'json', required: true },
    ],
  },
  {
    name: 'tenant_api_keys',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'api_key_hash', type: 'text', max: 64 },
      { name: 'key_prefix', type: 'text', max: 32 },
      { name: 'key_last4', type: 'text', max: 4 },
      { name: 'created_at', type: 'text', required: true },
      { name: 'rotated_at', type: 'text' },
      { name: 'revoked_at', type: 'text' },
      { name: 'last_ingested_at', type: 'text' },
      { name: 'last_product_name', type: 'text' },
      { name: 'version', type: 'number', required: true },
    ],
  },
  {
    name: 'tenant_support_settings',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'default_authorized', type: 'bool', required: true },
      { name: 'updated_by', type: 'text' },
    ],
  },
  {
    name: 'support_access_requests',
    fields: [
      { name: 'request_id', type: 'text', required: true },
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'tenant_name', type: 'text' },
      { name: 'admin_user_id', type: 'text', required: true },
      { name: 'admin_email', type: 'text' },
      { name: 'status', type: 'text', required: true },
      { name: 'requested_at', type: 'text', required: true },
      { name: 'revoked_at', type: 'text' },
    ],
  },
  {
    name: 'audit_logs',
    fields: [
      { name: 'tenantId', type: 'text', required: true },
      { name: 'actorUserId', type: 'text', required: true },
      { name: 'actorEmail', type: 'text' },
      { name: 'action', type: 'text', required: true },
      { name: 'targetType', type: 'text' },
      { name: 'targetId', type: 'text' },
      { name: 'metadata', type: 'json' },
      { name: 'createdAt', type: 'text', required: true },
    ],
  },
  {
    name: 'scheduled_tasks',
    fields: [
      { name: 'task_id', type: 'text', required: true },
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'category', type: 'text' },
      { name: 'task_type', type: 'text', required: true },
      { name: 'cron_expr', type: 'text', required: true },
      { name: 'cron_label', type: 'text' },
      { name: 'enabled', type: 'bool' },
      { name: 'channel_id', type: 'text' },
      { name: 'config', type: 'json' },
      { name: 'last_run', type: 'text' },
      { name: 'last_result', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
    ],
  },
  {
    // Mac 登录态采集队列。云端只保存任务，Mac worker 经 SSH 隧道把
    // 抓取/下载/分析结果直接写回同一个 PocketBase。
    name: 'crawl_jobs',
    fields: [
      { name: 'tenantId', type: 'text', required: true },
      { name: 'requestedBy', type: 'text' },
      { name: 'platform', type: 'text', required: true },
      { name: 'mode', type: 'text', required: true },
      { name: 'keyword', type: 'text' },
      { name: 'accountUrl', type: 'text' },
      { name: 'accountName', type: 'text' },
      { name: 'limit', type: 'number' },
      { name: 'status', type: 'text', required: true },
      { name: 'workerId', type: 'text' },
      { name: 'attempts', type: 'number' },
      { name: 'resultJson', type: 'text', max: 2000000 },
      { name: 'error', type: 'text', max: 2000000 },
      { name: 'createdAt', type: 'text' },
      { name: 'updatedAt', type: 'text' },
      { name: 'leasedUntil', type: 'text' },
      { name: 'finishedAt', type: 'text' },
      { name: 'leaseToken', type: 'text' },
      { name: 'revision', type: 'number' },
    ],
  },
  {
    name: 'whatsapp_customers',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'customer_id', type: 'text', required: true },
      { name: 'wa_number', type: 'text' },
      { name: 'name', type: 'text' },
      { name: 'stage', type: 'text' },
      { name: 'last_active_at', type: 'number' },
      { name: 'payload', type: 'json', required: true },
    ],
  },
  {
    name: 'whatsapp_interactions',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'interaction_id', type: 'text', required: true },
      { name: 'customer_id', type: 'text', required: true },
      { name: 'wa_number', type: 'text' },
      { name: 'timestamp', type: 'number' },
      { name: 'payload', type: 'json', required: true },
    ],
  },
  {
    name: 'posts',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'content_id', type: 'text' },
      { name: 'platform', type: 'text', required: true },
      { name: 'platform_post_id', type: 'text' },
      { name: 'title', type: 'text' },
      { name: 'published_at', type: 'text' },
      { name: 'track_code', type: 'text', required: true },
      { name: 'wa_link', type: 'text' },
      { name: 'stats', type: 'json' },
      { name: 'inquiries', type: 'number' },
      { name: 'deals', type: 'number' },
    ],
  },
  {
    // 对标账号库：灵感大屏「爬取对标账号主页视频」功能读写这里
    name: 'competitor_accounts',
    fields: [
      { name: 'tenantId', type: 'text' },
      { name: 'platform', type: 'text' },          // youtube / tiktok
      { name: 'accountUrl', type: 'text' },         // 主页 URL（规范化后）
      { name: 'accountName', type: 'text' },        // 展示名
      { name: 'handle', type: 'text' },             // @handle / channel id
      { name: 'avatarUrl', type: 'text' },
      { name: 'note', type: 'text' },
      { name: 'lastCrawledAt', type: 'text' },      // ISO
      { name: 'lastCrawlCount', type: 'number' },
      { name: 'createdAt', type: 'text' },
    ],
  },
  {
    name: 'digital_employee_configs',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'config', type: 'json', required: true, maxSize: 262144 },
      { name: 'status', type: 'text', required: true },
      { name: 'updated_by', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
  },
  {
    name: 'weekly_goals',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'title', type: 'text', required: true },
      { name: 'objective', type: 'text', required: true, max: 5000 },
      { name: 'metric', type: 'text', required: true },
      { name: 'baseline', type: 'number' },
      { name: 'target', type: 'number', required: true },
      { name: 'unit', type: 'text' },
      { name: 'starts_at', type: 'text', required: true },
      { name: 'ends_at', type: 'text', required: true },
      { name: 'scope', type: 'json', maxSize: 65536 },
      { name: 'budget_limit', type: 'number' },
      { name: 'constraints', type: 'json', maxSize: 65536 },
      { name: 'owner_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'version', type: 'number', required: true },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
  },
  {
    name: 'weekly_plans',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'goal_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'plan', type: 'json', required: true, maxSize: 524288 },
      { name: 'created_at', type: 'text', required: true },
    ],
  },
  {
    name: 'execution_contracts',
    fields: [
      { name: 'tenant_id', type: 'text', required: true }, { name: 'goal_id', type: 'text', required: true },
      { name: 'goal_version', type: 'number', required: true }, { name: 'version', type: 'number', required: true },
      { name: 'status', type: 'text', required: true }, { name: 'payload_hash', type: 'text', required: true },
      { name: 'source_fingerprint', type: 'text', required: true }, { name: 'contract', type: 'json', required: true, maxSize: 1048576 },
      { name: 'confirmed_by', type: 'text' }, { name: 'compiled_at', type: 'text', required: true },
      { name: 'confirmed_at', type: 'text' }, { name: 'invalidated_at', type: 'text' },
    ],
  },
  {
    name: 'workflow_runs',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'goal_id', type: 'text', required: true },
      { name: 'plan_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'current_controller', type: 'text' },
      { name: 'pause_reason', type: 'text' },
      { name: 'budget_limit', type: 'number' },
      { name: 'budget_spent', type: 'number' },
      { name: 'execution_snapshot', type: 'json', maxSize: 524288 },
      { name: 'idempotency_key', type: 'text' },
      { name: 'available_at', type: 'text' },
      { name: 'lease_owner', type: 'text' },
      { name: 'lease_expires_at', type: 'text' },
      { name: 'started_at', type: 'text', required: true },
      { name: 'completed_at', type: 'text' },
    ],
  },
  {
    name: 'workflow_tasks',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'goal_id', type: 'text', required: true },
      { name: 'plan_id', type: 'text', required: true },
      { name: 'run_id', type: 'text', required: true },
      { name: 'task_key', type: 'text', required: true },
      { name: 'title', type: 'text', required: true },
      { name: 'description', type: 'text', max: 5000 },
      { name: 'agent_role', type: 'text', required: true },
      { name: 'kind', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'sequence', type: 'number', required: true },
      { name: 'priority', type: 'text' },
      { name: 'requires_approval', type: 'bool' },
      { name: 'depends_on', type: 'json', maxSize: 65536 },
      { name: 'output', type: 'json', maxSize: 524288 },
      { name: 'blocked_reason', type: 'text' },
      { name: 'owner_id', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
      { name: 'attempt', type: 'number' },
      { name: 'max_attempts', type: 'number' },
      { name: 'available_at', type: 'text' },
      { name: 'lease_owner', type: 'text' },
      { name: 'lease_expires_at', type: 'text' },
      { name: 'started_at', type: 'text' },
      { name: 'completed_at', type: 'text' },
      { name: 'error_code', type: 'text' },
      { name: 'error_detail', type: 'text', max: 5000 },
      { name: 'idempotency_key', type: 'text' },
      { name: 'actual_cost', type: 'number' },
    ],
  },
  {
    name: 'run_events',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'run_id', type: 'text', required: true },
      { name: 'task_id', type: 'text' },
      { name: 'sequence', type: 'number', required: true },
      { name: 'type', type: 'text', required: true },
      { name: 'level', type: 'text', required: true },
      { name: 'summary', type: 'text', required: true, max: 5000 },
      { name: 'payload', type: 'json', maxSize: 524288 },
      { name: 'occurred_at', type: 'text', required: true },
    ],
  },
  {
    name: 'approval_requests',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'goal_id', type: 'text', required: true },
      { name: 'run_id', type: 'text', required: true },
      { name: 'task_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'action_summary', type: 'text', required: true, max: 5000 },
      { name: 'risk_level', type: 'text', required: true },
      { name: 'evidence', type: 'json', maxSize: 524288 },
      { name: 'requested_by_agent', type: 'text' },
      { name: 'decided_by', type: 'text' },
      { name: 'decision_note', type: 'text', max: 5000 },
      { name: 'created_at', type: 'text', required: true },
      { name: 'decided_at', type: 'text' },
      { name: 'owner_id', type: 'text', required: true },
      { name: 'action_version', type: 'number', required: true },
      { name: 'payload_hash', type: 'text', required: true },
      { name: 'action_payload', type: 'json', maxSize: 524288 },
      { name: 'target_account', type: 'text' },
      { name: 'scheduled_at', type: 'text' },
      { name: 'estimated_cost', type: 'number' },
      { name: 'reversibility', type: 'text' },
      { name: 'expires_at', type: 'text' },
      { name: 'next_step', type: 'text' },
    ],
  },
  {
    name: 'handoff_sessions',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'run_id', type: 'text', required: true },
      { name: 'task_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'taken_by', type: 'text', required: true },
      { name: 'snapshot', type: 'json', required: true, maxSize: 524288 },
      { name: 'started_at', type: 'text', required: true },
      { name: 'returned_at', type: 'text' },
    ],
  },
  {
    name: 'weekly_reviews',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'goal_id', type: 'text', required: true },
      { name: 'run_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'summary', type: 'json', required: true, maxSize: 524288 },
      { name: 'created_at', type: 'text', required: true },
    ],
  },
  {
    name: 'digital_employee_outbox',
    fields: [
      { name: 'tenant_id', type: 'text', required: true }, { name: 'run_id', type: 'text', required: true },
      { name: 'event_id', type: 'text', required: true }, { name: 'sequence', type: 'number', required: true },
      { name: 'topic', type: 'text', required: true }, { name: 'payload', type: 'json', required: true, maxSize: 524288 },
      { name: 'status', type: 'text', required: true }, { name: 'attempt', type: 'number' },
      { name: 'available_at', type: 'text' }, { name: 'created_at', type: 'text', required: true }, { name: 'delivered_at', type: 'text' },
    ],
  },
  {
    name: 'outbound_action_ledger',
    fields: [
      { name: 'tenant_id', type: 'text', required: true }, { name: 'run_id', type: 'text', required: true }, { name: 'task_id', type: 'text', required: true },
      { name: 'action_type', type: 'text', required: true }, { name: 'status', type: 'text', required: true }, { name: 'idempotency_key', type: 'text', required: true },
      { name: 'approved_payload_hash', type: 'text' }, { name: 'external_record_id', type: 'text' }, { name: 'reason', type: 'text', max: 5000 },
      { name: 'created_at', type: 'text', required: true }, { name: 'updated_at', type: 'text', required: true },
    ],
  },
];

// The canonical module is the effective source of truth. Existing non-critical
// definitions above are retained for backwards-compatible bootstrap, while
// canonical fields replace same-name definitions and add required fields.
function mergeDeliveryCollections(base: typeof BASE_COLLECTIONS): typeof BASE_COLLECTIONS {
  const result = base.map(item => ({ ...item, fields: [...item.fields] }));
  for (const delivery of DELIVERY_COLLECTION_SPECS) {
    const fields = delivery.fields.map(field => ({ ...field }));
    const existing = result.find(item => item.name === delivery.name);
    if (!existing) {
      result.push({ name: delivery.name, fields });
      continue;
    }
    const byName = new Map(existing.fields.map(field => [field.name, field]));
    for (const field of fields) byName.set(field.name, field);
    existing.fields = [...byName.values()];
  }
  return result;
}

const COLLECTIONS = mergeCanonicalCollections(mergeDeliveryCollections(BASE_COLLECTIONS));
const PRODUCTION_INDEXES: Record<string, string[]> = Object.fromEntries(
  Object.entries(CANONICAL_INDEXES).map(([name, indexes]) => [name, [...indexes]]),
);

/** Auth as superuser; supports both new (_superusers) and legacy (admins) APIs. */
async function authToken(): Promise<string> {
  if (!EMAIL || !PASSWORD) {
    throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set in .env');
  }
  const body = JSON.stringify({ identity: EMAIL, password: PASSWORD });
  for (const p of [
    '/api/collections/_superusers/auth-with-password',
    '/api/admins/auth-with-password',
  ]) {
    const res = await fetch(`${PB_URL}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) {
      const json = (await res.json()) as { token?: string };
      if (json.token) return json.token;
    }
  }
  throw new Error('Superuser auth failed — check creds and PB version');
}

async function listCollections(token: string): Promise<Map<string, unknown>> {
  const res = await fetch(`${PB_URL}/api/collections?perPage=500`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`list collections failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { items?: { name: string }[] };
  return new Map((json.items ?? []).map((c) => [c.name, c]));
}

async function createCollection(token: string, name: string, fields: Field[]): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      name,
      type: 'base',
      fields: fields.map((f) => ({ ...f, required: f.required ?? false })),
      indexes: PRODUCTION_INDEXES[name] || [],
    }),
  });
  if (!res.ok) {
    throw new Error(`create ${name} failed: ${res.status} ${await res.text()}`);
  }
  console.log(`  ✓ created ${name}`);
}

async function ensureIndexes(token: string, name: string): Promise<void> {
  const wanted = PRODUCTION_INDEXES[name];
  if (!wanted?.length) return;
  const current = await fetch(`${PB_URL}/api/collections/${name}`, { headers: { Authorization: token } });
  if (!current.ok) throw new Error(`read ${name} indexes failed: ${current.status}`);
  const collection = await current.json() as { indexes?: string[] };
  const normalize = (value: string) => value.toLowerCase().replace(/[`";]/g, '').replace(/\s+/g, ' ').trim();
  const indexName = (value: string) => /\bindex\s+(?:if\s+not\s+exists\s+)?([^\s]+)/i.exec(value)?.[1]?.replace(/[`"]+/g, '').toLowerCase() || normalize(value);
  const wantedNames = new Set(wanted.map(indexName));
  const preserved = (collection.indexes || []).filter(index => !wantedNames.has(indexName(index)));
  const indexes = [...preserved, ...wanted];
  const currentNormalized = (collection.indexes || []).map(normalize).sort();
  const nextNormalized = indexes.map(normalize).sort();
  if (JSON.stringify(currentNormalized) === JSON.stringify(nextNormalized)) return;
  const updated = await fetch(`${PB_URL}/api/collections/${name}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify({ indexes }) });
  if (!updated.ok) throw new Error(`patch ${name} indexes failed: ${updated.status} ${await updated.text()}`);
  console.log(`  ✓ ${name}: indexes synchronized`);
}

/** Add missing fields and synchronize canonical field options idempotently. */
async function ensureFields(token: string, name: string, want: Field[]): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections/${name}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return;
  const col = (await res.json()) as { fields?: Field[]; schema?: Field[] };
  const key = col.fields ? 'fields' : 'schema';
  const currentFields = col.fields ?? col.schema ?? [];
  const wantedByName = new Map(want.map(field => [field.name, field]));
  const have = new Set(currentFields.map((field) => field.name));
  const missing = want.filter((field) => !have.has(field.name));
  const merged = currentFields.map((current) => {
    const wanted = wantedByName.get(current.name);
    if (!wanted) return current;
    return { ...current, ...wanted, required: wanted.required ?? false };
  }).concat(missing.map((field) => ({ ...field, required: field.required ?? false })));
  const relevant = (field: Field) => ({
    name: field.name,
    type: field.type,
    required: Boolean(field.required),
    hidden: Boolean(field.hidden),
    max: field.max,
    maxSize: field.maxSize,
    maxSelect: field.maxSelect,
    values: field.values,
  });
  const currentByName = new Map(currentFields.map(field => [field.name, relevant(field)]));
  const changed = want.some(wanted => JSON.stringify(currentByName.get(wanted.name)) !== JSON.stringify(relevant({
    ...(currentFields.find(field => field.name === wanted.name) || wanted),
    ...wanted,
    required: wanted.required ?? false,
  })));
  if (!missing.length && !changed) {
    console.log(`  = ${name} up to date`);
    return;
  }
  const up = await fetch(`${PB_URL}/api/collections/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ [key]: merged }),
  });
  if (!up.ok) throw new Error(`patch ${name} fields failed: ${up.status} ${await up.text()}`);
  console.log(`  ✓ ${name}: canonical fields synchronized${missing.length ? ` (added ${missing.map((field) => field.name).join(', ')})` : ''}`);
}

/** Ensure the users auth collection has tenant, role, and session-epoch fields. */
async function ensureUsersTenantId(token: string): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections/users`, {
    headers: { Authorization: token },
  });
  if (!res.ok) {
    console.log('  ! users collection not found — skipping tenantId');
    return;
  }
  const col = (await res.json()) as { fields?: { name: string }[]; schema?: { name: string }[] };
  const fields = col.fields ?? col.schema ?? [];
  const additions = [
    !fields.some((f) => f.name === 'tenantId') ? { name: 'tenantId', type: 'text', required: false } : null,
    !fields.some((f) => f.name === 'role') ? { name: 'role', type: 'select', required: false, maxSelect: 1, values: [...ORGANIZATION_ROLE_VALUES] } : null,
    !fields.some((f) => f.name === 'session_epoch') ? { name: 'session_epoch', type: 'number', required: false } : null,
  ].filter(Boolean);
  if (!additions.length) {
    console.log('  = users tenant/role fields already present');
    return;
  }
  const key = col.fields ? 'fields' : 'schema';
  const patch = {
    [key]: [...fields, ...additions],
  };
  const up = await fetch(`${PB_URL}/api/collections/users`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(patch),
  });
  if (!up.ok) throw new Error(`add users tenant/role fields failed: ${up.status} ${await up.text()}`);
  console.log('  ✓ added users tenant/role fields');
}

async function ensureUsersCollection(token: string, existing: Map<string, unknown>): Promise<void> {
  if (existing.has('users')) {
    await ensureUsersTenantId(token);
    return;
  }
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      name: 'users',
      type: 'auth',
      fields: [
        { name: 'name', type: 'text', required: false },
        { name: 'tenantId', type: 'text', required: true },
        { name: 'role', type: 'select', required: true, maxSelect: 1, values: [...ORGANIZATION_ROLE_VALUES] },
      ],
      passwordAuth: { enabled: true, identityFields: ['email'] },
    }),
  });
  if (!res.ok) throw new Error(`create users auth collection failed: ${res.status} ${await res.text()}`);
  console.log('  ✓ created users auth collection');
}

function filterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function findRecord(token: string, collection: string, filter: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${PB_URL}/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(filter)}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`find ${collection} failed: ${res.status} ${await res.text()}`);
  const body = await res.json() as { items?: Record<string, unknown>[] };
  return body.items?.[0] ?? null;
}

async function writeRecord(token: string, collection: string, id: string | null, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${PB_URL}/api/collections/${collection}/records${id ? `/${id}` : ''}`, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${id ? 'update' : 'create'} ${collection} failed: ${res.status} ${await res.text()}`);
  return await res.json() as Record<string, unknown>;
}

async function listAllRecords(token: string, collection: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const params = new URLSearchParams({ page: String(page), perPage: '200' });
    const res = await fetch(`${PB_URL}/api/collections/${collection}/records?${params}`, {
      headers: { Authorization: token },
    });
    if (!res.ok) throw new Error(`list ${collection} failed: ${res.status} ${await res.text()}`);
    const body = await res.json() as { items?: Record<string, unknown>[]; totalPages?: number };
    items.push(...(body.items ?? []));
    totalPages = Math.max(1, Number(body.totalPages || 1));
    page += 1;
  } while (page <= totalPages);
  return items;
}

async function migrateAndHardenUsers(token: string): Promise<void> {
  const [tenants, users] = await Promise.all([
    listAllRecords(token, 'tenants'),
    listAllRecords(token, 'users'),
  ]);
  const tenantByEmail = new Map<string, Record<string, unknown>>();
  for (const tenant of tenants) {
    const email = String(tenant.registeredEmail || '').trim().toLowerCase();
    if (!email) continue;
    if (tenantByEmail.has(email)) throw new Error(`duplicate tenants registeredEmail prevents safe user migration: ${email}`);
    tenantByEmail.set(email, tenant);
  }

  const validRoles = new Set<string>(ORGANIZATION_ROLE_VALUES);
  const tenantIds = new Set(tenants.map(tenant => String(tenant.id || '')).filter(Boolean));
  const plan = users.map(user => {
    const email = String(user.email || '').trim().toLowerCase();
    const registeredTenant = tenantByEmail.get(email);
    const currentTenantId = String(user.tenantId || '');
    const tenantId = String(registeredTenant?.id || (tenantIds.has(currentTenantId) ? currentTenantId : ''));
    if (!tenantId) throw new Error(`user ${email || user.id} has no tenantId and cannot be migrated safely`);
    const currentRole = String(user.role || '');
    const role = email === WORKBENCH_ADMIN_EMAIL || registeredTenant
      ? 'super_admin'
      : validRoles.has(currentRole)
        ? currentRole
        : 'customer_service';
    return { user, email, tenantId, role };
  });

  const superAdminsByTenant = new Map<string, string[]>();
  for (const item of plan) {
    if (item.role !== 'super_admin') continue;
    const list = superAdminsByTenant.get(item.tenantId) ?? [];
    list.push(item.email || String(item.user.id));
    superAdminsByTenant.set(item.tenantId, list);
  }
  for (const [tenantId, emails] of superAdminsByTenant) {
    if (emails.length > 1) throw new Error(`tenant ${tenantId} has multiple super_admin candidates: ${emails.join(', ')}`);
  }
  for (const [email, tenant] of tenantByEmail) {
    const tenantId = String(tenant.id || '');
    if (!plan.some(item => item.email === email && item.tenantId === tenantId && item.role === 'super_admin')) {
      throw new Error(`registered tenant ${tenantId} has no matching super_admin user: ${email}`);
    }
  }

  for (const item of plan) {
    if (String(item.user.tenantId || '') === item.tenantId && String(item.user.role || '') === item.role) continue;
    await writeRecord(token, 'users', String(item.user.id), { tenantId: item.tenantId, role: item.role });
  }

  const collectionRes = await fetch(`${PB_URL}/api/collections/users`, { headers: { Authorization: token } });
  if (!collectionRes.ok) throw new Error(`read users schema failed: ${collectionRes.status} ${await collectionRes.text()}`);
  const collection = await collectionRes.json() as { fields?: Field[]; schema?: Field[] };
  const key = collection.fields ? 'fields' : 'schema';
  const fields = collection.fields ?? collection.schema ?? [];
  const hardened = fields.map(current => {
    if (current.name === 'tenantId') return { ...current, type: 'text', required: true };
    if (current.name === 'role') return {
      ...current,
      type: 'select',
      required: true,
      maxSelect: 1,
      values: [...ORGANIZATION_ROLE_VALUES],
    };
    if (current.name === 'session_epoch') return { ...current, type: 'number', required: false };
    return current;
  });
  const schemaRes = await fetch(`${PB_URL}/api/collections/users`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ [key]: hardened }),
  });
  if (!schemaRes.ok) throw new Error(`harden users tenant/role schema failed: ${schemaRes.status} ${await schemaRes.text()}`);

  let scrubbed = 0;
  for (const tenant of tenants) {
    if (!String(tenant.registeredPasswordCipher || '')) continue;
    await writeRecord(token, 'tenants', String(tenant.id), { registeredPasswordCipher: '' });
    scrubbed += 1;
  }
  if (scrubbed) {
    console.warn(`  ! scrubbed recoverable registration credentials from ${scrubbed} tenants; force password reset per docs/credential-security-migration.md`);
  }
  console.log('  ✓ users tenantId/role migrated and hardened');
}

async function ensureWorkbenchAdmin(token: string): Promise<void> {
  if (!WORKBENCH_ADMIN_EMAIL && !WORKBENCH_ADMIN_PASSWORD) {
    if (process.env.NODE_ENV === 'production') throw new Error('WORKBENCH_ADMIN_EMAIL / WORKBENCH_ADMIN_PASSWORD are required in production');
    console.log('  ! workbench admin not configured — skipping');
    return;
  }
  if (!WORKBENCH_ADMIN_EMAIL || WORKBENCH_ADMIN_PASSWORD.length < 12) {
    throw new Error('WORKBENCH_ADMIN_EMAIL and a WORKBENCH_ADMIN_PASSWORD of at least 12 characters are required');
  }

  const tenantFilter = `registeredEmail = ${filterValue(WORKBENCH_ADMIN_EMAIL)}`;
  const currentTenant = await findRecord(token, 'tenants', tenantFilter);
  const tenant = await writeRecord(token, 'tenants', String(currentTenant?.id || '') || null, {
    name: WORKBENCH_ADMIN_NAME,
    companyName: WORKBENCH_ADMIN_NAME,
    registeredEmail: WORKBENCH_ADMIN_EMAIL,
    subscriptionStatus: 'active',
    subscriptionPlan: 'admin',
    subscriptionExpiresAt: '',
    createdAt: String(currentTenant?.createdAt || new Date().toISOString()),
  });
  const tenantId = String(tenant.id || currentTenant?.id || '');
  if (!tenantId) throw new Error('workbench admin tenant creation returned no id');

  const currentUser = await findRecord(token, 'users', `email = ${filterValue(WORKBENCH_ADMIN_EMAIL)}`);
  await writeRecord(token, 'users', String(currentUser?.id || '') || null, {
    email: WORKBENCH_ADMIN_EMAIL,
    emailVisibility: true,
    name: WORKBENCH_ADMIN_NAME,
    tenantId,
    role: 'super_admin',
    ...(!currentUser?.id ? {
      password: WORKBENCH_ADMIN_PASSWORD,
      passwordConfirm: WORKBENCH_ADMIN_PASSWORD,
    } : {}),
  });
  console.log(`  ✓ workbench admin ready: ${WORKBENCH_ADMIN_EMAIL}`);
}

async function main(): Promise<void> {
  console.log(`→ Provisioning PocketBase at ${PB_URL}`);
  if (process.argv.includes('--check')) {
    const result = await validateCanonicalPocketBaseSchema();
    if (!result.ok) throw new Error(`canonical schema drift: ${JSON.stringify(result.issues)}`);
    console.log(`✓ Canonical schema ${result.version} verified.`);
    return;
  }
  const token = await authToken();
  const existing = await listCollections(token);

  await ensureUsersCollection(token, existing);

  for (const { name, fields } of COLLECTIONS) {
    if (name === 'users') continue;
    if (existing.has(name)) {
      await ensureFields(token, name, fields);
      await ensureIndexes(token, name);
      continue;
    }
    await createCollection(token, name, fields);
  }
  await ensureWorkbenchAdmin(token);
  await migrateAndHardenUsers(token);
  await ensureIndexes(token, 'users');
  const schema = await validateCanonicalPocketBaseSchema();
  if (!schema.ok) throw new Error(`canonical schema drift after setup: ${JSON.stringify(schema.issues)}`);
  console.log(`✓ Done. Canonical schema ${schema.version} verified (${CANONICAL_COLLECTIONS.length} critical collections).`);
}

main().catch((e) => {
  console.error('✗ Setup failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
