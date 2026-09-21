import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';

const previous = {
  NODE_ENV: process.env.NODE_ENV,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  PB_URL: process.env.PB_URL,
  cwd: process.cwd(),
};
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-social-content-test-'));
process.chdir(temporaryRoot);
process.env.NODE_ENV = 'test';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.PB_URL = 'http://127.0.0.1:1';

type Row = Record_ & Record<string, unknown>;

function completeFormulaDirection() {
  return {
    pace: 'balanced',
    visualStyle: '真实产品实拍，克制的 B2B 商务质感，不使用无法核验的效果画面',
    music: {
      mood: '清晰、专业', volume: 18, strategy: '开头建立节奏，口播期间自动压低，结尾轻收束',
      sourceType: 'licensed_library', licenseVerified: true, licenseReference: 'music-library:professional-clean-v1',
    },
    voiceover: { voice: 'v1', preset: 'professional_b2b', speed: 1.1, pauseStyle: 'natural' },
    subtitles: { fontScale: 1, bottomRatio: 0.18, styleIntent: '高对比单行字幕，不能遮挡产品主体' },
    cover: {
      intent: '第一眼说明产品价值且不夸大功效',
      headlineTemplate: { zh: '{{product}}真实卖点', en: 'Verified value of {{product}}' },
      subject: '产品与一项可核验证据', composition: '主体居中偏下，标题位于安全区上方',
    },
    materialFallback: {
      minimumUsableClips: 1, allowStillFrames: true, allowRepeatedClips: false, maxRepeatCount: 0,
      insufficientMaterialAction: 'adapt_with_verified_assets',
    },
    risks: {
      prohibitedClaims: ['禁止无证据的绝对化功效'],
      prohibitedVisuals: ['禁止使用未获授权的人脸或品牌标识'],
      mandatoryDisclosures: [],
    },
    acceptanceGates: [
      { gateId: 'qc_grounding', name: '事实可追溯', rule: '脚本中的产品信息必须来自已核验知识或可见素材', blocking: true },
      { gateId: 'qc_rights', name: '音乐授权', rule: '配乐必须带有可核验授权引用', blocking: true },
    ],
  };
}

function completeFormulaNode(nodeId: string, overrides: Record<string, unknown> = {}) {
  return {
    nodeId,
    shotFunction: '展示产品与证据', subject: '产品与检测证据', action: '同框展示', environment: '干净的产品展示台',
    orientation: 'portrait', durationSeconds: { minimum: 3, maximum: 8 }, required: true,
    shotType: 'product_demo', shotSize: 'close_up', cameraMovement: 'push_in',
    composition: '产品主体位于中央安全区，证据标签保持清晰', transition: 'cut',
    narrationTemplate: {
      zh: '围绕{{topic}}，用真实素材展示{{product}}与可核验证据。{{callToAction}}',
      en: 'For {{topic}}, use real material to show {{product}} with verifiable evidence. {{callToAction}}',
    },
    scriptTemplate: { zh: '脚本：{{shotFunction}}，{{subject}}，{{action}}。', en: 'Script: {{shotFunction}}, {{subject}}, {{action}}.' },
    voiceoverTemplate: { zh: '口播：用真实素材展示{{product}}。', en: 'Voice: show {{product}} with real material.' },
    captionTemplate: { zh: '字幕：真实素材展示', en: 'Caption: real material' },
    ...overrides,
  };
}

class MemoryStore implements DataStore {
  readonly rows = new Map<string, Row[]>();
  private sequence = 0;

  constructor(collections: string[]) {
    for (const name of collections) this.rows.set(name, []);
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection)?.find(row => row.id === id) as T | undefined) ?? null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const bucket = this.rows.get(collection) ?? [];
    const duplicate = collection === 'durable_operation_leases'
      ? bucket.some(row => row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)
      : collection === 'starter_social_content_operations'
        ? bucket.some(row => row.tenant_id === data.tenant_id && row.idempotency_key === data.idempotency_key)
        : collection === 'starter_social_content_tasks'
          ? bucket.some(row => row.tenant_id === data.tenant_id && row.create_idempotency_key === data.create_idempotency_key)
          : 'last_operation_id' in data
            ? bucket.some(row => row.tenant_id === data.tenant_id && row.last_operation_id === data.last_operation_id)
            : false;
    if (duplicate) return null;
    this.sequence += 1;
    const row = { id: String(data.id || `row${String(this.sequence).padStart(12, '0')}`), ...structuredClone(data) } as Row;
    bucket.push(row);
    this.rows.set(collection, bucket);
    return structuredClone(row) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const row = this.rows.get(collection)?.find(item => item.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(data));
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const bucket = this.rows.get(collection) ?? [];
    const index = bucket.findIndex(row => row.id === id);
    if (index < 0) return false;
    bucket.splice(index, 1);
    return true;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}) {
    let items = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      items = [...items].sort((left, right) => String(left[key] ?? '').localeCompare(String(right[key] ?? '')) * (descending ? -1 : 1));
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return {
      items: items.slice((page - 1) * perPage, page * perPage).map(item => structuredClone(item)) as T[],
      totalItems: items.length,
      totalPages: Math.ceil(items.length / perPage),
      page,
      perPage,
    };
  }
}

const [
  { createStarter198Repository, STARTER_COLLECTIONS },
  { createSocialContentRouter },
  { STARTER_198_CAPABILITIES },
  { isStarter198BoundaryExemptPath },
  { assertSocialTaskCapacity, assertSocialTaskChildCapacity, socialTaskFileCapacity },
  { createStarter198OrchestratorQueue },
  { assertSocialContentSubjectLease, runOutsideSocialContentMutationScope, withSocialContentSubjectLease },
  { MAX_SOCIAL_WORK_PACKAGE_VERSIONS, SOCIAL_PACKAGE_CATALOG_TENANT },
  { issueLocalIdentityTokenForTest },
] = await Promise.all([
  import('./repository.js'),
  import('./socialContentRouter.js'),
  import('../../shared/contracts/starter198.js'),
  import('./legacyBoundary.js'),
  import('./socialContentLimits.js'),
  import('./orchestratorQueue.js'),
  import('./socialContentMutation.js'),
  import('./socialWorkPackages.js'),
  import('../auth/localIdentity.js'),
]);

const tenant = 'social-content-tenant';
const victim = 'social-content-victim';
const collections = [...Object.values(STARTER_COLLECTIONS), 'durable_operation_leases'];
const dataStore = new MemoryStore(collections);
const limits = {
  workspaceCount: 1, brandCount: 1, memberCount: 3, agentTeamCount: 1,
  productCount: 1, marketCount: 1, buyerPersonaCount: 2, languageCount: 2,
  primaryPlatformCount: 2, concurrentRunCount: 1, contentArtifactCountPerCycle: 20,
  contentRevisionCountPerCycle: 3, publicationPackageCountPerContent: 2,
  assistedSessionCount: 5, inquiryAiCountPerCycle: 100, quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0, budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};
for (const tenantId of [tenant, victim]) {
  dataStore.rows.get(STARTER_COLLECTIONS.access)!.push({
    id: `access-${tenantId}`,
    tenant_id: tenantId,
    product_profile: 'starter_198',
    profile_version: 'starter_198.v1',
    entitlement_snapshot_id: `snapshot-${tenantId}`,
    feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
    resource_limits: limits,
    status: 'active',
    cycle_started_at: '2026-09-01T00:00:00.000Z',
    cycle_ends_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-09-14T00:00:00.000Z',
  });
}

const repository = createStarter198Repository(dataStore);
const orchestratorInputs: Record<string, unknown>[] = [];
const sourceOptionFor = (tenantId: string) => ({
  optionId: 'knowledge:enterprise-profile',
  kind: 'knowledge' as const,
  sourceRef: 'socialknowledge:enterprise-profile',
  sourceVersion: `profile-${tenantId}`,
  label: `${tenantId} 企业知识`,
  type: 'enterprise_profile',
  thumbnailHref: null,
});
const sourceOptionsPort = {
  async list(input: { tenantId: string; kind?: 'knowledge' | 'material' }) {
    const item = sourceOptionFor(input.tenantId);
    const items = !input.kind || input.kind === item.kind ? [item] : [];
    return { items, page: 1, perPage: 20, totalItems: items.length, totalPages: items.length ? 1 : 0, status: 'ready' as const };
  },
  async resolve(input: { tenantId: string; kind: 'knowledge' | 'material'; sourceRef: string }) {
    const item = sourceOptionFor(input.tenantId);
    return item.kind === input.kind && item.sourceRef === input.sourceRef ? item : null;
  },
};
const backendPayloads = new Map<string, { buf: Buffer; contentType: string }>();
const backendFilePort = {
  async attach(input: { collection: string; recordId: string; name: string; path: string; contentType: string }) {
    const filename = `${input.recordId}-${path.basename(input.name)}`;
    backendPayloads.set(`${input.collection}/${input.recordId}/${filename}`, {
      buf: fs.readFileSync(input.path), contentType: input.contentType,
    });
    return filename;
  },
  async fetch(input: { collection: string; recordId: string; filename: string }) {
    return backendPayloads.get(`${input.collection}/${input.recordId}/${input.filename}`) || null;
  },
};
const materialRows = new Map<string, Record<string, any>>();
const socialTaskMaterialPort = {
  async upsert(input: Record<string, any>) {
    const key = `${input.tenantId}:${input.sha256}`;
    const current = materialRows.get(key);
    const sourceTaskIds = Array.from(new Set([...(current?.sourceTaskIds || []), input.taskId]));
    const sourceTaskFileRefs = Array.from(new Set([...(current?.sourceTaskFileRefs || []), input.taskFileRef]));
    const productRefs = Array.from(new Set([...(current?.productRefs || []), input.productRef].filter(Boolean)));
    const row = {
      ...current,
      id: current?.id || `pb-material-${materialRows.size + 1}`,
      name: input.title,
      type: input.type,
      sourceType: 'social_task_upload',
      sourceRevision: input.sha256,
      contentSha256: input.sha256,
      sha256: input.sha256,
      productId: '',
      productRef: input.productRef || '',
      productName: input.productRef || '',
      sourceTaskIds,
      sourceTaskFileRefs,
      productRefs,
      createdAt: '2026-09-14T08:00:00.000Z',
    };
    materialRows.set(key, row);
    return row;
  },
};
const productionQueue = createStarter198OrchestratorQueue({ repository, dataStore });
const productionQueueInputs: Parameters<typeof productionQueue.enqueue>[0][] = [];
let interruptNextProductionQueue = false;
const observedProductionQueue = {
  async enqueue(input: Parameters<typeof productionQueue.enqueue>[0]) {
    productionQueueInputs.push(structuredClone(input));
    if (interruptNextProductionQueue) {
      interruptNextProductionQueue = false;
      throw new Error('simulated scheduler interruption after pre-start reconciliation');
    }
    return productionQueue.enqueue(input);
  },
};
const router = createSocialContentRouter({
  repository,
  resolveRole: async request => String(request.headers['x-test-role'] || 'operator'),
  platformAdmin: async request => request.headers['x-platform-admin'] === 'yes' ? { userId: 'platform-admin' } : null,
  sourceOptions: sourceOptionsPort,
  backendFilePort,
  socialTaskMaterialPort,
  orchestratorQueue: {
    async enqueue(input) {
      orchestratorInputs.push(structuredClone(input) as unknown as Record<string, unknown>);
      return { queueItemId: 'social-queue-item', runId: 'social-run-1', disposition: 'queued', missingFacts: [] };
    },
  },
  now: () => new Date('2026-09-14T08:00:00.000Z'),
});

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use('/api/overseas/starter-198/social-content', router);
app.use('/api/default-social-content', createSocialContentRouter({
  repository,
  resolveRole: async request => String(request.headers['x-test-role'] || 'operator'),
  platformAdmin: async request => request.headers['x-platform-admin'] === 'yes' ? { userId: 'platform-admin' } : null,
  sourceOptions: sourceOptionsPort,
  backendFilePort,
  socialTaskMaterialPort,
  orchestratorQueue: observedProductionQueue,
  now: () => new Date('2026-09-14T08:00:00.000Z'),
}));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind');
const origin = `http://127.0.0.1:${address.port}`;

function token(tenantId: string): string {
  return issueLocalIdentityTokenForTest({ userId: `${tenantId}-user`, tenantId });
}

async function request(pathname: string, options: {
  tenantId?: string;
  role?: string;
  idempotencyKey?: string;
  platformAdmin?: boolean;
  method?: string;
  body?: unknown;
  rawBody?: Buffer;
  contentType?: string;
} = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: options.method ?? (options.body !== undefined || options.rawBody ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${token(options.tenantId ?? tenant)}`,
      'X-Test-Role': options.role ?? 'operator',
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...(options.platformAdmin ? { 'X-Platform-Admin': 'yes' } : {}),
      ...(options.rawBody ? { 'Content-Type': options.contentType ?? 'application/octet-stream' } : options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const raw = bytes.toString('utf8');
  return {
    status: response.status,
    body: response.headers.get('content-type')?.includes('json') && raw ? JSON.parse(raw) as Record<string, any> : {},
    raw,
    bytes,
    contentType: response.headers.get('content-type'),
    contentDisposition: response.headers.get('content-disposition'),
  };
}

const completeBrief = {
  title: '秋季新品内容', objective: '制作新品介绍内容', productRef: 'product:chair', audience: '海外家具采购商',
  markets: ['US'], languages: ['en'], platforms: ['instagram'], formats: ['short_video'], aspectRatio: '9:16',
  cadence: '每周两次', requestedOutputCount: 2, weeklyBudgetCny: 2_000, perItemBudgetCny: 600,
  retryReserveCny: 300, planningMode: 'auto_adjust', shootingWindowMinutes: 30,
  specialRequirements: '新品先验证代表样片', restrictions: ['不得虚构认证'], callToAction: '访问产品页',
};

try {
  let detachedMutation: Promise<void> | null = null;
  await withSocialContentSubjectLease({
    repository,
    tenantId: tenant,
    subjectId: 'deferred-worker-scope-regression',
    action: async () => {
      detachedMutation = runOutsideSocialContentMutationScope(() => new Promise<void>((resolve, reject) => {
        setImmediate(() => {
          withSocialContentSubjectLease({
            repository,
            tenantId: tenant,
            subjectId: 'deferred-worker-scope-regression',
            action: async () => assertSocialContentSubjectLease({
              repository,
              tenantId: tenant,
              subjectId: 'deferred-worker-scope-regression',
            }),
          }).then(resolve, reject);
        });
      }));
    },
  });
  await detachedMutation;

  assert.equal(isStarter198BoundaryExemptPath('/api/overseas/starter-198/social-content/tasks'), true);
  assert.equal(isStarter198BoundaryExemptPath('/api/overseas/social/accounts'), false, 'unrelated legacy social routes stay blocked');

  const workflowRowsBefore = dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.length;
  await assert.rejects(
    productionQueue.enqueue({
      tenantId: tenant,
      userId: `${tenant}-user`,
      commandId: 'socialop_failclosed',
      input: '社媒内容任务',
      idempotencyKey: 'social-failclosed-queue',
      workflowScope: 'social_content',
      subject: {
        type: 'social_content_task', id: 'socialtask_failclosed', admissionVersion: '1', version: '1',
        sourceRefs: [], packageSelection: [], conversionObjective: false,
      },
    }),
    (error: any) => error?.code === 'social_content_schedule_receipt_not_found' && error?.status === 409,
  );
  assert.equal(dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.length, workflowRowsBefore, 'unbound social enqueue creates no legacy task graph');

  const workspace = await request('/api/overseas/starter-198/social-content');
  assert.equal(workspace.status, 200);
  assert.deepEqual(workspace.body.catalog.map((item: any) => item.name), ['行业起航包', '内容火箭包', '任务飞车包']);
  assert.deepEqual(workspace.body.taskList, { page: 1, perPage: 50, totalItems: 0, totalPages: 0 });
  assert.deepEqual(workspace.body.tasks, []);
  assert.doesNotMatch(workspace.raw, /qualityChecks|fallbackPolicy|workOutline/, 'customer catalog must not expose internal configuration');

  const sourceOptions = await request('/api/overseas/starter-198/social-content/source-options?kind=knowledge');
  assert.equal(sourceOptions.status, 200);
  assert.equal(sourceOptions.body.items[0].sourceVersion, `profile-${tenant}`);

  const durableCreated = await request('/api/default-social-content/tasks', {
    idempotencyKey: 'social-durable-create', body: { ...completeBrief, title: '默认调度路径' },
  });
  assert.equal(durableCreated.status, 201);
  const durableTaskId = durableCreated.body.task.taskId as string;
  const durableReference = await request(`/api/default-social-content/tasks/${durableTaskId}/sources`, {
    idempotencyKey: 'social-durable-reference',
    body: { kind: 'reference_link', sourceRef: 'https://example.com/durable-source', label: '产品参考素材' },
  });
  assert.equal(durableReference.status, 201, durableReference.raw);
  const durableKnowledge = await request(`/api/default-social-content/tasks/${durableTaskId}/sources`, {
    idempotencyKey: 'social-durable-knowledge',
    body: {
      kind: 'knowledge', sourceRef: sourceOptions.body.items[0].sourceRef,
      sourceVersion: sourceOptions.body.items[0].sourceVersion, label: sourceOptions.body.items[0].label,
    },
  });
  assert.equal(durableKnowledge.status, 201);
  assert.equal(durableKnowledge.body.task.status, 'draft');
  const durableUpload = await request(`/api/default-social-content/tasks/${durableTaskId}/files?usage=source&name=durable-source.txt`, {
    idempotencyKey: 'social-durable-file', rawBody: Buffer.from('durable production material'), contentType: 'text/plain',
  });
  const durableMaterial = await request(`/api/default-social-content/tasks/${durableTaskId}/sources`, {
    idempotencyKey: 'social-durable-material',
    body: {
      kind: 'material', sourceRef: durableUpload.body.file.fileRef,
      sourceVersion: durableUpload.body.file.sha256, label: '真实制作素材',
    },
  });
  assert.equal(durableMaterial.status, 201, durableMaterial.raw);
  assert.equal(durableMaterial.body.task.status, 'plan_review');
  const durableStarted = await request(`/api/default-social-content/tasks/${durableTaskId}/start`, {
    idempotencyKey: 'social-durable-start',
    body: { expectedVersion: durableMaterial.body.task.version },
  });
  assert.equal(durableStarted.status, 202, 'automatic production is durably queued after admission');
  assert.equal(durableStarted.body.task.status, 'producing');
  assert.match(durableStarted.body.task.runId, /^[a-f0-9]{15}$/,
    'automatic production receives a durable, recoverable run identity');
  assert.equal(durableStarted.body.nextAction, undefined, 'automatic production never redirects to the legacy Studio flow');
  const manualRun = dataStore.rows.get(STARTER_COLLECTIONS.runs)!
    .find(row => row.id === durableStarted.body.task.runId)!;
  assert.equal(manualRun.product_profile, 'starter_social_content');
  assert.equal(manualRun.status, 'running');
  assert.equal(manualRun.current_controller, 'agent');
  const automaticExecutionTasks = dataStore.rows.get(STARTER_COLLECTIONS.tasks)!
    .filter(row => row.run_id === durableStarted.body.task.runId);
  assert.equal(automaticExecutionTasks.length, 1);
  assert.equal(automaticExecutionTasks[0]?.task_key, 'social_content_auto_production');
  assert.match(String(automaticExecutionTasks[0]?.title), /编导 Agent.*内容 Agent/);
  assert.equal((automaticExecutionTasks[0]?.output as any)?.productionPolicy, 'director_plan_then_content_render');
  assert.deepEqual((automaticExecutionTasks[0]?.output as any)?.workflowStages, [
    'director_planning', 'content_production', 'rendering', 'quality_check', 'review_ready',
  ]);
  assert.equal(automaticExecutionTasks[0]?.status, 'running');
  assert.equal(automaticExecutionTasks[0]?.automatic_execution_allowed, true);
  const durableTaskRow = dataStore.rows.get(STARTER_COLLECTIONS.socialContentTasks)!
    .find(row => row.task_id === durableTaskId)!;
  assert.match(String(durableTaskRow.orchestrator_item_id), /^social-content:[a-f0-9]{32}$/);
  assert.equal(durableTaskRow.last_operation_id,
    dataStore.rows.get(STARTER_COLLECTIONS.socialContentOperations)!
      .find(row => row.idempotency_key === 'social-durable-start')?.operation_id,
    'the task schedule marker and durable operation receipt share one operation identity');
  const durableReplay = await request(`/api/default-social-content/tasks/${durableTaskId}/start`, {
    idempotencyKey: 'social-durable-start',
    body: { expectedVersion: durableMaterial.body.task.version },
  });
  assert.equal(durableReplay.status, 202);
  assert.equal(durableReplay.body.task.version, durableStarted.body.task.version);
  assert.equal(dataStore.rows.get(STARTER_COLLECTIONS.socialContentOperations)!
    .filter(row => row.idempotency_key === 'social-durable-start').length, 1);
  const durableStartOperation = dataStore.rows.get(STARTER_COLLECTIONS.socialContentOperations)!
    .find(row => row.idempotency_key === 'social-durable-start')!;
  durableStartOperation.status = 'processing';
  durableStartOperation.result = {};
  const durableRecovered = await request(`/api/default-social-content/tasks/${durableTaskId}/start`, {
    idempotencyKey: 'social-durable-start',
    body: { expectedVersion: durableMaterial.body.task.version },
  });
  assert.equal(durableRecovered.status, 202);
  assert.equal(durableRecovered.body.task.version, durableStarted.body.task.version,
    'recovery finalizes the receipt without scheduling or versioning the task twice');
  assert.equal(durableStartOperation.status, 'succeeded');
  const durableConflict = await request(`/api/default-social-content/tasks/${durableTaskId}/start`, {
    idempotencyKey: 'social-durable-start',
    body: { expectedVersion: durableStarted.body.task.version },
  });
  assert.equal(durableConflict.status, 409, 'one idempotency key cannot schedule a different task version');
  assert.equal(dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.length, workflowRowsBefore + 1,
    'the dedicated scheduler creates only its automatic production checkpoint, not inquiry or quotation tasks');

  const scheduleRaceCreated = await request('/api/default-social-content/tasks', {
    idempotencyKey: 'social-schedule-race-create', body: { ...completeBrief, title: '并发调度校验' },
  });
  const scheduleRaceTaskId = scheduleRaceCreated.body.task.taskId as string;
  await request(`/api/default-social-content/tasks/${scheduleRaceTaskId}/sources`, {
    idempotencyKey: 'social-schedule-race-reference',
    body: { kind: 'reference_link', sourceRef: 'https://example.com/race-source', label: '并发校验素材' },
  });
  const scheduleRaceKnowledge = await request(`/api/default-social-content/tasks/${scheduleRaceTaskId}/sources`, {
    idempotencyKey: 'social-schedule-race-knowledge',
    body: {
      kind: 'knowledge', sourceRef: sourceOptions.body.items[0].sourceRef,
      sourceVersion: sourceOptions.body.items[0].sourceVersion, label: sourceOptions.body.items[0].label,
    },
  });
  const scheduleRaceUpload = await request(`/api/default-social-content/tasks/${scheduleRaceTaskId}/files?usage=source&name=race-source.txt`, {
    idempotencyKey: 'social-schedule-race-file', rawBody: Buffer.from('race production material'), contentType: 'text/plain',
  });
  const scheduleRaceMaterial = await request(`/api/default-social-content/tasks/${scheduleRaceTaskId}/sources`, {
    idempotencyKey: 'social-schedule-race-material',
    body: {
      kind: 'material', sourceRef: scheduleRaceUpload.body.file.fileRef,
      sourceVersion: scheduleRaceUpload.body.file.sha256, label: '并发真实素材',
    },
  });
  const racedStarts = await Promise.all(['a', 'b'].map(suffix => request(
    `/api/default-social-content/tasks/${scheduleRaceTaskId}/start`,
    {
      idempotencyKey: `social-schedule-race-${suffix}`,
      body: { expectedVersion: scheduleRaceMaterial.body.task.version },
    },
  )));
  assert.deepEqual(racedStarts.map(result => result.status).sort(), [202, 409],
    'one durable subject lease admits only one start for a task version');
  const scheduleRaceRead = await request(`/api/default-social-content/tasks/${scheduleRaceTaskId}`);
  assert.equal(scheduleRaceRead.body.task.status, 'producing');
  assert.equal(dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.length, workflowRowsBefore + 2,
    'each automatic social order has one isolated execution checkpoint');

  const durableRevisionArtifact = await request(
    `/api/default-social-content/tasks/${durableTaskId}/artifacts`,
    {
      idempotencyKey: 'social-durable-revision-artifact',
      body: { kind: 'publish_copy', origin: 'manual', content: { body: '等待真实调度器重制的成果' } },
    },
  );
  assert.equal(durableRevisionArtifact.status, 201, durableRevisionArtifact.raw);
  const durableRevisionDecision = await request(
    `/api/default-social-content/tasks/${durableTaskId}/artifacts/${durableRevisionArtifact.body.artifact.artifactId}/decision`,
    {
      idempotencyKey: 'social-durable-revision-decision',
      body: {
        expectedVersion: durableRevisionArtifact.body.artifact.version,
        decision: 'changes_requested',
        note: '开头更直接，口播保持完整自然',
      },
    },
  );
  assert.equal(durableRevisionDecision.status, 200, durableRevisionDecision.raw);
  assert.equal(durableRevisionDecision.body.task.status, 'producing',
    'a rejected artifact must pass the durable receipt check and enter a replacement run');
  const durableRevisionStart = dataStore.rows.get(STARTER_COLLECTIONS.socialContentOperations)!
    .find(row => String(row.idempotency_key).startsWith('social-revision-start:'))!;
  assert.equal(durableRevisionStart.status, 'succeeded');
  const durableRevisionQueueInput = productionQueueInputs.at(-1)!;
  assert.notEqual(durableRevisionQueueInput.subject?.admissionVersion, durableRevisionQueueInput.subject?.version,
    'revision projection advances independently of the version admitted by the start mutation');
  assert.equal(
    durableRevisionStart.request_hash,
    (await import('./socialContentValidation.js')).socialRequestHash({
      expectedVersion: durableRevisionQueueInput.subject?.admissionVersion,
    }),
    'the durable receipt stays bound to the admitted version, not the reconciled execution snapshot',
  );
  await assert.rejects(
    productionQueue.enqueue({
      ...durableRevisionQueueInput,
      subject: {
        ...durableRevisionQueueInput.subject!,
        admissionVersion: durableRevisionQueueInput.subject!.version,
      },
    }),
    (error: any) => error?.code === 'social_content_schedule_receipt_integrity_violation' && error?.status === 503,
    'changing the admitted version cannot reuse a valid durable start receipt',
  );

  const interruptedRevisionArtifact = await request(
    `/api/default-social-content/tasks/${scheduleRaceTaskId}/artifacts`,
    {
      idempotencyKey: 'social-interrupted-revision-artifact',
      body: { kind: 'publish_copy', origin: 'manual', content: { body: '等待中断恢复的成果' } },
    },
  );
  assert.equal(interruptedRevisionArtifact.status, 201, interruptedRevisionArtifact.raw);
  const interruptedDecisionInput = {
    expectedVersion: interruptedRevisionArtifact.body.artifact.version,
    decision: 'changes_requested',
    note: '请重新生成完整口播',
  };
  interruptNextProductionQueue = true;
  const interruptedRevision = await request(
    `/api/default-social-content/tasks/${scheduleRaceTaskId}/artifacts/${interruptedRevisionArtifact.body.artifact.artifactId}/decision`,
    {
      idempotencyKey: 'social-interrupted-revision-decision',
      body: interruptedDecisionInput,
    },
  );
  assert.equal(interruptedRevision.status, 503, interruptedRevision.raw);
  const recoveredRevision = await request(
    `/api/default-social-content/tasks/${scheduleRaceTaskId}/artifacts/${interruptedRevisionArtifact.body.artifact.artifactId}/decision`,
    {
      idempotencyKey: 'social-interrupted-revision-decision',
      body: interruptedDecisionInput,
    },
  );
  assert.equal(recoveredRevision.status, 200, recoveredRevision.raw);
  assert.equal(recoveredRevision.body.task.status, 'producing',
    'the same outer receipt resumes an interrupted nested start without resetting its admitted version');

  const missingIdempotency = await request('/api/overseas/starter-198/social-content/tasks', { body: completeBrief });
  assert.equal(missingIdempotency.status, 400);

  const created = await request('/api/overseas/starter-198/social-content/tasks', {
    idempotencyKey: 'social-create-0001', body: completeBrief,
  });
  assert.equal(created.status, 201);
  const taskId = created.body.task.taskId as string;
  assert.equal(created.body.task.status, 'draft');
  assert.equal(created.body.task.brief.aspectRatio, '9:16');
  assert.equal(created.body.task.brief.cadence, '每周两次');
  assert.equal(created.body.task.brief.weeklyBudgetCny, 2_000);
  assert.equal(created.body.task.brief.planningMode, 'auto_adjust');
  assert.equal(created.body.task.brief.shootingWindowMinutes, 30);
  assert.equal(created.body.task.packageSelection.length, 3);

  const replay = await request('/api/overseas/starter-198/social-content/tasks', {
    idempotencyKey: 'social-create-0001', body: completeBrief,
  });
  assert.equal(replay.body.task.taskId, taskId);
  const conflict = await request('/api/overseas/starter-198/social-content/tasks', {
    idempotencyKey: 'social-create-0001', body: { ...completeBrief, title: '另一个任务' },
  });
  assert.equal(conflict.status, 409);

  const concurrentUpdates = await Promise.all([
    request(`/api/overseas/starter-198/social-content/tasks/${taskId}`, {
      method: 'PATCH', idempotencyKey: 'social-race-update-a',
      body: { expectedVersion: created.body.task.version, changes: { cadence: '每周三次' } },
    }),
    request(`/api/overseas/starter-198/social-content/tasks/${taskId}`, {
      method: 'PATCH', idempotencyKey: 'social-race-update-b',
      body: { expectedVersion: created.body.task.version, changes: { cadence: '每周四次' } },
    }),
  ]);
  assert.deepEqual(concurrentUpdates.map(result => result.status).sort(), [200, 409]);
  const afterRace = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}`);
  assert.equal(afterRace.body.task.version, '2', 'one optimistic-concurrency winner advances the task exactly once');

  const victimRead = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}`, { tenantId: victim });
  assert.equal(victimRead.status, 404, 'a public task id cannot cross the tenant boundary');
  const customerServiceWrite = await request('/api/overseas/starter-198/social-content/tasks', {
    role: 'customer_service', idempotencyKey: 'social-create-cs01', body: completeBrief,
  });
  assert.equal(customerServiceWrite.status, 403);

  const uploaded = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/files?usage=source&name=facts.txt`, {
    idempotencyKey: 'social-file-00001', rawBody: Buffer.from('verified product facts\n'), contentType: 'text/plain',
  });
  assert.equal(uploaded.status, 201);
  assert.match(uploaded.body.file.fileRef, /^socialfile:socialfile_[a-f0-9]{24}$/);
  const fileRead = await request(`/api/overseas/starter-198/social-content/files/${uploaded.body.file.fileId}`);
  assert.equal(fileRead.status, 200);
  assert.equal(fileRead.raw, 'verified product facts\n');
  const duplicateUpload = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/files?usage=source&name=facts-copy.txt`, {
    idempotencyKey: 'social-file-dedupe', rawBody: Buffer.from('verified product facts\n'), contentType: 'text/plain',
  });
  assert.equal(duplicateUpload.status, 201);
  assert.equal(duplicateUpload.body.file.fileId, uploaded.body.file.fileId, 'same task/usage/content is deduplicated by SHA-256');
  assert.equal(uploaded.body.material, undefined, 'text/PDF/office task evidence does not enter the creative material library');

  const pdfUpload = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/files?usage=source&name=specification.pdf`, {
    idempotencyKey: 'social-file-pdf001', rawBody: Buffer.from('%PDF-1.4\n% task evidence\n'), contentType: 'application/pdf',
  });
  assert.equal(pdfUpload.status, 201);
  assert.equal(pdfUpload.body.material, undefined, 'PDF evidence remains task-only');

  const productImage = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const imageUpload = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/files?usage=source&name=chair.png`, {
    idempotencyKey: 'social-file-image1', rawBody: productImage, contentType: 'image/png',
  });
  assert.equal(imageUpload.status, 201);
  assert.equal(imageUpload.body.material.type, 'image');
  assert.equal(imageUpload.body.material.sourceType, 'social_task_upload');
  assert.match(imageUpload.body.material.sourceRef, /^socialmaterial:[A-Za-z0-9_-]+$/);
  assert.equal(imageUpload.body.material.sourceVersion, imageUpload.body.file.sha256,
    'task upload returns the same canonical material revision used by the source picker');
  assert.equal(imageUpload.body.material.productId, null, 'free-text task productRef is never forged into a stable product id');
  assert.equal(imageUpload.body.material.productRef, completeBrief.productRef);
  assert.deepEqual(imageUpload.body.material.sourceTaskIds, [taskId]);
  const bridgedImageRead = await request(`/api/overseas/starter-198/social-content/files/${imageUpload.body.file.fileId}`);
  assert.deepEqual(bridgedImageRead.bytes, productImage, 'task file remains readable after entering My Materials');
  assert.equal(materialRows.size, 1);
  const materialRow = materialRows.get(`${tenant}:${imageUpload.body.file.sha256}`);
  assert.equal(materialRow?.productId, '');
  assert.equal(materialRow?.productName, completeBrief.productRef);
  assert.deepEqual(materialRow?.productRefs, [completeBrief.productRef]);
  assert.equal(materialRow?.contentSha256, imageUpload.body.file.sha256);
  assert.equal(fs.existsSync(path.join(temporaryRoot, 'data', 'materials.json')), false,
    'task uploads no longer create an application-server material index');
  assert.equal(fs.existsSync(path.join(temporaryRoot, 'data', 'media')), false,
    'task uploads no longer mirror media bytes into the application server');

  const duplicateImage = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/files?usage=source&name=chair-copy.png`, {
    idempotencyKey: 'social-file-image2', rawBody: productImage, contentType: 'image/png',
  });
  assert.equal(duplicateImage.status, 201);
  assert.equal(duplicateImage.body.file.fileId, imageUpload.body.file.fileId);
  assert.equal(duplicateImage.body.material.id, imageUpload.body.material.id);
  assert.equal(materialRows.size, 1,
    'same-tenant SHA-256 deduplication keeps one canonical material row');
  const metricScreenshot = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/files?usage=metric_evidence&name=metrics.png`, {
    idempotencyKey: 'social-file-metric1', rawBody: productImage, contentType: 'image/png',
  });
  assert.equal(metricScreenshot.status, 201);
  assert.equal(metricScreenshot.body.material, undefined);
  assert.equal(materialRows.size, 1,
    'metric screenshots remain evidence and do not pollute My Materials');

  const source = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/sources`, {
    idempotencyKey: 'social-source-001',
    body: { kind: 'material', sourceRef: uploaded.body.file.fileRef, label: '产品素材' },
  });
  assert.equal(source.status, 201);
  assert.equal(source.body.task.status, 'draft');
  assert.deepEqual(source.body.task.readiness.missing, ['enterprise_knowledge']);
  assert.equal(source.body.task.sourceCount, 1);

  const knowledgeSource = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/sources`, {
    idempotencyKey: 'social-source-option',
    body: {
      kind: 'knowledge',
      sourceRef: sourceOptions.body.items[0].sourceRef,
      sourceVersion: sourceOptions.body.items[0].sourceVersion,
      label: sourceOptions.body.items[0].label,
    },
  });
  assert.equal(knowledgeSource.status, 201);
  assert.equal(knowledgeSource.body.task.sourceCount, 2);
  assert.equal(knowledgeSource.body.task.status, 'plan_review');

  const duplicateSource = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/sources`, {
    idempotencyKey: 'social-source-duplicate',
    body: {
      kind: 'knowledge', sourceRef: sourceOptions.body.items[0].sourceRef,
      sourceVersion: sourceOptions.body.items[0].sourceVersion, label: '重复企业知识',
    },
  });
  assert.equal(duplicateSource.status, 409);
  assert.equal(duplicateSource.body.error, 'social_content_source_already_attached');

  const removedSource = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/sources/${knowledgeSource.body.source.sourceId}`, {
    method: 'DELETE', idempotencyKey: 'social-source-remove',
    body: { expectedTaskVersion: knowledgeSource.body.task.version },
  });
  assert.equal(removedSource.status, 200);
  assert.equal(removedSource.body.source.status, 'removed');
  assert.equal(removedSource.body.task.status, 'needs_input');
  assert.equal(removedSource.body.task.sourceCount, 1);
  const removedReplay = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/sources/${knowledgeSource.body.source.sourceId}`, {
    method: 'DELETE', idempotencyKey: 'social-source-remove',
    body: { expectedTaskVersion: knowledgeSource.body.task.version },
  });
  assert.equal(removedReplay.status, 200);
  assert.equal(removedReplay.body.task.sourceCount, 1, 'source removal replay cannot decrement twice');

  const restoredKnowledge = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/sources`, {
    idempotencyKey: 'social-source-option-restored',
    body: {
      kind: 'knowledge', sourceRef: sourceOptions.body.items[0].sourceRef,
      sourceVersion: sourceOptions.body.items[0].sourceVersion, label: sourceOptions.body.items[0].label,
    },
  });
  assert.equal(restoredKnowledge.status, 201);
  assert.equal(restoredKnowledge.body.task.status, 'plan_review');

  const fakeFile = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/sources`, {
    idempotencyKey: 'social-source-002',
    body: { kind: 'material', sourceRef: `socialfile:socialfile_${'a'.repeat(24)}`, label: '伪造文件' },
  });
  assert.equal(fakeFile.status, 404);

  const started = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/start`, {
    idempotencyKey: 'social-start-0001', body: { expectedVersion: restoredKnowledge.body.task.version },
  });
  assert.equal(started.status, 202);
  assert.equal(started.body.task.status, 'producing');
  assert.equal(started.body.task.runId, 'social-run-1');
  const orchestratorInput = orchestratorInputs[0]!;
  assert.equal(orchestratorInput.workflowScope, 'social_content');
  assert.equal((orchestratorInput.subject as any).id, taskId);
  assert.equal((orchestratorInput.subject as any).sourceRefs.length, 2);
  assert.equal((orchestratorInput.subject as any).packageSelection.length, 3);

  const forgedAgent = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts`, {
    idempotencyKey: 'social-artifact-agent',
    body: { kind: 'video', origin: 'agent', resourceRef: 'studio-project:one' },
  });
  assert.equal(forgedAgent.status, 403, 'a customer route cannot attest an agent-produced artifact');

  const noArtifactPackage = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/delivery-packages`, {
    idempotencyKey: 'social-package-none',
    body: { expectedTaskVersion: started.body.task.version, artifactIds: [] },
  });
  assert.equal(noArtifactPackage.status, 400);
  assert.equal((await request(`/api/overseas/starter-198/social-content/tasks/${taskId}`)).body.task.status, 'producing');

  const artifactCreated = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts`, {
    idempotencyKey: 'social-artifact-001',
    body: { kind: 'publish_copy', origin: 'manual', content: { title: '真实标题', body: '真实正文' }, platform: 'instagram', language: 'en' },
  });
  assert.equal(artifactCreated.status, 201);
  const artifactId = artifactCreated.body.artifact.artifactId as string;
  const beforeApproval = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/delivery-packages`, {
    idempotencyKey: 'social-package-early',
    body: { expectedTaskVersion: artifactCreated.body.task.version, artifactIds: [artifactId] },
  });
  assert.equal(beforeApproval.status, 409, 'unapproved content cannot enter a delivery package');

  const mediaBytes = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const uploadedMedia = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/files?usage=artifact_media&name=final.mp4`, {
    idempotencyKey: 'social-media-upload-001', rawBody: mediaBytes, contentType: 'video/mp4',
  });
  assert.equal(uploadedMedia.status, 201);
  const externalVideo = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts`, {
    idempotencyKey: 'social-media-external-rejected',
    body: { kind: 'short_video', origin: 'manual', resourceRef: 'https://example.com/final.mp4', content: { title: '伪装成片' } },
  });
  assert.equal(externalVideo.status, 400, 'media artifacts cannot point at unarchived external URLs');
  const sourceAsArtifact = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts`, {
    idempotencyKey: 'social-source-as-media-rejected',
    body: { kind: 'short_video', origin: 'manual', resourceRef: uploaded.body.file.fileRef, content: { title: '来源混淆' } },
  });
  assert.equal(sourceAsArtifact.status, 404, 'source files cannot be relabelled as deliverable media');
  const mismatchedMedia = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts`, {
    idempotencyKey: 'social-media-kind-mismatch',
    body: { kind: 'image_post', origin: 'manual', resourceRef: uploadedMedia.body.file.fileRef, content: { title: '类型不符' } },
  });
  assert.equal(mismatchedMedia.status, 415, 'persisted video cannot be relabelled as an image artifact');
  const mediaArtifactCreated = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts`, {
    idempotencyKey: 'social-media-artifact-001',
    body: { kind: 'short_video', origin: 'manual', resourceRef: uploadedMedia.body.file.fileRef, content: { title: '真实成片' }, platform: 'instagram', language: 'en' },
  });
  assert.equal(mediaArtifactCreated.status, 201);
  assert.equal(mediaArtifactCreated.body.artifact.content.media.sha256, uploadedMedia.body.file.sha256);
  const mediaArtifactId = mediaArtifactCreated.body.artifact.artifactId as string;
  const mediaPreview = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts/${mediaArtifactId}/media`);
  assert.equal(mediaPreview.status, 200);
  assert.equal(mediaPreview.contentType, 'video/mp4');
  assert.deepEqual(mediaPreview.bytes, mediaBytes, 'preview serves the archived bytes bound to this artifact');
  assert.match(mediaPreview.contentDisposition || '', /^inline;/);
  const crossTenantPreview = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts/${mediaArtifactId}/media`, { tenantId: victim });
  assert.equal(crossTenantPreview.status, 404, 'artifact previews cannot cross the tenant boundary');
  const textArtifactPreview = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts/${artifactId}/media`);
  assert.equal(textArtifactPreview.status, 404, 'metadata-only artifacts cannot masquerade as downloadable media');

  const approved = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts/${artifactId}/decision`, {
    idempotencyKey: 'social-approve-001',
    body: { expectedVersion: artifactCreated.body.artifact.version, decision: 'approved' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.task.approvedArtifactCount, 1);

  const mediaApproved = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts/${mediaArtifactId}/decision`, {
    idempotencyKey: 'social-media-approve-001',
    body: { expectedVersion: mediaArtifactCreated.body.artifact.version, decision: 'approved' },
  });
  assert.equal(mediaApproved.status, 200);
  assert.equal(mediaApproved.body.task.approvedArtifactCount, 2);

  const packaged = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/delivery-packages`, {
    idempotencyKey: 'social-package-001',
    body: { expectedTaskVersion: mediaApproved.body.task.version, artifactIds: [artifactId, mediaArtifactId] },
  });
  assert.equal(packaged.status, 201);
  assert.equal(packaged.body.task.status, 'delivered');
  const packageId = packaged.body.deliveryPackage.packageId as string;
  const downloaded = await request(`/api/overseas/starter-198/social-content/delivery-packages/${packageId}/download`);
  assert.equal(downloaded.status, 200, 'an untampered ready package downloads successfully');
  assert.equal(downloaded.contentType, 'application/zip');
  assert.equal(downloaded.contentDisposition, `attachment; filename="${packageId}.zip"`);
  assert.equal(downloaded.bytes.readUInt32LE(0), 0x04034b50, 'download is a real ZIP archive');
  assert.match(downloaded.raw, /manifest\.json/);
  assert.match(downloaded.raw, /真实正文/, 'approved inline content is bundled for delivery');
  assert.match(downloaded.raw, /final\.mp4/, 'the archived media file is physically embedded in the ZIP');

  const packageRow = dataStore.rows.get(STARTER_COLLECTIONS.socialDeliveryPackages)!.find(row => row.package_id === packageId)!;
  const originalHash = packageRow.package_hash;
  packageRow.package_hash = '0'.repeat(64);
  const tamperedDownload = await request(`/api/overseas/starter-198/social-content/delivery-packages/${packageId}/download`);
  assert.equal(tamperedDownload.status, 503, 'a tampered manifest is never served');
  packageRow.package_hash = originalHash;

  const mediaRow = dataStore.rows.get(STARTER_COLLECTIONS.socialContentFiles)!.find(row => row.file_id === uploadedMedia.body.file.fileId)!;
  const mediaPath = path.join(temporaryRoot, 'data', 'social-content-sources', String(mediaRow.storage_key));
  fs.writeFileSync(mediaPath, Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x62, 0x61, 0x64, 0x21]));
  const corruptMediaDownload = await request(`/api/overseas/starter-198/social-content/delivery-packages/${packageId}/download`);
  assert.equal(corruptMediaDownload.status, 503, 'checksum mismatch must fail before a media ZIP is served');
  fs.writeFileSync(mediaPath, mediaBytes);

  dataStore.rows.get(STARTER_COLLECTIONS.socialDeliveryPackages)!.push({
    id: 'preparing-package', tenant_id: tenant, package_id: 'socialpkg_preparing', task_id: taskId,
    version: '2', status: 'preparing', artifact_ids: [artifactId], manifest: {}, package_hash: 'x',
    created_at: '2026-09-14T08:00:00.000Z', updated_at: '2026-09-14T08:00:00.000Z',
  });
  const prematurePublication = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/publications`, {
    idempotencyKey: 'social-publish-early',
    body: { expectedTaskVersion: packaged.body.task.version, packageId: 'socialpkg_preparing', platform: 'instagram', publicUrl: 'https://example.com/post/early', publishedAt: '2026-09-14T09:00:00Z' },
  });
  assert.equal(prematurePublication.status, 409, 'a package that is not ready cannot be registered as published');

  const publication = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/publications`, {
    idempotencyKey: 'social-publish-001',
    body: { expectedTaskVersion: packaged.body.task.version, packageId, platform: 'instagram', publicUrl: 'https://example.com/post/1', publishedAt: '2026-09-14T09:00:00Z' },
  });
  assert.equal(publication.status, 201);
  assert.equal(publication.body.task.status, 'awaiting_metrics');
  const publicationId = publication.body.publication.publicationId as string;

  const orphanMetrics = await request(`/api/overseas/starter-198/social-content/publications/socialpub_${'f'.repeat(24)}/metrics`, {
    idempotencyKey: 'social-metrics-orphan',
    body: { method: 'manual', capturedAt: '2026-09-14T10:00:00Z', metrics: { views: 10 } },
  });
  assert.equal(orphanMetrics.status, 404, 'metrics must belong to a real publication');
  const missingScreenshot = await request(`/api/overseas/starter-198/social-content/publications/${publicationId}/metrics`, {
    idempotencyKey: 'social-metrics-shot',
    body: { method: 'screenshot', capturedAt: '2026-09-14T10:00:00Z', metrics: { views: 10 } },
  });
  assert.equal(missingScreenshot.status, 400);
  const metrics = await request(`/api/overseas/starter-198/social-content/publications/${publicationId}/metrics`, {
    idempotencyKey: 'social-metrics-001',
    body: { method: 'manual', capturedAt: '2026-09-14T10:00:00Z', metrics: { views: 10, likes: null } },
  });
  assert.equal(metrics.status, 201);
  assert.equal(metrics.body.metricSubmission.status, 'received');
  assert.equal(metrics.body.task.status, 'awaiting_metrics', 'received data is not falsely labeled as reviewed');

  const taskRow = dataStore.rows.get(STARTER_COLLECTIONS.socialContentTasks)!.find(row => row.task_id === taskId)!;
  const artifactCreateOperation = dataStore.rows.get(STARTER_COLLECTIONS.socialContentOperations)!
    .find(row => row.idempotency_key === 'social-artifact-001')!;
  artifactCreateOperation.status = 'processing';
  artifactCreateOperation.result = {};
  taskRow.artifact_count = 0;
  const recoveredArtifactCreate = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts`, {
    idempotencyKey: 'social-artifact-001',
    body: { kind: 'publish_copy', origin: 'manual', content: { title: '真实标题', body: '真实正文' }, platform: 'instagram', language: 'en' },
  });
  assert.equal(recoveredArtifactCreate.status, 201);
  assert.equal(recoveredArtifactCreate.body.task.artifactCount, 2, 'A → B → replay(A) recomputes rather than increments');
  assert.equal(recoveredArtifactCreate.body.task.status, 'awaiting_metrics', 'an older recovery cannot regress a later status');

  const approvalOperation = dataStore.rows.get(STARTER_COLLECTIONS.socialContentOperations)!
    .find(row => row.idempotency_key === 'social-approve-001')!;
  approvalOperation.status = 'processing';
  approvalOperation.result = {};
  taskRow.approved_artifact_count = 0;
  const recoveredApproval = await request(`/api/overseas/starter-198/social-content/tasks/${taskId}/artifacts/${artifactId}/decision`, {
    idempotencyKey: 'social-approve-001',
    body: { expectedVersion: artifactCreated.body.artifact.version, decision: 'approved' },
  });
  assert.equal(recoveredApproval.status, 200);
  assert.equal(recoveredApproval.body.task.approvedArtifactCount, 2, 'decision recovery repairs a missed parent projection');

  const bypassTask = await request('/api/overseas/starter-198/social-content/tasks', {
    idempotencyKey: 'social-bypass-create', body: { ...completeBrief, title: '来源覆盖校验' },
  });
  assert.equal(bypassTask.status, 201);
  const bypassTaskId = bypassTask.body.task.taskId as string;
  const referenceOnly = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/sources`, {
    idempotencyKey: 'social-bypass-reference',
    body: { kind: 'reference_link', sourceRef: 'https://example.com/reference', label: '单一参考链接' },
  });
  assert.equal(referenceOnly.status, 201);
  assert.deepEqual(referenceOnly.body.task.readiness.missing, ['enterprise_knowledge', 'source_material']);
  const freeTextNote = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/sources`, {
    idempotencyKey: 'social-bypass-free-text-note',
    body: { kind: 'text_note', sourceRef: 'brief:brand-notes', label: '用户填写的企业与产品关键信息' },
  });
  assert.equal(freeTextNote.status, 201);
  assert.equal(freeTextNote.body.task.knowledgeSourceCount, 0);
  assert.deepEqual(freeTextNote.body.task.readiness.missing, ['enterprise_knowledge', 'source_material'],
    'request free text must not be promoted to confirmed enterprise knowledge');
  const bypassStart = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/start`, {
    idempotencyKey: 'social-bypass-start', body: { expectedVersion: freeTextNote.body.task.version },
  });
  assert.equal(bypassStart.status, 409, 'a reference link alone cannot bypass the knowledge requirement');
  assert.equal(bypassStart.body.error, 'social_content_task_inputs_incomplete');
  assert.equal(orchestratorInputs.length, 1, 'incomplete source coverage never reaches the orchestrator');

  const incompleteManualArtifact = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts`, {
    idempotencyKey: 'social-manual-incomplete',
    body: { kind: 'publish_copy', origin: 'manual', content: { body: '不得绕过资料校验' } },
  });
  assert.equal(incompleteManualArtifact.status, 409);
  assert.equal(incompleteManualArtifact.body.error, 'social_content_artifact_not_allowed');
  const manualKnowledge = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/sources`, {
    idempotencyKey: 'social-manual-knowledge',
    body: {
      kind: 'knowledge', sourceRef: sourceOptions.body.items[0].sourceRef,
      sourceVersion: sourceOptions.body.items[0].sourceVersion, label: sourceOptions.body.items[0].label,
    },
  });
  assert.equal(manualKnowledge.status, 201);
  assert.equal(manualKnowledge.body.task.status, 'needs_input');
  assert.deepEqual(manualKnowledge.body.task.readiness.missing, ['source_material']);
  const manualUpload = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/files?usage=source&name=manual-source.txt`, {
    idempotencyKey: 'social-manual-source-file', rawBody: Buffer.from('real production source'), contentType: 'text/plain',
  });
  assert.equal(manualUpload.status, 201, manualUpload.raw);
  const manualMaterial = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/sources`, {
    idempotencyKey: 'social-manual-source',
    body: {
      kind: 'material', sourceRef: manualUpload.body.file.fileRef,
      sourceVersion: manualUpload.body.file.sha256, label: '真实生产素材',
    },
  });
  assert.equal(manualMaterial.status, 201, manualMaterial.raw);
  assert.equal(manualMaterial.body.task.status, 'plan_review');
  const manualFallbackArtifact = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts`, {
    idempotencyKey: 'social-manual-ready',
    body: { kind: 'publish_copy', origin: 'manual', content: { body: '人工专业页真实成果' } },
  });
  assert.equal(manualFallbackArtifact.status, 201);
  assert.equal(manualFallbackArtifact.body.task.status, 'asset_review', 'a complete plan may use the safe manual fallback');
  const secondBatchArtifact = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts`, {
    idempotencyKey: 'social-manual-ready-two',
    body: { kind: 'publish_copy', origin: 'manual', content: { body: '同批第二项真实成果' } },
  });
  assert.equal(secondBatchArtifact.status, 201);
  const batchDecisionInput = {
    artifacts: [manualFallbackArtifact.body.artifact, secondBatchArtifact.body.artifact]
      .map((artifact: any) => ({ artifactId: artifact.artifactId, expectedVersion: artifact.version })),
    decision: 'approved',
  };
  const batchApproved = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts/batch-decision`, {
    idempotencyKey: 'social-batch-approve', body: batchDecisionInput,
  });
  assert.equal(batchApproved.status, 200);
  assert.equal(batchApproved.body.task.approvedArtifactCount, 2);
  const batchReplay = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts/batch-decision`, {
    idempotencyKey: 'social-batch-approve', body: batchDecisionInput,
  });
  assert.equal(batchReplay.status, 200);
  assert.equal(batchReplay.body.task.approvedArtifactCount, 2, 'batch decision replay cannot apply twice');

  const revisionArtifact = await request(`/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts`, {
    idempotencyKey: 'social-revision-artifact',
    body: { kind: 'publish_copy', origin: 'manual', content: { body: '等待用户验收的自动成果' } },
  });
  assert.equal(revisionArtifact.status, 201);
  const queuesBeforeRevision = orchestratorInputs.length;
  const revisionDecisionInput = {
    expectedVersion: revisionArtifact.body.artifact.version,
    decision: 'changes_requested',
    note: '请缩短口播和字幕，开头更直接一些',
  };
  const revisionDecision = await request(
    `/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts/${revisionArtifact.body.artifact.artifactId}/decision`,
    { idempotencyKey: 'social-revision-decision', body: revisionDecisionInput },
  );
  assert.equal(revisionDecision.status, 200, revisionDecision.raw);
  assert.equal(revisionDecision.body.artifact.status, 'changes_requested');
  assert.equal(revisionDecision.body.task.status, 'producing', 'a rejection automatically enters a fresh production run');
  assert.equal(orchestratorInputs.length, queuesBeforeRevision + 1, 'one rejection admits exactly one revision command');

  const revisionReplay = await request(
    `/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts/${revisionArtifact.body.artifact.artifactId}/decision`,
    { idempotencyKey: 'social-revision-decision', body: revisionDecisionInput },
  );
  assert.equal(revisionReplay.status, 200);
  assert.equal(revisionReplay.body.task.status, 'producing');
  assert.equal(orchestratorInputs.length, queuesBeforeRevision + 1, 'idempotent replay never queues a second revision');

  const duplicateRevision = await request(
    `/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts/${revisionArtifact.body.artifact.artifactId}/decision`,
    {
      idempotencyKey: 'social-revision-decision-duplicate',
      body: { ...revisionDecisionInput, expectedVersion: revisionDecision.body.artifact.version },
    },
  );
  assert.equal(duplicateRevision.status, 409, 'an already accepted rejection cannot open another revision run');
  assert.equal(orchestratorInputs.length, queuesBeforeRevision + 1);

  const approvedCannotBeReopened = await request(
    `/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts/${manualFallbackArtifact.body.artifact.artifactId}/decision`,
    {
      idempotencyKey: 'social-approved-revision-forbidden',
      body: { expectedVersion: '2', decision: 'changes_requested', note: '不得覆盖已审批成品' },
    },
  );
  assert.equal(approvedCannotBeReopened.status, 409, 'approved output is immutable and cannot be replaced by review rejection');
  assert.equal(orchestratorInputs.length, queuesBeforeRevision + 1);

  const crossTenantRevision = await request(
    `/api/overseas/starter-198/social-content/tasks/${bypassTaskId}/artifacts/${revisionArtifact.body.artifact.artifactId}/decision`,
    {
      tenantId: victim,
      idempotencyKey: 'social-cross-tenant-revision',
      body: { expectedVersion: revisionDecision.body.artifact.version, decision: 'changes_requested', note: '越权修改' },
    },
  );
  assert.equal(crossTenantRevision.status, 404, 'revision scheduling is tenant isolated');
  assert.equal(orchestratorInputs.length, queuesBeforeRevision + 1);

  const internalDenied = await request('/api/overseas/starter-198/social-content/internal/work-packages');
  assert.equal(internalDenied.status, 403);
  const internalList = await request('/api/overseas/starter-198/social-content/internal/work-packages', { platformAdmin: true });
  assert.equal(internalList.status, 200);
  assert.ok(internalList.body.items.every((item: any) => item.framework), 'only the internal endpoint returns framework fields');

  const internalCreated = await request('/api/overseas/starter-198/social-content/internal/work-packages', {
    platformAdmin: true,
    idempotencyKey: 'social-admin-pkg1',
    body: { kind: 'content_rocket', packageKey: 'content_rocket_pro', version: 'v1', name: '内容火箭包新版' },
  });
  assert.equal(internalCreated.status, 201);
  assert.equal(internalCreated.body.workPackage.status, 'draft');
  const activationBlocked = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_pro/v1/status', {
    platformAdmin: true,
    idempotencyKey: 'social-admin-pkg-incomplete',
    body: { expectedVersion: internalCreated.body.workPackage.recordVersion, status: 'internal_trial' },
  });
  assert.equal(activationBlocked.status, 200);
  const incompleteActive = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_pro/v1/status', {
    platformAdmin: true,
    idempotencyKey: 'social-admin-pkg-incomplete-active',
    body: { expectedVersion: activationBlocked.body.workPackage.recordVersion, status: 'active' },
  });
  assert.equal(incompleteActive.status, 409);
  assert.equal(incompleteActive.body.error, 'social_package_activation_incomplete');
  const backToDraft = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_pro/v1/status', {
    platformAdmin: true,
    idempotencyKey: 'social-admin-pkg-back-draft',
    body: { expectedVersion: activationBlocked.body.workPackage.recordVersion, status: 'draft' },
  });
  assert.equal(backToDraft.status, 200);
  const internalConfigured = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_pro/v1', {
    method: 'PATCH', platformAdmin: true, idempotencyKey: 'social-admin-pkg-configure',
    body: {
      expectedVersion: backToDraft.body.workPackage.recordVersion,
      changes: {
        summary: '用于新品社媒内容快速制作',
        framework: { requiredInputs: ['产品事实'], deliverables: ['发布文案'] },
      },
    },
  });
  assert.equal(internalConfigured.status, 200);
  const internalTrial = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_pro/v1/status', {
    platformAdmin: true,
    idempotencyKey: 'social-admin-pkg2',
    body: { expectedVersion: internalConfigured.body.workPackage.recordVersion, status: 'internal_trial' },
  });
  assert.equal(internalTrial.status, 200);
  const activated = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_pro/v1/status', {
    platformAdmin: true,
    idempotencyKey: 'social-admin-pkg3',
    body: { expectedVersion: internalTrial.body.workPackage.recordVersion, status: 'active' },
  });
  assert.equal(activated.status, 200);
  const activeEdit = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_pro/v1', {
    method: 'PATCH', platformAdmin: true, idempotencyKey: 'social-admin-pkg4',
    body: { expectedVersion: activated.body.workPackage.recordVersion, changes: { name: '不允许原地覆盖' } },
  });
  assert.equal(activeEdit.status, 409);

  const publicCatalog = await request('/api/overseas/starter-198/social-content/catalog');
  const publicRocket = publicCatalog.body.items.find((item: any) => item.kind === 'content_rocket');
  assert.equal(publicRocket.summary, '用于新品社媒内容快速制作');
  assert.deepEqual(publicRocket.requiredInputs, ['产品事实']);
  assert.deepEqual(publicRocket.deliverables, ['发布文案']);
  assert.doesNotMatch(publicCatalog.raw, /qualityChecks|fallbackPolicy|workOutline/);

  const secondVersion = await request('/api/overseas/starter-198/social-content/internal/work-packages', {
    platformAdmin: true, idempotencyKey: 'social-admin-second-create',
    body: {
      kind: 'content_rocket', packageKey: 'content_rocket_next', version: 'v2', name: '内容火箭包候选',
      summary: '候选正式版', framework: { requiredInputs: ['企业知识'], deliverables: ['发布包'] },
    },
  });
  assert.equal(secondVersion.status, 201);
  const secondTrial = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_next/v2/status', {
    platformAdmin: true, idempotencyKey: 'social-admin-second-trial',
    body: { expectedVersion: secondVersion.body.workPackage.recordVersion, status: 'internal_trial' },
  });
  assert.equal(secondTrial.status, 200);
  const secondActivation = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket_next/v2/status', {
    platformAdmin: true, idempotencyKey: 'social-admin-second-active',
    body: { expectedVersion: secondTrial.body.workPackage.recordVersion, status: 'active' },
  });
  assert.equal(secondActivation.status, 409);
  assert.equal(secondActivation.body.error, 'social_package_active_version_exists');

  const builtinMutation = await request('/api/overseas/starter-198/social-content/internal/work-packages/content_rocket/framework-v1/status', {
    platformAdmin: true, idempotencyKey: 'social-admin-builtin',
    body: { expectedVersion: 'builtin', status: 'retired' },
  });
  assert.equal(builtinMutation.status, 409);
  assert.equal(builtinMutation.body.error, 'social_package_builtin_read_only');

  const taskRows = dataStore.rows.get(STARTER_COLLECTIONS.socialContentTasks)!;
  const templateTaskRow = taskRows.find(row => row.tenant_id === tenant && row.task_id === taskId);
  assert.ok(templateTaskRow, 'pagination test requires a valid social task record');
  for (let index = 0; index < 55; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 8, 15, 0, 0, index)).toISOString();
    taskRows.push({
      ...structuredClone(templateTaskRow),
      id: `pagination-task-${String(index).padStart(3, '0')}`,
      tenant_id: victim,
      task_id: `socialtask_${index.toString(16).padStart(24, '0')}`,
      brief: { ...completeBrief, title: `分页任务 ${index + 1}` },
      status: 'reviewed',
      version: '1',
      run_id: '',
      source_count: 0,
      knowledge_source_count: 0,
      material_source_count: 0,
      artifact_count: 0,
      approved_artifact_count: 0,
      delivery_package_count: 0,
      publication_count: 0,
      metric_submission_count: 0,
      create_idempotency_key: `pagination-create-${index}`,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  const firstTaskPage = await request('/api/overseas/starter-198/social-content/tasks?page=1&perPage=50', { tenantId: victim });
  const secondTaskPage = await request('/api/overseas/starter-198/social-content/tasks?page=2&perPage=50', { tenantId: victim });
  assert.equal(firstTaskPage.status, 200);
  assert.equal(firstTaskPage.body.items.length, 50);
  assert.deepEqual(
    { page: firstTaskPage.body.page, perPage: firstTaskPage.body.perPage, totalItems: firstTaskPage.body.totalItems, totalPages: firstTaskPage.body.totalPages },
    { page: 1, perPage: 50, totalItems: 55, totalPages: 2 },
  );
  assert.equal(secondTaskPage.body.items.length, 5);
  assert.equal(new Set([...firstTaskPage.body.items, ...secondTaskPage.body.items].map((item: any) => item.taskId)).size, 55);
  const pagedWorkspace = await request('/api/overseas/starter-198/social-content', { tenantId: victim });
  assert.equal(pagedWorkspace.status, 200, pagedWorkspace.raw);
  assert.equal(pagedWorkspace.body.tasks.length, 50, 'workspace loads only its first task page');
  assert.deepEqual(pagedWorkspace.body.taskList, { page: 1, perPage: 50, totalItems: 55, totalPages: 2 });
  assert.equal(pagedWorkspace.body.tasks.some((item: any) => item.taskId === pagedWorkspace.body.currentTask.taskId), true);

  const hiddenFormulaList = await request('/api/overseas/starter-198/social-content/internal/content-formulas');
  assert.equal(hiddenFormulaList.status, 403, 'formula registry is platform-admin only');
  const initiallyEmptyFormulaList = await request('/api/overseas/starter-198/social-content/internal/content-formulas', { platformAdmin: true });
  assert.equal(initiallyEmptyFormulaList.status, 200);
  assert.deepEqual(initiallyEmptyFormulaList.body.items, [],
    'the formula interface remains available but ships with no preloaded formula');
  const incompleteFormulaDraft = await request('/api/overseas/starter-198/social-content/internal/content-formulas', {
    platformAdmin: true,
    idempotencyKey: 'social-formula-incomplete-create',
    body: {
      formulaId: 'custom.incomplete-draft', version: '1.0.0', name: '允许保存的未完成草稿', themeId: 'product_value',
      direction: { pace: 'fast' },
      nodes: [{ nodeId: 'opening', shotFunction: '开场钩子' }],
    },
  });
  assert.equal(incompleteFormulaDraft.status, 201, incompleteFormulaDraft.raw);
  assert.deepEqual(incompleteFormulaDraft.body.formula.direction, { pace: 'fast' },
    'draft persistence keeps authored direction only');
  assert.deepEqual(incompleteFormulaDraft.body.formula.nodes[0], { nodeId: 'opening', shotFunction: '开场钩子' },
    'draft persistence must not synthesize script, voiceover, caption or shot grammar');
  const incompleteFormulaTrial = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.incomplete-draft/1.0.0/trial', {
    platformAdmin: true, idempotencyKey: 'social-formula-incomplete-trial', body: {},
  });
  assert.equal(incompleteFormulaTrial.status, 422, incompleteFormulaTrial.raw);
  assert.equal(incompleteFormulaTrial.body.error, 'social_content_formula_release_incomplete');
  const incompleteFormulaPublish = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.incomplete-draft/1.0.0/publish', {
    platformAdmin: true, idempotencyKey: 'social-formula-incomplete-publish', body: { status: 'active' },
  });
  assert.equal(incompleteFormulaPublish.status, 422, incompleteFormulaPublish.raw);
  assert.equal(incompleteFormulaPublish.body.error, 'social_content_formula_release_incomplete');
  await repository.create(STARTER_COLLECTIONS.plans, '__starter_social_formula_catalog__', {
    id: 'socialformula_legacy_draft',
    goal_id: 'social-content-formula:custom.legacy-draft',
    status: 'draft',
    plan: {
      schemaVersion: 'social-content-formula.v1',
      lastIdempotencyKey: 'legacy-formula-created-before-director-contract',
      formula: {
        formulaId: 'custom.legacy-draft', version: '0.9.0', name: '旧版未完成草稿', themeId: 'product_value',
        rollout: { percentage: 0, tenantAllowlist: [] }, nodes: [],
        audit: [{ event: 'draft_created', actor: 'legacy-admin', at: '2026-09-01T00:00:00.000Z' }],
      },
    },
    created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
  });
  const registryWithLegacyDraft = await request('/api/overseas/starter-198/social-content/internal/content-formulas', { platformAdmin: true });
  assert.equal(registryWithLegacyDraft.status, 200, registryWithLegacyDraft.raw);
  assert.equal(registryWithLegacyDraft.body.items.some((item: any) => item.formulaId === 'custom.legacy-draft'), true,
    'v1 drafts remain readable without receiving synthesized director fields');
  const legacyTrial = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.legacy-draft/0.9.0/trial', {
    platformAdmin: true, idempotencyKey: 'social-formula-legacy-trial', body: {},
  });
  assert.equal(legacyTrial.status, 422, legacyTrial.raw);
  assert.equal(legacyTrial.body.error, 'social_content_formula_release_incomplete');
  const formulaDraft = await request('/api/overseas/starter-198/social-content/internal/content-formulas', {
    platformAdmin: true,
    idempotencyKey: 'social-formula-create-001',
    body: {
      formulaId: 'custom.product-proof',
      version: '1.0.0',
      name: '产品单镜头验证',
      themeId: 'product_value',
      direction: completeFormulaDirection(),
      nodes: [completeFormulaNode('hero')],
    },
  });
  assert.equal(formulaDraft.status, 201, formulaDraft.raw);
  assert.equal(formulaDraft.body.formula.status, 'draft');
  assert.equal(formulaDraft.body.formula.direction.pace, 'balanced');
  assert.equal(formulaDraft.body.formula.direction.music.licenseVerified, true);
  assert.equal(formulaDraft.body.formula.direction.cover.intent, '第一眼说明产品价值且不夸大功效');
  assert.equal(formulaDraft.body.formula.direction.materialFallback.insufficientMaterialAction, 'adapt_with_verified_assets');
  assert.equal(formulaDraft.body.formula.direction.acceptanceGates[0].blocking, true);
  assert.equal(formulaDraft.body.formula.nodes[0].cameraMovement, 'push_in');
  assert.equal(formulaDraft.body.formula.nodes[0].transition, 'cut');
  assert.equal(formulaDraft.body.formula.nodes[0].voiceoverTemplate.zh, '口播：用真实素材展示{{product}}。');
  assert.equal(formulaDraft.body.formula.nodes[0].captionTemplate.zh, '字幕：真实素材展示');
  const formulaTrial = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.product-proof/1.0.0/trial', {
    platformAdmin: true, idempotencyKey: 'social-formula-trial-001', body: { note: '内部试跑通过' },
  });
  assert.equal(formulaTrial.status, 200, formulaTrial.raw);
  assert.equal(formulaTrial.body.formula.status, 'internal_trial');
  assert.equal(formulaTrial.body.preview.length, 1);
  const formulaPublished = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.product-proof/1.0.0/publish', {
    platformAdmin: true, idempotencyKey: 'social-formula-publish-001', body: { status: 'active', note: '全量启用' },
  });
  assert.equal(formulaPublished.status, 200, formulaPublished.raw);
  assert.equal(formulaPublished.body.formula.rollout.percentage, 100);
  const formulaFork = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.product-proof/1.0.0', {
    method: 'PATCH', platformAdmin: true, idempotencyKey: 'social-formula-version-002',
    body: { version: '1.1.0', name: '产品单镜头验证 B' },
  });
  assert.equal(formulaFork.status, 201, formulaFork.raw);
  assert.equal(formulaFork.body.formula.status, 'draft');
  const formulaRegistry = await request('/api/overseas/starter-198/social-content/internal/content-formulas', { platformAdmin: true });
  assert.equal(formulaRegistry.status, 200);
  assert.equal(formulaRegistry.body.items.some((item: any) => item.formulaId === 'custom.product-proof' && item.version === '1.0.0' && item.status === 'active'), true,
    'referenced formula version remains immutable while a new draft is created');
  const formulaDisabled = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.product-proof/1.1.0/disable', {
    platformAdmin: true, idempotencyKey: 'social-formula-disable-002', body: { note: '未发布版本停用' },
  });
  assert.equal(formulaDisabled.status, 200);
  assert.equal(formulaDisabled.body.formula.audit.at(-1).event, 'disabled');
  const matchedFormula = await request('/api/overseas/starter-198/social-content/internal/content-formulas/match', {
    platformAdmin: true, body: { themeId: 'product_value', topic: '展示核心卖点' },
  });
  assert.equal(matchedFormula.status, 200, matchedFormula.raw);
  assert.equal(matchedFormula.body.formula.formulaId, 'custom.product-proof');
  const allowlistDraft = await request('/api/overseas/starter-198/social-content/internal/content-formulas', {
    platformAdmin: true, idempotencyKey: 'social-formula-allowlist-create',
    body: {
      formulaId: 'custom.case-allowlist', version: '1.0.0', name: '案例灰度公式', themeId: 'customer_case',
      direction: completeFormulaDirection(),
      nodes: [completeFormulaNode('case', { shotFunction: '展示授权案例', subject: '案例证据', action: '去敏展示' })],
    },
  });
  assert.equal(allowlistDraft.status, 201, allowlistDraft.raw);
  await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.case-allowlist/1.0.0/trial', {
    platformAdmin: true, idempotencyKey: 'social-formula-allowlist-trial', body: {},
  });
  const allowlistPublish = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.case-allowlist/1.0.0/publish', {
    platformAdmin: true, idempotencyKey: 'social-formula-allowlist-publish',
    body: { status: 'gray', rollout: { percentage: 0, tenantAllowlist: [victim] } },
  });
  assert.equal(allowlistPublish.status, 200, allowlistPublish.raw);
  const regularTenantMatch = await request('/api/overseas/starter-198/social-content/internal/content-formulas/match', {
    platformAdmin: true, body: { themeId: 'customer_case', targetTenantId: tenant },
  });
  const allowlistedTenantMatch = await request('/api/overseas/starter-198/social-content/internal/content-formulas/match', {
    platformAdmin: true, body: { themeId: 'customer_case', targetTenantId: victim },
  });
  assert.equal(regularTenantMatch.status, 503);
  assert.equal(regularTenantMatch.body.error, 'social_content_formula_unavailable',
    'formula registry remains empty for tenants that were not explicitly allowlisted');
  assert.equal(allowlistedTenantMatch.body.formula.formulaId, 'custom.case-allowlist');
  const percentageOnlyDraft = await request('/api/overseas/starter-198/social-content/internal/content-formulas', {
    platformAdmin: true, idempotencyKey: 'social-formula-percentage-create',
    body: {
      formulaId: 'custom.percentage-only', version: '1.0.0', name: '仅百分比灰度公式', themeId: 'scenario_solution',
      direction: completeFormulaDirection(),
      nodes: [completeFormulaNode('scene', { shotFunction: '展示场景', subject: '使用场景', action: '现场展示' })],
    },
  });
  assert.equal(percentageOnlyDraft.status, 201, percentageOnlyDraft.raw);
  await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.percentage-only/1.0.0/trial', {
    platformAdmin: true, idempotencyKey: 'social-formula-percentage-trial', body: {},
  });
  const percentageOnlyPublish = await request('/api/overseas/starter-198/social-content/internal/content-formulas/custom.percentage-only/1.0.0/publish', {
    platformAdmin: true, idempotencyKey: 'social-formula-percentage-publish',
    body: { status: 'gray', rollout: { percentage: 100, tenantAllowlist: [] } },
  });
  assert.equal(percentageOnlyPublish.status, 200, percentageOnlyPublish.raw);
  const percentageOnlyMatch = await request('/api/overseas/starter-198/social-content/internal/content-formulas/match', {
    platformAdmin: true, body: { themeId: 'scenario_solution', targetTenantId: tenant },
  });
  assert.equal(percentageOnlyMatch.status, 503);
  assert.equal(percentageOnlyMatch.body.error, 'social_content_formula_unavailable',
    'gray percentage is metadata only; an empty allowlist authorizes no tenant and there is no bundled fallback formula');

  const publicThemes = await request('/api/overseas/starter-198/social-content/themes');
  assert.equal(publicThemes.status, 200);
  assert.equal(publicThemes.body.items.length, 5);
  assert.doesNotMatch(publicThemes.raw, /formulaId|formula_reference|产品单镜头验证/);
  const pendingTheme = await request('/api/overseas/starter-198/social-content/themes/classify', { body: { customTopic: '今天想随便聊聊' } });
  assert.equal(pendingTheme.status, 200);
  assert.equal(pendingTheme.body.theme.classificationStatus, 'pending_confirmation');

  const instantTask = await request('/api/overseas/starter-198/social-content/tasks', {
    idempotencyKey: 'social-instant-create-001',
    body: { ...completeBrief, title: '即时产品卖点', mode: 'instant', themeId: 'product_value', topic: '一个镜头看懂卖点', requestedOutputCount: 9 },
  });
  assert.equal(instantTask.status, 201, instantTask.raw);
  assert.equal(instantTask.body.task.mode, 'instant');
  assert.equal(instantTask.body.task.brief.requestedOutputCount, 1, 'instant creation always produces one output');
  assert.deepEqual(instantTask.body.task.scriptBaseline, {
    version: '1', source: 'formula', sceneCount: 1, language: 'en',
    lockedAt: instantTask.body.task.createdAt,
    matchConfidence: 0.78,
    groundingVersion: 'social-script-grounding.v3',
  }, 'formula script baseline is frozen before any material upload or production request');
  assert.equal(instantTask.body.task.materialRequirements.length, 1);
  assert.equal(instantTask.body.task.materialRequirements.every((item: any) => item.required === false), true,
    'theme suggestions are advisory until a formula is explicitly applied as a production constraint');
  const instantStoredTask = dataStore.rows.get(STARTER_COLLECTIONS.socialContentTasks)!.find(row => row.task_id === instantTask.body.task.taskId)!;
  assert.deepEqual(instantStoredTask.formula_reference, { formulaId: 'custom.product-proof', version: '1.0.0' });
  const instantStoredBaseline = instantStoredTask.script_baseline as { scenes: Array<{ narration: string }>; match: { userTextUsage: string } };
  assert.doesNotMatch(instantStoredBaseline.scenes[0].narration, /一个镜头看懂卖点|product:chair/,
    'task topic and free-form product reference are intent only and never become narration facts');
  assert.equal(instantStoredBaseline.match.userTextUsage, 'intent_only');
  assert.doesNotMatch(instantTask.raw, /custom\.product-proof|formulaId|formulaReference|formula_reference/,
    'customer task responses never disclose formula identity or version');
  const instantTaskId = instantTask.body.task.taskId as string;
  const instantUpload = await request(`/api/overseas/starter-198/social-content/tasks/${instantTaskId}/files?usage=source&name=hero-proof.txt`, {
    idempotencyKey: 'social-instant-file-001', rawBody: Buffer.from('instant-theme-proof-material'), contentType: 'text/plain',
  });
  assert.equal(instantUpload.status, 201, instantUpload.raw);
  const instantMaterial = await request(`/api/overseas/starter-198/social-content/tasks/${instantTaskId}/sources`, {
    idempotencyKey: 'social-instant-material-001',
    body: {
      kind: 'material', sourceRef: instantUpload.body.file.fileRef, sourceVersion: instantUpload.body.file.sha256,
      label: '产品与证据同框素材', purpose: instantTask.body.task.materialRequirements[0].requirementId,
    },
  });
  assert.equal(instantMaterial.status, 201, instantMaterial.raw);
  assert.equal(instantMaterial.body.task.materialRequirements[0].status, 'satisfied');
  const instantKnowledge = await request(`/api/overseas/starter-198/social-content/tasks/${instantTaskId}/sources`, {
    idempotencyKey: 'social-instant-knowledge-001',
    body: { kind: 'knowledge', sourceRef: 'socialknowledge:enterprise-profile', label: '企业资料' },
  });
  assert.equal(instantKnowledge.status, 201, instantKnowledge.raw);
  assert.equal(instantKnowledge.body.task.readiness.complete, true, 'enterprise knowledge plus one real material unlock production');
  assert.equal(instantKnowledge.body.task.status, 'plan_review');
  const sameThemeUpdate = await request(`/api/overseas/starter-198/social-content/tasks/${instantTaskId}`, {
    method: 'PATCH', idempotencyKey: 'social-instant-same-theme-update',
    body: {
      expectedVersion: instantKnowledge.body.task.version,
      changes: { themeId: 'product_value', customTopic: null, topic: '一个镜头看懂卖点' },
    },
  });
  assert.equal(sameThemeUpdate.status, 200, sameThemeUpdate.raw);
  assert.equal(sameThemeUpdate.body.task.materialRequirements[0].status, 'satisfied',
    'submitting an unchanged theme must not reset material suggestions');
  const instantStarted = await request(`/api/overseas/starter-198/social-content/tasks/${instantTaskId}/start`, {
    idempotencyKey: 'social-instant-start-001', body: { expectedVersion: sameThemeUpdate.body.task.version },
  });
  assert.equal(instantStarted.status, 202, instantStarted.raw);
  assert.equal(instantStarted.body.task.status, 'producing',
    'advisory theme structure must not block production');

  const weeklyPlan = await request('/api/overseas/starter-198/social-content/weekly-plans', {
    idempotencyKey: 'social-weekly-plan-001',
    body: {
      title: '下周内容验证', objective: '验证两个主题', productRef: 'product:chair', audience: '海外家具采购商',
      items: [
        { title: '卖点内容', objective: '展示产品差异', themeId: 'product_value', topic: '产品实测' },
        { title: '供应内容', objective: '展示供应保障', themeId: 'supplier_capability', topic: '质检与交付' },
      ],
    },
  });
  assert.equal(weeklyPlan.status, 201, weeklyPlan.raw);
  assert.equal(weeklyPlan.body.tasks.length, 2);
  assert.equal(weeklyPlan.body.tasks.every((item: any) => item.mode === 'weekly' && item.weeklyPlanId === weeklyPlan.body.weeklyPlan.weeklyPlanId), true);
  assert.deepEqual(weeklyPlan.body.weeklyPlan.taskIds, weeklyPlan.body.tasks.map((item: any) => item.taskId));

  const workPackageRows = dataStore.rows.get(STARTER_COLLECTIONS.socialWorkPackageVersions)!;
  while (workPackageRows.filter(row => row.tenant_id === SOCIAL_PACKAGE_CATALOG_TENANT).length <= MAX_SOCIAL_WORK_PACKAGE_VERSIONS) {
    workPackageRows.push({
      id: `limit-work-package-${workPackageRows.length}`,
      tenant_id: SOCIAL_PACKAGE_CATALOG_TENANT,
    });
  }
  const truncatedCatalog = await request('/api/overseas/starter-198/social-content/internal/work-packages', { platformAdmin: true });
  assert.equal(truncatedCatalog.status, 503);
  assert.equal(truncatedCatalog.body.error, 'social_package_catalog_limit_exceeded');

  const succeededOperations = dataStore.rows.get(STARTER_COLLECTIONS.socialContentOperations)!
    .filter(row => row.status === 'succeeded');
  assert.ok(succeededOperations.length > 0);
  for (const operation of succeededOperations) {
    assert.deepEqual(Object.keys(operation.result as object).sort(), ['operationId', 'schemaVersion', 'targetId']);
    assert.ok(Buffer.byteLength(JSON.stringify(operation.result), 'utf8') < 512, 'operation replay receipt remains bounded');
  }

  const fileRows = dataStore.rows.get(STARTER_COLLECTIONS.socialContentFiles)!;
  while (fileRows.filter(row => row.tenant_id === tenant && row.task_id === taskId).length < 50) {
    const index = fileRows.length;
    fileRows.push({ id: `limit-file-${index}`, tenant_id: tenant, task_id: taskId, byte_size: 1 });
  }
  await assert.rejects(
    socialTaskFileCapacity({ repository, tenantId: tenant, taskId }),
    (error: any) => error?.code === 'social_content_file_limit_reached',
  );

  const sourceRows = dataStore.rows.get(STARTER_COLLECTIONS.socialTaskSources)!;
  while (sourceRows.filter(row => row.tenant_id === tenant && row.task_id === taskId).length < 100) {
    sourceRows.push({ id: `limit-source-${sourceRows.length}`, tenant_id: tenant, task_id: taskId });
  }
  await assert.rejects(
    assertSocialTaskChildCapacity({ repository, tenantId: tenant, taskId, kind: 'source' }),
    (error: any) => error?.code === 'social_content_source_limit_reached',
  );

  const artifactRows = dataStore.rows.get(STARTER_COLLECTIONS.socialContentArtifacts)!;
  while (artifactRows.filter(row => row.tenant_id === tenant && row.task_id === taskId).length < limits.contentArtifactCountPerCycle) {
    artifactRows.push({ id: `limit-artifact-${artifactRows.length}`, tenant_id: tenant, task_id: taskId });
  }
  await assert.rejects(
    assertSocialTaskChildCapacity({ repository, tenantId: tenant, taskId, kind: 'artifact' }),
    (error: any) => error?.code === 'social_content_artifact_limit_reached',
  );

  const metricRows = dataStore.rows.get(STARTER_COLLECTIONS.socialMetricSubmissions)!;
  while (metricRows.filter(row => row.tenant_id === tenant && row.publication_id === publicationId).length < 50) {
    metricRows.push({ id: `limit-metric-${metricRows.length}`, tenant_id: tenant, task_id: taskId, publication_id: publicationId });
  }
  await assert.rejects(
    assertSocialTaskChildCapacity({ repository, tenantId: tenant, taskId, kind: 'metric_submission', publicationId }),
    (error: any) => error?.code === 'social_content_publication_metric_limit_reached',
  );

  while (taskRows.filter(row => row.tenant_id === victim).length < 200) {
    taskRows.push({ id: `limit-task-${taskRows.length}`, tenant_id: victim });
  }
  await assert.rejects(
    assertSocialTaskCapacity({ repository, tenantId: victim }),
    (error: any) => error?.code === 'social_content_task_limit_reached',
  );

  console.log('Starter social-content workflow HTTP, tenancy, lineage, idempotency, limits, evidence and package integrity tests passed');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.chdir(previous.cwd);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.NODE_ENV;
  if (previous.DISABLE_LOCAL_AUTH_FALLBACK === undefined) delete process.env.DISABLE_LOCAL_AUTH_FALLBACK;
  else process.env.DISABLE_LOCAL_AUTH_FALLBACK = previous.DISABLE_LOCAL_AUTH_FALLBACK;
  if (previous.PB_URL === undefined) delete process.env.PB_URL; else process.env.PB_URL = previous.PB_URL;
}
