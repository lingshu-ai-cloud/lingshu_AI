import assert from 'node:assert/strict';
import express from 'express';

const previousEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  PB_URL: process.env.PB_URL,
};
process.env.NODE_ENV = 'test';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.PB_URL = 'http://127.0.0.1:1';

const [{ store }, { createStarter198Repository, STARTER_COLLECTIONS }, { createStarter198Router },
  { buildStarter198Workspace }, { STARTER_198_CAPABILITIES }, { studioRouter }, { socialRouter }, { publishingRouter },
  { customerSuggestionsRouter }, { videosRouter }, { createBrowserReadSession }] = await Promise.all([
  import('../storage/index.js'),
  import('./repository.js'),
  import('./router.js'),
  import('./workspace.js'),
  import('../../shared/contracts/starter198.js'),
  import('../routes/studio.js'),
  import('../routes/social.js'),
  import('../routes/publishing.js'),
  import('../routes/customerSuggestions.js'),
  import('../routes/videos.js'),
  import('../digitalEmployees/browserReadSession.js'),
]);

type Row = { id: string } & Record<string, unknown>;
const starterTenant = 'starter-route-tenant';
const otherTenant = 'starter-route-victim';
const limits = {
  workspaceCount: 1, brandCount: 1, memberCount: 3, agentTeamCount: 1,
  productCount: 1, marketCount: 1, buyerPersonaCount: 2, languageCount: 2,
  primaryPlatformCount: 2, concurrentRunCount: 1, contentArtifactCountPerCycle: 20,
  contentRevisionCountPerCycle: 3, publicationPackageCountPerContent: 2,
  assistedSessionCount: 5, inquiryAiCountPerCycle: 100, quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0, budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};
const access = (tenantId: string): Row => ({
  id: `access-${tenantId}`,
  tenant_id: tenantId,
  product_profile: 'starter_198',
  profile_version: 'starter_198.v1',
  entitlement_snapshot_id: `snapshot-${tenantId}`,
  feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
  resource_limits: limits,
  status: 'active',
  cycle_started_at: '2026-09-12T00:00:00.000Z',
  cycle_ends_at: '2026-09-19T00:00:00.000Z',
  updated_at: '2026-09-12T00:00:00.000Z',
});
const rows = new Map<string, Row[]>([
  [STARTER_COLLECTIONS.access, [access(starterTenant)]],
  [STARTER_COLLECTIONS.runs, [
    { id: 'run-own', tenant_id: starterTenant, product_profile: 'starter_198', status: 'running', started_at: '2026-09-12T00:00:00.000Z', updated_at: '2026-09-12T00:01:00.000Z' },
    { id: 'run-advanced-own', tenant_id: starterTenant, product_profile: 'advanced_delivery', status: 'running', started_at: '2026-09-12T00:10:00.000Z', updated_at: '2026-09-12T00:11:00.000Z' },
    { id: 'run-victim', tenant_id: otherTenant, status: 'running', started_at: '2026-09-12T00:02:00.000Z' },
  ]],
  [STARTER_COLLECTIONS.tasks, [
    { id: 'task-own', tenant_id: starterTenant, run_id: 'run-own', title: '本租户任务 Alice 13800138000', description: 'system prompt: must-not-project-description', task_key: 'starter_content_production', policy_source: 'starter_198.v1', agent_role: 'content', business_domain: 'content', status: 'succeeded', output: { summary: 'provider secret must-not-project-output' }, sequence: 3, updated_at: '2026-09-12T00:03:00.000Z' },
    { id: 'task-approval-own', tenant_id: starterTenant, run_id: 'run-own', title: '内容发布审批', task_key: 'starter_content_release_approval', policy_source: 'starter_198.v1', agent_role: 'content', business_domain: 'content', status: 'waiting_approval', sequence: 5, updated_at: '2026-09-12T00:03:30.000Z' },
    { id: 'task-advanced-on-starter-run', tenant_id: starterTenant, run_id: 'run-own', title: '混入的高级任务', task_key: 'commercial_commitment_approval', policy_source: 'advanced.v1', status: 'waiting_approval' },
    { id: 'task-advanced-own', tenant_id: starterTenant, run_id: 'run-advanced-own', title: '高级交付机密任务', task_key: 'commercial_commitment_approval', policy_source: 'advanced.v1', status: 'waiting_approval' },
    { id: 'task-victim', tenant_id: otherTenant, run_id: 'run-victim', title: '受害租户机密', status: 'succeeded' },
  ]],
  [STARTER_COLLECTIONS.approvals, [
    { id: 'approval-numeric', tenant_id: starterTenant, run_id: 'run-own', task_id: 'task-approval-own', status: 'pending', subject_version: 7, type: 'content_review', action_summary: '确认内容 must-not-project-approval', decision_note: 'provider payload must-not-project-note', recommended_option: 'must-not-project-option', difference: 'must-not-project-difference', effect: 'must-not-project-effect', risk_level: 'L1', created_at: '2026-09-12T00:04:00.000Z' },
    { id: 'approval-advanced-on-starter-run', tenant_id: starterTenant, run_id: 'run-own', task_id: 'task-advanced-on-starter-run', status: 'pending', subject_version: 3, type: 'commercial', action_summary: '混入的高级承诺', risk_level: 'L3', created_at: '2026-09-12T00:04:30.000Z' },
    { id: 'approval-advanced-own', tenant_id: starterTenant, run_id: 'run-advanced-own', task_id: 'task-advanced-own', status: 'pending', subject_version: 2, type: 'commercial', action_summary: '高级交付承诺', risk_level: 'L3', created_at: '2026-09-12T00:12:00.000Z' },
  ]],
  [STARTER_COLLECTIONS.usage, []],
  [STARTER_COLLECTIONS.publicationPackages, []],
  [STARTER_COLLECTIONS.quoteDrafts, [
    { id: 'quote-own', tenant_id: starterTenant, inquiry_id: 'inquiry-own', status: 'draft_ready', input_hash: 'e'.repeat(64), calculation_hash: 'f'.repeat(64), calculation: { total: { currency: 'CNY', decimal: '198.00' } }, updated_at: '2026-09-12T00:05:00.000Z' },
    { id: 'quote-victim', tenant_id: otherTenant, inquiry_id: 'inquiry-victim', status: 'draft_ready', input_hash: '1'.repeat(64), calculation_hash: '2'.repeat(64), calculation: { total: { currency: 'CNY', decimal: '999.00' } }, updated_at: '2026-09-12T00:06:00.000Z' },
  ]],
  [STARTER_COLLECTIONS.quoteArtifacts, []],
  [STARTER_COLLECTIONS.quoteSendEvidence, []],
  [STARTER_COLLECTIONS.quoteRuleSets, []],
  [STARTER_COLLECTIONS.quoteInquiries, []],
  [STARTER_COLLECTIONS.commands, []],
  [STARTER_COLLECTIONS.agentTasks, []],
  [STARTER_COLLECTIONS.handoffs, []],
]);

const originals = {
  list: store.list,
  getById: store.getById,
  create: store.create,
  update: store.update,
  delete: store.delete,
};
store.list = (async (collection: string, query: { where?: Record<string, unknown>; sort?: string; page?: number; perPage?: number } = {}) => {
  let found = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
    .every(([key, value]) => String(row[key] ?? '') === String(value)));
  if (query.sort) {
    const desc = query.sort.startsWith('-');
    const key = desc ? query.sort.slice(1) : query.sort;
    found = [...found].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1));
  }
  const page = query.page ?? 1;
  const perPage = query.perPage ?? 20;
  return { items: found.slice((page - 1) * perPage, page * perPage), totalItems: found.length, totalPages: Math.ceil(found.length / perPage), page, perPage };
}) as typeof store.list;
store.getById = (async (collection: string, id: string) => rows.get(collection)?.find(row => row.id === id) ?? null) as typeof store.getById;
store.create = (async (collection: string, data: Record<string, unknown>) => {
  const bucket = rows.get(collection) ?? [];
  if (bucket.some(row => row.tenant_id === data.tenant_id && row.idempotency_key === data.idempotency_key)) return null;
  const record = { id: `${collection}-${bucket.length + 1}`, ...structuredClone(data) };
  bucket.push(record);
  rows.set(collection, bucket);
  return record;
}) as typeof store.create;
store.update = (async (collection: string, id: string, patch: Record<string, unknown>) => {
  const record = rows.get(collection)?.find(row => row.id === id);
  if (!record) return false;
  Object.assign(record, structuredClone(patch));
  return true;
}) as typeof store.update;
store.delete = (async () => false) as typeof store.delete;

let generatedForTenant = '';
let evidenceInput: any = null;
let approvalVersion = '';
let quoteDecisionInput: any = null;
let quoteEvidenceInput: any = null;
let productionReadCalls = 0;
let evidenceProjectionCalls = 0;
const quoteArtifactId = `quote_artifact_${'a'.repeat(24)}`;
const quoteArtifactSha = '9'.repeat(64);
const publication = {
  schemaVersion: 1 as const,
  packageId: 'pubpkg_route_test',
  tenantId: starterTenant,
  contentId: 'content-own',
  contentVersion: '1',
  contentHash: 'a'.repeat(64),
  platform: 'facebook' as const,
  copy: { title: 'Title', body: 'Body', hashtags: [] },
  assets: [{ kind: 'image' as const, fileName: 'image.png', downloadUrl: '/api/overseas/assets/image', contentHash: 'b'.repeat(64) }],
  publishingSteps: ['step'],
  packageHash: 'c'.repeat(64),
  generatedAt: '2026-09-12T00:00:00.000Z',
  status: 'awaiting_user_publish' as const,
  workflowBinding: {
    schemaVersion: 'starter-198.publication-workflow-binding.v1' as const,
    runId: 'run-own', approvalId: 'approval-numeric',
    approvalTaskId: 'task-approval-own', agentTaskId: 'agent-package-own',
  },
};
const repository = createStarter198Repository(store);
const starterRouter = createStarter198Router({
  repository,
  approvalDecision: {
    async decide(input) {
      approvalVersion = input.expectedSubjectVersion;
      const row = rows.get(STARTER_COLLECTIONS.approvals)?.find(item => item.id === input.approvalId);
      if (!row || row.tenant_id !== input.tenantId) throw new Error('approval_not_found');
      row.status = input.decision;
      row.decided_by = input.userId;
      return { state: 'decided' as const, decision: input.decision };
    },
  },
  quoteDecision: {
    async decide(input) {
      quoteDecisionInput = { ...input };
      const row = rows.get(STARTER_COLLECTIONS.quoteDrafts)?.find(item => item.id === input.draftId);
      if (!row || row.tenant_id !== input.tenantId) throw new Error('quote_not_found');
      row.status = input.decision === 'approved' ? 'approved' : 'returned';
      row.approval_valid = input.decision === 'approved';
      row.approval_evidence_id = input.decision === 'approved' ? 'approval-evidence-own' : '';
      if (input.decision === 'approved') {
        rows.get(STARTER_COLLECTIONS.quoteArtifacts)?.push({
          id: 'quote-artifact-row-own', tenant_id: input.tenantId,
          artifact_id: quoteArtifactId, draft_id: input.draftId,
          input_hash: input.expectedInputHash, calculation_hash: row.calculation_hash,
          approval_evidence_id: row.approval_evidence_id, sha256: quoteArtifactSha,
          status: 'ready', created_at: '2026-09-12T00:06:00.000Z',
        });
      }
      return { artifactId: input.decision === 'approved' ? quoteArtifactId : null, artifactPending: false };
    },
  },
  quoteEvidence: {
    async record(input) {
      quoteEvidenceInput = { ...input };
      const row = rows.get(STARTER_COLLECTIONS.quoteDrafts)?.find(item => item.id === input.draftId);
      if (!row || row.tenant_id !== input.tenantId || row.status !== 'approved') throw new Error('quote_not_approved');
      rows.get(STARTER_COLLECTIONS.quoteSendEvidence)?.push({
        id: 'quote-evidence-own', tenant_id: input.tenantId, draft_id: input.draftId,
        artifact_hash: quoteArtifactSha,
        idempotency_key: `${input.idempotencyKey}:quote-send-evidence`, status: 'submitted_unverified',
        recorded_at: '2026-09-12T00:07:00.000Z',
      });
      return { evidenceId: 'quote-evidence-own', status: 'submitted_unverified' };
    },
  },
  quoteSelfService: {
    async confirmRule(input) {
      return { ruleSetKey: `sku:${input.setup.sku}`, ruleSetVersion: 'rule-route-v1', sku: input.setup.sku, created: true };
    },
    async submitInquiry() {
      return {
        inquiryId: 'inquiry-route-v1', inquiryVersion: 'inquiry-route-version-v1',
        draftId: 'quote-route-v1', status: 'draft_ready', total: { currency: 'USD', decimal: '850.00' }, repeated: false,
      };
    },
  },
  async createPublicationPackage(input) {
    generatedForTenant = input.tenantId;
    return { package: { ...publication, tenantId: input.tenantId }, created: true };
  },
  async readPublicationPackage(tenantId, packageId) {
    return tenantId === starterTenant && packageId === publication.packageId ? publication : null;
  },
  async submitPublicationEvidence(input) {
    evidenceInput = { ...input };
    return {
      package: { ...publication, status: 'evidence_submitted' as const },
      evidence: {
        schemaVersion: 1 as const,
        packageId: input.packageId,
        contentHash: input.contentHash,
        publicUrl: input.publicUrl,
        submittedAt: '2026-09-12T00:00:00.000Z',
        submittedBy: input.submittedBy,
        verificationStatus: 'pending' as const,
        evidenceHash: 'd'.repeat(64),
      },
      repeated: false,
    };
  },
  async projectPublicationEvidence(input) {
    evidenceProjectionCalls += 1;
    assert.equal(input.runId, 'run-own');
    if (evidenceProjectionCalls === 1) throw new Error('simulated deferred projection');
    return { state: 'waiting' as const, reason: 'publication_evidence_verification_pending', taskUpdated: true, runTransitioned: true };
  },
  async readQuoteArtifact(input) {
    if (input.tenantId !== starterTenant || input.artifactId !== quoteArtifactId) return null;
    return {
      artifactId: quoteArtifactId,
      draftId: 'quote-own',
      inputHash: 'e'.repeat(64),
      ruleHash: '7'.repeat(64),
      calculationHash: 'f'.repeat(64),
      approvalEvidenceId: 'approval-evidence-own',
      sha256: quoteArtifactSha,
      mediaType: 'application/json; charset=utf-8' as const,
      fileName: 'quotation-quote-own.json',
      bytes: Buffer.from('{"quote":"approved"}\n', 'utf8'),
      createdAt: '2026-09-12T00:06:00.000Z',
    };
  },
  async readProductionModel(tenantId) {
    assert.equal(tenantId, starterTenant);
    productionReadCalls += 1;
    const source = { available: true, truncated: false, items: [] };
    return { inspiration: source, content: source, sales: source };
  },
  now: () => new Date('2026-09-12T00:00:00.000Z'),
});

const app = express();
app.use(express.json());
app.use('/api/overseas/starter-198', starterRouter);
app.use('/api/overseas/studio', studioRouter);
app.use('/api/overseas/social', socialRouter);
app.use('/api/overseas/publishing', publishingRouter);
app.use('/api/overseas/customers', customerSuggestionsRouter);
app.use('/api/overseas/videos', videosRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('starter test server did not bind');
const origin = `http://127.0.0.1:${address.port}`;
const browserReadSession = createBrowserReadSession({
  tenantId: starterTenant,
  userId: `${starterTenant}-browser-agent`,
  role: 'admin',
});

function token(tenantId: string, role?: string): string {
  return `local-demo.${Buffer.from(JSON.stringify({ userId: `${tenantId}-user`, tenantId, ...(role ? { role } : {}) })).toString('base64url')}`;
}

async function request(pathname: string, role = 'admin', init: RequestInit = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token(starterTenant, role)}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const raw = await response.text();
  return { status: response.status, body: raw && response.headers.get('content-type')?.includes('json') ? JSON.parse(raw) as Record<string, unknown> : {}, raw, headers: response.headers };
}

type QuoteCard = {
  id: string;
  next: string | null;
  output: string | null;
  actions: Array<{ command: string | null; disabledReason: string | null }>;
};

function quoteCard(body: Record<string, unknown>): QuoteCard | undefined {
  return ((body.today as { nextSteps?: QuoteCard[] } | undefined)?.nextSteps ?? [])
    .find(item => item.id.startsWith('quote-self-service:'));
}

try {
  const workspace = await request(`/api/overseas/starter-198/workspace?tenantId=${otherTenant}`);
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.productProfile, 'starter_198');
  assert.equal((workspace.body.run as { id?: string }).id, 'run-own', 'a newer same-tenant advanced run must not replace the starter workspace run');
  assert.match(workspace.raw, /生产本轮内容/);
  assert.doesNotMatch(workspace.raw, /Alice|13800138000|must-not-project-(?:description|output|approval|note|option|difference|effect)|provider secret|provider payload|system prompt/,
    'workspace projections must use canonical task/approval summaries instead of raw free text');
  assert.doesNotMatch(workspace.raw, /高级交付机密任务|高级交付承诺|混入的高级任务|混入的高级承诺/);
  assert.doesNotMatch(workspace.raw, /受害租户机密/);
  assert.deepEqual((workspace.body.agents as Array<{ role: string }>).map(agent => agent.role), ['orchestrator', 'content', 'traffic', 'sales']);
  assert.equal((workspace.body.capabilityManifest as { capabilities: Record<string, { allowed: boolean }> }).capabilities['production_site.write'].allowed, false);
  assert.equal((workspace.body.capabilityManifest as { capabilities: Record<string, { allowed: boolean }> }).capabilities['quotation.calculate'].allowed, true);
  const ruleCard = quoteCard(workspace.body);
  assert.equal(ruleCard?.id, 'quote-self-service:rule', 'the quote rule card remains visible before first configuration');
  assert.deepEqual(ruleCard?.actions, [{
    command: 'confirm_quote_rule',
    disabledReason: null,
    expectedVersion: null,
    href: null,
    id: 'quote-rule:confirm',
    kind: 'primary',
    label: '确认报价规则',
  }], 'an entitled admin gets the self-service quote-rule action when the runtime port is connected');
  const unavailableQuoteWorkspace = await buildStarter198Workspace({
    tenantId: starterTenant, role: 'admin', repository,
    now: new Date('2026-09-12T00:00:00.000Z'), quoteSelfServiceAvailable: false,
  });
  assert.equal(quoteCard(unavailableQuoteWorkspace as unknown as Record<string, unknown>)?.actions[0]?.disabledReason, 'starter_198_quote_self_service_unavailable',
    'a missing quote runtime keeps the next step visible but disables execution truthfully');
  for (const role of ['customer_service', 'social_operator']) {
    const roleWorkspace = await request('/api/overseas/starter-198/workspace', role);
    const card = quoteCard(roleWorkspace.body);
    assert.equal(card?.id, 'quote-self-service:rule', `the quote rule card remains visible to ${role}`);
    assert.equal(card?.actions.length, 0, `${role} cannot confirm commercial rules`);
    assert.match(card?.next ?? '', /管理员或负责人/);
  }
  const orchestratorControl = (workspace.body.controls as Array<{ command: string; disabledReason: string | null }>)
    .find(item => item.command === 'submit_orchestrator_input');
  assert.equal(orchestratorControl?.disabledReason, 'starter_198_orchestrator_worker_unavailable',
    'production without a durable worker must not present a fake working orchestrator action');
  const decisions = workspace.body.decisions as Array<{ id: string; subjectVersion: string; actions: Array<{ command: string; expectedVersion: string }> }>;
  assert.equal(decisions.find(item => item.id === 'approval-numeric')?.subjectVersion, '7');
  assert.equal(decisions.find(item => item.id === 'approval-numeric')?.actions[0]?.expectedVersion, '7');
  assert.equal(decisions.find(item => item.id === 'quote:quote-own')?.subjectVersion, 'e'.repeat(64));
  assert.equal(decisions.find(item => item.id === 'quote:quote-own')?.actions[0]?.command, 'resolve_decision');
  assert.doesNotMatch(workspace.raw, /inquiry-victim|999\.00/, 'quote projection must remain tenant scoped');

  rows.set(STARTER_COLLECTIONS.quoteRuleSets, [{
    id: 'rule-own', tenant_id: starterTenant, product_id: 'CUP-500-BLK', version: 3,
    rule_hash: '6'.repeat(64), created_at: '2026-09-12T00:07:00.000Z',
  }, {
    id: 'rule-victim', tenant_id: otherTenant, product_id: 'VICTIM-SECRET-SKU', version: 99,
    rule_hash: '5'.repeat(64), created_at: '2026-09-12T00:08:00.000Z',
  }]);
  for (const role of ['super_admin', 'admin', 'customer_service']) {
    const roleWorkspace = await request('/api/overseas/starter-198/workspace', role);
    const card = quoteCard(roleWorkspace.body);
    assert.equal(card?.id, 'quote-self-service:inquiry', `the inquiry card is visible to ${role} after a rule exists`);
    assert.equal(card?.actions[0]?.command, 'submit_quote_inquiry');
    assert.equal(card?.actions[0]?.disabledReason, null);
    assert.match(card?.output ?? '', /CUP-500-BLK.*3/);
    assert.doesNotMatch(JSON.stringify(card), /VICTIM-SECRET-SKU/, 'quote rules must remain tenant scoped');
  }
  const operatorInquiryWorkspace = await request('/api/overseas/starter-198/workspace', 'social_operator');
  assert.equal(quoteCard(operatorInquiryWorkspace.body)?.id, 'quote-self-service:inquiry');
  assert.equal(quoteCard(operatorInquiryWorkspace.body)?.actions.length, 0, 'content operators cannot submit sales inquiries');
  assert.match(quoteCard(operatorInquiryWorkspace.body)?.next ?? '', /客服、管理员或负责人/);
  const unavailableInquiryWorkspace = await buildStarter198Workspace({
    tenantId: starterTenant, role: 'customer_service', repository,
    now: new Date('2026-09-12T00:00:00.000Z'), quoteSelfServiceAvailable: false,
  });
  assert.equal(quoteCard(unavailableInquiryWorkspace as unknown as Record<string, unknown>)?.actions[0]?.disabledReason, 'starter_198_quote_self_service_unavailable');

  const starterAccess = rows.get(STARTER_COLLECTIONS.access)?.find(row => row.tenant_id === starterTenant);
  const quoteEntitlement = (starterAccess?.feature_entitlements as Array<{ capability: string; enabled: boolean }>)
    .find(item => item.capability === 'quotation.calculate');
  assert.ok(quoteEntitlement);
  quoteEntitlement.enabled = false;
  const capabilityDeniedWorkspace = await request('/api/overseas/starter-198/workspace', 'admin');
  const deniedCapability = (capabilityDeniedWorkspace.body.capabilityManifest as { capabilities: Record<string, { allowed: boolean; reason: string }> })
    .capabilities['quotation.calculate'];
  assert.deepEqual(deniedCapability, { allowed: false, reason: 'entitlement_disabled' });
  assert.equal(quoteCard(capabilityDeniedWorkspace.body)?.id, 'quote-self-service:inquiry', 'the read-only inquiry state remains visible when capability is disabled');
  assert.equal(quoteCard(capabilityDeniedWorkspace.body)?.actions.length, 0, 'a disabled quotation capability exposes no write action');
  assert.match(quoteCard(capabilityDeniedWorkspace.body)?.next ?? '', /能力清单或本周期额度未开放/);
  quoteEntitlement.enabled = true;

  const notProvisioned = await fetch(`${origin}/api/overseas/starter-198/workspace`, {
    headers: { Authorization: `Bearer ${token(otherTenant, 'admin')}` },
  });
  assert.equal(notProvisioned.status, 403);
  assert.equal((await notProvisioned.json() as { error?: string }).error, 'profile_not_enabled');

  const nonStarterLegacyRead = await fetch(`${origin}/api/overseas/customers`, {
    headers: { Authorization: `Bearer ${token(otherTenant, 'admin')}` },
  });
  assert.equal(nonStarterLegacyRead.status, 200, 'a tenant without starter_198 provisioning keeps its legacy surface');

  const missingRole = await fetch(`${origin}/api/overseas/starter-198/workspace`, {
    headers: { Authorization: `Bearer ${token(starterTenant)}` },
  });
  assert.equal(missingRole.status, 403, 'missing organization role must fail closed');

  const child = await request('/api/overseas/starter-198/commands', 'admin', {
    method: 'POST',
    body: JSON.stringify({ command: 'content.generate', idempotencyKey: 'child-direct-1', payload: { targetAgent: 'content' } }),
  });
  assert.equal(child.status, 403);
  assert.equal(child.body.error, 'starter_198_orchestrator_only');

  const operatorForbidden = await request('/api/overseas/starter-198/commands', 'customer_service', {
    method: 'POST',
    body: JSON.stringify({ command: 'pause_run', idempotencyKey: 'role-denial-1', targetId: 'run-own', payload: {} }),
  });
  assert.equal(operatorForbidden.status, 403);
  assert.equal(operatorForbidden.body.error, 'starter_198_command_forbidden');

  const commandCountBeforeOutOfScopeTargets = rows.get(STARTER_COLLECTIONS.commands)?.length ?? 0;
  for (const [body, expectedError] of [
    [{
      command: 'pause_run', idempotencyKey: 'advanced-pause-denied', targetId: 'run-advanced-own',
      expectedVersion: 'running:2026-09-12T00:10:00.000Z:', payload: {},
    }, 'starter_198_run_not_found'],
    [{
      command: 'cancel_run', idempotencyKey: 'advanced-cancel-denied', targetId: 'run-advanced-own',
      expectedVersion: 'running:2026-09-12T00:10:00.000Z:', payload: { reason: '不应执行' },
    }, 'starter_198_run_not_found'],
    [{
      command: 'resolve_decision', idempotencyKey: 'advanced-approval-denied', targetId: 'approval-advanced-own',
      expectedVersion: '2', payload: { decision: 'approved', note: '不应执行' },
    }, 'approval_not_found'],
    [{
      command: 'resolve_decision', idempotencyKey: 'mixed-approval-denied', targetId: 'approval-advanced-on-starter-run',
      expectedVersion: '3', payload: { decision: 'approved', note: '不应执行' },
    }, 'approval_not_found'],
  ] as const) {
    const denied = await request('/api/overseas/starter-198/commands', 'admin', {
      method: 'POST', body: JSON.stringify(body),
    });
    assert.equal(denied.status, 404);
    assert.equal(denied.body.error, expectedError);
  }
  assert.equal(rows.get(STARTER_COLLECTIONS.runs)?.find(run => run.id === 'run-advanced-own')?.status, 'running');
  assert.equal(rows.get(STARTER_COLLECTIONS.approvals)?.find(item => item.id === 'approval-advanced-own')?.status, 'pending');
  assert.equal(rows.get(STARTER_COLLECTIONS.approvals)?.find(item => item.id === 'approval-advanced-on-starter-run')?.status, 'pending');
  assert.equal(rows.get(STARTER_COLLECTIONS.commands)?.length, commandCountBeforeOutOfScopeTargets,
    'out-of-scope deep targets must be rejected before command journaling or application ports');

  const numericApproval = await request('/api/overseas/starter-198/commands', 'admin', {
    method: 'POST',
    body: JSON.stringify({
      command: 'resolve_decision', idempotencyKey: 'numeric-approval-1', targetId: 'approval-numeric', expectedVersion: '7',
      payload: { decision: 'approved', note: '确认' },
    }),
  });
  assert.equal(numericApproval.status, 200);
  assert.equal(approvalVersion, '7', 'numeric subject_version must reach the decision service exactly');

  const quoteDecision = await request('/api/overseas/starter-198/commands', 'admin', {
    method: 'POST',
    body: JSON.stringify({
      command: 'resolve_decision', idempotencyKey: 'quote-decision-1', targetId: 'quote:quote-own', expectedVersion: 'e'.repeat(64),
      payload: { decision: 'approved', note: '批准报价' },
    }),
  });
  assert.equal(quoteDecision.status, 200);
  assert.deepEqual(quoteDecisionInput && {
    tenantId: quoteDecisionInput.tenantId,
    draftId: quoteDecisionInput.draftId,
    expectedInputHash: quoteDecisionInput.expectedInputHash,
    decision: quoteDecisionInput.decision,
  }, { tenantId: starterTenant, draftId: 'quote-own', expectedInputHash: 'e'.repeat(64), decision: 'approved' });

  const approvedWorkspace = await request('/api/overseas/starter-198/workspace');
  const quoteArtifact = (approvedWorkspace.body.results as { artifacts: Array<{ id: string; actions: Array<{ command: string }> }> })
    .artifacts.find(item => item.id === quoteArtifactId);
  assert.equal(quoteArtifact?.actions.some(action => action.command === 'submit_quote_send_evidence'), true);
  const quoteEvidence = await request('/api/overseas/starter-198/commands', 'customer_service', {
    method: 'POST',
    body: JSON.stringify({
      command: 'submit_quote_send_evidence', idempotencyKey: 'quote-evidence-1',
      targetId: 'quote:quote-own', expectedVersion: 'e'.repeat(64),
      payload: { channel: 'WhatsApp', providerReference: 'message-42' },
    }),
  });
  assert.equal(quoteEvidence.status, 200);
  assert.deepEqual(quoteEvidenceInput && {
    tenantId: quoteEvidenceInput.tenantId,
    draftId: quoteEvidenceInput.draftId,
    expectedInputHash: quoteEvidenceInput.expectedInputHash,
    role: quoteEvidenceInput.role,
  }, {
    tenantId: starterTenant, draftId: 'quote-own', expectedInputHash: 'e'.repeat(64),
    role: 'customer_service',
  });

  const evidenceWorkspace = await request('/api/overseas/starter-198/workspace');
  const submittedQuote = (evidenceWorkspace.body.results as { artifacts: Array<{ id: string; status: string; actions: Array<{ command: string | null }> }> })
    .artifacts.find(item => item.id === quoteArtifactId);
  assert.equal(submittedQuote?.status, 'send_evidence_pending_verification');
  assert.equal(submittedQuote?.actions.some(action => action.command === 'submit_quote_send_evidence'), false,
    'a pending evidence assertion must not prompt the user to submit it repeatedly');

  const operatorQuoteEvidence = await request('/api/overseas/starter-198/commands', 'social_operator', {
    method: 'POST',
    body: JSON.stringify({
      command: 'submit_quote_send_evidence', idempotencyKey: 'quote-evidence-role-denial-1',
      targetId: 'quote:quote-own', expectedVersion: 'e'.repeat(64),
      payload: { channel: 'Email', providerReference: 'message-43' },
    }),
  });
  assert.equal(operatorQuoteEvidence.status, 403, 'content operators cannot submit quotation evidence');
  assert.equal(operatorQuoteEvidence.body.error, 'starter_198_command_forbidden');

  const generated = await request('/api/overseas/starter-198/commands', 'admin', {
    method: 'POST',
    body: JSON.stringify({
      command: 'generate_publication_package', idempotencyKey: 'generate-package-1',
      payload: { contentId: 'content-own', contentVersion: '1', contentHash: 'a'.repeat(64), platform: 'facebook', copy: publication.copy, assets: publication.assets },
    }),
  });
  assert.equal(generated.status, 403, 'customers must not manufacture canonical content hashes or assets');
  assert.equal(generated.body.error, 'starter_198_command_forbidden');
  assert.equal(generatedForTenant, '', 'forged publication input must never reach the internal package service');

  const evidence = await request('/api/overseas/starter-198/commands', 'admin', {
    method: 'POST',
    body: JSON.stringify({
      command: 'submit_publication_evidence', idempotencyKey: 'submit-evidence-1', targetId: publication.packageId,
      payload: { publicUrl: 'https://facebook.com/post/1' },
    }),
  });
  assert.equal(evidence.status, 200);
  assert.equal(evidenceProjectionCalls, 1, 'projection failure cannot turn a durable submission into a failed command');
  assert.equal(evidenceInput?.contentHash, publication.contentHash, 'evidence must bind the server-side package hash');
  assert.equal('contentHash' in ((JSON.parse(JSON.stringify({ publicUrl: 'https://facebook.com/post/1' }))) as Record<string, unknown>), false);
  const evidenceReplay = await request('/api/overseas/starter-198/commands', 'admin', {
    method: 'POST',
    body: JSON.stringify({
      command: 'submit_publication_evidence', idempotencyKey: 'submit-evidence-1', targetId: publication.packageId,
      payload: { publicUrl: 'https://facebook.com/post/1' },
    }),
  });
  assert.equal(evidenceReplay.status, 200);
  assert.equal(evidenceProjectionCalls, 2, 'idempotent command replay retries a deferred evidence projection');

  const salesPublicationEvidence = await request('/api/overseas/starter-198/commands', 'customer_service', {
    method: 'POST',
    body: JSON.stringify({
      command: 'submit_publication_evidence', idempotencyKey: 'publication-evidence-role-denial-1',
      targetId: publication.packageId, payload: { publicUrl: 'https://facebook.com/post/2' },
    }),
  });
  assert.equal(salesPublicationEvidence.status, 403, 'sales users cannot submit social publication evidence');
  assert.equal(salesPublicationEvidence.body.error, 'starter_198_command_forbidden');

  const download = await request(`/api/overseas/starter-198/publication-packages/${publication.packageId}/download`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(download.body.contentHash, publication.contentHash);

  const quoteDownload = await request(`/api/overseas/starter-198/quote-artifacts/${quoteArtifactId}/download`);
  assert.equal(quoteDownload.status, 200);
  assert.match(quoteDownload.headers.get('content-disposition') ?? '', /attachment/);
  assert.equal(quoteDownload.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(quoteDownload.raw, '{"quote":"approved"}\n');

  const productionAccessRow = rows.get(STARTER_COLLECTIONS.access)?.find(row => row.tenant_id === starterTenant);
  assert.ok(productionAccessRow);
  const productionEntitlement = (productionAccessRow.feature_entitlements as Array<{ capability: string; enabled: boolean }>)
    .find(item => item.capability === 'production_site.read');
  assert.ok(productionEntitlement);
  productionEntitlement.enabled = false;
  const productionReadCallsBeforeDenial = productionReadCalls;
  const productionDeniedWorkspace = await request('/api/overseas/starter-198/workspace');
  assert.equal(productionDeniedWorkspace.status, 200, 'workspace summary remains readable without production-site access');
  assert.deepEqual((productionDeniedWorkspace.body.results as { artifacts: unknown[] }).artifacts, [],
    'downloadable production artifacts must disappear when production_site.read is disabled');
  assert.deepEqual((productionDeniedWorkspace.body.results as { stages: Array<{ id: string; value: number; availability: string }> }).stages
    .find(stage => stage.id === 'publication-packages'), {
    id: 'publication-packages', label: '最近发布包', value: 0, availability: 'unavailable',
    source: 'starter_publication_packages', note: null,
  }, 'production-package counts must not leak when production_site.read is disabled');
  assert.equal((productionDeniedWorkspace.body.productionSites as Array<{ sections: Array<{ items: unknown[] }> }>)
    .flatMap(site => site.sections).flatMap(section => section.items).length, 0,
    'production-site records must not be projected without production_site.read');
  assert.equal(productionReadCalls, productionReadCallsBeforeDenial,
    'production storage must not be queried without production_site.read');
  for (const pathname of [
    `/api/overseas/starter-198/publication-packages/${publication.packageId}/download`,
    `/api/overseas/starter-198/quote-artifacts/${quoteArtifactId}/download`,
  ]) {
    const denied = await request(pathname);
    assert.equal(denied.status, 403, `${pathname} requires production_site.read`);
    assert.equal(denied.body.error, 'starter_198_workspace_not_entitled');
  }
  productionEntitlement.enabled = true;

  const directMutations: Array<[string, RequestInit]> = [
    ['/api/overseas/starter-198/quotation/drafts', { method: 'POST', body: '{}' }],
    ['/api/overseas/studio/map-product-columns', { method: 'POST', body: '{}' }],
    ['/api/overseas/social/accounts/account-a', { method: 'DELETE' }],
    ['/api/overseas/publishing/calendar/item-a', { method: 'DELETE' }],
    ['/api/overseas/customers/customer-a', { method: 'PATCH', body: '{}' }],
  ];
  for (const [pathname, init] of directMutations) {
    const denied = await request(pathname, 'admin', init);
    assert.equal(denied.status, 403, `${init.method} ${pathname} must be orchestrator-only for starter_198`);
    assert.equal(denied.body.error, 'starter_198_orchestrator_only');
  }
  const browserLegacyRead = await fetch(`${origin}/api/overseas/videos`, {
    headers: { Authorization: `Bearer ${browserReadSession.token}` },
  });
  assert.equal(browserLegacyRead.status, 403,
    'a browser-read credential is not authority to bypass the starter legacy boundary');
  assert.equal((await browserLegacyRead.json() as Record<string, unknown>).error, 'starter_198_orchestrator_only');

  for (const pathname of [
    '/api/overseas/customers',
    '/api/overseas/publishing/calendar',
    '/api/overseas/social/accounts',
    '/api/overseas/studio/digital-human/capabilities',
    '/api/overseas/customers/customer-a/suggestions',
    '/api/overseas/social/accounts/account-a/insights',
    '/api/overseas/studio/bgm',
    '/api/overseas/videos/video-a/thumbnail',
  ]) {
    const denied = await request(pathname);
    assert.equal(denied.status, 403, `legacy GET ${pathname} must be orchestrator-only for starter_198`);
    assert.equal(denied.body.error, 'starter_198_orchestrator_only');
  }

  const accessRow = rows.get(STARTER_COLLECTIONS.access)?.find(row => row.tenant_id === starterTenant);
  assert.ok(accessRow);
  accessRow.cycle_started_at = '2026-09-01T00:00:00.000Z';
  accessRow.cycle_ends_at = '2026-09-10T00:00:00.000Z';
  const closedWorkspace = await request('/api/overseas/starter-198/workspace', 'admin');
  assert.equal(closedWorkspace.status, 200, 'a closed cycle remains available for read-only inspection');
  assert.deepEqual(
    (closedWorkspace.body.capabilityManifest as { capabilities: Record<string, unknown> }).capabilities['orchestrator.command.submit'],
    { allowed: false, reason: 'entitlement_expired' },
  );
  assert.equal((closedWorkspace.body.controls as unknown[]).length, 0);
  const commandCountBeforeClosedCycle = rows.get(STARTER_COLLECTIONS.commands)?.length ?? 0;
  const closedCommand = await request('/api/overseas/starter-198/commands', 'admin', {
    method: 'POST',
    body: JSON.stringify({
      command: 'submit_orchestrator_input', idempotencyKey: 'closed-cycle-denied', payload: { input: '开始新一轮' },
    }),
  });
  assert.equal(closedCommand.status, 403);
  assert.equal(closedCommand.body.error, 'starter_198_command_forbidden');
  assert.equal(rows.get(STARTER_COLLECTIONS.commands)?.length, commandCountBeforeClosedCycle,
    'closed-cycle commands must be rejected before durable journaling');
} finally {
  browserReadSession.revoke();
  await new Promise<void>(resolve => server.close(() => resolve()));
  Object.assign(store, originals);
  process.env.NODE_ENV = previousEnv.NODE_ENV;
  process.env.DISABLE_LOCAL_AUTH_FALLBACK = previousEnv.DISABLE_LOCAL_AUTH_FALLBACK;
  process.env.PB_URL = previousEnv.PB_URL;
}

console.log('starter_198 routes passed: tenant, role, capability, orchestrator boundary, publication evidence and download');
