import assert from 'node:assert/strict';
import fs from 'node:fs';
import express, { type Request } from 'express';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import { createStarter198LegacyMutationBoundary } from './legacyBoundary.js';
import {
  STARTER_COLLECTIONS,
  Starter198RepositoryError,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import type { Starter198AccessSnapshot } from './profile.js';
import {
  bindSocialProjectSpec,
  socialProjectBelongs,
  socialProjectTaskId,
} from './socialProjectScope.js';

const now = new Date('2026-09-14T08:00:00.000Z');
const limits = {
  workspaceCount: 1,
  brandCount: 1,
  memberCount: 3,
  agentTeamCount: 1,
  productCount: 1,
  marketCount: 1,
  buyerPersonaCount: 2,
  languageCount: 2,
  primaryPlatformCount: 2,
  concurrentRunCount: 1,
  contentArtifactCountPerCycle: 20,
  contentRevisionCountPerCycle: 3,
  publicationPackageCountPerContent: 2,
  assistedSessionCount: 5,
  inquiryAiCountPerCycle: 100,
  quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0,
  budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

function access(tenantId: string, workflowEnabled = true, productionEnabled = true): Starter198AccessSnapshot {
  return {
    recordId: `access-${tenantId}`,
    tenantId,
    productProfile: 'starter_198',
    profileVersion: 'starter_198.v1',
    entitlementSnapshotId: `snapshot-${tenantId}`,
    entitlements: STARTER_198_CAPABILITIES.map(capability => ({
      capability,
      enabled: capability === 'workflow.standard.run'
        ? workflowEnabled
        : capability === 'production_site.read' ? productionEnabled : true,
    })),
    resourceLimits: limits,
    status: 'active',
    cycleStartedAt: '2026-09-01T00:00:00.000Z',
    cycleEndsAt: '2026-10-01T00:00:00.000Z',
    updatedAt: now.toISOString(),
  };
}

const accessRows = new Map([
  ['tenant-a', access('tenant-a')],
  ['tenant-b', access('tenant-b')],
  ['tenant-no-generation', access('tenant-no-generation', false)],
  ['tenant-no-production-read', access('tenant-no-production-read', true, false)],
]);
const taskRows: StarterRecord[] = [
  { id: 'row-task-a', tenant_id: 'tenant-a', task_id: 'task-a' },
  { id: 'row-task-b', tenant_id: 'tenant-b', task_id: 'task-b' },
  { id: 'row-task-no-generation', tenant_id: 'tenant-no-generation', task_id: 'task-no-generation' },
  { id: 'row-task-no-production-read', tenant_id: 'tenant-no-production-read', task_id: 'task-no-production-read' },
];

const repository: Starter198Repository = {
  async access(tenantId) {
    const value = accessRows.get(tenantId);
    if (!value) throw new Starter198RepositoryError('starter_198_not_provisioned');
    return value;
  },
  async list(collection, tenantId, query = {}) {
    const expectedTaskId = String(query.where?.task_id || '');
    const items = collection === STARTER_COLLECTIONS.socialContentTasks
      ? taskRows.filter(item => item.tenant_id === tenantId && (!expectedTaskId || item.task_id === expectedTaskId))
      : [];
    return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage ?? 500 };
  },
  async get() { return null; },
  async create() { throw new Error('not used'); },
  async update() { throw new Error('not used'); },
};

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  Object.assign(res.locals, {
    tenantId: String(req.header('x-test-tenant') || 'tenant-a'),
    userId: 'user-a',
  });
  void createStarter198LegacyMutationBoundary(repository, {
    resolveRole: async (request: Request) => request.header('x-test-role') || null,
    now: () => now,
  })(req, res, next);
});
app.use((req, res) => res.json({ ok: true, path: req.path, method: req.method }));

const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('social legacy access test server did not bind');
const origin = `http://127.0.0.1:${address.port}`;

async function request(pathname: string, input: {
  method?: string;
  tenantId?: string;
  role?: string;
  taskId?: string;
  page?: string;
  body?: Record<string, unknown>;
} = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: input.method,
    headers: {
      'x-test-tenant': input.tenantId || 'tenant-a',
      'x-test-role': input.role || 'admin',
      ...(input.taskId ? { 'x-lingshu-social-task-id': input.taskId } : {}),
      ...(input.page ? { 'x-lingshu-social-page': input.page } : {}),
      ...(input.method && input.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(input.method && !['GET', 'HEAD'].includes(input.method) ? { body: JSON.stringify(input.body || {}) } : {}),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const ownContext = { taskId: 'task-a', page: 'smartAssets' };

try {
  assert.deepEqual(bindSocialProjectSpec({ socialContentTaskId: 'forged', title: 'draft' }, 'task-a'), {
    socialContentTaskId: 'task-a',
    title: 'draft',
  }, 'the trusted task context must override a client-forged project binding');
  assert.equal(socialProjectBelongs({ spec: { socialContentTaskId: 'task-a' } }, 'task-a'), true);
  assert.equal(socialProjectBelongs({ spec: JSON.stringify({ socialContentTaskId: 'task-b' }) }, 'task-a'), false,
    'a task context must not read or mutate another social task project');
  assert.equal(socialProjectBelongs({ spec: { socialContentTaskId: 'task-b' } }, ''), true,
    'legacy project behavior remains unchanged outside a starter social context');
  assert.equal(socialProjectTaskId({ starter198SocialContext: {
    taskId: 'task-a', page: 'smartAssets', accessKind: 'edit',
  } }), 'task-a');
  assert.equal((await request('/api/overseas/studio/projects')).status, 403,
    'starter tenants must not reach a professional page without an explicit social task');
  assert.equal((await request('/api/overseas/studio/projects', { taskId: 'task-a' })).status, 403,
    'a partial task header must never authorize a professional page');
  assert.equal((await request('/api/overseas/studio/projects', ownContext)).status, 200,
    'the exact task handoff may read its allowlisted professional resource');
  assert.equal((await request('/api/overseas/studio/projects', { ...ownContext, method: 'POST', role: 'social_operator' })).status, 200,
    'a social operator may save a task-bound draft');
  assert.equal((await request('/api/overseas/studio/projects', { ...ownContext, role: 'customer_service' })).status, 403,
    'customer-service-only members must not acquire social production access by forging headers');
  assert.equal((await request('/api/overseas/studio/projects', { taskId: 'task-b', page: 'smartAssets' })).status, 403,
    'a task id owned by another tenant must not authorize the current tenant');
  assert.equal((await request('/api/overseas/studio/projects', { taskId: 'task-a', page: 'enterprise' })).status, 403,
    'a task handoff for another page must not authorize studio routes');
  assert.equal((await request('/api/overseas/studio/projects/task-a', { ...ownContext, method: 'PATCH' })).status, 403,
    'an allowlisted path must still reject a method that was not explicitly granted');
  assert.equal((await request('/api/overseas/studio/seedance-video', { ...ownContext, method: 'POST' })).status, 403,
    'high-cost AI video generation must stay outside the 198 professional bridge');
  assert.equal((await request('/api/overseas/social/accounts/account-a/upload', { taskId: 'task-a', page: 'traffic', method: 'POST' })).status, 403,
    'direct provider publishing must stay outside the package-first 198 flow');
  assert.equal((await request('/api/overseas/studio/script', { ...ownContext, method: 'POST' })).status, 200,
    'standard task-bound content generation may reach its existing handler');
  assert.equal((await request('/api/overseas/videos/video-a/reanalyze', {
    taskId: 'task-a', page: 'socialInspiration', method: 'PATCH',
  })).status, 200, 'the inspiration page may use the real PATCH reanalysis route');
  assert.equal((await request('/api/overseas/videos/analyze-source', {
    taskId: 'task-a', page: 'socialInspiration', method: 'POST', body: { id: 'video-a' },
  })).status, 200, 'record-bound source analysis may run in the inspiration page');
  assert.equal((await request('/api/overseas/videos/analyze-source', {
    taskId: 'task-a', page: 'socialInspiration', method: 'POST', body: { sourceUrl: 'https://example.test/video' },
  })).status, 403, 'source analysis without a tenant-owned record id must fail closed');
  assert.equal((await request('/api/overseas/enterprise/faq/structure', {
    taskId: 'task-a', page: 'enterprise', method: 'POST',
  })).status, 200, 'enterprise knowledge structuring is part of the scoped manual workbench');
  assert.equal((await request('/api/overseas/studio/library/download-file', {
    taskId: 'task-a', page: 'smartAssets', method: 'POST',
  })).status, 200, 'the content workbench may download a tenant-contained rendered file');
  assert.equal((await request('/api/overseas/social/accounts/account-a/videos', {
    taskId: 'task-a', page: 'traffic',
  })).status, 200, 'the data workbench may read connected-account performance records');
  assert.equal((await request('/api/overseas/social-engagement/comments', {
    taskId: 'task-a', page: 'traffic',
  })).status, 200, 'the account data workbench may read tenant-scoped comments');
  assert.equal((await request('/api/overseas/social-engagement/interactions', {
    taskId: 'task-a', page: 'traffic',
  })).status, 200, 'the account data workbench may read tenant-scoped interaction writebacks');
  assert.equal((await request('/api/overseas/social-engagement/creative-learnings', {
    taskId: 'task-a', page: 'traffic',
  })).status, 200, 'the review workbench may read tenant-scoped creative learnings');
  assert.equal((await request('/api/overseas/social-engagement/inquiries/inquiry-a/qualification', {
    taskId: 'task-a', page: 'traffic', method: 'POST', body: { status: 'qualified', authority: 'sales', reason: 'Sales confirmed' },
  })).status, 200, 'the authorized data workbench may submit a sales qualification decision');
  assert.equal((await request('/api/overseas/social-engagement/comments/reply', {
    taskId: 'task-a', page: 'accountManagement', method: 'POST',
  })).status, 403, 'the 198 bridge must not send an external comment reply');
  assert.equal((await request('/api/overseas/studio/script', {
    tenantId: 'tenant-no-generation', taskId: 'task-no-generation', page: 'smartAssets', method: 'POST',
  })).status, 403, 'generation must fail closed when workflow.standard.run is disabled');
  assert.equal((await request('/api/overseas/studio/projects', {
    tenantId: 'tenant-no-production-read', taskId: 'task-no-production-read', page: 'smartAssets',
  })).status, 403, 'professional pages must fail closed when production_site.read is disabled');
  assert.equal((await request('/api/overseas/studio/projects', {
    tenantId: 'legacy-tenant', taskId: 'task-a', page: 'smartAssets',
  })).status, 200, 'non-starter tenants must retain their existing legacy surface');

  const videosSource = fs.readFileSync(new URL('../routes/videos.ts', import.meta.url), 'utf8');
  assert.match(videosSource, /scoped \? \{ id, async \} : \{ id, sourceUrl, title, platform, async \}/,
    'starter record analysis must ignore a client-supplied remote URL');

  console.log('starter social professional access security tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
