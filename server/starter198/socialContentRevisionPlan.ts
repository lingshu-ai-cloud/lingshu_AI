import type { Starter198Repository } from './repository.js';
import { STARTER_COLLECTIONS } from './repository.js';
import { executeSocialContentMutation } from './socialContentMutation.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { socialJson, socialObject, socialRequestHash, socialText, SocialContentWorkflowError } from './socialContentValidation.js';
import { startSocialContentTask } from './socialContentTasks.js';
import { parseStoredSocialReplicationScript, parseStoredSocialReferenceVideoAnalysis, type ResolvedSocialTaskReference } from './socialContentScriptSources.js';
import { readTenantEnterpriseProfile } from '../lib/socialContentLegacyPorts.js';
import { verifiedSocialScriptContext } from './socialContentScriptBaseline.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import { withStarter198RunMutationLease } from './runMutationLease.js';

/** Server-owned revision command; deliberately not a public HTTP body contract.
 * It prepares a version, never reviews an artifact, calls a supplier or starts a worker. */
export interface TrustedSocialRevisionPlanInput {
  repository: Starter198Repository; tenantId: string; userId: string; taskId: string; idempotencyKey: string;
  expectedTaskVersion: string; parentArtifactId: string; expectedArtifactVersion: string;
  expectedBriefHash: string; expectedReferenceAnalysisHash: string; expectedEnterpriseFactsHash: string;
  referenceSha256: string; resolved: ResolvedSocialTaskReference;
  /** Server media port must verify the canonical tenant-owned reference bytes. */
  readEnterpriseFactsHash?: (tenantId: string, productRef: string) => Promise<string | null>;
  verifyReferenceBytes: (input: { tenantId: string; referenceRecordId: string; sha256: string }) => Promise<boolean>;
}

async function assertFacts(input: Pick<TrustedSocialRevisionPlanInput, 'tenantId' | 'expectedEnterpriseFactsHash' | 'readEnterpriseFactsHash'>, productRef: string) {
  const actual = input.readEnterpriseFactsHash ? await input.readEnterpriseFactsHash(input.tenantId, productRef)
    : verifiedSocialScriptContext(await readTenantEnterpriseProfile(input.tenantId), productRef).factVersion?.contentHash;
  if (!actual || actual !== input.expectedEnterpriseFactsHash) throw new SocialContentWorkflowError('social_revision_facts_changed', 409);
}

function validateEightScenePlan(resolved: ResolvedSocialTaskReference) {
  const script = parseStoredSocialReplicationScript(resolved.replicationScript);
  const analysis = parseStoredSocialReferenceVideoAnalysis(resolved.referenceVideoAnalysis);
  if (!script || !analysis || analysis.status !== 'ready' || script.referenceAnalysisId !== analysis.analysisId
    || script.shots.length !== 8 || new Set(script.shots.map(shot => shot.shotId)).size !== 8)
    throw new SocialContentWorkflowError('social_revision_plan_invalid', 400);
  const references = new Set(analysis.shots.map(shot => shot.shotId));
  if (script.shots.some(shot => !shot.referenceShotId || !references.has(shot.referenceShotId) || !shot.visualInstruction?.trim())
    || resolved.shotMaterialMap.some(shot => !script.shots.some(scene => scene.shotId === shot.shotId)))
    throw new SocialContentWorkflowError('social_revision_scene_lineage_invalid', 400);
  // The command must not grant a human approval or fake production/provider evidence.
  const text = JSON.stringify(resolved);
  if (/"(?:humanConfirmed|humanApproved|externalPublishPerformed)"\s*:\s*true/.test(text)
    || /"(?:providerTaskId|actualCostCny)"\s*:/.test(text))
    throw new SocialContentWorkflowError('social_revision_authority_invalid', 400);
  // Independent copy is authored text, never reference ASR or identity-only substitution.
  const shots = script.shots.map(shot => {
    const spokenText = shot.spokenText?.trim() || null;
    if (!Number.isFinite(shot.startSeconds) || !(shot.endSeconds > shot.startSeconds)) throw new SocialContentWorkflowError('social_revision_timing_invalid', 400);
    const { voiceoverReplacement: _replacement, ...copy } = shot;
    const speechLines = spokenText ? [{ lineId: `revision-speech:${shot.shotId}`, referenceText: '', draftText: spokenText,
      sourceStartSeconds: shot.startSeconds, sourceEndSeconds: shot.endSeconds, sourcePrecision: 'coarse' as const,
      sourceWords: [], sourceProvenance: 'independent_revision_script:not_reference_asr', replacedEntityTypes: [],
      narrationOwnerShotId: shot.shotId, visualShotIds: [shot.shotId] }] : [];
    return { ...copy, scriptOrigin: 'independent_revision' as const, spokenText, referenceSpokenText: null, speechLines };
  });
  return { ...structuredClone(resolved), replicationScript: { ...script, shots, narrationLines: shots.flatMap(shot => shot.speechLines),
    narrationSourceStatus: 'missing_source_asr' as const, status: 'draft' as const,
    originalityDifferenceSummary: 'Independent eight-scene creative restructuring; reference used for visual structure analysis only.' }, referenceVideoAnalysis: analysis };
}

export async function prepareSocialContentRevisionPlan(input: TrustedSocialRevisionPlanInput) {
  const resolved = validateEightScenePlan(input.resolved);
  if (!/^[a-f0-9]{64}$/.test(input.referenceSha256)) throw new SocialContentWorkflowError('social_revision_reference_hash_invalid', 400);
  const immutable = { schemaVersion: 'social-production-revision.v1', tenantId: input.tenantId, taskId: input.taskId,
    parentArtifactId: input.parentArtifactId, parentArtifactVersion: input.expectedArtifactVersion,
    briefHash: input.expectedBriefHash, referenceAnalysisHash: input.expectedReferenceAnalysisHash,
    enterpriseFactsHash: input.expectedEnterpriseFactsHash, referenceSha256: input.referenceSha256, resolved };
  const planHash = socialRequestHash(immutable);
  const result = await executeSocialContentMutation({ ...input, operation: 'prepare_social_production_revision', targetId: input.taskId,
    requestHash: socialRequestHash({ ...immutable, expectedTaskVersion: input.expectedTaskVersion }),
    replay: async () => {
      const row = await requireSocialTask(input), marker = socialObject(socialObject(socialJson(row.brief))?._productionRevision);
      if (marker?.planHash !== planHash) throw new SocialContentWorkflowError('social_revision_plan_superseded', 409);
      return { task: (await readSocialTaskDetail(input))!, planHash };
    }, action: async operationId => {
      const row = await requireSocialTask(input);
      const brief = socialObject(socialJson(row.brief));
      const prior = socialObject(brief?._productionRevision);
      if (row.last_operation_id === operationId && prior?.planHash === planHash)
        return { task: (await readSocialTaskDetail(input))!, planHash };
      if (socialText(row.version) !== input.expectedTaskVersion) throw new SocialContentWorkflowError('social_content_version_conflict', 409);
      const { planHash: priorHash, preparedBy: _priorBy, preparedAt: _priorAt, ...priorFrozen } = prior ?? {};
      const frozenProductionRevision = socialText(row.status) === 'producing' && prior?.tenantId === input.tenantId && prior?.taskId === input.taskId && typeof priorHash === 'string' && socialRequestHash(priorFrozen) === priorHash;
      if (!frozenProductionRevision && !['asset_review', 'attention', 'paused'].includes(socialText(row.status))) throw new SocialContentWorkflowError('social_revision_task_not_editable', 409);
      const publicBrief = (await readSocialTaskDetail(input))?.brief;
      if (!publicBrief || socialRequestHash(publicBrief) !== input.expectedBriefHash
        || socialRequestHash(socialJson(row.reference_video_analysis)) !== input.expectedReferenceAnalysisHash)
        throw new SocialContentWorkflowError('social_revision_input_changed', 409);
      const parent = await input.repository.list(STARTER_COLLECTIONS.socialContentArtifacts, input.tenantId,
        { where: { task_id: input.taskId, artifact_id: input.parentArtifactId }, perPage: 2 });
      if (parent.totalItems !== 1 || socialText(parent.items[0]?.version) !== input.expectedArtifactVersion
        || !['review_required', 'changes_requested'].includes(socialText(parent.items[0]?.status)))
        throw new SocialContentWorkflowError('social_revision_parent_changed', 409);
      if (socialRequestHash(resolved.referenceVideoAnalysis) !== input.expectedReferenceAnalysisHash
        || !await input.verifyReferenceBytes({ tenantId: input.tenantId, referenceRecordId: resolved.referenceVideoAnalysis.referenceRecordId || '', sha256: input.referenceSha256 }))
        throw new SocialContentWorkflowError('social_revision_reference_changed', 409);
      await assertFacts(input, publicBrief.productId || publicBrief.productRef || '');
      const store = input.repository.dataStore;
      if (!store?.compareAndSwap) throw new SocialContentWorkflowError('social_revision_atomic_storage_required', 503);
      const jobs = await store.list<Record<string, unknown>>('content_execution_jobs', { where: { tenant_id: input.tenantId, task_id: input.taskId }, page: 1, perPage: 500 });
      if (jobs.totalItems !== jobs.items.length || jobs.items.some(job => ['running', 'queued', 'retry_wait', 'reconciling', 'paused'].includes(String(job.status)) || Boolean(job.worker_id) || Boolean(job.lease_expires_at)))
        throw new SocialContentWorkflowError('social_revision_execution_active', 409);
      const version = Number(row.version);
      if (!Number.isSafeInteger(version) || version < 1) throw new SocialContentWorkflowError('social_revision_version_invalid', 409);
      // Fence the superseded legacy run before detaching it. Its callbacks already
      // reject cancelled runs; preserve provider jobs and artifacts as evidence.
      const oldRunId = socialText(row.run_id);
      if (oldRunId) await withStarter198RunMutationLease({ tenantId: input.tenantId, runId: oldRunId, dataStore: store, action: async () => {
        const current = await requireSocialTask(input);
        if (current.version !== row.version || current.run_id !== row.run_id) throw new SocialContentWorkflowError('social_content_version_conflict', 409);
        const run = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, oldRunId);
        const runTaskId = socialText(socialObject(socialJson(run?.starter_context))?.socialTaskId);
        if (run && ((runTaskId && runTaskId !== input.taskId) || (!runTaskId && !jobs.items.some(job => job.run_id === oldRunId))))
          throw new SocialContentWorkflowError('social_revision_previous_run_identity_invalid', 409);
        if (run && !['completed', 'succeeded', 'cancelled', 'failed'].includes(socialText(run.status))) {
          if (!await store.compareAndSwap!(STARTER_COLLECTIONS.runs, run.id, { tenant_id: input.tenantId, status: run.status },
            { status: 'cancelled', current_controller: 'system', pause_reason: 'superseded_by_explicit_revision', finished_at: new Date().toISOString() }))
            throw new SocialContentWorkflowError('social_revision_previous_run_changed', 409);
          const steps = await store.list<Record<string, unknown>>(STARTER_COLLECTIONS.tasks, { where: { tenant_id: input.tenantId, run_id: oldRunId }, page: 1, perPage: 500 });
          if (steps.totalItems !== steps.items.length) throw new SocialContentWorkflowError('social_revision_previous_run_incomplete', 409);
          for (const step of steps.items) if (!['succeeded', 'completed', 'cancelled', 'failed'].includes(String(step.status)))
            await store.compareAndSwap!(STARTER_COLLECTIONS.tasks, String(step.id), { tenant_id: input.tenantId, run_id: oldRunId, status: step.status }, { status: 'cancelled', finished_at: new Date().toISOString() });
        }
      } });
      const changed = await store.compareAndSwap(STARTER_COLLECTIONS.socialContentTasks, row.id,
        { tenant_id: input.tenantId, version: row.version, last_operation_id: row.last_operation_id },
        { brief: { ...brief, _productionRevision: { ...immutable, planHash, preparedBy: input.userId, preparedAt: new Date().toISOString() } },
          status: 'attention', run_id: '', orchestrator_item_id: '', version: String(version + 1), last_operation_id: operationId,
          updated_by: input.userId, updated_at: new Date().toISOString() });
      if (!changed) throw new SocialContentWorkflowError('social_content_version_conflict', 409);
      return { task: (await readSocialTaskDetail(input))!, planHash };
    } });
  return result.value;
}

/** Explicit separate admission. The existing start/queue/provider gates remain authoritative. */
export async function startPreparedSocialContentRevision(input: {
  repository: Starter198Repository; tenantId: string; userId: string; taskId: string;
  expectedVersion: string; expectedPlanHash: string; idempotencyKey: string; orchestratorQueue: Starter198OrchestratorQueuePort;
  verifyReferenceBytes: TrustedSocialRevisionPlanInput['verifyReferenceBytes'];
  readEnterpriseFactsHash?: TrustedSocialRevisionPlanInput['readEnterpriseFactsHash'];
}) {
  if (process.env.SOCIAL_CONTENT_EXECUTOR !== 'langgraph') throw new SocialContentWorkflowError('social_revision_graph_executor_required', 409);
  const row = await requireSocialTask(input);
  const marker = socialObject(socialObject(socialJson(row.brief))?._productionRevision);
  if (!marker || marker.planHash !== input.expectedPlanHash || marker.tenantId !== input.tenantId || marker.taskId !== input.taskId)
    throw new SocialContentWorkflowError('social_revision_plan_changed', 409);
  const { planHash, preparedBy: _actor, preparedAt: _time, ...immutable } = marker;
  if (socialRequestHash(immutable) !== planHash) throw new SocialContentWorkflowError('social_revision_plan_corrupt', 409);
  const resolved = validateEightScenePlan(marker.resolved as unknown as ResolvedSocialTaskReference);
  await assertFacts({ tenantId: input.tenantId, expectedEnterpriseFactsHash: String(marker.enterpriseFactsHash), readEnterpriseFactsHash: input.readEnterpriseFactsHash }, (await readSocialTaskDetail(input))?.brief.productId || (await readSocialTaskDetail(input))?.brief.productRef || '');
  return startSocialContentTask({ ...input, preparedRevisionAdmission: async current => {
    const actual = socialObject(socialObject(socialJson(current.brief))?._productionRevision);
    if (socialText(current.run_id) || actual?.planHash !== input.expectedPlanHash || actual.tenantId !== input.tenantId || actual.taskId !== input.taskId)
      throw new SocialContentWorkflowError('social_revision_plan_changed', 409);
    const { planHash: currentHash, preparedBy: _by, preparedAt: _at, ...frozen } = actual;
    if (socialRequestHash(frozen) !== currentHash) throw new SocialContentWorkflowError('social_revision_plan_corrupt', 409);
  }, referenceResolver: async () => {
    const current = await requireSocialTask(input);
    const currentMarker = socialObject(socialObject(socialJson(current.brief))?._productionRevision);
    const detail = await readSocialTaskDetail(input);
    if (currentMarker?.planHash !== input.expectedPlanHash || !detail || socialRequestHash(detail.brief) !== marker.briefHash
      || socialRequestHash(socialJson(current.reference_video_analysis)) !== marker.referenceAnalysisHash
      || !await input.verifyReferenceBytes({ tenantId: input.tenantId, referenceRecordId: resolved.referenceVideoAnalysis.referenceRecordId || '', sha256: String(marker.referenceSha256) }))
      throw new SocialContentWorkflowError('social_revision_input_changed', 409);
    await assertFacts({ tenantId: input.tenantId, expectedEnterpriseFactsHash: String(marker.enterpriseFactsHash), readEnterpriseFactsHash: input.readEnterpriseFactsHash }, detail.brief.productId || detail.brief.productRef || '');
    return structuredClone(resolved);
  } });
}

/** Trusted budget reallocation for an idle frozen revision; preserves all ledgers. */
export async function reallocatePreparedSocialRevisionBudget(input: {
  repository: Starter198Repository; tenantId: string; userId: string; taskId: string;
  expectedVersion: string; expectedPlanHash: string; idempotencyKey: string;
}) {
  const result = await executeSocialContentMutation({ ...input, operation: 'reallocate_social_revision_budget', targetId: input.taskId,
    requestHash: socialRequestHash({ expectedVersion: input.expectedVersion, expectedPlanHash: input.expectedPlanHash, production: 9.4, repair: .6 }),
    replay: async () => ({ task: (await readSocialTaskDetail(input))! }), action: async operationId => {
      const row = await requireSocialTask(input), brief = socialObject(socialJson(row.brief));
      const marker = socialObject(brief?._productionRevision);
      const { planHash, preparedBy: _by, preparedAt: _at, ...frozen } = marker ?? {};
      if (socialText(row.version) !== input.expectedVersion || !brief || marker?.tenantId !== input.tenantId || marker?.taskId !== input.taskId
        || planHash !== input.expectedPlanHash || socialRequestHash(frozen) !== planHash)
        throw new SocialContentWorkflowError('social_revision_plan_changed', 409);
      const jobs = await input.repository.dataStore!.list<Record<string, unknown>>('content_execution_jobs', { where: { tenant_id: input.tenantId, task_id: input.taskId }, perPage: 500 });
      if (jobs.totalItems !== jobs.items.length || jobs.items.some(job => !['cancelled', 'succeeded', 'dead_letter', 'blocked'].includes(String(job.status)) || Boolean(job.worker_id) || Boolean(job.lease_expires_at)))
        throw new SocialContentWorkflowError('social_revision_execution_active', 409);
      if (Number(brief.perItemBudgetCny) !== 8.5 || Number(brief.retryReserveCny) !== 1.5)
        throw new SocialContentWorkflowError('social_revision_budget_allocation_changed', 409);
      const changed = { ...brief, perItemBudgetCny: 9.4, retryReserveCny: .6,
        _revisionBudgetReallocation: { oldProduction: 8.5, oldRepair: 1.5, newProduction: 9.4, remainingRepair: .6, total: 10, purpose: 'Preserve full natural authorized hook voice via image-to-video; existing reservations and billing ledger unchanged', approvedScope: 'explicit_mvp_director_revision_20261011', operationId } };
      const saved = await input.repository.dataStore!.compareAndSwap!(STARTER_COLLECTIONS.socialContentTasks, row.id,
        { tenant_id: input.tenantId, version: row.version, last_operation_id: row.last_operation_id },
        { brief: changed, version: String(Number(row.version) + 1), last_operation_id: operationId, updated_by: input.userId, updated_at: new Date().toISOString() });
      if (!saved) throw new SocialContentWorkflowError('social_content_version_conflict', 409);
      return { task: (await readSocialTaskDetail(input))! };
    } });
  return result.value;
}
