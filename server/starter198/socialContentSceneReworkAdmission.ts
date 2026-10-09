import { randomUUID } from 'node:crypto';
import type { Record_ } from '../storage/datastore.js';
import type { Starter198Repository } from './repository.js';
import { organizationRoleOrNull } from '../lib/organizationRole.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { socialContentAccessResolver } from './socialContentAccess.js';
import { assertOrchestratorAdmissionQuota } from './quota.js';
import { socialJson, socialObject, socialRequestHash } from './socialContentValidation.js';
import { createSocialSceneReworkIntent } from './socialContentSceneRework.js';
import { createSocialSceneReworkService } from './socialContentSceneReworkService.js';

function fail(code: string): never { throw new Error(code); }

/** Admits an independent repair run without reviving or changing the source run.
 * No supplier is invoked here; the durable worker separately checks actual cost reservations.
 */
export async function admitSocialSceneRework(input: {
  repository: Starter198Repository;
  tenantId: string;
  actorUserId: string;
  taskId: string;
  sourceRunId: string;
  parentArtifactId: string;
  affectedSceneIds: string[];
  expectedCacheHash?: string;
}) {
  const { repository } = input;
  const store = repository.dataStore;
  if (!store) return fail('scene_rework_persistent_store_required');
  for (const value of [input.tenantId, input.actorUserId, input.taskId, input.sourceRunId, input.parentArtifactId]) {
    if (!/^[a-zA-Z0-9._:@-]{1,200}$/.test(value)) return fail('scene_rework_identity_invalid');
  }
  const user = await store.getById<Record_>('users', input.actorUserId);
  const role = organizationRoleOrNull(user?.role);
  if (!user || user.tenantId !== input.tenantId || !role || role === 'customer_service'
    || user.disabled === true || user.active === false || ['disabled', 'suspended'].includes(String(user.status))) {
    return fail('scene_rework_actor_forbidden');
  }
  const access = await socialContentAccessResolver.resolve({ repository, tenantId: input.tenantId,
    requiredCapabilities: ['workflow.standard.run'], requireOpenCycle: true });
  // Subscription authority needs its own actual resource-limit binding before admission.
  if (access.kind !== 'starter_198') return fail('scene_rework_resource_limits_unavailable');
  const lease = await acquireDurableOperationLease({ dataStore: store, tenantId: input.tenantId,
    scope: 'social_scene_rework_admission', subjectId: input.tenantId, ownerId: randomUUID() });
  if (!lease) return fail('scene_rework_admission_busy');
  try {
    const service = createSocialSceneReworkService(repository);
    const scope = { tenantId: input.tenantId, taskId: input.taskId, runId: input.sourceRunId,
      parentArtifactId: input.parentArtifactId };
    const context = await service.readCache(scope);
    if (input.expectedCacheHash !== undefined && input.expectedCacheHash !== context.cache.recordHash) {
      return fail('scene_rework_cache_version_conflict');
    }
    const source = await store.getById<Record_>('workflow_runs', input.sourceRunId);
    if (!source || source.tenant_id !== input.tenantId || !['succeeded', 'completed', 'failed'].includes(String(source.status))) {
      return fail('scene_rework_source_run_not_terminal');
    }
    const preview = createSocialSceneReworkIntent(context.cache, input.actorUserId, input.affectedSceneIds, 'pending-admission');
    if (context.cache.scenes.some(scene => !preview.affectedSceneIds.includes(scene.sceneId) && scene.status !== 'passed')) {
      return fail('scene_rework_unselected_review_required');
    }
    const executionRunId = socialRequestHash({ type: 'social_scene_rework_run', tenantId: input.tenantId,
      sourceRunId: input.sourceRunId, operationId: preview.operationId }).slice(0, 15);
    let run = await store.getById<Record_>('workflow_runs', executionRunId);
    if (!run) {
      await assertOrchestratorAdmissionQuota({ repository, tenantId: input.tenantId, limits: access.access.resourceLimits });
      const payload = { type: 'social_scene_rework_authorization', version: 1, tenantId: input.tenantId,
        taskId: input.taskId, sourceRunId: input.sourceRunId, executionRunId,
        parentArtifactId: input.parentArtifactId, parentArtifactHash: preview.parentArtifactHash,
        actorUserId: input.actorUserId, operationId: preview.operationId, cacheHash: preview.cacheHash,
        planHash: preview.planHash, changeKind: 'visual_asset', authorizedAt: new Date().toISOString() };
      await assertDurableOperationLease({ dataStore: store, lease });
      run = await store.create<Record_>('workflow_runs', { id: executionRunId, tenant_id: input.tenantId,
        goal_id: source.goal_id, plan_id: source.plan_id, status: 'running', current_controller: 'agent',
        product_profile: source.product_profile,
        starter_context: { sceneReworkAuthorization: { ...payload, recordHash: socialRequestHash(payload) } },
        started_at: payload.authorizedAt, completed_at: '' });
      if (!run) return fail('scene_rework_run_save_failed');
    }
    const authorization = socialObject(socialObject(socialJson(run.starter_context))?.sceneReworkAuthorization);
    if (!authorization || run.tenant_id !== input.tenantId || authorization.sourceRunId !== input.sourceRunId
      || authorization.operationId !== preview.operationId) return fail('scene_rework_run_conflict');
    await assertDurableOperationLease({ dataStore: store, lease });
    // Full authorization, actor, cache and run-status checks are repeated by createIntent.
    return await service.createIntent({ ...scope, executionRunId, actorUserId: input.actorUserId,
      affectedSceneIds: input.affectedSceneIds, changeKind: 'visual_asset' });
  } finally { await releaseDurableOperationLease({ dataStore: store, lease }); }
}
