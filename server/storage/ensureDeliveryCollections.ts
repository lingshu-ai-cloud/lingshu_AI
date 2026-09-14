import { adminFetch } from './pb.js';

type FieldType = 'text' | 'select' | 'bool' | 'date' | 'autodate' | 'json' | 'number';

interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  values?: string[];
  onCreate?: boolean;
  onUpdate?: boolean;
}

const RECORD_TIMESTAMP_FIELDS: FieldDef[] = [
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];

const TENANTS_FIELDS: FieldDef[] = [
  { name: 'name', type: 'text', required: true },
  { name: 'companyName', type: 'text' },
  { name: 'contactName', type: 'text' },
  { name: 'contact', type: 'text' },
  { name: 'industry', type: 'text' },
  { name: 'notes', type: 'text' },
  { name: 'inviteCode', type: 'text' },
  { name: 'registrationInviteCode', type: 'text' },
  { name: 'registeredEmail', type: 'text' },
  { name: 'registeredAt', type: 'text' },
  { name: 'subscriptionStatus', type: 'text' },
  { name: 'subscriptionPlan', type: 'text' },
  { name: 'subscriptionExpiresAt', type: 'date' },
];

const TENANT_PLATFORM_APP_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'platform', type: 'select', required: true, values: ['meta', 'google', 'wecom'] },
  { name: 'app_id', type: 'text' },
  { name: 'app_secret', type: 'text' },
  { name: 'wa_config_id', type: 'text' },
  { name: 'business_id', type: 'text' },
  { name: 'waba_id', type: 'text' },
  { name: 'phone_number_id', type: 'text' },
  { name: 'wa_public_number', type: 'text' },
  { name: 'page_id', type: 'text' },
  { name: 'ig_user_id', type: 'text' },
  { name: 'youtube_channel_id', type: 'text' },
  { name: 'webhook_verify_token', type: 'text' },
  { name: 'wecom_encoding_aes_key', type: 'text' },
  { name: 'token_type', type: 'select', values: ['user_60d', 'system_user_permanent'] },
  { name: 'access_token', type: 'text' },
  { name: 'token_expires_at', type: 'text' },
  { name: 'status', type: 'select', values: ['pending', 'configuring', 'waiting_customer', 'importing_history', 'verifying', 'active', 'needs_permanent_token', 'token_expired', 'error'] },
  { name: 'last_checklist', type: 'json' },
  { name: 'notes', type: 'text' },
];

const POSTS_FIELDS: FieldDef[] = [
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
];

const RECYCLE_LIST_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'name', type: 'text', required: true },
  { name: 'enabled', type: 'bool' },
  { name: 'items', type: 'json' },
  { name: 'slots', type: 'json' },
  { name: 'refresh_mode', type: 'text' },
  { name: 'cursor', type: 'number' },
];

const POSTING_STATS_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'platform', type: 'text', required: true },
  { name: 'weekday', type: 'number' },
  { name: 'hour', type: 'number' },
  { name: 'engagement', type: 'number' },
  { name: 'post_id', type: 'text' },
  { name: 'captured_at', type: 'text' },
];

const PLATFORM_AD_TASK_FIELDS: FieldDef[] = [
  { name: 'version', type: 'number' },
  { name: 'authorization', type: 'json' },
  { name: 'proposal', type: 'json' },
  { name: 'sourceContext', type: 'json' },
  { name: 'managementHistory', type: 'json' },
  { name: 'creationSource', type: 'text' },
  { name: 'managementMode', type: 'text' },
  { name: 'configuration', type: 'json' },
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'created_by', type: 'text', required: true },
  { name: 'name', type: 'text', required: true },
  { name: 'video', type: 'text', required: true },
  { name: 'goal', type: 'text', required: true },
  { name: 'market', type: 'text', required: true },
  { name: 'budget', type: 'number', required: true },
  { name: 'currency', type: 'select', required: true, values: ['USD', 'CNY'] },
  { name: 'channels', type: 'json', required: true },
  { name: 'status', type: 'select', required: true, values: ['draft', 'paused', 'active', 'error', 'unknown'] },
  { name: 'createdAt', type: 'text', required: true },
  { name: 'updatedAt', type: 'text', required: true },
  ...RECORD_TIMESTAMP_FIELDS,
];

const STYLE_MEMORY_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'customer_id', type: 'text' },
  { name: 'trigger_message', type: 'text' },
  { name: 'draft_original', type: 'text' },
  { name: 'final_sent', type: 'text' },
  { name: 'edited', type: 'bool' },
  { name: 'category', type: 'text' },
  { name: 'outcome', type: 'text' },
  { name: 'strategy_ids', type: 'json' },
  { name: 'status', type: 'select', values: ['pending', 'confirmed', 'paused', 'superseded'] },
  { name: 'learning_scope', type: 'select', values: ['enterprise_style', 'customer_private'] },
  { name: 'source_kind', type: 'select', values: ['employee_edit', 'ai_inferred', 'imported_winning', 'manual'] },
  { name: 'evidence_source', type: 'text' },
  { name: 'node_id', type: 'text' },
  { name: 'risk_level', type: 'text' },
  { name: 'diff_tags', type: 'json' },
  { name: 'intervention_type', type: 'text' },
  { name: 'outcome_3_turn', type: 'text' },
  { name: 'outcome_24h', type: 'text' },
  { name: 'fact_learning_allowed', type: 'bool' },
  { name: 'expires_at', type: 'date' },
  { name: 'confirmed_by', type: 'text' },
  { name: 'confirmed_at', type: 'date' },
  { name: 'updated_by', type: 'text' },
  ...RECORD_TIMESTAMP_FIELDS,
];

const RESPONSE_STRATEGY_MEMORY_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'strategy_id', type: 'text', required: true },
  { name: 'adjustment', type: 'text' },
  { name: 'evidence_count', type: 'number' },
  { name: 'status', type: 'select', values: ['candidate', 'active', 'paused', 'archived'] },
  { name: 'source', type: 'text' },
  { name: 'scenario', type: 'text' },
  { name: 'signals', type: 'json' },
  { name: 'intent', type: 'text' },
  { name: 'strategy_steps', type: 'json' },
  { name: 'risk_link', type: 'text' },
  { name: 'escalate', type: 'text' },
  { name: 'version', type: 'number' },
  { name: 'rollout_percent', type: 'number' },
  { name: 'evidence_customer_count', type: 'number' },
  { name: 'evidence_period_count', type: 'number' },
  { name: 'risk_boundary', type: 'text' },
  { name: 'previous_snapshot', type: 'json' },
  { name: 'confirmed_by', type: 'text' },
  { name: 'confirmed_at', type: 'date' },
  { name: 'updated_by', type: 'text' },
  { name: 'last_used_at', type: 'date' },
  { name: 'use_count', type: 'number' },
  ...RECORD_TIMESTAMP_FIELDS,
];

const CUSTOMER_MEMORY_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'customer_id', type: 'text', required: true },
  { name: 'memory_key', type: 'text', required: true },
  { name: 'memory_value', type: 'text', required: true },
  { name: 'evidence', type: 'text' },
  { name: 'status', type: 'select', values: ['pending', 'confirmed', 'paused', 'superseded', 'conflict'] },
  { name: 'source_kind', type: 'select', values: ['human', 'ai_inferred'] },
  { name: 'confidence', type: 'number' },
  { name: 'expires_at', type: 'date' },
  { name: 'conflict_with', type: 'text' },
  { name: 'superseded_by', type: 'text' },
  { name: 'created_by', type: 'text' },
  { name: 'confirmed_by', type: 'text' },
  { name: 'confirmed_at', type: 'date' },
  { name: 'updated_by', type: 'text' },
  ...RECORD_TIMESTAMP_FIELDS,
];

const AGENT_MEMORY_AUDIT_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'actor_user_id', type: 'text' },
  { name: 'action', type: 'text', required: true },
  { name: 'target_type', type: 'text' },
  { name: 'target_id', type: 'text' },
  { name: 'reply_id', type: 'text' },
  { name: 'customer_id', type: 'text' },
  { name: 'node_id', type: 'text' },
  { name: 'memory_ids', type: 'json' },
  { name: 'strategy_ids', type: 'json' },
  { name: 'model_version', type: 'text' },
  { name: 'knowledge_version', type: 'text' },
  { name: 'metadata', type: 'json' },
  { name: 'created_at', type: 'date', required: true },
];

const STYLE_ADOPTION_STATS_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'week', type: 'text', required: true },
  { name: 'total', type: 'text' },
  { name: 'direct_sent', type: 'text' },
  { name: 'rate', type: 'text' },
];

const TENANT_PROFILE_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'profile', type: 'json', required: true },
  { name: 'updated_by', type: 'text' },
];

const TENANT_ORDER_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'order_no', type: 'text', required: true },
  { name: 'order', type: 'json', required: true },
];

const TENANT_SUPPORT_SETTINGS_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'default_authorized', type: 'bool', required: true },
  { name: 'updated_by', type: 'text' },
];

function oldSchemaField(field: FieldDef) {
  return {
    name: field.name,
    type: field.type,
    required: Boolean(field.required),
    options: field.type === 'select'
      ? { values: field.values ?? [] }
      : field.type === 'autodate'
        ? { onCreate: Boolean(field.onCreate), onUpdate: Boolean(field.onUpdate) }
        : {},
  };
}

function newField(field: FieldDef) {
  return {
    name: field.name,
    type: field.type,
    required: Boolean(field.required),
    ...(field.type === 'select' ? { values: field.values ?? [] } : {}),
    ...(field.type === 'autodate' ? { onCreate: Boolean(field.onCreate), onUpdate: Boolean(field.onUpdate) } : {}),
  };
}

export function withoutRecoverableTenantCredentialField<T extends { name?: string }>(fields: T[]): T[] {
  return fields.filter(field => field.name !== 'registeredPasswordCipher');
}

async function collectionExists(name: string): Promise<boolean> {
  const res = await adminFetch(`/api/collections/${encodeURIComponent(name)}`);
  if (res.ok) return true;
  if (res.status === 404) return false;
  const detail = await res.text().catch(() => '');
  throw new Error(`检查集合 ${name} 失败 (${res.status})${detail ? `: ${detail}` : ''}`);
}

async function createCollection(name: string, fields: FieldDef[]): Promise<void> {
  const base = {
    name,
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  };
  const attempts = [
    { ...base, fields: fields.map(newField) },
    { ...base, schema: fields.map(oldSchemaField) },
  ];

  let lastDetail = '';
  for (const body of attempts) {
    const res = await adminFetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    lastDetail = `${res.status} ${await res.text().catch(() => '')}`;
  }
  throw new Error(`创建集合 ${name} 失败：${lastDetail}`);
}

async function ensureCollection(name: string, fields: FieldDef[]): Promise<void> {
  if (!await collectionExists(name)) {
    await createCollection(name, fields);
    console.log(`[pb-init] created collection ${name}`);
    return;
  }

  const res = await adminFetch(`/api/collections/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`读取集合 ${name} 失败 (${res.status})`);
  const collection = await res.json() as { fields?: Array<{ name?: string; type?: string; values?: string[]; options?: { values?: string[] } }>; schema?: Array<{ name?: string; type?: string; values?: string[]; options?: { values?: string[] } }> };
  const existing = collection.fields ?? collection.schema ?? [];
  const removeRecoverableCredential = name === 'tenants'
    && existing.some(field => field.name === 'registeredPasswordCipher');
  const missing = fields.filter(field => !existing.some(item => item.name === field.name));
  const selectUpdates = fields
    .filter(field => field.type === 'select' && field.values?.length)
    .filter(field => {
      const current = existing.find(item => item.name === field.name);
      const values = current?.values ?? current?.options?.values ?? [];
      return field.values!.some(value => !values.includes(value));
    });
  if (!missing.length && !selectUpdates.length && !removeRecoverableCredential) return;

  const attempts = collection.fields
    ? [{
      fields: [
        ...withoutRecoverableTenantCredentialField(collection.fields).map(field => {
          const update = selectUpdates.find(item => item.name === field.name);
          return update ? { ...field, values: update.values ?? [] } : field;
        }),
        ...missing.map(newField),
      ],
    }]
    : [{
      schema: withoutRecoverableTenantCredentialField(collection.schema ?? []).map(field => {
        const update = selectUpdates.find(item => item.name === field.name);
        return update ? { ...field, options: { ...(field.options ?? {}), values: update.values ?? [] } } : field;
      }).concat(missing.map(oldSchemaField)),
    }];
  let lastDetail = '';
  for (const body of attempts) {
    const patch = await adminFetch(`/api/collections/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (patch.ok) {
      const changes = [
        missing.length ? `added ${missing.map(field => field.name).join(', ')}` : '',
        selectUpdates.length ? `updated ${selectUpdates.map(field => field.name).join(', ')}` : '',
        removeRecoverableCredential ? 'removed legacy registration credential field and stored values' : '',
      ].filter(Boolean).join('; ');
      console.log(`[pb-init] ${changes} in ${name}`);
      return;
    }
    lastDetail = `${patch.status} ${await patch.text().catch(() => '')}`;
  }
  throw new Error(`更新集合 ${name} 失败：${lastDetail}`);
}

export async function ensureDeliveryCollections(): Promise<void> {
  await ensureCollection('platform_ad_imports', [
    ...['tenant_id', 'provider', 'accountId', 'connectionId', 'campaignId', 'taskId', 'status', 'capability', 'createdAt', 'updatedAt'].map(name => ({ name, type: 'text' as const })),
    { name: 'providerSnapshot', type: 'json' },
  ]);
  await ensureCollection('platform_ad_launches', [
    ...['tenant_id', 'taskId', 'connectionId', 'status', 'createdAt', 'updatedAt', 'error'].map(name => ({ name, type: 'text' as const })),
    { name: 'launchMode', type: 'select', values: ['create_paused', 'create_and_activate'] },
    { name: 'taskVersion', type: 'number' },
    { name: 'meta', type: 'json' },
    { name: 'receipt', type: 'json' },
  ]);
  await ensureCollection('platform_ad_approvals', [
    ...['tenant_id', 'taskId', 'status', 'createdBy', 'decidedBy', 'createdAt', 'expiresAt', 'updatedAt', 'error'].map(name => ({ name, type: 'text' as const })),
    { name: 'taskVersion', type: 'number' },
    { name: 'payload', type: 'json' },
    { name: 'receipt', type: 'json' },
  ]);
  await ensureCollection('platform_ad_oauth_states', [
    ...['tenant_id', 'userId', 'stateHash', 'expiresAt', 'status', 'tokenCipher'].map(name => ({ name, type: 'text' as const })),
    { name: 'accounts', type: 'json' },
  ]);
  await ensureCollection('platform_ad_automation_rules', [
    ...['tenant_id', 'taskId', 'connectionId', 'resourceId', 'updatedAt'].map(name => ({ name, type: 'text' as const, required: true })),
    ...['targetCpc', 'minClicks', 'cooldownMinutes', 'maxMetricAgeMinutes'].map(name => ({ name, type: 'number' as const, required: true })),
    { name: 'enabled', type: 'bool' },
  ]);
  await ensureCollection('platform_ad_automation_runs', [
    ...['tenant_id', 'taskId', 'ruleId', 'status', 'reason', 'createdAt'].map(name => ({ name, type: 'text' as const })),
    { name: 'metrics', type: 'json' },
    { name: 'receipt', type: 'json' },
  ]);
  await ensureCollection('platform_ad_executions', [
    { name: 'expectedDailyBudget', type: 'number' },
    { name: 'tenant_id', type: 'text', required: true },
    { name: 'taskId', type: 'text', required: true },
    { name: 'requestId', type: 'text', required: true },
    { name: 'action', type: 'text', required: true },
    { name: 'connectionId', type: 'text', required: true },
    { name: 'resourceId', type: 'text' },
    { name: 'status', type: 'text', required: true },
    { name: 'createdAt', type: 'text', required: true },
    { name: 'error', type: 'text' },
    { name: 'result', type: 'json' },
  ]);
  await ensureCollection('platform_ad_handoffs', [
    { name: 'tenant_id', type: 'text', required: true },
    { name: 'goalId', type: 'text', required: true },
    { name: 'adTaskId', type: 'text' },
    { name: 'objective', type: 'text' },
    { name: 'evidence', type: 'text' },
    { name: 'expectedOutcome', type: 'text' },
    { name: 'constraints', type: 'json' },
    { name: 'createdAt', type: 'text' },
    { name: 'createdBy', type: 'text' },
  ]);
  await ensureCollection('platform_ad_connections', [
    { name: 'tenant_id', type: 'text', required: true },
    { name: 'provider', type: 'text', required: true },
    { name: 'accountId', type: 'text', required: true },
    { name: 'name', type: 'text' },
    { name: 'currency', type: 'text' },
    { name: 'tokenCipher', type: 'text' },
    { name: 'status', type: 'text' },
    { name: 'updatedAt', type: 'text' },
  ]);
  await ensureCollection('tenants', TENANTS_FIELDS);
  await ensureCollection('tenant_platform_apps', TENANT_PLATFORM_APP_FIELDS);
  await ensureCollection('posts', POSTS_FIELDS);
  await ensureCollection('recycle_lists', RECYCLE_LIST_FIELDS);
  await ensureCollection('posting_stats', POSTING_STATS_FIELDS);
  await ensureCollection('platform_ad_tasks', PLATFORM_AD_TASK_FIELDS);
  await ensureCollection('style_memory', STYLE_MEMORY_FIELDS);
  await ensureCollection('response_strategy_memory', RESPONSE_STRATEGY_MEMORY_FIELDS);
  await ensureCollection('customer_memory', CUSTOMER_MEMORY_FIELDS);
  await ensureCollection('agent_memory_audit', AGENT_MEMORY_AUDIT_FIELDS);
  await ensureCollection('style_adoption_stats', STYLE_ADOPTION_STATS_FIELDS);
  await ensureCollection('tenant_profiles', TENANT_PROFILE_FIELDS);
  await ensureCollection('tenant_orders', TENANT_ORDER_FIELDS);
  await ensureCollection('tenant_support_settings', TENANT_SUPPORT_SETTINGS_FIELDS);
}

export async function ensureTrendVideoAnalysisCapacity(): Promise<void> {
  const requiredMax = 1_000_000;
  const res = await adminFetch('/api/collections/trend_videos');
  if (!res.ok) throw new Error(`读取集合 trend_videos 失败 (${res.status})`);
  const collection = await res.json() as {
    fields?: Array<Record<string, unknown> & { name?: string; max?: number }>;
    schema?: Array<Record<string, unknown> & { name?: string; options?: Record<string, unknown> }>;
  };
  const fields = collection.fields;
  if (fields) {
    const analysis = fields.find(field => field.name === 'aiAnalysis');
    const hasContentFormat = fields.some(field => field.name === 'contentFormat');
    const needsAnalysisExpansion = Boolean(analysis && Number(analysis.max || 0) < requiredMax);
    if (!needsAnalysisExpansion && hasContentFormat) return;
    const nextFields = fields
      .map(field => field.name === 'aiAnalysis' && needsAnalysisExpansion ? { ...field, max: requiredMax } : field)
      .concat(hasContentFormat ? [] : [newField({ name: 'contentFormat', type: 'select', values: ['video', 'image'] })]);
    const patch = await adminFetch('/api/collections/trend_videos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: nextFields }),
    });
    if (!patch.ok) throw new Error(`更新 trend_videos 索引字段失败 (${patch.status})`);
    console.log('[pb-init] ensured trend_videos contentFormat / aiAnalysis capacity');
    return;
  }
  const schema = collection.schema ?? [];
  const analysis = schema.find(field => field.name === 'aiAnalysis');
  const hasContentFormat = schema.some(field => field.name === 'contentFormat');
  const needsAnalysisExpansion = Boolean(analysis && Number(analysis.options?.max || 0) < requiredMax);
  if (!needsAnalysisExpansion && hasContentFormat) return;
  const nextSchema = schema
    .map(field => field.name === 'aiAnalysis' && needsAnalysisExpansion ? { ...field, options: { ...(field.options ?? {}), max: requiredMax } } : field)
    .concat(hasContentFormat ? [] : [oldSchemaField({ name: 'contentFormat', type: 'select', values: ['video', 'image'] })]);
  const patch = await adminFetch('/api/collections/trend_videos', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: nextSchema }),
  });
  if (!patch.ok) throw new Error(`更新 trend_videos 索引字段失败 (${patch.status})`);
  console.log('[pb-init] ensured trend_videos contentFormat / aiAnalysis capacity');
}

export async function backfillTrendVideoContentFormat(): Promise<void> {
  let updated = 0;
  // Newly added PocketBase fields are empty on historical records. Repeatedly
  // consume page one so pagination cannot skip rows as they leave the filter.
  for (let batch = 0; batch < 100; batch += 1) {
    const params = new URLSearchParams({
      page: '1',
      perPage: '100',
      filter: 'contentFormat = ""',
      fields: 'id,aiAnalysis,contentFormat',
    });
    const response = await adminFetch(`/api/collections/trend_videos/records?${params}`);
    if (!response.ok) throw new Error(`读取 trend_videos.contentFormat 待迁移记录失败 (${response.status})`);
    const payload = await response.json() as { items?: Array<{ id?: string; aiAnalysis?: unknown; contentFormat?: string }> };
    const items = payload.items ?? [];
    if (!items.length) break;
    await Promise.all(items.map(async record => {
      if (!record.id) return;
      let analysis: Record<string, unknown> = {};
      try {
        const parsed = typeof record.aiAnalysis === 'string' ? JSON.parse(record.aiAnalysis) : record.aiAnalysis;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) analysis = parsed as Record<string, unknown>;
      } catch { /* legacy malformed analysis defaults to video */ }
      const contentFormat = analysis.contentFormat === 'image' ? 'image' : 'video';
      const patch = await adminFetch(`/api/collections/trend_videos/records/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentFormat }),
      });
      if (!patch.ok) throw new Error(`回填 trend_videos/${record.id}.contentFormat 失败 (${patch.status})`);
      updated += 1;
    }));
    if (items.length < 100) break;
  }
  if (updated > 0) console.log(`[pb-init] backfilled trend_videos.contentFormat for ${updated} records`);
}
