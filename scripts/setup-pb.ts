import '../server/loadEnvironment.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PB_URL = (process.env.PB_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD ?? '';
const WORKBENCH_ADMIN_EMAIL = String(process.env.WORKBENCH_ADMIN_EMAIL ?? '').trim().toLowerCase();
const WORKBENCH_ADMIN_PASSWORD = String(process.env.WORKBENCH_ADMIN_PASSWORD ?? '');
const WORKBENCH_ADMIN_NAME = String(process.env.WORKBENCH_ADMIN_NAME ?? '灵枢管理员').trim() || '灵枢管理员';

type Field = { name: string; type: string; required?: boolean; [k: string]: unknown };
type CollectionSpec = { name: string; fields: Field[]; indexes?: string[] };

/** Collection definitions, derived from what the route handlers write/read. */
const COLLECTIONS: CollectionSpec[] = [
  {
    name: 'quote_skill_drafts',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'customer_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'payload', type: 'json', required: true, maxSize: 500000 },
      { name: 'created_by', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
    indexes: [
      'CREATE INDEX `idx_quote_skill_customer` ON `quote_skill_drafts` (`tenant_id`, `customer_id`, `updated_at`)',
      'CREATE INDEX `idx_quote_skill_status` ON `quote_skill_drafts` (`tenant_id`, `status`)',
    ],
  },
  {
    name: 'quote_skill_events',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'customer_id', type: 'text', required: true },
      { name: 'quote_id', type: 'text', required: true },
      { name: 'actor_id', type: 'text', required: true },
      { name: 'action', type: 'text', required: true },
      { name: 'revision', type: 'number', required: true, min: 1, onlyInt: true },
      { name: 'details', type: 'json', maxSize: 100000 },
      { name: 'created_at', type: 'text', required: true },
    ],
    indexes: [
      'CREATE INDEX `idx_quote_event_quote` ON `quote_skill_events` (`tenant_id`, `quote_id`, `created_at`)',
      'CREATE INDEX `idx_quote_event_customer` ON `quote_skill_events` (`tenant_id`, `customer_id`, `created_at`)',
    ],
  },
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
      { name: 'registeredPasswordCipher', type: 'text' },
      { name: 'registeredAt', type: 'text' },
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
      { name: 'aiAnalysis', type: 'text' },
      { name: 'status', type: 'text' },
      { name: 'crawledAt', type: 'text' },
      // The raw video blob — stored on PB disk, not in the SQLite row.
      { name: 'videoFile', type: 'file', maxSelect: 1, maxSize: 104857600 },
      // 封面同样跟着记录走。此前封面只落在各自代码副本的 data/media/ 里，
      // 而 PocketBase 是共用的，换一份工作目录跑就会让所有 /media/*.thumb.jpg 变 404。
      { name: 'thumbnailFile', type: 'file', maxSelect: 1, maxSize: 5242880, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
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
      { name: 'productId', type: 'text' },
      { name: 'productName', type: 'text' },
      { name: 'sourceUrl', type: 'text' },
      { name: 'licenseEvidence', type: 'text' },
      { name: 'visualObservations', type: 'json', maxSize: 200000 },
      { name: 'videoFile', type: 'file', required: true, maxSelect: 1, maxSize: 104857600 },
      { name: 'posterFile', type: 'file', required: true, maxSelect: 1, maxSize: 5242880 },
      // 分镜匹配所需：素材要先切成片段，才能与对标视频的分镜比对。
      // 缺这三个字段时云端素材永远进不了匹配池，可复制性恒为「弱」。
      { name: 'pinned', type: 'bool' },
      { name: 'analysisSourceRevision', type: 'text' },
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
      { name: 'status', type: 'text' },
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
      { name: 'api_key', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: true },
      { name: 'last_ingested_at', type: 'text' },
      { name: 'last_product_name', type: 'text' },
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
      { name: 'config_version', type: 'number' },
      { name: 'policy_version', type: 'text' },
      { name: 'facts_version', type: 'text' },
      { name: 'effective_config', type: 'json', maxSize: 1048576 },
      { name: 'activated_at', type: 'text' },
      { name: 'updated_by', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_digital_employee_config_tenant ON digital_employee_configs (tenant_id)'],
  },
  {
    name: 'digital_employee_config_versions',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'config_version', type: 'number', required: true },
      { name: 'policy_version', type: 'text', required: true },
      { name: 'facts_version', type: 'text', required: true },
      { name: 'config', type: 'json', required: true, maxSize: 1048576 },
      { name: 'knowledge_binding', type: 'json', required: true, maxSize: 1048576 },
      { name: 'runtime_policy', type: 'json', required: true, maxSize: 1048576 },
      { name: 'status', type: 'text', required: true },
      { name: 'created_by', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_de_config_versions_tenant_version ON digital_employee_config_versions (tenant_id, config_version)',
      'CREATE INDEX idx_de_config_versions_tenant_created ON digital_employee_config_versions (tenant_id, created_at)',
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
      { name: 'constraints', type: 'json', maxSize: 65536 },
      { name: 'owner_id', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'version', type: 'number', required: true },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
    indexes: ['CREATE INDEX idx_weekly_goals_tenant_created ON weekly_goals (tenant_id, created_at)'],
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
    indexes: ['CREATE UNIQUE INDEX idx_weekly_plans_goal ON weekly_plans (tenant_id, goal_id)'],
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
      { name: 'started_at', type: 'text', required: true },
      { name: 'completed_at', type: 'text' },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_workflow_runs_goal ON workflow_runs (tenant_id, goal_id)'],
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
      // Business-native task metadata. These fields let the Digital Employee
      // page deep-link into the existing content, publishing and customer
      // workspaces instead of creating a second source of truth.
      { name: 'business_domain', type: 'text' },
      { name: 'capability_key', type: 'text' },
      { name: 'destination', type: 'text' },
      { name: 'destination_view', type: 'text' },
      { name: 'status_source', type: 'text' },
      { name: 'execution_mode', type: 'text' },
      { name: 'external_effect', type: 'text' },
      { name: 'automatic_execution_allowed', type: 'bool' },
      { name: 'policy_source', type: 'text' },
      { name: 'business_refs', type: 'json', maxSize: 262144 },
      { name: 'task_version', type: 'number' },
      { name: 'correction_version', type: 'number' },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_workflow_tasks_run_key ON workflow_tasks (tenant_id, run_id, task_key)',
      'CREATE INDEX idx_workflow_tasks_run_sequence ON workflow_tasks (tenant_id, run_id, sequence)',
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
    indexes: ['CREATE UNIQUE INDEX idx_run_events_sequence ON run_events (tenant_id, run_id, sequence)'],
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
      { name: 'subject_version', type: 'number' },
      { name: 'content_hash', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
      { name: 'decided_at', type: 'text' },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_approval_requests_task ON approval_requests (tenant_id, task_id)'],
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
    indexes: ['CREATE INDEX idx_handoff_sessions_task ON handoff_sessions (tenant_id, task_id, started_at)'],
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
    indexes: ['CREATE UNIQUE INDEX idx_weekly_reviews_run ON weekly_reviews (tenant_id, run_id)'],
  },
  {
    name: 'workflow_corrections',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'goal_id', type: 'text' },
      { name: 'run_id', type: 'text', required: true },
      { name: 'task_id', type: 'text', required: true },
      { name: 'version', type: 'number', required: true },
      { name: 'scope', type: 'text', required: true },
      { name: 'instruction', type: 'text', required: true, max: 5000 },
      { name: 'rerun_downstream', type: 'bool' },
      { name: 'before_state', type: 'json', required: true, maxSize: 524288 },
      { name: 'after_state', type: 'json', required: true, maxSize: 524288 },
      { name: 'affected_task_ids', type: 'json', maxSize: 262144 },
      { name: 'business_refs', type: 'json', maxSize: 262144 },
      { name: 'status', type: 'text', required: true },
      { name: 'created_by', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_workflow_corrections_task_version ON workflow_corrections (tenant_id, task_id, version)',
      'CREATE INDEX idx_workflow_corrections_run_created ON workflow_corrections (tenant_id, run_id, created_at)',
    ],
  },
  {
    name: 'customer_segments',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'goal_id', type: 'text' },
      { name: 'run_id', type: 'text', required: true },
      { name: 'task_id', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'version', type: 'number', required: true },
      { name: 'criteria', type: 'json', required: true, maxSize: 524288 },
      { name: 'criteria_hash', type: 'text', required: true },
      { name: 'member_count', type: 'number' },
      { name: 'excluded_count', type: 'number' },
      { name: 'exclusion_summary', type: 'json', maxSize: 262144 },
      { name: 'snapshot_at', type: 'text', required: true },
      { name: 'created_by', type: 'text', required: true },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_customer_segments_run_version ON customer_segments (tenant_id, run_id, version)',
      'CREATE INDEX idx_customer_segments_tenant_snapshot ON customer_segments (tenant_id, snapshot_at)',
    ],
  },
  {
    name: 'customer_segment_members',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'segment_id', type: 'text', required: true },
      { name: 'customer_id', type: 'text', required: true },
      { name: 'customer_name', type: 'text' },
      { name: 'membership', type: 'text', required: true },
      { name: 'inclusion_reasons', type: 'json', maxSize: 262144 },
      { name: 'exclusion_reasons', type: 'json', maxSize: 262144 },
      { name: 'customer_snapshot', type: 'json', required: true, maxSize: 524288 },
      { name: 'risk_level', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_customer_segment_members_customer ON customer_segment_members (tenant_id, segment_id, customer_id)',
      'CREATE INDEX idx_customer_segment_members_segment_state ON customer_segment_members (tenant_id, segment_id, membership)',
    ],
  },
  {
    name: 'followup_batches',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'goal_id', type: 'text' },
      { name: 'run_id', type: 'text', required: true },
      { name: 'task_id', type: 'text', required: true },
      { name: 'segment_id', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'version', type: 'number', required: true },
      { name: 'approval_id', type: 'text' },
      { name: 'approved_version', type: 'number' },
      { name: 'content_hash', type: 'text', required: true },
      { name: 'delivery_policy', type: 'json', required: true, maxSize: 262144 },
      { name: 'safety_summary', type: 'json', required: true, maxSize: 262144 },
      { name: 'counts', type: 'json', required: true, maxSize: 262144 },
      { name: 'created_by', type: 'text', required: true },
      { name: 'approved_by', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
      { name: 'approved_at', type: 'text' },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_followup_batches_run_version ON followup_batches (tenant_id, run_id, version)',
      'CREATE INDEX idx_followup_batches_tenant_status ON followup_batches (tenant_id, status, updated_at)',
    ],
  },
  {
    name: 'followup_batch_items',
    fields: [
      { name: 'tenant_id', type: 'text', required: true },
      { name: 'batch_id', type: 'text', required: true },
      { name: 'segment_member_id', type: 'text' },
      { name: 'customer_id', type: 'text', required: true },
      { name: 'customer_name', type: 'text' },
      { name: 'wa_number', type: 'text' },
      { name: 'language', type: 'text' },
      { name: 'time_zone', type: 'text' },
      { name: 'last_inbound_at', type: 'text' },
      { name: 'outside_24h', type: 'bool' },
      { name: 'send_mode', type: 'text' },
      { name: 'template_name', type: 'text' },
      { name: 'template_status', type: 'text' },
      { name: 'template_language', type: 'text' },
      { name: 'template_variables', type: 'json', maxSize: 65536 },
      { name: 'draft_body', type: 'text', required: true, max: 200000 },
      { name: 'draft_version', type: 'number', required: true },
      { name: 'content_hash', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'risk_level', type: 'text' },
      { name: 'guard_rule', type: 'text' },
      { name: 'exclusion_reason', type: 'text', max: 5000 },
      { name: 'scheduled_at', type: 'text' },
      { name: 'idempotency_key', type: 'text' },
      { name: 'provider_message_id', type: 'text' },
      { name: 'provider_receipt', type: 'json', maxSize: 524288 },
      { name: 'attempts', type: 'number' },
      { name: 'last_error', type: 'text', max: 5000 },
      { name: 'approved_at', type: 'text' },
      { name: 'sent_at', type: 'text' },
      { name: 'delivered_at', type: 'text' },
      { name: 'created_at', type: 'text', required: true },
      { name: 'updated_at', type: 'text', required: true },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_followup_batch_items_customer ON followup_batch_items (tenant_id, batch_id, customer_id)',
      "CREATE UNIQUE INDEX idx_followup_batch_items_idempotency ON followup_batch_items (tenant_id, idempotency_key) WHERE idempotency_key != ''",
      'CREATE INDEX idx_followup_batch_items_due ON followup_batch_items (tenant_id, status, scheduled_at)',
    ],
  },
];

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
  const json = (await res.json()) as { items?: { name: string }[] };
  return new Map((json.items ?? []).map((c) => [c.name, c]));
}

async function createCollection(token: string, name: string, fields: Field[], indexes: string[] = []): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({
      name,
      type: 'base',
      fields: fields.map((f) => ({ ...f, required: f.required ?? false })),
      indexes,
    }),
  });
  if (!res.ok) {
    throw new Error(`create ${name} failed: ${res.status} ${await res.text()}`);
  }
  console.log(`  ✓ created ${name}`);
}

/** Add only missing named indexes without removing PocketBase/system indexes. */
async function ensureIndexes(token: string, name: string, want: string[]): Promise<void> {
  if (!want.length) return;
  const res = await fetch(`${PB_URL}/api/collections/${name}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return;
  const col = (await res.json()) as { indexes?: string[] };
  const current = col.indexes ?? [];
  const indexName = (definition: string) => definition.match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([^\s`"']+)/i)?.[1] ?? definition;
  const have = new Set(current.map(indexName));
  const missing = want.filter(definition => !have.has(indexName(definition)));
  if (!missing.length) return;
  const up = await fetch(`${PB_URL}/api/collections/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ indexes: [...current, ...missing] }),
  });
  if (!up.ok) throw new Error(`patch ${name} indexes failed: ${up.status} ${await up.text()}`);
  console.log(`  ✓ ${name}: added ${missing.map(indexName).join(', ')}`);
}

/** Add any missing fields to an existing collection (idempotent schema sync). */
function indexName(sql: string): string {
  return sql.match(/\bINDEX\s+[`"]?([^`"\s]+)[`"]?/i)?.[1]?.toLowerCase() || sql.trim().toLowerCase();
}

async function ensureFields(token: string, name: string, want: Field[], wantIndexes: string[] = []): Promise<void> {
  const res = await fetch(`${PB_URL}/api/collections/${name}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return;
  const col = (await res.json()) as { fields?: { name: string }[]; indexes?: string[] };
  const have = new Set((col.fields ?? []).map((f) => f.name));
  const missing = want.filter((f) => !have.has(f.name));
  const existingIndexes = col.indexes ?? [];
  const existingIndexNames = new Set(existingIndexes.map(indexName));
  const indexes = [...existingIndexes, ...wantIndexes.filter(index => !existingIndexNames.has(indexName(index)))];
  const indexesChanged = indexes.length !== existingIndexes.length;
  if (!missing.length && !indexesChanged) {
    console.log(`  = ${name} up to date`);
    return;
  }
  const merged = [
    ...(col.fields ?? []),
    ...missing.map((f) => ({ ...f, required: f.required ?? false })),
  ];
  const up = await fetch(`${PB_URL}/api/collections/${name}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ fields: merged, indexes }),
  });
  if (!up.ok) throw new Error(`patch ${name} fields failed: ${up.status} ${await up.text()}`);
  console.log(`  ✓ ${name}: synchronized ${[...missing.map((f) => f.name), ...(indexesChanged ? ['indexes'] : [])].join(', ')}`);
}

/** Ensure the users auth collection has tenant and organization-role fields. */
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
    !fields.some((f) => f.name === 'role') ? { name: 'role', type: 'select', required: false, maxSelect: 1, values: ['super_admin', 'admin', 'social_operator', 'customer_service'] } : null,
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
        { name: 'role', type: 'select', required: false, maxSelect: 1, values: ['super_admin', 'admin', 'social_operator', 'customer_service'] },
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
    ...(!currentUser?.id ? {
      password: WORKBENCH_ADMIN_PASSWORD,
      passwordConfirm: WORKBENCH_ADMIN_PASSWORD,
    } : {}),
  });
  console.log(`  ✓ workbench admin ready: ${WORKBENCH_ADMIN_EMAIL}`);
}

async function main(): Promise<void> {
  console.log(`→ Provisioning PocketBase at ${PB_URL}`);
  const token = await authToken();
  const existing = await listCollections(token);

  await ensureUsersCollection(token, existing);

  for (const { name, fields, indexes = [] } of COLLECTIONS) {
    if (existing.has(name)) {
      await ensureFields(token, name, fields, indexes);
      await ensureIndexes(token, name, indexes);
      continue;
    }
    await createCollection(token, name, fields, indexes);
  }
  await ensureWorkbenchAdmin(token);
  console.log('✓ Done.');
}

main().catch((e) => {
  console.error('✗ Setup failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
