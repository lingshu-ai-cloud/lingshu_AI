import assert from 'node:assert/strict';
import { assertManagedPublishingAuthorization, ManagedPublishingAuthorizationError } from './managedPublishingAuthorization.js';
import type { DataStore } from '../storage/datastore.js';
import type { PostRecord } from './waLink.js';

const stats = { managedPublishingGrantId: 'grant-a', workflowRunId: 'run-a', realPublishingAuthorized: true, targetAccountIds: ['account-a'] };
const post = { id: 'post-a', tenant_id: 'tenant-a', platform: 'youtube', track_code: 'test', stats } satisfies PostRecord;
const grant = { enabled: true, grantId: 'grant-a', authorizedBy: 'user-a', authorizedAt: '2026-09-26T00:00:00Z', accountIds: ['account-a'], maxPublishItems: 3, validUntil: '2026-09-27' };
const config = { autonomyMode: 'automatic', allowRealPublishing: true, enabledWorkflows: ['content_publish'], publishingTargets: [{ accountId: 'account-a', platform: 'youtube', displayName: 'A' }], managedPublishingGrant: grant };
let savedConfig: unknown = config;
let planGrant = 'grant-a';
let planTenant = 'tenant-a';
let runStatus = 'running';
let endsAt = '2026-09-27';
let count = 1;
let now = new Date('2026-09-27T15:59:00Z');
let reads = 0;
const port = {
  async getById(collection: string) {
    reads++;
    if (collection === 'posts') return post;
    if (collection === 'workflow_runs') return { tenant_id: 'tenant-a', plan_id: 'plan-a', goal_id: 'goal-a', status: runStatus };
    if (collection === 'weekly_plans') return { tenant_id: planTenant, plan: { managedPublishingGrantId: planGrant, businessPackage: { authorization: { mode: 'bounded', accountIds: ['account-a'], maxPublishItems: 3 } } } };
    if (collection === 'weekly_goals') return { tenant_id: 'tenant-a', starts_at: '2026-09-20', ends_at: endsAt };
    return null;
  },
  async list(collection: string) { reads++; if (collection === 'posts') return { items: Array.from({ length: count }, () => post), totalItems: count, totalPages: 1, page: 1, perPage: 100 }; return { items: [{ tenant_id: 'tenant-a', config: savedConfig }], totalItems: 1, totalPages: 1, page: 1, perPage: 1 }; },
} as Pick<DataStore, 'getById' | 'list'>;
const check = () => assertManagedPublishingAuthorization(post, 'account-a', { store: port, now: () => now });
await check();
assert.ok(reads > 0);
savedConfig = { ...config, managedPublishingGrant: undefined };
await assert.rejects(check, ManagedPublishingAuthorizationError);
savedConfig = { ...config, managedPublishingGrant: { ...grant, grantId: 'new-grant' } };
await assert.rejects(check, ManagedPublishingAuthorizationError);
savedConfig = { ...config, managedPublishingGrant: { ...grant, accountIds: ['other'] } };
await assert.rejects(check, ManagedPublishingAuthorizationError);
savedConfig = config;
now = new Date('2026-09-27T16:00:00Z'); // Beijing midnight: expired even though still September 27 UTC.
await assert.rejects(check, ManagedPublishingAuthorizationError);
now = new Date('2026-09-27T10:00:00Z');
planGrant = 'old-grant';
await assert.rejects(check, ManagedPublishingAuthorizationError);
planGrant = 'grant-a'; planTenant = 'other-tenant';
await assert.rejects(check, ManagedPublishingAuthorizationError);
planTenant = 'tenant-a';
await check();
runStatus = 'paused';
await assert.rejects(check, /暂停或结束/);
runStatus = 'running';
endsAt = '2026-09-26';
await assert.rejects(check, /授权经营周期/);
endsAt = '2026-09-27'; count = 4;
await assert.rejects(check, /超过授权上限/);
count = 1;
reads = 0;
await assertManagedPublishingAuthorization({ ...post, stats: {} }, 'account-a', { store: port, now: () => now });
assert.equal(reads, 0, 'legacy individually approved posts keep their existing authorization path');
console.log('managed publishing authorization tests passed');
