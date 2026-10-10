import { socialContentAccessResolver, type SocialContentAccessResolver } from '../starter198/socialContentAccess.js';
import { starter198Repository, type Starter198Repository } from '../starter198/repository.js';
import { withStarter198TenantTransitionLock } from '../starter198/legacyEffectGuard.js';
import { resolveSocialPublishingScope } from '../starter198/socialContentManagedPublishing.js';
import { assertManagedPublishingAuthorization, ManagedPublishingAuthorizationError } from './managedPublishingAuthorization.js';
import { verifyFrozenPublishSourceClaim } from './publishSourceClaim.js';
import type { PostRecord } from './waLink.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';

const object = (value: unknown): Record<string, any> => {
  if (typeof value === 'string') { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
};

/** A routing hint only. Every invocation still verifies stored provenance. */
export function isManagedSocialPublication(post: Pick<PostRecord, 'stats'>): boolean {
  const stats = object(post.stats);
  return object(stats.publishSourceClaim).sourceKind === 'social_content_artifact' && !!stats.managedPublishingGrantId;
}

interface ManagedSocialEffectPorts {
  repository: Starter198Repository;
  accessResolver: SocialContentAccessResolver;
  data: DataStore;
  assertGrant: typeof assertManagedPublishingAuthorization;
  verifySource: typeof verifyFrozenPublishSourceClaim;
  resolveScope: typeof resolveSocialPublishingScope;
  transition: typeof withStarter198TenantTransitionLock;
}
const ports: ManagedSocialEffectPorts = { repository: starter198Repository, accessResolver: socialContentAccessResolver, data: store,
  assertGrant: assertManagedPublishingAuthorization, verifySource: verifyFrozenPublishSourceClaim,
  resolveScope: resolveSocialPublishingScope, transition: withStarter198TenantTransitionLock };

export async function assertManagedSocialPublication(
  post: Pick<PostRecord, 'id' | 'tenant_id' | 'stats'>,
  accountId: string,
  dependencies: ManagedSocialEffectPorts = ports,
): Promise<void> {
  const fail = () => { throw new ManagedPublishingAuthorizationError('社媒发布任务缺少匹配的持久授权与成片来源'); };
  if (!isManagedSocialPublication(post)) return fail();
  // Provisioned tenants retain their manifest. Only an explicitly unprovisioned
  // tenant may use a valid subscription; unavailable/malformed access fails closed.
  await dependencies.accessResolver.resolve({ repository: dependencies.repository, tenantId: post.tenant_id,
    requiredCapabilities: ['publishing.official_api'], requireOpenCycle: true });
  await dependencies.assertGrant(post, accountId);
  const stats = object(post.stats), source = object(stats.publishSourceClaim);
  const scope = await dependencies.resolveScope(dependencies.data, post.tenant_id, String(source.projectId || ''), new Date());
  if (scope.run.id !== stats.workflowRunId || scope.grant.grantId !== stats.managedPublishingGrantId || scope.accountId !== accountId) return fail();
  const binding = scope.bindings.map(row => object(row.payload)).find(item => item.artifactId === source.artifactId
    && item.businessRunId === stats.workflowRunId && item.grantId === stats.managedPublishingGrantId && item.accountId === accountId);
  if (!binding) return fail();
  const approval = await dependencies.data.getById<any>('approval_requests', String(stats.approvalId || ''));
  if (!approval || approval.tenant_id !== post.tenant_id || approval.run_id !== stats.workflowRunId
    || approval.status !== 'approved' || approval.content_hash !== stats.approvedContentHash) return fail();
  const storedPost = await dependencies.data.getById<any>('posts', post.id);
  const evidence = typeof approval.evidence === 'string' ? (() => { try { return JSON.parse(approval.evidence); } catch { return []; } })() : approval.evidence;
  const packageEvidence = Array.isArray(evidence) ? evidence.find(item => object(item).type === 'publishing_approval_package') : null;
  const frozen = object(packageEvidence);
  const matchingItem = Array.isArray(frozen.items) && frozen.items.find((item: any) => item.sourceProjectId === source.projectId
    && item.platform === scope.target.platform && item.platform === storedPost?.platform
    && Array.isArray(item.accountIds) && item.accountIds.length === 1 && item.accountIds[0] === accountId
    && item.scheduledAt === storedPost?.published_at && item.title === storedPost?.title
    && item.description === object(storedPost?.stats).description
    && item.videoPath === stats.videoPath && object(item.sourceClaim).sourceFingerprint === source.sourceFingerprint);
  if (!storedPost || storedPost.tenant_id !== post.tenant_id || frozen.contentHash !== stats.approvedContentHash || !matchingItem) return fail();
  await dependencies.verifySource(post.tenant_id, source, stats.videoPath);
}

/** Profile transition, current consent and immutable media are fenced around the actual effect. */
export function withManagedSocialPublication<T>(
  post: Pick<PostRecord, 'id' | 'tenant_id' | 'stats'>,
  accountId: string,
  effect: () => Promise<T>,
  dependencies: ManagedSocialEffectPorts = ports,
): Promise<T> {
  return dependencies.transition(post.tenant_id, async guard => {
    await assertManagedSocialPublication(post, accountId, dependencies);
    await guard.beforeEffect();
    return effect();
  }, dependencies.data);
}
