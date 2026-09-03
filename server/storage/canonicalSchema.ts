import { adminFetch } from './pb.js';
import { createHash } from 'node:crypto';

export type CanonicalField = {
  name: string;
  type: string;
  required?: boolean;
  [key: string]: unknown;
};

export type CanonicalCollection = {
  name: string;
  fields: CanonicalField[];
  indexes: string[];
};

const field = (name: string, type: string, required = false, options: Record<string, unknown> = {}): CanonicalField => ({
  name,
  type,
  ...(required ? { required: true } : {}),
  ...options,
});
const text = (name: string, required = false, max?: number) => field(name, 'text', required, max ? { max } : {});
const number = (name: string, required = false) => field(name, 'number', required);
const json = (name: string, required = false, maxSize = 524_288) => field(name, 'json', required, { maxSize });
const bool = (name: string) => field(name, 'bool');
const select = (name: string, values: string[], required = false) => field(name, 'select', required, { maxSelect: 1, values });

export const ORGANIZATION_ROLE_VALUES = ['super_admin', 'admin', 'social_operator', 'customer_service'] as const;

/** Authentication/onboarding schema is synchronized by setup-pb before app startup. */
export const CANONICAL_AUTH_COLLECTIONS: readonly CanonicalCollection[] = [
  {
    name: 'users',
    fields: [
      text('tenantId', true),
      select('role', [...ORGANIZATION_ROLE_VALUES], true),
      // Session-wide revocation is a monotonic epoch, not a token deny-list.
      // Keep zero valid by leaving PocketBase's `required` flag disabled.
      number('session_epoch'),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_users_single_super_admin ON users (tenantId) WHERE role = 'super_admin'",
    ],
  },
  {
    name: 'tenants',
    fields: [
      text('inviteCode'), text('registrationInviteCode'), text('registeredEmail'), text('registeredAt'),
      text('registrationClaimToken'), text('registrationClaimedAt'), text('registrationClaimEmail'),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_tenants_active_invite ON tenants (inviteCode) WHERE inviteCode != ''",
      "CREATE UNIQUE INDEX idx_tenants_used_invite ON tenants (registrationInviteCode) WHERE registrationInviteCode != ''",
    ],
  },
] as const;

/**
 * Canonical schema for the production-critical autonomous execution path.
 * setup-pb, readiness validation, and the schema drift test consume this list.
 * The PocketBase migration is a generated/runtime-compatible representation.
 */
export const CANONICAL_COLLECTIONS: readonly CanonicalCollection[] = [
  {
    name: 'tenant_platform_apps',
    fields: [
      text('tenant_id', true), text('platform', true), text('app_id'),
      field('app_secret', 'text', false, { hidden: true }), text('wa_config_id'), text('business_id'),
      text('waba_id'), text('phone_number_id'), text('wa_public_number'), text('page_id'), text('ig_user_id'),
      text('youtube_channel_id'), field('webhook_verify_token', 'text', false, { hidden: true }),
      field('wecom_encoding_aes_key', 'text', false, { hidden: true }), text('token_type'),
      field('access_token', 'text', false, { hidden: true }), text('token_expires_at'), text('status'),
      text('last_checklist'), text('notes'), text('credential_version'), text('credential_state'),
      number('credential_revision'),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_tenant_platform_apps_unique ON tenant_platform_apps (tenant_id, platform)',
      'CREATE INDEX idx_tenant_platform_apps_status ON tenant_platform_apps (status)',
      'CREATE INDEX idx_tenant_platform_apps_credential_state ON tenant_platform_apps (credential_state)',
    ],
  },
  {
    name: 'auth_sessions',
    fields: [
      field('token_hash', 'text', true, { max: 64, hidden: true }), text('user_id', true), text('tenant_id', true), text('status', true),
      number('session_epoch'), text('expires_at', true), text('revoked_at'), number('revision'),
      text('created_at', true), text('updated_at', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_auth_sessions_token_hash ON auth_sessions (token_hash)',
      'CREATE INDEX idx_auth_sessions_tenant_user_status ON auth_sessions (tenant_id, user_id, status)',
      'CREATE INDEX idx_auth_sessions_status_expiry ON auth_sessions (status, expires_at)',
    ],
  },
  {
    name: 'oauth_transactions',
    fields: [
      field('state_hash', 'text', true, { max: 64, hidden: true }), text('tenant_id', true), text('user_id', true), text('platform', true),
      text('return_to', true, 2_000), text('status', true), text('expires_at', true), text('consumed_at'),
      number('revision'), text('created_at', true), text('updated_at', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_oauth_transactions_state_hash ON oauth_transactions (state_hash)',
      'CREATE INDEX idx_oauth_transactions_status_expiry ON oauth_transactions (status, expires_at)',
      'CREATE INDEX idx_oauth_transactions_actor ON oauth_transactions (tenant_id, user_id, platform)',
    ],
  },
  {
    name: 'youtube_accounts',
    fields: [text('credentialVersion'), text('credentialState'), number('credentialRevision')],
    indexes: [
      'CREATE UNIQUE INDEX idx_youtube_accounts_tenant_channel ON youtube_accounts (tenantId, channelId)',
      'CREATE INDEX idx_youtube_accounts_credential_state ON youtube_accounts (credentialState)',
    ],
  },
  {
    name: 'social_accounts',
    fields: [text('credentialVersion'), text('credentialState'), number('credentialRevision')],
    indexes: [
      'CREATE UNIQUE INDEX idx_social_accounts_tenant_platform_provider ON social_accounts (tenantId, platform, providerAccountId)',
      'CREATE INDEX idx_social_accounts_credential_state ON social_accounts (credentialState)',
    ],
  },
  {
    name: 'crawl_jobs',
    fields: [
      text('tenantId', true), text('requestedBy'), text('platform', true), text('mode', true),
      text('keyword'), text('accountUrl'), text('accountName'), number('limit'), text('status', true),
      text('workerId'), number('attempts'), text('resultJson', false, 2_000_000), text('error', false, 2_000_000),
      text('createdAt'), text('updatedAt'), text('leasedUntil'), text('finishedAt'),
      text('leaseToken'), number('revision'),
    ],
    indexes: [
      'CREATE INDEX idx_crawl_jobs_status_created ON crawl_jobs (status, createdAt)',
      'CREATE INDEX idx_crawl_jobs_status_lease ON crawl_jobs (status, leasedUntil, createdAt)',
      'CREATE INDEX idx_crawl_jobs_tenant_created ON crawl_jobs (tenantId, createdAt)',
    ],
  },
  {
    name: 'scheduled_tasks',
    fields: [
      text('task_id', true), text('tenant_id', true), text('name', true), text('category'),
      text('task_type', true), text('cron_expr', true), text('cron_label'), bool('enabled'),
      text('channel_id'), json('config'), text('last_run'), text('last_result'), text('created_at', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_scheduled_tasks_tenant_task ON scheduled_tasks (tenant_id, task_id)',
      'CREATE INDEX idx_scheduled_tasks_tenant_created ON scheduled_tasks (tenant_id, created_at, id)',
    ],
  },
  {
    name: 'scripts',
    fields: [text('idempotency_key'), number('version'), text('payload_hash'), text('updatedAt')],
    indexes: [
      "CREATE UNIQUE INDEX idx_scripts_idempotency ON scripts (tenantId, idempotency_key) WHERE idempotency_key != ''",
    ],
  },
  {
    name: 'studio_projects',
    fields: [
      text('tenant_id', true), text('legacy_id'), text('title', true), text('status', true),
      json('spec', false, 2_000_000), text('thumb_seed'), text('created_at'), text('updated_at'),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_studio_projects_legacy ON studio_projects (tenant_id, legacy_id) WHERE legacy_id != ''",
    ],
  },
  {
    name: 'posts',
    fields: [
      text('tenant_id', true), text('content_id'), text('platform', true), text('platform_post_id'),
      text('title'), text('published_at'), text('track_code', true), text('wa_link'), json('stats'),
      number('inquiries'), number('deals'),
      text('digital_employee_idempotency_key'), text('publish_lease_owner'), text('publish_lease_expires_at'),
      number('publish_revision'), bool('reconciliation_required'), text('digital_employee_run_id'),
      text('digital_employee_approval_id'), text('digital_employee_action_hash'), number('digital_employee_fence_revision'),
      text('direct_publish_fence_key', false, 64), text('direct_publish_content_digest', false, 64), text('direct_publish_account_id', false, 120),
      text('publish_operation_id', false, 64), text('publish_operation_state', false, 32),
      text('publish_operation_quiesced_at'), text('publish_retry_not_before'),
      text('publish_queue_state', false, 32), text('publish_available_at'),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_posts_de_idempotency ON posts (tenant_id, digital_employee_idempotency_key) WHERE digital_employee_idempotency_key != ''",
      'CREATE UNIQUE INDEX idx_posts_track_code ON posts (tenant_id, track_code)',
      'CREATE INDEX idx_posts_publish_lease ON posts (tenant_id, publish_lease_expires_at, published_at)',
      'CREATE INDEX idx_posts_reconciliation ON posts (tenant_id, reconciliation_required)',
      'CREATE INDEX idx_posts_de_run ON posts (tenant_id, digital_employee_run_id)',
      "CREATE UNIQUE INDEX idx_posts_direct_fence ON posts (tenant_id, direct_publish_fence_key) WHERE direct_publish_fence_key != ''",
      'CREATE INDEX idx_posts_publish_queue ON posts (publish_queue_state, publish_available_at, id)',
    ],
  },
  {
    name: 'publish_content_fences',
    fields: [
      text('tenant_id', true), text('fence_key', true, 64), text('platform', true), text('account_id', true, 120),
      text('content_digest', true, 64), text('owner_key', false, 200), text('post_id'), text('state', true, 32),
      number('revision'), text('created_at', true), text('updated_at', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_publish_content_fence_key ON publish_content_fences (fence_key)',
      'CREATE INDEX idx_publish_content_fence_post ON publish_content_fences (tenant_id, post_id)',
    ],
  },
  {
    name: 'tenant_api_keys',
    fields: [
      text('tenant_id', true), text('api_key_hash', false, 64), text('key_prefix', false, 32), text('key_last4', false, 4),
      text('created_at', true), text('rotated_at'), text('revoked_at'), text('last_ingested_at'),
      text('last_product_name'), number('version', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_tenant_api_keys_tenant ON tenant_api_keys (tenant_id)',
      "CREATE UNIQUE INDEX idx_tenant_api_keys_hash ON tenant_api_keys (api_key_hash) WHERE api_key_hash != ''",
    ],
  },
  {
    name: 'assist_links',
    fields: [
      text('token_hash', false, 64), text('token_prefix', false, 6), text('token_last4', false, 4),
      text('tenant_id', true), text('platform', true), text('status', true), text('expires_at', true),
      text('claimed_at'), text('claim_expires_at'), text('claim_nonce_hash', false, 64), text('used_at'),
      text('revoked_at'), text('created_by'), number('revision'), text('connected_account_id'),
      number('connected_account_count'),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_assist_links_token_hash ON assist_links (token_hash) WHERE token_hash != ''",
      'CREATE INDEX idx_assist_links_status_expiry ON assist_links (status, expires_at, claim_expires_at)',
      'CREATE INDEX idx_assist_links_tenant_expiry ON assist_links (tenant_id, expires_at)',
    ],
  },
  {
    name: 'webhook_message_receipts',
    fields: [
      text('tenant_id', true), text('provider', true), text('message_id', true), text('status', true),
      number('revision'), text('received_at', true), text('updated_at', true), text('claim_expires_at'),
      text('completed_at'), text('last_error_code', false, 80), text('reconciled_at'), text('reconciled_by'),
      text('reconciliation_resolution', false, 40), text('reconciliation_note', false, 2_000),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_webhook_message_receipts_key ON webhook_message_receipts (tenant_id, provider, message_id)',
      'CREATE INDEX idx_webhook_message_receipts_status ON webhook_message_receipts (status, claim_expires_at, updated_at)',
    ],
  },
  {
    name: 'whatsapp_customers',
    fields: [
      text('tenant_id', true), text('customer_id', true), text('wa_number', true), text('name'), text('stage'),
      number('last_active_at'), text('payload', true), number('persistence_revision', true), text('updated_at', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_whatsapp_customers_tenant_customer ON whatsapp_customers (tenant_id, customer_id)',
      'CREATE INDEX idx_whatsapp_customers_tenant_active ON whatsapp_customers (tenant_id, last_active_at)',
    ],
  },
  {
    name: 'whatsapp_interactions',
    fields: [
      text('tenant_id', true), text('interaction_id', true), text('customer_id', true), text('wa_number'),
      number('timestamp'), text('payload', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_whatsapp_interactions_tenant_interaction ON whatsapp_interactions (tenant_id, interaction_id)',
      'CREATE INDEX idx_whatsapp_interactions_customer_time ON whatsapp_interactions (tenant_id, customer_id, timestamp)',
    ],
  },
  {
    name: 'social_comment_states',
    fields: [
      text('tenantId', true), text('key', true), text('status', true), json('analysis', false, 200_000),
      text('repliedAt'), text('replyId'), text('updatedAt', true), number('revision'),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_social_comment_state_key ON social_comment_states (tenantId, key)',
      'CREATE INDEX idx_social_comment_state_status ON social_comment_states (tenantId, status)',
    ],
  },
  {
    name: 'social_reply_operations',
    fields: [
      text('tenant_id', true), text('idempotency_key', true, 200), text('operation_type', true),
      text('target_id', true), text('payload_hash', true, 64), text('status', true),
      json('provider_message_ids'), json('result'), text('last_error_code', false, 80), number('revision'),
      text('created_at', true), text('updated_at', true), text('completed_at'),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_social_reply_operations_idempotency ON social_reply_operations (tenant_id, idempotency_key)',
      'CREATE INDEX idx_social_reply_operations_status ON social_reply_operations (status, updated_at)',
    ],
  },
  {
    name: 'whatsapp_outbound_operations',
    fields: [
      text('tenant_id', true), text('idempotency_key', true, 200), text('operation_type', true),
      text('target_id', true), text('payload_hash', true, 64), text('status', true),
      json('provider_message_ids'), json('result'), text('last_error_code', false, 80), number('revision'),
      text('created_at', true), text('updated_at', true), text('completed_at'), text('delivery_status'),
      text('delivery_updated_at'),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_whatsapp_outbound_operations_idempotency ON whatsapp_outbound_operations (tenant_id, idempotency_key)',
      'CREATE INDEX idx_whatsapp_outbound_operations_status ON whatsapp_outbound_operations (status, updated_at)',
    ],
  },
  {
    name: 'whatsapp_delivery_receipts',
    fields: [
      text('tenant_id', true), text('provider_message_id', true), text('outbound_operation_id'), text('status', true),
      text('provider_timestamp'), text('recipient_hash', false, 64), text('error_code', false, 80),
      number('revision'), text('created_at', true), text('updated_at', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_whatsapp_delivery_receipts_provider ON whatsapp_delivery_receipts (tenant_id, provider_message_id)',
      'CREATE INDEX idx_whatsapp_delivery_receipts_status ON whatsapp_delivery_receipts (status, updated_at)',
      'CREATE INDEX idx_whatsapp_delivery_receipts_operation ON whatsapp_delivery_receipts (tenant_id, outbound_operation_id)',
    ],
  },
  {
    name: 'digital_employee_configs',
    fields: [
      text('tenant_id', true), json('config', true, 262_144), text('status', true), text('updated_by'),
      text('created_at', true), text('updated_at', true),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_digital_employee_config_tenant ON digital_employee_configs (tenant_id)'],
  },
  {
    name: 'weekly_goals',
    fields: [
      text('tenant_id', true), text('title', true), text('objective', true, 5_000), text('metric', true),
      number('baseline'), number('target', true), text('unit'), text('starts_at', true), text('ends_at', true),
      json('scope', false, 65_536), number('budget_limit'), json('constraints', false, 65_536), text('owner_id', true),
      text('status', true), number('version', true), text('created_at', true), text('updated_at', true),
    ],
    indexes: ['CREATE INDEX idx_weekly_goals_tenant_created ON weekly_goals (tenant_id, created_at)'],
  },
  {
    name: 'weekly_plans',
    fields: [
      text('tenant_id', true), text('goal_id', true), number('goal_version', true), number('version', true),
      text('status', true), json('plan', true), text('idempotency_key', true), text('parent_plan_id'),
      text('reason', false, 5_000), text('created_at', true), text('updated_at'),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_weekly_plans_goal_version ON weekly_plans (tenant_id, goal_id, version)',
      "CREATE UNIQUE INDEX idx_weekly_plans_idempotency ON weekly_plans (tenant_id, idempotency_key) WHERE idempotency_key != ''",
    ],
  },
  {
    name: 'execution_contracts',
    fields: [
      text('tenant_id', true), text('goal_id', true), number('goal_version', true), number('version', true),
      text('status', true), text('payload_hash', true), text('source_fingerprint', true), json('contract', true, 1_048_576),
      text('confirmed_by'), text('compiled_at', true), text('confirmed_at'), text('invalidated_at'),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_execution_contract_version ON execution_contracts (tenant_id, goal_id, version)',
      'CREATE INDEX idx_execution_contract_status ON execution_contracts (tenant_id, status)',
    ],
  },
  {
    name: 'workflow_runs',
    fields: [
      text('tenant_id', true), text('goal_id', true), text('plan_id', true), text('status', true),
      text('current_controller'), text('pause_reason'), number('budget_limit'), number('budget_spent'),
      json('execution_snapshot'), text('idempotency_key'), text('available_at'), text('lease_owner'), text('lease_expires_at'),
      text('started_at', true), text('completed_at'), number('revision'), text('error_code'), text('error_detail', false, 5_000),
    ],
    indexes: [
      'CREATE INDEX idx_workflow_runs_goal ON workflow_runs (tenant_id, goal_id)',
      "CREATE UNIQUE INDEX idx_workflow_runs_idempotency ON workflow_runs (tenant_id, idempotency_key) WHERE idempotency_key != ''",
      'CREATE INDEX idx_workflow_runs_available ON workflow_runs (status, available_at, lease_expires_at)',
    ],
  },
  {
    name: 'workflow_tasks',
    fields: [
      text('tenant_id', true), text('goal_id', true), text('plan_id', true), text('run_id', true), text('task_key', true),
      text('title', true), text('description', false, 5_000), text('agent_role', true), text('kind', true), text('status', true),
      number('sequence', true), text('priority'), bool('requires_approval'), json('depends_on', false, 65_536), json('output'),
      text('blocked_reason'), text('owner_id'), text('created_at', true), text('updated_at', true), number('attempt'),
      number('max_attempts'), text('available_at'), text('lease_owner'), text('lease_expires_at'), text('started_at'),
      text('completed_at'), text('error_code'), text('error_detail', false, 5_000), text('idempotency_key'), number('actual_cost'),
      number('expected_cost'), number('revision'),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_workflow_tasks_run_key ON workflow_tasks (tenant_id, run_id, task_key)',
      'CREATE INDEX idx_workflow_tasks_run_sequence ON workflow_tasks (tenant_id, run_id, sequence)',
      "CREATE UNIQUE INDEX idx_workflow_tasks_idempotency ON workflow_tasks (tenant_id, idempotency_key) WHERE idempotency_key != ''",
      'CREATE INDEX idx_workflow_tasks_available ON workflow_tasks (status, available_at, lease_expires_at)',
    ],
  },
  {
    name: 'run_events',
    fields: [
      text('tenant_id', true), text('run_id', true), text('task_id'), number('sequence', true), text('type', true),
      text('level', true), text('summary', true, 5_000), json('payload'), text('occurred_at', true),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_run_events_sequence ON run_events (tenant_id, run_id, sequence)'],
  },
  {
    name: 'approval_requests',
    fields: [
      text('tenant_id', true), text('goal_id', true), text('run_id', true), text('task_id', true), text('status', true),
      text('action_summary', true, 5_000), text('action_type'), text('risk_level', true), json('evidence'), text('requested_by_agent'),
      text('decided_by'), text('decision_note', false, 5_000), text('created_at', true), text('decided_at'), text('owner_id', true),
      number('action_version', true), text('payload_hash', true), text('approved_payload_hash'), json('action_payload'),
      text('target_account'), text('scheduled_at'), number('estimated_cost'), text('reversibility'), text('expires_at'),
      text('next_step'), json('changes'), json('diff'), number('revision'), text('transfer_note', false, 5_000),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_approval_requests_action_version ON approval_requests (tenant_id, task_id, action_version)',
      'CREATE INDEX idx_approval_requests_owner_status ON approval_requests (tenant_id, owner_id, status, expires_at)',
    ],
  },
  {
    name: 'handoff_sessions',
    fields: [
      text('tenant_id', true), text('run_id', true), text('task_id', true), text('status', true), text('taken_by', true),
      json('snapshot', true), text('started_at', true), text('returned_at'), number('revision'), text('transfer_note', false, 5_000),
    ],
    indexes: [
      'CREATE INDEX idx_handoff_sessions_task ON handoff_sessions (tenant_id, task_id, started_at)',
      "CREATE UNIQUE INDEX idx_handoff_sessions_active ON handoff_sessions (tenant_id, task_id) WHERE status = 'active'",
    ],
  },
  {
    name: 'weekly_reviews',
    fields: [
      text('tenant_id', true), text('goal_id', true), text('run_id', true), number('version', true),
      text('status', true), json('summary', true), text('created_at', true), text('superseded_at'),
      text('superseded_by'), text('superseded_reason', false, 5_000),
    ],
    indexes: ['CREATE UNIQUE INDEX idx_weekly_reviews_run_version ON weekly_reviews (tenant_id, run_id, version)'],
  },
  {
    name: 'digital_employee_outbox',
    fields: [
      text('tenant_id', true), text('run_id', true), text('event_id', true), number('sequence', true), text('topic', true),
      json('payload', true), text('status', true), number('attempt'), text('available_at'), text('created_at', true),
      text('delivered_at'), text('lease_owner'), text('lease_expires_at'), text('error_detail', false, 5_000),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_de_outbox_event ON digital_employee_outbox (tenant_id, event_id)',
      'CREATE INDEX idx_de_outbox_pending ON digital_employee_outbox (status, available_at, lease_expires_at)',
    ],
  },
  {
    name: 'outbound_action_ledger',
    fields: [
      text('tenant_id', true), text('run_id', true), text('task_id', true), text('approval_id', true),
      text('action_type', true), number('action_version', true), text('status', true), text('idempotency_key', true),
      text('approved_payload_hash'), json('payload'), text('external_record_id'), text('reason', false, 5_000),
      text('created_at', true), text('updated_at', true),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_outbound_action_idempotency ON outbound_action_ledger (tenant_id, idempotency_key)',
      'CREATE UNIQUE INDEX idx_outbound_action_approval_version ON outbound_action_ledger (tenant_id, approval_id, action_version)',
    ],
  },
] as const;

export const CANONICAL_SCHEMA_VERSION = 'digital-employee-production-v7';

export function canonicalSchemaFingerprint(): string {
  return createHash('sha256')
    .update(JSON.stringify({ collections: CANONICAL_COLLECTIONS, authCollections: CANONICAL_AUTH_COLLECTIONS }))
    .digest('hex');
}

export const CANONICAL_INDEXES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  [...CANONICAL_COLLECTIONS, ...CANONICAL_AUTH_COLLECTIONS].map(spec => [spec.name, spec.indexes]),
);

export function mergeCanonicalCollections<T extends { name: string; fields: CanonicalField[] }>(base: T[]): T[] {
  const result = base.map(item => ({ ...item, fields: [...item.fields] }));
  for (const canonical of [...CANONICAL_COLLECTIONS, ...CANONICAL_AUTH_COLLECTIONS]) {
    const existing = result.find(item => item.name === canonical.name);
    if (!existing) {
      result.push({ name: canonical.name, fields: [...canonical.fields] } as T);
      continue;
    }
    const byName = new Map(existing.fields.map(item => [item.name, item]));
    for (const requiredField of canonical.fields) byName.set(requiredField.name, requiredField);
    existing.fields = [...byName.values()];
  }
  return result;
}

function normalizeIndex(index: string): string {
  return index.toLowerCase().replace(/[`";]/g, '').replace(/\s+/g, ' ').trim();
}

export type SchemaIssue = {
  collection: string;
  kind: 'collection_missing' | 'field_missing' | 'field_type_mismatch' | 'field_required_mismatch' | 'field_option_mismatch' | 'index_missing';
  detail: string;
};

export async function validateCanonicalPocketBaseSchema(): Promise<{ ok: boolean; version: string; issues: SchemaIssue[] }> {
  const issues: SchemaIssue[] = [];
  for (const spec of [...CANONICAL_COLLECTIONS, ...CANONICAL_AUTH_COLLECTIONS]) {
    const path = `/api/collections/${encodeURIComponent(spec.name)}`;
    const response = await adminFetch(path);
    if (response.status === 404) {
      issues.push({ collection: spec.name, kind: 'collection_missing', detail: spec.name });
      continue;
    }
    if (!response.ok) throw new Error(`schema read ${spec.name} failed (${response.status})`);
    const collection = await response.json() as {
      fields?: Array<{ name?: string; type?: string; required?: boolean; hidden?: boolean; max?: number; maxSize?: number; maxSelect?: number; values?: string[] }>;
      schema?: Array<{ name?: string; type?: string; required?: boolean; hidden?: boolean; max?: number; maxSize?: number; maxSelect?: number; values?: string[] }>;
      indexes?: string[];
    };
    const fields = collection.fields ?? collection.schema ?? [];
    for (const wanted of spec.fields) {
      const current = fields.find(item => item.name === wanted.name);
      if (!current) {
        issues.push({ collection: spec.name, kind: 'field_missing', detail: wanted.name });
        continue;
      }
      if (current.type !== wanted.type) {
        issues.push({ collection: spec.name, kind: 'field_type_mismatch', detail: `${wanted.name}: ${current.type} != ${wanted.type}` });
      }
      if (Boolean(current.required) !== Boolean(wanted.required)) {
        issues.push({ collection: spec.name, kind: 'field_required_mismatch', detail: `${wanted.name}: ${Boolean(current.required)} != ${Boolean(wanted.required)}` });
      }
      if (wanted.hidden !== undefined && Boolean(current.hidden) !== Boolean(wanted.hidden)) {
        issues.push({ collection: spec.name, kind: 'field_option_mismatch', detail: `${wanted.name}.hidden: ${Boolean(current.hidden)} != ${Boolean(wanted.hidden)}` });
      }
      for (const option of ['max', 'maxSize', 'maxSelect'] as const) {
        if (wanted[option] !== undefined && Number(current[option]) !== Number(wanted[option])) {
          issues.push({ collection: spec.name, kind: 'field_option_mismatch', detail: `${wanted.name}.${option}: ${String(current[option])} != ${String(wanted[option])}` });
        }
      }
      if (Array.isArray(wanted.values)) {
        const currentValues = Array.isArray(current.values) ? [...current.values].sort() : [];
        const wantedValues = [...wanted.values].map(String).sort();
        if (JSON.stringify(currentValues) !== JSON.stringify(wantedValues)) {
          issues.push({ collection: spec.name, kind: 'field_option_mismatch', detail: `${wanted.name}.values: ${JSON.stringify(currentValues)} != ${JSON.stringify(wantedValues)}` });
        }
      }
    }
    const indexes = new Set((collection.indexes ?? []).map(normalizeIndex));
    for (const wanted of spec.indexes) {
      if (!indexes.has(normalizeIndex(wanted))) {
        issues.push({ collection: spec.name, kind: 'index_missing', detail: wanted });
      }
    }
  }
  return { ok: issues.length === 0, version: CANONICAL_SCHEMA_VERSION, issues };
}
