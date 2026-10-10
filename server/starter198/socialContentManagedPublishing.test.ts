import assert from 'node:assert/strict';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { resolveSocialPublishingScope, SocialManagedPublishingBlocked } from './socialContentManagedPublishing.js';

const now = new Date('2026-09-27T04:00:00Z');
const records: Record<string, Record_[]> = {
  starter_social_content_tasks: [{ id: 'row-task', tenant_id: 'tenant-a', task_id: 'task-1', brief: {
    managementMode: 'one_click_managed', programRef: { id: 'program-1' }, targetAccountRef: { id: 'account-strategy-1' },
  } }],
  social_owned_accounts: [{ id: 'strategy', tenant_id: 'tenant-a', program_id: 'program-1', account_id: 'account-strategy-1', payload: { status: 'active', connectionId: 'connection-1', platform: 'facebook' } }],
  digital_employee_configs: [{ id: 'config', tenant_id: 'tenant-a', config: {
    autonomyMode: 'automatic', allowRealPublishing: true, enabledWorkflows: ['content_publish'],
    publishingTargets: [{ platform: 'facebook', accountId: 'connection-1', accountLabel: 'Page' }],
    managedPublishingGrant: { enabled: true, grantId: 'grant-1', authorizedBy: 'owner', accountIds: ['connection-1'], maxPublishItems: 3, validUntil: '2026-10-01' },
  } }],
  workflow_runs: [{ id: 'business-run', tenant_id: 'tenant-a', status: 'running', plan_id: 'plan', goal_id: 'goal' }],
  weekly_plans: [{ id: 'plan', tenant_id: 'tenant-a', plan: { managedPublishingGrantId: 'grant-1', businessPackage: { authorization: { mode: 'bounded', accountIds: ['connection-1'], maxPublishItems: 3 } } } }],
  weekly_goals: [{ id: 'goal', tenant_id: 'tenant-a', starts_at: '2026-09-27', ends_at: '2026-09-30', scope: { programId: 'program-1' } }],
  run_events: [],
};
const data = {
  list: async (collection: string, query: any) => {
    const items = (records[collection] || []).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
    return { items, page: 1, perPage: 100, totalPages: 1, totalItems: items.length };
  },
  getById: async (collection: string, id: string) => (records[collection] || []).find(row => row.id === id) || null,
} as unknown as DataStore;
const resolve = () => resolveSocialPublishingScope(data, 'tenant-a', 'task-1', now);
assert.equal((await resolve()).run.id, 'business-run');
assert.equal((await resolve()).accountId, 'connection-1');
await assert.rejects(() => resolveSocialPublishingScope(data, 'tenant-b', 'task-1', now), SocialManagedPublishingBlocked);
const brief = records.starter_social_content_tasks[0].brief as any;
const target = brief.targetAccountRef;
delete brief.targetAccountRef;
await assert.rejects(resolve, /未绑定明确/);
brief.targetAccountRef = target;
const config = records.digital_employee_configs[0].config as any;
config.managedPublishingGrant.enabled = false;
await assert.rejects(resolve, /授权未覆盖/);
config.managedPublishingGrant.enabled = true;
records.workflow_runs.push({ ...records.workflow_runs[0], id: 'another-run' });
await assert.rejects(resolve, /多个可用经营周期/);
records.workflow_runs.pop();
records.run_events.push({ id: 'binding', tenant_id: 'tenant-a', type: 'social_content.publishing_bound', payload: {
  socialTaskId: 'task-1', grantId: 'grant-old', accountId: 'connection-1', programId: 'program-1', businessRunId: 'business-run',
} });
await assert.rejects(resolve, /原任务发布绑定已变化/);
records.run_events = [];
records.weekly_plans[0].tenant_id = 'tenant-b';
await assert.rejects(resolve, /没有与此账号授权匹配/);
console.log('social content managed publishing scope tests passed');

// Exercise the persistent binding → grant decision → existing calendar adapter path.
const { scheduleManagedSocialArtifact } = await import('./socialContentManagedPublishing');
records.weekly_plans[0].tenant_id = 'tenant-a';
records.workflow_tasks = [{ id: 'approval-task', tenant_id: 'tenant-a', run_id: 'business-run', task_key: 'content_release_approval', status: 'pending' }];
records.posts = [];
records.approval_requests = [];
let created = 0;
Object.assign(data, {
  create: async (collection: string, value: Record<string, unknown>) => {
    const row = { id: `row-${++created}`, ...value } as Record_;
    (records[collection] ||= []).push(row); return row;
  },
  update: async (collection: string, id: string, value: Record<string, unknown>) => {
    const row = records[collection]?.find(row => row.id === id);
    if (!row) return false;
    Object.assign(row, value); return true;
  },
  delete: async (collection: string, id: string) => {
    records[collection] = (records[collection] || []).filter(row => row.id !== id); return true;
  },
});
let calendarCalls = 0;
const ports = {
  resolveAccess: async () => ({ kind: 'subscription' as const, subscription: { status: 'active' as const, plan: 'customer' as const, expiresAt: null } }),
  connectedAccounts: async () => [{ accountId: 'connection-1', platform: 'facebook' as const, accountLabel: 'Page', status: 'connected' as const }],
  buildPackage: async (input: any) => ({ schemaVersion: 1 as const, contentHash: 'frozen-content-hash', allowRealPublishing: true, items: input.items }),
  createEntries: async (input: any) => {
    calendarCalls++;
    assert.equal(input.managedPublishingGrantId, 'grant-1');
    assert.equal(input.runId, 'business-run');
    assert.equal(records.approval_requests.length, 1, 'authorization decision is durable before calendar mutation');
    assert.equal(records.run_events.length, 1, 'binding and quota reservation persist before calendar mutation');
    if (!records.posts.length) records.posts.push({ id: 'post-1', tenant_id: 'tenant-a', stats: { workflowRunId: input.runId, sourceProjectId: 'task-1', publishSourceClaim: { artifactId: 'artifact-1' } } });
    return [{ id: 'post-1', status: 'scheduled' }];
  },
};
const input = { repository: { dataStore: data } as any, tenantId: 'tenant-a', taskId: 'task-1', artifactId: 'artifact-1', now };
assert.deepEqual(await scheduleManagedSocialArtifact(input, ports), { status: 'scheduled', postIds: ['post-1'] });
assert.deepEqual(await scheduleManagedSocialArtifact(input, ports), { status: 'scheduled', postIds: ['post-1'] });
assert.equal(records.approval_requests.length, 1, 'retry reuses the original authorization decision');
assert.equal(records.run_events.length, 1, 'retry preserves a single binding');
assert.equal(calendarCalls, 2, 'calendar adapter owns idempotent post creation');
const changedVersion = await scheduleManagedSocialArtifact({ ...input, artifactId: 'artifact-2' }, ports);
assert.equal(changedVersion.status, 'blocked', 'an already scheduled artifact cannot be silently replaced');
config.managedPublishingGrant.enabled = false;
assert.equal((await scheduleManagedSocialArtifact(input, ports)).status, 'blocked');
assert.equal(calendarCalls, 2, 'revocation stops scheduling before reaching the calendar');
console.log('social managed publishing bridge and replay tests passed');

const { reconcileManagedSocialPublications } = await import('./socialContentManagedPublishing');
const published = records.posts[0];
published.platform = 'facebook';
published.stats = { workflowRunId: 'business-run', managedPublishingGrantId: 'grant-1', targetAccountIds: ['connection-1'], targetAccountLabels: ['Page'],
  publishSourceClaim: { sourceKind: 'social_content_artifact', projectId: 'task-1', artifactId: 'artifact-1' },
  publishResults: { 'connection-1': { status: 'published', platformPostId: 'remote-real-id', publishedAt: now.toISOString(), platformUrl: 'https://example.com/post' } } };
const task: any = { version: '1', deliveryPackages: [{ packageId: 'package-1', artifactIds: ['artifact-1'] }], publications: [] };
let registrations = 0;
const receiptPorts: any = {
  readTask: async () => task,
  register: async (input: any) => { registrations++; task.publications.push(input.value); task.version = String(Number(task.version) + 1); },
};
const receiptInput = { repository: { dataStore: data } as any, tenantId: 'tenant-a', taskId: 'task-1', artifactId: 'artifact-1', postIds: ['post-1'] };
assert.deepEqual(await reconcileManagedSocialPublications(receiptInput, receiptPorts), { registered: 1, pending: 0 });
assert.deepEqual(await reconcileManagedSocialPublications(receiptInput, receiptPorts), { registered: 0, pending: 0 });
assert.equal(registrations, 1, 'published receipts are idempotent even after grant revocation');
(published.stats as any).publishResults['connection-1'].status = 'unknown';
assert.equal((await reconcileManagedSocialPublications(receiptInput, receiptPorts)).pending, 1);
assert.equal(registrations, 1, 'unknown never becomes published');
published.tenant_id = 'tenant-b';
assert.equal((await reconcileManagedSocialPublications(receiptInput, receiptPorts)).pending, 1);
assert.equal(registrations, 1, 'cross-tenant post cannot supply a receipt');
console.log('social managed publication receipt reconciliation tests passed');
config.managedPublishingGrant.enabled = true;
published.tenant_id = 'tenant-a';
(records.weekly_plans[0].plan as any).businessPackage.authorization.maxPublishItems = 1;
records.posts.push({ id: 'another-post', tenant_id: 'tenant-a', stats: { workflowRunId: 'business-run' } });
assert.equal((await scheduleManagedSocialArtifact(input, ports)).status, 'blocked', 'existing reservation cannot bypass a reduced live cycle quota');
assert.equal(calendarCalls, 2);
records.starter_social_content_tasks[0].status = 'paused';
await assert.rejects(resolve, /已暂停/);
