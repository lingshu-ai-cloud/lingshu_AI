import assert from 'node:assert/strict';
import { boundedAuthorizationIssue, buildBoundedPublishingAuthorization, buildPublishingApprovalPackage, createPublishingCalendarEntries, invalidatePublishingApprovalForProject, invalidatePublishingAuthorizationForRun } from './publishingExecution.js';
import { store } from '../storage/index.js';

const base = {
  tenantId: 'tenant-1',
  projects: [{ id: 'project-1', title: '成片一', status: 'ready_for_approval', spec: { caption: '正文', automation: { managedBy: 'digital_employee', stage: 'completed', renderOutputPath: '/safe/final.mp4', quality: { passed: true, ruleVersion: 9 } } } }],
  targets: [{ platform: 'facebook' as const, accountId: 'account-1', accountLabel: '主页一' }],
  goalPlatforms: ['facebook' as const], allowRealPublishing: false,
  now: new Date('2026-09-04T02:00:00.000Z'),
};
const manual = buildPublishingApprovalPackage(base);
assert.equal(manual.items.length, 1);
assert.deepEqual(manual.items[0]?.accountLabels, ['主页一']);
assert.equal(manual.allowRealPublishing, false);
assert.ok(manual.contentHash);
assert.notEqual(buildPublishingApprovalPackage({ ...base, projects: [{ ...base.projects[0], spec: { ...base.projects[0]!.spec, caption: '已修改' } }] }).contentHash, manual.contentHash);
assert.notEqual(buildPublishingApprovalPackage({ ...base, allowRealPublishing: true }).contentHash, manual.contentHash);

const boundedInput = {
  packageRevision: 3,
  authorizedBy: 'owner-1',
  authorizedAt: '2026-09-06T01:00:00.000Z',
  startsAt: '2026-09-04',
  endsAt: '2026-09-12',
  accountBindings: [{ accountId: 'account-1', platform: 'facebook' as const }],
  maxPublishItems: 1,
  businessBoundary: { products: 'A', markets: 'US', audience: 'brand buyers', languages: ['en'], platforms: ['facebook' as const], productionBudget: 100, paidMediaBudget: 0 },
};
const bounded = buildPublishingApprovalPackage({ ...base, allowRealPublishing: true, boundedAuthorization: boundedInput });
assert.ok(bounded.authorizationSnapshot, 'bounded weekly approval must freeze its authorization snapshot');
assert.equal(boundedAuthorizationIssue(bounded.authorizationSnapshot, { accountId: 'account-1', platform: 'facebook', scheduledAt: bounded.items[0]!.scheduledAt }), '');
assert.equal(boundedAuthorizationIssue(bounded.authorizationSnapshot, { accountId: 'outside', platform: 'facebook', scheduledAt: bounded.items[0]!.scheduledAt }), 'bounded_authorization_account_mismatch');
assert.equal(boundedAuthorizationIssue({ ...bounded.authorizationSnapshot!, schemaVersion: 2 as 1 }, { accountId: 'account-1', platform: 'facebook', scheduledAt: bounded.items[0]!.scheduledAt }), 'bounded_authorization_version_unsupported');
assert.equal(boundedAuthorizationIssue({ ...bounded.authorizationSnapshot!, businessBoundary: null } as any, { accountId: 'account-1', platform: 'facebook', scheduledAt: bounded.items[0]!.scheduledAt }), 'bounded_authorization_malformed');
assert.equal(boundedAuthorizationIssue({ ...bounded.authorizationSnapshot!, accountBindings: 'account-1' } as any, { accountId: 'account-1', platform: 'facebook', scheduledAt: bounded.items[0]!.scheduledAt }), 'bounded_authorization_malformed');
assert.throws(() => buildPublishingApprovalPackage({ ...base, allowRealPublishing: true, boundedAuthorization: { ...boundedInput, accountBindings: [] } }), /bounded_authorization_account_mismatch/);
assert.throws(() => buildPublishingApprovalPackage({
  ...base,
  targets: [...base.targets, { ...base.targets[0], accountId: 'account-2', accountLabel: '主页二' }],
  allowRealPublishing: true,
  boundedAuthorization: { ...boundedInput, accountBindings: [...boundedInput.accountBindings, { accountId: 'account-2', platform: 'facebook' as const }] },
}), /bounded_authorization_item_limit_exceeded/, 'the limit counts actual account publish actions, including grouped legacy rows');
const tampered = { ...bounded.authorizationSnapshot!, maxPublishItems: 2 };
assert.equal(boundedAuthorizationIssue(tampered, { accountId: 'account-1', platform: 'facebook', scheduledAt: bounded.items[0]!.scheduledAt }), 'bounded_authorization_tampered');
assert.notEqual(buildBoundedPublishingAuthorization({ ...boundedInput, businessBoundary: { ...boundedInput.businessBoundary, markets: 'EU' } }).snapshotHash, bounded.authorizationSnapshot!.snapshotHash, 'market changes must invalidate the frozen authorization');

const versioned = buildPublishingApprovalPackage({ ...base, projects: [{ ...base.projects[0], spec: {
  automation: { managedBy: 'digital_employee', stage: 'completed', renderOutputPath: '/current-v3.mp4', quality: { passed: true, ruleVersion: 9 } },
  languageRenderOutputs: { en: { status: 'done', path: '/old-v2.mp4' } },
  languageRenderVersions: { en: [{ status: 'done', path: '/old-v1.mp4' }] },
  renderOutputPath: '/legacy.mp4',
} }] });
assert.deepEqual(versioned.items.map(item => item.videoPath), ['/current-v3.mp4']);
const historicalOnly = buildPublishingApprovalPackage({ ...base, projects: [{ ...base.projects[0], spec: {
  automation: { managedBy: 'digital_employee', stage: 'completed', quality: { passed: true, ruleVersion: 9 } },
  languageRenderVersions: { en: [{ status: 'done', path: '/old.mp4' }] },
} }] });
assert.equal(historicalOnly.items.length, 0, 'history alone is not a publishable current deliverable');
const rerendering = buildPublishingApprovalPackage({ ...base, projects: [{ ...base.projects[0], spec: {
  automation: { managedBy: 'digital_employee', stage: 'rendering', quality: { passed: true, ruleVersion: 9 } },
  languageRenderOutputs: { en: { status: 'rendering', path: '/old.mp4' } },
  renderOutputPath: '/legacy.mp4',
} }] });
assert.equal(rerendering.items.length, 0, 'an active render must not fall back to an old legacy output');

const run = { id: 'run-1', tenant_id: 'tenant-1', status: 'cancelled' };
const task = { id: 'task-1', tenant_id: run.tenant_id, run_id: run.id, status: 'cancelled', task_version: 1 };
const approval = { id: 'approval-1', tenant_id: run.tenant_id, run_id: run.id, task_id: task.id, status: 'approved' };
const post = { id: 'post-1', tenant_id: run.tenant_id, stats: { sourceProjectId: 'project-1', approvalId: approval.id, status: 'scheduled', realPublishingAuthorized: true } };
const original = { list: store.list, getById: store.getById, update: store.update };
const records: Record<string, Record<string, any>> = { workflow_runs: run, workflow_tasks: task, approval_requests: approval, posts: post };
store.getById = (async (collection: string, id: string) => records[collection]?.id === id ? records[collection] : null) as typeof store.getById;
store.list = (async () => ({ items: [post], totalItems: 1, totalPages: 1, page: 1, perPage: 500 })) as typeof store.list;
store.update = (async (collection: string, id: string, patch: Record<string, unknown>) => {
  if (records[collection]?.id !== id) return false;
  Object.assign(records[collection], patch);
  return true;
}) as typeof store.update;
try {
  for (const status of ['cancelled', 'paused', 'waiting_human', 'failed', 'succeeded', 'running']) {
    run.status = status;
    task.status = status === 'waiting_human' ? 'handed_off' : status === 'cancelled' ? 'cancelled' : 'succeeded';
    approval.status = 'approved';
    post.stats.status = 'scheduled';
    post.stats.realPublishingAuthorized = true;
    assert.equal(await invalidatePublishingApprovalForProject(run.tenant_id, 'project-1'), 1);
    assert.equal(run.status, status === 'running' ? 'waiting_external' : status, 'source edits must not revive a stopped run');
    assert.equal(approval.status, 'superseded');
    assert.equal(post.stats.realPublishingAuthorized, false);
    if (status === 'cancelled') assert.equal(task.status, 'cancelled');
    if (status === 'waiting_human') assert.equal(task.status, 'handed_off');
  }
} finally {
  store.list = original.list;
  store.getById = original.getById;
  store.update = original.update;
}

const pagedPosts = Array.from({ length: 501 }, (_, index) => ({
  id: `old-${index}`, tenant_id: 'tenant-1', stats: { status: 'published' },
}));
const frozen = buildPublishingApprovalPackage(base);
const approved = { id: 'already-materialized', tenant_id: 'tenant-1', platform: 'facebook', stats: {
  status: 'scheduled', workflowRunId: 'run-1', sourceProjectId: 'project-1',
  approvedContentHash: frozen.contentHash, videoPath: '/safe/final.mp4', approvalId: 'approval-1',
  publishSourceClaim: frozen.items[0]?.sourceClaim,
} };
const calendarRows: any[] = [...pagedPosts, approved];
store.list = (async (_collection: string, query: { page?: number; perPage?: number } = {}) => {
  const page = query.page || 1, perPage = query.perPage || 500;
  return { items: calendarRows.slice((page - 1) * perPage, page * perPage), totalItems: calendarRows.length, totalPages: Math.ceil(calendarRows.length / perPage), page, perPage };
}) as typeof store.list;
store.update = (async (_collection: string, id: string, patch: Record<string, unknown>) => {
  const row = calendarRows.find(item => item.id === id);
  if (!row) return false;
  Object.assign(row, patch); return true;
}) as typeof store.update;
store.getById = (async () => null) as typeof store.getById;
const originalCreate = store.create;
store.create = (async () => { throw Error('idempotent retry must not create another draft'); }) as typeof store.create;
try {
  const entries = await createPublishingCalendarEntries({ tenantId: 'tenant-1', runId: 'run-1', approvalTaskId: 'task-1', approvalId: 'approval-1', approvedContentHash: frozen.contentHash, package: frozen }, { verifySource: async (_tenantId, claim) => claim });
  assert.deepEqual(entries, [{ id: approved.id, status: 'scheduled' }]);
  assert.equal(await invalidatePublishingApprovalForProject('tenant-1', 'project-1'), 1);
  assert.equal(approved.stats.status, 'awaiting_reapproval', 'source invalidation must also reach later pages');
} finally {
  Object.assign(store, original);
  store.create = originalCreate;
}

const queued = { id: 'queued', tenant_id: 'tenant-1', stats: { workflowRunId: 'run-2', status: 'scheduled', realPublishingAuthorized: true, publishResults: {} } };
const accepted = { id: 'accepted', tenant_id: 'tenant-1', stats: { workflowRunId: 'run-2', status: 'provider_processing', realPublishingAuthorized: true, publishResults: { account: { status: 'provider_accepted' } } } };
const otherRun = { id: 'other', tenant_id: 'tenant-1', stats: { workflowRunId: 'run-other', status: 'scheduled', realPublishingAuthorized: true, publishResults: {} } };
const revocationRows: any[] = [queued, accepted, otherRun];
store.list = (async () => ({ items: revocationRows, totalItems: revocationRows.length, totalPages: 1, page: 1, perPage: 500 })) as typeof store.list;
store.update = (async (_collection: string, id: string, patch: Record<string, unknown>) => {
  const row = revocationRows.find(item => item.id === id);
  if (!row) return false;
  Object.assign(row, patch); return true;
}) as typeof store.update;
try {
  assert.equal(await invalidatePublishingAuthorizationForRun('tenant-1', 'run-2'), 1);
  assert.equal(queued.stats.status, 'awaiting_reapproval', 'queued work must stop when the weekly package changes');
  assert.equal(queued.stats.realPublishingAuthorized, false);
  assert.equal(accepted.stats.status, 'provider_processing', 'accepted provider work must remain recoverable without resending');
  assert.equal(otherRun.stats.status, 'scheduled', 'another run must remain untouched');
} finally {
  Object.assign(store, original);
}

console.log('publishing execution tests passed');
