import { createSocialContentAccessResolver } from '../starter198/socialContentAccess';
import { Starter198RepositoryError } from '../starter198/repository';
import assert from 'node:assert/strict';
import { assertManagedSocialPublication, withManagedSocialPublication } from './managedSocialEffect';
const post = { id: 'post', tenant_id: 'tenant', platform: 'facebook', title: 'Title', published_at: '2026-09-27T00:00:00Z', stats: { managedPublishingGrantId: 'grant', workflowRunId: 'run', approvalId: 'approval', approvedContentHash: 'hash', videoPath: '/controlled/video.mp4', description: '', publishSourceClaim: { sourceKind: 'social_content_artifact', projectId: 'task', artifactId: 'artifact' } } };
let bound = true, access = true, sourceValid = true, transitioned = false, fenced = false, effects = 0;
const dependencies: any = {
  repository: { access: async () => { if (!access) throw new Error('access_unavailable'); throw new Starter198RepositoryError('starter_198_not_provisioned'); } },
  accessResolver: createSocialContentAccessResolver({ loadSubscription: async () => ({ status: 'active', plan: 'customer', expiresAt: null }) }),
  assertGrant: async (_post: unknown, account: string) => { assert.equal(account, 'account'); },
  data: { getById: async (collection: string) => collection === 'posts' ? post : ({ tenant_id: 'tenant', run_id: 'run', status: 'approved', content_hash: 'hash', evidence: [{ type: 'publishing_approval_package', contentHash: 'hash', items: [{ sourceProjectId: 'task', platform: 'facebook', accountIds: ['account'], scheduledAt: post.published_at, title: post.title, description: '', videoPath: post.stats.videoPath, sourceClaim: post.stats.publishSourceClaim }] }] }) },
  resolveScope: async () => ({ run: { id: 'run' }, grant: { grantId: 'grant' }, accountId: 'account', target: { platform: 'facebook' }, bindings: bound ? [{ payload: { artifactId: 'artifact', businessRunId: 'run', grantId: 'grant', accountId: 'account' } }] : [] }),
  verifySource: async () => { if (!sourceValid) throw new Error('source_changed'); },
  transition: async (_tenant: string, action: any) => { transitioned = true; return action({ beforeEffect: async () => { fenced = true; } }); },
};
const effect = async () => { assert.equal(transitioned && fenced, true); effects++; return 'receipt'; };
assert.equal(await withManagedSocialPublication(post, 'account', effect, dependencies), 'receipt');
bound = false;
await assert.rejects(() => withManagedSocialPublication(post, 'account', effect, dependencies), /持久授权/);
bound = true; access = false;
await assert.rejects(() => withManagedSocialPublication(post, 'account', effect, dependencies), /access_unavailable/);
access = true; sourceValid = false;
await assert.rejects(() => withManagedSocialPublication(post, 'account', effect, dependencies), /source_changed/);
await assert.rejects(() => assertManagedSocialPublication({ ...post, stats: { ...post.stats, managedPublishingGrantId: '' } }, 'account', dependencies), /持久授权/);
assert.equal(effects, 1, 'forged hints, missing binding and changed media never reach provider');
console.log('managed social effect authority tests passed');

sourceValid = true;
dependencies.accessResolver = createSocialContentAccessResolver({ loadSubscription: async () => ({ status: 'expired', plan: 'customer', expiresAt: '2020-01-01' }) });
await assert.rejects(() => withManagedSocialPublication(post, 'account', effect, dependencies), /not_entitled/);
let subscriptionReads = 0;
dependencies.accessResolver = createSocialContentAccessResolver({ loadSubscription: async () => { subscriptionReads++; return { status: 'active', plan: 'customer', expiresAt: null }; } });
dependencies.repository.access = async () => ({ recordId: 'access', tenantId: 'tenant', productProfile: 'starter_198', profileVersion: 'starter_198.v1', entitlementSnapshotId: 'snapshot', entitlements: [{ capability: 'publishing.official_api', enabled: true }], resourceLimits: {}, status: 'active', cycleStartedAt: '2020-01-01T00:00:00Z', cycleEndsAt: '2099-01-01T00:00:00Z', updatedAt: '' });
await assert.rejects(() => withManagedSocialPublication(post, 'account', effect, dependencies), /not_entitled/);
assert.equal(subscriptionReads, 0, 'a starter manifest prohibition cannot fall through to subscription');
assert.equal(effects, 1);
console.log('managed social effect subscription and manifest boundaries passed');
