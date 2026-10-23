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
  { name: 'platform', type: 'select', required: true, values: ['meta', 'instagram', 'google', 'tiktok', 'linkedin', 'wecom'] },
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

const ENTERPRISE_ONBOARDING_DRAFT_FIELDS: FieldDef[] = [
  { name: 'tenant_id', type: 'text', required: true },
  { name: 'user_id', type: 'text', required: true },
  { name: 'schema_version', type: 'text', required: true },
  { name: 'revision', type: 'number', required: true },
  { name: 'current_step', type: 'number', required: true },
  { name: 'base_fact_version', type: 'text', required: true },
  { name: 'confirmation_id', type: 'text', required: true },
  { name: 'confirmation_state', type: 'text' },
  { name: 'claim_token', type: 'text' },
  { name: 'payload', type: 'json', required: true },
  { name: 'updated_at', type: 'text', required: true },
  { name: 'updated_by', type: 'text', required: true },
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

async function createCollection(name: string, fields: FieldDef[], indexes: string[] = []): Promise<void> {
  const base = {
    name,
    type: 'base',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes,
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

async function ensureCollection(name: string, fields: FieldDef[], indexes: string[] = [], adminOnly = false): Promise<void> {
  if (!await collectionExists(name)) {
    await createCollection(name, fields, indexes);
    console.log(`[pb-init] created collection ${name}`);
    return;
  }

  const res = await adminFetch(`/api/collections/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`读取集合 ${name} 失败 (${res.status})`);
  const collection = await res.json() as { fields?: Array<{ name?: string; type?: string; values?: string[]; options?: { values?: string[] } }>; schema?: Array<{ name?: string; type?: string; values?: string[]; options?: { values?: string[] } }>; indexes?:string[];listRule?:string|null;viewRule?:string|null;createRule?:string|null;updateRule?:string|null;deleteRule?:string|null };
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
  const missingIndexes=indexes.filter(index=>!collection.indexes?.includes(index));
  const insecure=adminOnly&&[collection.listRule,collection.viewRule,collection.createRule,collection.updateRule,collection.deleteRule].some(rule=>rule!==null);
  if (!missing.length && !selectUpdates.length && !removeRecoverableCredential && !missingIndexes.length && !insecure) return;
  const rules=insecure?{listRule:null,viewRule:null,createRule:null,updateRule:null,deleteRule:null}:{};

  const attempts = collection.fields
    ? [{
      fields: [
        ...withoutRecoverableTenantCredentialField(collection.fields).map(field => {
          const update = selectUpdates.find(item => item.name === field.name);
          return update ? { ...field, values: update.values ?? [] } : field;
        }),
        ...missing.map(newField),
      ],
      ...(missingIndexes.length?{indexes:[...(collection.indexes??[]),...missingIndexes]}:{}),
      ...rules,
    }]
    : [{
      schema: withoutRecoverableTenantCredentialField(collection.schema ?? []).map(field => {
        const update = selectUpdates.find(item => item.name === field.name);
        return update ? { ...field, options: { ...(field.options ?? {}), values: update.values ?? [] } } : field;
      }).concat(missing.map(oldSchemaField)),
      ...(missingIndexes.length?{indexes:[...(collection.indexes??[]),...missingIndexes]}:{}),
      ...rules,
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
        missingIndexes.length ? `added ${missingIndexes.length} index(es)` : '',
        insecure ? 'restored admin-only rules' : '',
      ].filter(Boolean).join('; ');
      console.log(`[pb-init] ${changes} in ${name}`);
      return;
    }
    lastDetail = `${patch.status} ${await patch.text().catch(() => '')}`;
  }
  throw new Error(`更新集合 ${name} 失败：${lastDetail}`);
}

export const MATERIAL_EVIDENCE_CONFIGURATION_FIELDS: FieldDef[] = [
  ...['tenant_id', 'program_id', 'package_id', 'slot_id', 'source_hash', 'record_hash'].map(name => ({ name, type: 'text' as const, required: true })),
  { name: 'package_version', type: 'number', required: true },
  { name: 'configuration_version', type: 'number', required: true },
  { name: 'payload', type: 'json', required: true },
];

export const CUSTOMER_FEEDBACK_TOPIC_FIELDS: FieldDef[] = [
  ...['tenant_id', 'program_id', 'record_hash'].map(name => ({ name, type: 'text' as const, required: true })),
  { name: 'payload', type: 'json', required: true },
];

/** Admin-only, tuple-unique progress; a server restart must see the same
 * candidate stage rather than issuing another semantic request. */
export async function ensureWeeklyCandidatePostAnalysisCollection(): Promise<void> {
  await ensureCollection('social_weekly_candidate_postanalysis_progress',[
    ...['tenant_id','job_id','run_id','candidate_id','record_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'payload',type:'json',required:true},
  ],['CREATE UNIQUE INDEX idx_weekly_candidate_postanalysis_identity ON social_weekly_candidate_postanalysis_progress (tenant_id, job_id, run_id, candidate_id)'],true);
}

export async function ensureCandidateSemanticCollections(): Promise<void> {
  const common=[{name:'tenant_id',type:'text' as const,required:true},{name:'record_hash',type:'text' as const,required:true},{name:'payload',type:'json' as const,required:true}];
  await ensureCollection('social_candidate_semantic_operations',[
    ...common,{name:'candidate_id',type:'text',required:true},{name:'operation_id',type:'text',required:true},
  ],['CREATE UNIQUE INDEX idx_candidate_semantic_operation_key ON social_candidate_semantic_operations (operation_id)'],true);
  await ensureCollection('social_candidate_semantic_provider_receipts',[
    ...common,{name:'operation_id',type:'text',required:true},
  ],['CREATE UNIQUE INDEX idx_candidate_semantic_receipt_key ON social_candidate_semantic_provider_receipts (operation_id)'],true);
  await ensureCollection('social_candidate_semantic_assessments',[
    ...common,{name:'candidate_id',type:'text',required:true},{name:'context_id',type:'text',required:true},{name:'assessment_id',type:'text',required:true},
  ],['CREATE UNIQUE INDEX idx_candidate_semantic_assessment_key ON social_candidate_semantic_assessments (assessment_id)'],true);
}

export async function ensureWeeklyCandidateSemanticBudgetCollections(): Promise<void> {
  await ensureCollection('social_weekly_candidate_semantic_budget_authorizations',[
    ...['tenant_id','program_id','package_id','status','record_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'package_version',type:'number',required:true},{name:'payload',type:'json',required:true},
  ],['CREATE UNIQUE INDEX idx_weekly_candidate_semantic_budget_scope ON social_weekly_candidate_semantic_budget_authorizations (tenant_id, program_id, package_id, package_version)'],true);
  await ensureCollection('social_weekly_candidate_semantic_budget_revocations',[
    ...['tenant_id','authorization_id','record_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'payload',type:'json',required:true},
  ],['CREATE UNIQUE INDEX idx_weekly_candidate_semantic_budget_revoke ON social_weekly_candidate_semantic_budget_revocations (tenant_id, authorization_id)'],true);
}

export async function ensureDeliveryCollections(): Promise<void> {
  // Jobs are provisioned by the execution migration; never create a truncated queue schema.
  const executionJobs = await adminFetch('/api/collections/content_execution_jobs');
  if (!executionJobs.ok) throw new Error('content_execution_jobs_schema_missing');
  await ensureCollection('content_execution_jobs', [{name:'checkpoint',type:'json'}]);
  await ensureCollection('social_weekly_template_adoptions', [
    ...['tenant_id','program_id','package_id'].map(name=>({name,type:'text' as const,required:true})),
    {name:'package_version',type:'number',required:true},
    {name:'payload',type:'json',required:true},
  ]);
  await ensureCollection('social_weekly_cta_contacts', [
    ...['tenant_id','program_id','package_id','record_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'package_version',type:'number',required:true},
    {name:'revision',type:'number',required:true},
    {name:'payload',type:'json',required:true},
  ]);
  for(const name of ['social_weekly_publication_product_selection_issuances','social_weekly_publication_product_selections'])await ensureCollection(name,[
    ...['tenant_id','program_id','package_id','publication_task_id','content_hash'].map(field=>({name:field,type:'text' as const,required:true})),
    {name:'package_version',type:'number',required:true},
    {name:'payload',type:'json',required:true},
  ]);
  await ensureCollection('social_weekly_sample_policy_candidates',[
    ...['tenant_id','program_id','package_id','publication_task_id','content_hash'].map(field=>({name:field,type:'text' as const,required:true})),
    {name:'package_version',type:'number',required:true},
    {name:'payload',type:'json',required:true},
  ]);
  for(const name of ['social_weekly_sample_policy_review_operations','social_weekly_sample_policy_review_decisions','social_weekly_sample_policy_review_revocations'])await ensureCollection(name,[
    ...['tenant_id','program_id','package_id','publication_task_id','content_hash'].map(field=>({name:field,type:'text' as const,required:true})),
    {name:'package_version',type:'number',required:true},
    {name:'payload',type:'json',required:true},
    name==='social_weekly_sample_policy_review_revocations'
      ?{name:'decision_id',type:'text',required:true}
      :{name:'candidate_id',type:'text',required:true},
    ...(name==='social_weekly_sample_policy_review_decisions'?[{name:'operation_id',type:'text' as const,required:true}]:[]),
  ]);
  await ensureCollection('social_product_footage_reviews',[
    ...['tenant_id','material_id','product_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'payload',type:'json',required:true},
  ]);
  await ensureCollection('social_product_footage_revocations',[
    ...['tenant_id','material_id','approval_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'payload',type:'json',required:true},
  ]);
  await ensureCollection('social_product_footage_visual_reviews',[
    ...['tenant_id','material_id','product_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'payload',type:'json',required:true},
  ],[
    'CREATE INDEX idx_product_footage_visual_scope ON social_product_footage_visual_reviews (tenant_id,material_id)',
    'CREATE INDEX idx_product_footage_visual_product ON social_product_footage_visual_reviews (tenant_id,product_id)',
  ],true);
  await ensureCollection('social_apify_run_kv_mapping_receipts',[
    ...['tenant_id','package_id','job_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'payload',type:'json',required:true},
  ],[
    'CREATE INDEX idx_apify_run_kv_mapping_scope ON social_apify_run_kv_mapping_receipts (tenant_id,package_id,job_id)',
  ],true);
  await ensureCollection('social_weekly_account_collection_cost_ceilings',[
    ...['tenant_id','authorization_id','job_id','record_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'payload',type:'json',required:true},
  ],[
    'CREATE UNIQUE INDEX idx_weekly_account_cost_ceiling_job ON social_weekly_account_collection_cost_ceilings (tenant_id,authorization_id,job_id)',
  ],true);
  await ensureCollection('social_weekly_account_collection_provider_evidence',[
    ...['tenant_id','authorization_id','job_id','observed_at','valid_until','record_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'payload',type:'json',required:true},
  ],[
    'CREATE UNIQUE INDEX idx_weekly_account_provider_evidence_hash ON social_weekly_account_collection_provider_evidence (tenant_id,authorization_id,job_id,record_hash)',
  ],true);
  for(const name of [
    'social_weekly_candidate_canonical_media_operations',
    'social_weekly_candidate_canonical_media_read_receipts',
    'social_weekly_candidate_canonical_media_receipts',
  ])await ensureCollection(name,[
    {name:'tenant_id',type:'text',required:true},
    {name:'record_hash',type:'text',required:true},
    {name:'payload',type:'json',required:true},
  ],[`CREATE INDEX idx_${name}_tenant ON ${name} (tenant_id)`],true);
  await ensureCollection('reference_exact_shot_evidence', [...['tenant_id','record_id','source_sha256','analysis_run_id','analysis_hash','record_hash','created_at'].map(name=>({name,type:'text' as const,required:true})),{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_candidate_reference_analysis_handoffs',[
    ...['tenant_id','program_id','package_id','job_id','run_id','candidate_id','record_hash'].map(name=>({name,type:'text' as const,required:true})),
    {name:'package_version',type:'number',required:true},{name:'payload',type:'json',required:true},
  ]);
  await ensureWeeklyCandidatePostAnalysisCollection();
  await ensureCandidateSemanticCollections();
  await ensureWeeklyCandidateSemanticBudgetCollections();
  await ensureCollection('weekly_customer_knowledge_quote_requests',[...['tenant_id','program_id','package_id','run_id','request_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),{name:'package_version',type:'number',required:true},{name:'version',type:'number',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('customer_manual_takeovers',[...['tenant_id','scope_key','content_hash'].map(name=>({name,type:'text' as const,required:true})),{name:'version',type:'number',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_inventory_bindings',[...['tenant_id','program_id','target_package_id','publication_task_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),{name:'target_version',type:'number',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_cross_week_material_continuations',[...['tenant_id','program_id','target_package_id','source_request_id','target_consumer_task_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),{name:'target_version',type:'number',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_customer_channel_selections',[...['tenant_id','program_id','run_id','package_id','channel','record_hash'].map(name=>({name,type:'text' as const,required:true})),{name:'package_version',type:'number',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('customer_channel_send_requests',[{name:'active_key',type:'text',required:false},{name:'tenant_id',type:'text',required:true},{name:'request_key',type:'text',required:true},{name:'content_hash',type:'text',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_native_send_recoveries', [{name:'tenant_id',type:'text',required:true},{name:'program_id',type:'text',required:true},{name:'package_id',type:'text',required:true},{name:'package_version',type:'number',required:true},{name:'source_key',type:'text',required:true},{name:'content_hash',type:'text',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('starter_social_director_g5_reviews', [...['tenant_id','task_id','run_id','artifact_id','kind','content_hash'].map(name=>({name,type:'text' as const,required:true})),...['request_id','receipt_id'].map(name=>({name,type:'text' as const})),{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_platform_capability_evidence', [...['tenant_id','account_id','platform','capability','status','evidence_source','evidence_ref','verified_at','created_at','updated_at'].map(name=>({name,type:'text' as const,required:true})),...['expires_at','reason_code','account_identity_hash'].map(name=>({name,type:'text' as const}))]);
  await ensureCollection('starter_social_weekly_g6_reviews', [...['tenant_id','task_id','run_id','artifact_id','program_id','package_id','publication_task_id','request_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),{name:'package_version',type:'number',required:true},{name:'receipt_id',type:'text'},{name:'payload',type:'json',required:true}]);
  await ensureCollection('starter_social_instagram_deliveries', [...['tenant_id','task_id','run_id','artifact_id','program_id','package_id','publication_task_id','request_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),{name:'package_version',type:'number',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('starter_social_instagram_delivery_reviews', [...['tenant_id','delivery_id','kind','request_id','content_hash'].map(name=>({name,type:'text' as const,required:true})),{name:'payload',type:'json',required:true}]);
  await ensureCollection('starter_social_scene_g4_reviews', [...['tenant_id','task_id','run_id','artifact_id','kind','content_hash'].map(name=>({name,type:'text' as const,required:true})),...['request_id','receipt_id'].map(name=>({name,type:'text' as const})),{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_profile_upgrades', [{name:'tenant_id',type:'text',required:true},{name:'program_id',type:'text',required:true},{name:'package_id',type:'text',required:true},{name:'package_version',type:'number',required:true},{name:'target_week_start',type:'text',required:true},{name:'content_hash',type:'text',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_enterprise_fact_migrations', [{name:'tenant_id',type:'text',required:true},{name:'program_id',type:'text',required:true},{name:'package_id',type:'text',required:true},{name:'package_version',type:'number',required:true},{name:'state',type:'text',required:true},{name:'record_hash',type:'text',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_publication_recoveries', [{name:'tenant_id',type:'text',required:true},{name:'program_id',type:'text',required:true},{name:'package_id',type:'text',required:true},{name:'package_version',type:'number',required:true},{name:'source_key',type:'text',required:true},{name:'content_hash',type:'text',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_customer_send_recoveries', [{name:'tenant_id',type:'text',required:true},{name:'source_key',type:'text',required:true},{name:'content_hash',type:'text',required:true},{name:'payload',type:'json',required:true}]);
  await ensureCollection('social_weekly_deadline_assessments', [
    ...['tenant_id', 'program_id', 'package_id', 'assessment_id', 'evidence_hash', 'content_hash'].map(name => ({ name, type: 'text' as const, required: true })),
    { name: 'package_version', type: 'number', required: true }, { name: 'payload', type: 'json', required: true },
  ]);
  const templateCommon: FieldDef[] = [...['tenant_id', 'program_id', 'record_hash'].map(name => ({ name, type: 'text' as const, required: true })), { name: 'payload', type: 'json', required: true }];
  for (const name of ['social_content_template_candidates', 'social_content_template_confirmations']) await ensureCollection(name, [...templateCommon, { name: 'template_id', type: 'text', required: true }, { name: 'template_version', type: 'number', required: true }]);
  await ensureCollection('social_weekly_content_template_bindings', [...templateCommon, { name: 'package_id', type: 'text', required: true }, { name: 'package_version', type: 'number', required: true }, { name: 'publication_task_id', type: 'text', required: true }]);
  await ensureCollection('social_weekly_content_template_execution_selections', [...templateCommon, { name: 'package_id', type: 'text', required: true }, { name: 'package_version', type: 'number', required: true }, { name: 'task_id', type: 'text', required: true }]);
  await ensureCollection('social_weekly_supplement_requests', [
    { name: 'idempotency_key', type: 'text', required: true },
    { name: 'tenant_id', type: 'text', required: true }, { name: 'program_id', type: 'text', required: true },
    { name: 'package_id', type: 'text', required: true }, { name: 'package_version', type: 'number', required: true },
    { name: 'payload', type: 'json', required: true },
  ]);
  await ensureCollection('social_weekly_supplement_events', [
    { name: 'tenant_id', type: 'text', required: true }, { name: 'request_id', type: 'text', required: true },
    { name: 'version', type: 'number', required: true }, { name: 'payload', type: 'json', required: true },
  ]);
  const sceneReworkFields: FieldDef[] = [...['tenant_id', 'task_id', 'run_id', 'parent_artifact_id', 'content_hash'].map(name => ({ name, type: 'text' as const, required: true })), { name: 'payload', type: 'json', required: true }];
  await ensureCollection('starter_social_scene_media_caches', sceneReworkFields);
  await ensureCollection('starter_social_scene_rework_intents', [...sceneReworkFields, { name: 'operation_id', type: 'text', required: true }, { name: 'execution', type: 'json', required: false }]);
  await ensureCollection('starter_social_scene_rework_cost_policies', [
    { name: 'tenant_id', type: 'text', required: true }, { name: 'operation_id', type: 'text', required: true },
    { name: 'content_hash', type: 'text', required: true }, { name: 'payload', type: 'json', required: true },
  ]);
  await ensureCollection('social_weekly_material_evidence_configurations', MATERIAL_EVIDENCE_CONFIGURATION_FIELDS);
  await ensureCollection('social_customer_relationship_confirmations', [...['tenant_id', 'customer_id', 'record_hash'].map(name => ({ name, type: 'text' as const, required: true })), { name: 'payload', type: 'json', required: true }]);
  await ensureCollection('social_customer_feedback_topic_candidates', [...CUSTOMER_FEEDBACK_TOPIC_FIELDS, { name: 'source_package_id', type: 'text', required: true }, { name: 'source_package_version', type: 'number', required: true }]);
  await ensureCollection('social_customer_feedback_topic_confirmations', [...CUSTOMER_FEEDBACK_TOPIC_FIELDS, { name: 'target_package_id', type: 'text', required: true }, { name: 'target_package_version', type: 'number', required: true }, { name: 'publication_task_id', type: 'text', required: true }]);
  await ensureCollection('studio_presenter_assets', [
    { name: 'tenant_id', type: 'text', required: true },
    { name: 'request_id', type: 'text', required: true },
    { name: 'kind', type: 'text', required: true },
    { name: 'payload', type: 'json', required: true },
  ]);
  await ensureCollection('customer_points_wallets', [
    { name: 'tenant_id', type: 'text', required: true },
    { name: 'schema_version', type: 'text', required: true },
    { name: 'revision', type: 'number', required: true },
    { name: 'wallet', type: 'json', required: true },
    { name: 'updated_at', type: 'text', required: true },
  ], [
    'CREATE UNIQUE INDEX idx_customer_points_wallet_tenant ON customer_points_wallets (tenant_id)',
    'CREATE INDEX idx_customer_points_wallet_updated ON customer_points_wallets (updated_at)',
  ], true);
  await ensureCollection('customer_points_events', [
    ...['tenant_id', 'event_id', 'operation_id', 'event_type', 'section', 'feature_rate_id', 'occurred_at'].map(name => ({ name, type: 'text' as const })),
    { name: 'points', type: 'number', required: true },
    { name: 'payload', type: 'json', required: true },
  ], [
    'CREATE UNIQUE INDEX idx_customer_points_event_identity ON customer_points_events (tenant_id, event_id)',
    'CREATE INDEX idx_customer_points_event_operation ON customer_points_events (tenant_id, operation_id)',
    'CREATE INDEX idx_customer_points_event_time ON customer_points_events (tenant_id, occurred_at)',
  ], true);
  await ensureCollection('platform_ad_worker_health', [
    ...'tenant_id workerId state lastStartedAt lastCompletedAt lastFailedAt nextCheckAt updatedAt'.split(' ').map(name => ({ name, type: 'text' as const })),
  ]);
  await ensureCollection('platform_ad_metric_snapshots', [
    ...'tenant_id provider accountId campaignId date currency metricDefinition metricLabel reportedAt reportTimezone updatedAt'.split(' ').map(name => ({ name, type: 'text' as const })),
    { name: 'values', type: 'json' }, { name: 'taskIds', type: 'json' },
  ]);
  await ensureCollection('platform_ad_creatives', [
    ...['tenant_id', 'taskId', 'sourceTaskId', 'artifactId', 'fileRef', 'sha256', 'mimeType', 'name', 'connectionId', 'provider', 'platformVideoId', 'status', 'createdAt', 'updatedAt', 'attemptId', 'uploadError', 'uploadStartedAt'].map(name => ({ name, type: 'text' as const })),
    ...['size', 'taskVersion'].map(name => ({ name, type: 'number' as const })),
    { name: 'uploadReceipt', type: 'json' },
  ]);
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
    { name: 'decision', type: 'json' },
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
  await ensureCollection('tenant_profiles', TENANT_PROFILE_FIELDS, [
    'CREATE UNIQUE INDEX idx_tenant_profile_owner ON tenant_profiles (tenant_id)',
  ]);
  await ensureCollection('enterprise_onboarding_drafts', ENTERPRISE_ONBOARDING_DRAFT_FIELDS, [
    'CREATE UNIQUE INDEX idx_enterprise_onboarding_draft_owner ON enterprise_onboarding_drafts (tenant_id, user_id)',
  ]);
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
    const hasShotReview = fields.some(field => field.name === 'referenceShotReview');
    const hasVerifiedSpeech = fields.some(field => field.name === 'referenceVerifiedSpeech');
    const needsAnalysisExpansion = Boolean(analysis && Number(analysis.max || 0) < requiredMax);
    if (!needsAnalysisExpansion && hasContentFormat && hasShotReview && hasVerifiedSpeech) return;
    const nextFields = fields
      .map(field => field.name === 'aiAnalysis' && needsAnalysisExpansion ? { ...field, max: requiredMax } : field)
      .concat(hasContentFormat ? [] : [newField({ name: 'contentFormat', type: 'select', values: ['video', 'image'] })])
      .concat(hasShotReview ? [] : [{ ...newField({ name: 'referenceShotReview', type: 'text' }), max: 1_000_000 }])
      .concat(hasVerifiedSpeech ? [] : [{ ...newField({ name: 'referenceVerifiedSpeech', type: 'text' }), max: 1_000_000 }]);
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
  const hasShotReview = schema.some(field => field.name === 'referenceShotReview');
  const hasVerifiedSpeech = schema.some(field => field.name === 'referenceVerifiedSpeech');
  const needsAnalysisExpansion = Boolean(analysis && Number(analysis.options?.max || 0) < requiredMax);
  if (!needsAnalysisExpansion && hasContentFormat && hasShotReview && hasVerifiedSpeech) return;
  const nextSchema = schema
    .map(field => field.name === 'aiAnalysis' && needsAnalysisExpansion ? { ...field, options: { ...(field.options ?? {}), max: requiredMax } } : field)
    .concat(hasContentFormat ? [] : [oldSchemaField({ name: 'contentFormat', type: 'select', values: ['video', 'image'] })])
    .concat(hasShotReview ? [] : [{ ...oldSchemaField({ name: 'referenceShotReview', type: 'text' }), options: { max: 1_000_000 } }])
    .concat(hasVerifiedSpeech ? [] : [{ ...oldSchemaField({ name: 'referenceVerifiedSpeech', type: 'text' }), options: { max: 1_000_000 } }]);
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
