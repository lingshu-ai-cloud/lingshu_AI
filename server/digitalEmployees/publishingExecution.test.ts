import assert from 'node:assert/strict';
import { buildPublishingApprovalPackage, invalidatePublishingApprovalForProject } from './publishingExecution.js';
import { store } from '../storage/index.js';

const base = {
  projects: [{ id: 'project-1', title: '成片一', status: 'completed', spec: { caption: '正文', languageRenderOutputs: { en: { status: 'done', path: '/safe/final.mp4' } } } }],
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

console.log('publishing execution tests passed');
