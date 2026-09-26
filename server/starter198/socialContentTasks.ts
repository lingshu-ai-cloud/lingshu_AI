import type {
  AddSocialTaskSourceInput,
  CreateSocialContentTaskInput,
  CreateSocialWeeklyPlanInput,
  SelectSocialWorkPackagesInput,
  SocialContentTaskDetail,
  SocialContentTaskPage,
  SocialContentTaskSummary,
  SocialContentWorkspace,
  SocialWeeklyPlan,
  SocialContentAgentWorkflow,
  SocialTaskSource,
  UpdateSocialContentTaskInput,
} from '../../shared/contracts/socialContentWorkflow.js';
import type { BusinessContentGoal } from '../../shared/contracts/socialOperatingDecision.js';
import type { SocialWeeklyPublicationTask, VersionedSocialRef, WeeklyOperatingPackage, WeeklyWorkflowTask } from '../../shared/contracts/socialProgram.js';
import type { VersionedReferenceSelection } from '../socialDiscovery/orchestration.js';
import { buildSocialAgentWorkflow, type BuildSocialAgentWorkflowInput } from './socialContentAgentWorkflow.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import { Starter198RuntimePortError } from './runtimePorts.js';
import { readTenantEnterpriseProfile } from '../lib/socialContentLegacyPorts.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { executeSocialContentMutation } from './socialContentMutation.js';
import {
  readSocialTaskDetail,
  findSocialRecord,
  requireSocialTask,
  socialTaskReadiness,
  socialTaskSource,
  socialTaskSummary,
} from './socialContentRecords.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialPublicId,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';
import {
  listActiveSocialWorkPackageCards,
  resolveSelectedPackages,
} from './socialWorkPackages.js';
import { requireOwnedSocialFileRef } from './socialContentFiles.js';
import { assertSocialTaskCapacity, assertSocialTaskChildCapacity } from './socialContentLimits.js';
import {
  socialContentSourceOptions,
  type SocialContentSourceOptionsPort,
} from './socialContentSourceOptions.js';
import {
  readSocialContentSourceCoverage,
  reconcileSocialContentTask,
} from './socialContentProjection.js';
import {
  SOCIAL_THEME_CATALOG,
  advisoryMaterialRequirements,
  materialReadiness,
  parseStoredMaterialRequirements,
  resolveSocialThemeSelection,
} from './socialContentThemes.js';
import {
  freezeSocialScriptBaseline,
  parseStoredSocialScriptBaseline,
  verifiedSocialScriptContext,
  type StoredSocialScriptBaseline,
} from './socialContentScriptBaseline.js';
import {
  pendingSocialTaskReferenceAnalysis,
  resolveSocialInspirationScript,
  resolveSocialRecommendedReferenceScript,
  resolveSocialTaskReferenceScript,
  type ResolvedSocialTaskReference,
} from './socialContentScriptSources.js';

import {
  SOURCE_EDITABLE_STATES,
  TASK_EDITABLE_STATES,
  assertVersion,
  defaultBrief,
  groundedScriptBaseline,
  nextVersion,
  refreshSocialTaskReferenceOutputs,
  socialWeeklyPlan,
  sourceCreatedByOperation,
  taskCreatedByOperation,
  type SocialTaskReferenceResolver,
} from './socialContentTaskSupport.js';
export { buildAuthoritativeSocialContentWorkflow, listSocialWeeklyPlans } from './socialContentTaskSupport.js';
import { listSocialWeeklyPlans } from './socialContentTaskSupport.js';

export async function createSocialContentTask(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  value: CreateSocialContentTaskInput;
  now?: Date;
}): Promise<SocialContentTaskDetail> {
  const packageSelection = (await listActiveSocialWorkPackageCards(input)).map(card => ({
    kind: card.kind,
    packageKey: card.packageKey,
    version: card.version,
    name: card.name,
  }));
  if (packageSelection.length !== 3) throw new SocialContentWorkflowError('social_package_catalog_incomplete', 503);
  const requestHash = socialRequestHash(input.value);
  const mutation = await executeSocialContentMutation<{ task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    operation: 'create_social_content_task',
    targetId: 'task-collection',
    now: input.now,
    replay: async () => {
      const existing = await taskCreatedByOperation(input);
      if (!existing) throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
      return { task: (await readSocialTaskDetail({ ...input, taskId: socialText(existing.task_id) }))! };
    },
    action: async operationId => {
      const existing = await taskCreatedByOperation(input);
      if (existing) {
        if (input.value.creationMode === 'viral_replication') {
          await refreshSocialTaskReferenceOutputs({ ...input, taskId: socialText(existing.task_id), operationId });
        }
        return { task: (await readSocialTaskDetail({ ...input, taskId: socialText(existing.task_id) }))! };
      }
      await assertSocialTaskCapacity(input);
      const timestamp = (input.now ?? new Date()).toISOString();
      const taskId = socialPublicId('socialtask');
      const theme = resolveSocialThemeSelection(input.value);
      const brief = defaultBrief(input.value);
      const scriptBaseline = theme?.classificationStatus === 'confirmed' && theme.themeId
        ? await groundedScriptBaseline({
            tenantId: input.tenantId,
            brief,
            theme,
            lockedAt: timestamp,
          })
        : null;
      const initialReadiness = socialTaskReadiness(brief, { total: 0, knowledge: 0, material: 0 }, theme ? {
        theme,
        materialReadiness: materialReadiness([]),
      } : undefined);
      await input.repository.create(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, {
        task_id: taskId,
        brief,
        workflow_version: theme ? 'theme-v1' : 'legacy-v1',
        task_mode: input.value.mode ?? 'weekly',
        weekly_plan_id: input.value.weeklyPlanId ?? '',
        theme_selection: theme ?? '',
        // Kept as an empty compatibility column while historic formula-backed
        // tasks remain readable. New tasks are grounded by per-video
        // inspiration analysis or the governed knowledge/system fallback.
        formula_reference: '',
        script_baseline: scriptBaseline ?? '',
        director_plan: '',
        material_requirements: [],
        legacy_creation_route: input.value.legacyCreationRoute ?? '',
        package_selection: packageSelection,
        status: initialReadiness.complete ? 'plan_review' : 'draft',
        version: '1',
        run_id: '',
        source_count: 0,
        knowledge_source_count: 0,
        material_source_count: 0,
        artifact_count: 0,
        approved_artifact_count: 0,
        delivery_package_count: 0,
        publication_count: 0,
        metric_submission_count: 0,
        create_idempotency_key: input.idempotencyKey,
        create_request_hash: requestHash,
        last_operation_id: operationId,
        created_by: input.userId,
        updated_by: input.userId,
        created_at: timestamp,
        updated_at: timestamp,
      });
      if (brief.creationMode === 'viral_replication') {
        await refreshSocialTaskReferenceOutputs({ ...input, taskId, operationId });
      }
      return { task: (await readSocialTaskDetail({ ...input, taskId }))! };
    },
  });
  return mutation.value.task;
}

export async function updateSocialContentTask(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  value: UpdateSocialContentTaskInput;
  now?: Date;
}): Promise<SocialContentTaskDetail> {
  const mutation = await executeSocialContentMutation<{ task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash(input.value),
    operation: 'update_social_content_task',
    targetId: input.taskId,
    now: input.now,
    replay: async () => ({ task: (await readSocialTaskDetail(input))! }),
    action: async operationId => {
      const record = await requireSocialTask(input);
      if (socialText(record.last_operation_id) === operationId) {
        return { task: (await readSocialTaskDetail(input))! };
      }
      assertVersion(record, input.value.expectedVersion);
      if (!TASK_EDITABLE_STATES.has(socialText(record.status))) {
        throw new SocialContentWorkflowError('social_content_task_not_editable', 409);
      }
      const currentSummary = socialTaskSummary(record);
      const current = currentSummary.brief;
      const {
        mode,
        weeklyPlanId,
        themeId,
        customTopic,
        topic,
        legacyCreationRoute,
        ...briefChanges
      } = input.value.changes;
      const nextMode = mode ?? currentSummary.mode ?? 'weekly';
      const hasThemeInput = ['themeId', 'customTopic', 'topic'].some(key => Object.prototype.hasOwnProperty.call(input.value.changes, key));
      const theme = hasThemeInput
        ? resolveSocialThemeSelection({ themeId, customTopic, topic })
        : currentSummary.theme ?? null;
      const timestamp = (input.now ?? new Date()).toISOString();
      const currentRequirements = advisoryMaterialRequirements(parseStoredMaterialRequirements(record.material_requirements));
      const currentBaseline = parseStoredSocialScriptBaseline(record.script_baseline);
      const themeChanged = (currentSummary.theme?.themeId ?? null) !== (theme?.themeId ?? null);
      // Existing shot suggestions remain advisory, but changing the theme
      // clears them so no historic formula structure leaks into the new plan.
      const materialRequirements = themeChanged ? [] : currentRequirements;
      const brief = {
        ...current,
        ...briefChanges,
        requestedOutputCount: nextMode === 'instant'
          ? 1
          : briefChanges.requestedOutputCount ?? current.requestedOutputCount,
      };
      const scriptFieldsChanged = [
        'title', 'objective', 'productRef', 'languages', 'callToAction', 'brandNotes', 'restrictions',
      ].some(key => Object.prototype.hasOwnProperty.call(briefChanges, key));
      let scriptBaseline = currentBaseline;
      if (!theme || theme.classificationStatus !== 'confirmed' || !theme.themeId) {
        scriptBaseline = null;
      } else if (themeChanged || hasThemeInput || scriptFieldsChanged || !currentBaseline
        || currentBaseline.source === 'formula' || currentBaseline.formulaReference) {
        // Editing a historic formula-backed task migrates it to the current
        // inspiration -> verified knowledge -> system fallback chain.
        scriptBaseline = await groundedScriptBaseline({
          tenantId: input.tenantId,
          brief,
          theme,
          lockedAt: timestamp,
          previous: currentBaseline,
        });
      }
      const readiness = socialTaskReadiness(brief, {
        total: currentSummary.sourceCount,
        knowledge: currentSummary.knowledgeSourceCount,
        material: currentSummary.materialSourceCount,
      }, {
        theme,
        materialReadiness: materialReadiness(materialRequirements),
      });
      const status = readiness.complete ? 'plan_review' : socialText(record.status) === 'needs_input' ? 'needs_input' : 'draft';
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
        brief,
        task_mode: nextMode,
        weekly_plan_id: weeklyPlanId === undefined ? socialText(record.weekly_plan_id) : weeklyPlanId ?? '',
        theme_selection: theme ?? '',
        formula_reference: '',
        script_baseline: scriptBaseline ?? '',
        ...((themeChanged || hasThemeInput || scriptFieldsChanged || currentBaseline?.source === 'formula') ? { director_plan: '' } : {}),
        material_requirements: materialRequirements,
        legacy_creation_route: legacyCreationRoute === undefined
          ? socialText(record.legacy_creation_route)
          : legacyCreationRoute ?? '',
        status,
        version: nextVersion(record),
        last_operation_id: operationId,
        updated_by: input.userId,
        updated_at: timestamp,
      });
      return { task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value.task;
}

export async function addSocialTaskSource(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  value: AddSocialTaskSourceInput;
  storage?: { kind: 'local' | 'object'; key: string; mimeType: string; byteSize: number; sha256: string };
  sourceOptions?: SocialContentSourceOptionsPort;
  referenceResolver?: SocialTaskReferenceResolver;
  now?: Date;
}): Promise<{ source: SocialTaskSource; task: SocialContentTaskDetail }> {
  let value = input.value;
  if (input.value.sourceRef.startsWith('socialfile:')) {
    const file = await requireOwnedSocialFileRef({
      repository: input.repository,
      tenantId: input.tenantId,
      taskId: input.taskId,
      fileRef: input.value.sourceRef,
      usage: 'source',
    });
    value = { ...input.value, sourceVersion: socialText(file.content_sha256) || input.value.sourceVersion };
  } else if (input.value.kind === 'material' || input.value.kind === 'knowledge') {
    const option = await (input.sourceOptions ?? socialContentSourceOptions).resolve({
      tenantId: input.tenantId,
      kind: input.value.kind,
      sourceRef: input.value.sourceRef,
    });
    if (!option) throw new SocialContentWorkflowError('social_content_source_option_not_found', 404);
    if (input.value.sourceVersion && input.value.sourceVersion !== option.sourceVersion) {
      throw new SocialContentWorkflowError('social_content_source_option_version_conflict', 409);
    }
    value = { ...input.value, sourceVersion: option.sourceVersion };
  }
  const mutation = await executeSocialContentMutation<{ source: SocialTaskSource; task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash({ ...value, storage: input.storage }),
    operation: 'add_social_task_source',
    targetId: input.taskId,
    now: input.now,
    replay: async operationId => {
      const existing = await sourceCreatedByOperation({ ...input, operationId });
      if (!existing) throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
      await reconcileSocialContentTask({ ...input, operationId });
      if (socialText(existing.source_kind) === 'reference_link') {
        await refreshSocialTaskReferenceOutputs({ ...input, operationId });
      }
      return { source: socialTaskSource(existing), task: (await readSocialTaskDetail(input))! };
    },
    action: async operationId => {
      const task = await requireSocialTask(input);
      const existing = await sourceCreatedByOperation({ ...input, operationId });
      if (existing) {
        await reconcileSocialContentTask({ ...input, operationId });
        if (socialText(existing.source_kind) === 'reference_link') {
          await refreshSocialTaskReferenceOutputs({ ...input, operationId });
        }
        return { source: socialTaskSource(existing), task: (await readSocialTaskDetail(input))! };
      }
      if (!SOURCE_EDITABLE_STATES.has(socialText(task.status))) {
        throw new SocialContentWorkflowError('social_content_sources_not_editable', 409);
      }
      await assertSocialTaskChildCapacity({ ...input, kind: 'source' });
      const attached = await input.repository.list(STARTER_COLLECTIONS.socialTaskSources, input.tenantId, {
        where: {
          task_id: input.taskId,
          source_kind: value.kind,
          source_ref: value.sourceRef,
          status: 'active',
        },
        perPage: 2,
      });
      if (attached.totalItems > 1 || attached.items.length > 1) {
        throw new SocialContentWorkflowError('social_content_source_integrity_violation', 503);
      }
      if (attached.items.length) throw new SocialContentWorkflowError('social_content_source_already_attached', 409);
      const timestamp = (input.now ?? new Date()).toISOString();
      const sourceId = socialPublicId('socialsrc');
      const created = await input.repository.create(STARTER_COLLECTIONS.socialTaskSources, input.tenantId, {
        source_id: sourceId,
        task_id: input.taskId,
        source_kind: value.kind,
        source_ref: value.sourceRef,
        source_version: value.sourceVersion ?? '',
        label: value.label,
        purpose: value.purpose ?? '',
        status: 'active',
        storage_kind: input.storage?.kind ?? '',
        storage_key: input.storage?.key ?? '',
        mime_type: input.storage?.mimeType ?? '',
        byte_size: input.storage?.byteSize ?? 0,
        content_sha256: input.storage?.sha256 ?? '',
        created_operation_id: operationId,
        last_operation_id: operationId,
        created_by: input.userId,
        created_at: timestamp,
        updated_at: timestamp,
      });
      await reconcileSocialContentTask({ ...input, operationId });
      if (value.kind === 'reference_link') {
        await refreshSocialTaskReferenceOutputs({ ...input, operationId });
      }
      return { source: socialTaskSource(created), task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value;
}

export async function removeSocialTaskSource(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  sourceId: string;
  expectedTaskVersion: string;
  idempotencyKey: string;
  referenceResolver?: SocialTaskReferenceResolver;
  now?: Date;
}): Promise<{ source: SocialTaskSource; task: SocialContentTaskDetail }> {
  const sourceRecord = async () => findSocialRecord({
    ...input,
    collection: STARTER_COLLECTIONS.socialTaskSources,
    where: { source_id: input.sourceId, task_id: input.taskId },
    notFoundCode: 'social_content_source_not_found',
  });
  const mutation = await executeSocialContentMutation<{ source: SocialTaskSource; task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash({ expectedTaskVersion: input.expectedTaskVersion }),
    operation: 'remove_social_task_source',
    targetId: input.taskId,
    now: input.now,
    replay: async operationId => {
      await reconcileSocialContentTask({ ...input, operationId, enforceReadiness: true });
      const replayedSource = await sourceRecord();
      if (socialText(replayedSource.source_kind) === 'reference_link') {
        await refreshSocialTaskReferenceOutputs({ ...input, operationId });
      }
      return { source: socialTaskSource(replayedSource), task: (await readSocialTaskDetail(input))! };
    },
    action: async operationId => {
      const task = await requireSocialTask(input);
      const source = await sourceRecord();
      if (socialText(source.last_operation_id) !== operationId) {
        assertVersion(task, input.expectedTaskVersion);
        if (!SOURCE_EDITABLE_STATES.has(socialText(task.status))) {
          throw new SocialContentWorkflowError('social_content_sources_not_editable', 409);
        }
        if (socialText(source.status) !== 'active') {
          throw new SocialContentWorkflowError('social_content_source_not_active', 409);
        }
        await input.repository.update(STARTER_COLLECTIONS.socialTaskSources, input.tenantId, source.id, {
          status: 'removed',
          last_operation_id: operationId,
          updated_at: (input.now ?? new Date()).toISOString(),
        });
      }
      await reconcileSocialContentTask({ ...input, operationId, enforceReadiness: true });
      if (socialText(source.source_kind) === 'reference_link') {
        await refreshSocialTaskReferenceOutputs({ ...input, operationId });
      }
      return { source: socialTaskSource(await sourceRecord()), task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value;
}

export async function selectSocialWorkPackages(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  value: SelectSocialWorkPackagesInput;
  now?: Date;
}): Promise<SocialContentTaskDetail> {
  const selection = await resolveSelectedPackages({ repository: input.repository, selections: input.value.selections, now: input.now });
  const mutation = await executeSocialContentMutation<{ task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash(input.value),
    operation: 'select_social_work_packages',
    targetId: input.taskId,
    now: input.now,
    replay: async () => ({ task: (await readSocialTaskDetail(input))! }),
    action: async operationId => {
      const record = await requireSocialTask(input);
      if (socialText(record.last_operation_id) === operationId) return { task: (await readSocialTaskDetail(input))! };
      assertVersion(record, input.value.expectedVersion);
      if (!['draft', 'needs_input', 'plan_review'].includes(socialText(record.status))) {
        throw new SocialContentWorkflowError('social_package_selection_locked', 409);
      }
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
        package_selection: selection,
        status: socialTaskSummary(record).readiness.complete ? 'plan_review' : socialText(record.status),
        version: nextVersion(record),
        last_operation_id: operationId,
        updated_by: input.userId,
        updated_at: (input.now ?? new Date()).toISOString(),
      });
      return { task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value.task;
}

export async function startSocialContentTask(input: {
  repository: Starter198Repository;
  orchestratorQueue: Starter198OrchestratorQueuePort;
  tenantId: string;
  userId: string;
  taskId: string;
  expectedVersion: string;
  idempotencyKey: string;
  referenceResolver?: SocialTaskReferenceResolver;
  now?: Date;
}): Promise<SocialContentTaskDetail> {
  const mutation = await executeSocialContentMutation<{ task: SocialContentTaskDetail }>({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    requestHash: socialRequestHash({ expectedVersion: input.expectedVersion }),
    operation: 'start_social_content_task',
    targetId: input.taskId,
    processingReceipt: { expectedVersion: input.expectedVersion },
    now: input.now,
    replay: async () => ({ task: (await readSocialTaskDetail(input))! }),
    action: async operationId => {
      let record = await requireSocialTask(input);
      if (socialText(record.last_operation_id) === operationId) return { task: (await readSocialTaskDetail(input))! };
      const projectionOperationId = `${operationId}:prestart`;
      const projectionAlreadyApplied = [
        projectionOperationId,
        `${projectionOperationId}:reference-analysis`,
      ].includes(socialText(record.last_operation_id));
      if (!projectionAlreadyApplied) {
        assertVersion(record, input.expectedVersion);
      }
      if (!['draft', 'needs_input', 'plan_review', 'paused', 'attention'].includes(socialText(record.status))
        && !(projectionAlreadyApplied && socialText(record.status) === 'asset_review')) {
        throw new SocialContentWorkflowError('social_content_task_not_startable', 409);
      }
      // Refresh counters and advisory material suggestions before deciding
      // whether the task can start. This also migrates older theme tasks whose
      // shot lists were incorrectly stored as hard requirements.
      record = await reconcileSocialContentTask({
        ...input,
        operationId: projectionOperationId,
      });
      if (socialTaskSummary(record).brief.creationMode === 'viral_replication') {
        record = await refreshSocialTaskReferenceOutputs({
          ...input,
          operationId: `${operationId}:prestart`,
          referenceResolver: input.referenceResolver,
        });
        const referenceAnalysis = socialObject(socialJson(record.reference_video_analysis));
        if (!referenceAnalysis || socialText(referenceAnalysis.status) !== 'ready') {
          throw new SocialContentWorkflowError('social_content_reference_analysis_pending', 409);
        }
        const replicationScript = socialObject(socialJson(record.replication_script));
        if (!replicationScript
          || socialText(replicationScript.referenceAnalysisId) !== socialText(referenceAnalysis.analysisId)) {
          throw new SocialContentWorkflowError('social_content_reference_analysis_pending', 409);
        }
        if (socialText(replicationScript.status) !== 'confirmed') {
          const timestamp = (input.now ?? new Date()).toISOString();
          await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
            replication_script: { ...replicationScript, status: 'confirmed' },
            version: nextVersion(record),
            last_operation_id: `${operationId}:reference-review`,
            updated_by: input.userId,
            updated_at: timestamp,
          });
          throw new SocialContentWorkflowError('social_content_reference_review_required', 409);
        }
      }
      const summary = socialTaskSummary(record);
      const coverage = await readSocialContentSourceCoverage(input);
      const readiness = socialTaskReadiness(summary.brief, coverage, summary.theme ? {
        theme: summary.theme,
        materialReadiness: summary.materialReadiness ?? materialReadiness([]),
      } : undefined);
      if (!readiness.complete) {
        await reconcileSocialContentTask({
          ...input,
          operationId: `${operationId}:incomplete`,
          enforceReadiness: true,
        });
        throw new SocialContentWorkflowError('social_content_task_inputs_incomplete', 409);
      }
      const executableDetail = await readSocialTaskDetail(input);
      const workflowReview = executableDetail?.agentWorkflow?.executionPlanReview;
      if (workflowReview && !workflowReview.approved) {
        const reasonCodes = workflowReview.reasonCodes;
        const code = reasonCodes.includes('rights_missing')
          ? 'social_content_execution_rights_required'
          : reasonCodes.includes('facts_missing')
            ? 'social_content_execution_facts_required'
            : reasonCodes.includes('budget_exceeded')
              ? 'social_content_execution_budget_required'
              : executableDetail?.agentWorkflow?.stage === 'goal_degraded'
                ? 'social_content_execution_goal_degraded'
                : 'social_content_execution_director_review_required';
        throw new SocialContentWorkflowError(code, 409);
      }
      await resolveSelectedPackages({ repository: input.repository, selections: summary.packageSelection, now: input.now });
      let queued;
      try {
        queued = await input.orchestratorQueue.enqueue({
          tenantId: input.tenantId,
          userId: input.userId,
          commandId: operationId,
          input: `社媒内容任务 ${input.taskId}：${summary.brief.title}\n目标：${summary.brief.objective}`.slice(0, 4_000),
          idempotencyKey: input.idempotencyKey,
          workflowScope: 'social_content',
          subject: {
            type: 'social_content_task',
            id: input.taskId,
            admissionVersion: input.expectedVersion,
            version: summary.version,
            sourceRefs: (await readSocialTaskDetail(input))!.sources.filter(source => source.status === 'active').map(source => ({
              id: source.sourceId,
              ...(source.sourceVersion ? { version: source.sourceVersion } : {}),
            })),
            packageSelection: summary.packageSelection.map(item => ({
              kind: item.kind,
              packageKey: item.packageKey,
              version: item.version,
            })),
            conversionObjective: Boolean(summary.brief.callToAction),
          },
        });
      } catch (error) {
        if (error instanceof Starter198RuntimePortError) {
          throw new SocialContentWorkflowError(error.code, error.status);
        }
        throw error;
      }
      if (!queued.queueItemId) throw new SocialContentWorkflowError('social_content_orchestrator_unavailable', 503);
      const scheduled = await requireSocialTask(input);
      if (socialText(scheduled.last_operation_id) === operationId) {
        if (socialText(scheduled.orchestrator_item_id) !== queued.queueItemId) {
          throw new SocialContentWorkflowError('social_content_schedule_state_integrity_violation', 503);
        }
        return { task: (await readSocialTaskDetail(input))! };
      }
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, scheduled.id, {
        status: queued.disposition === 'awaiting_initial_confirmation'
          ? 'plan_review'
          : queued.disposition === 'requires_manual_production'
            ? 'attention'
            : 'producing',
        run_id: queued.runId ?? '',
        orchestrator_item_id: queued.queueItemId,
        version: nextVersion(scheduled),
        last_operation_id: operationId,
        updated_by: input.userId,
        updated_at: (input.now ?? new Date()).toISOString(),
      });
      return { task: (await readSocialTaskDetail(input))! };
    },
  });
  return mutation.value.task;
}

/**
 * Creates a planning parent first, then idempotently creates its ContentTask
 * children. A retry resumes missing children and never duplicates a task.
 */
export async function createSocialWeeklyPlan(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  value: CreateSocialWeeklyPlanInput;
  now?: Date;
}): Promise<{ weeklyPlan: SocialWeeklyPlan; tasks: SocialContentTaskDetail[] }> {
  const existingPlans = await input.repository.list(STARTER_COLLECTIONS.plans, input.tenantId, {
    sort: '-created_at', page: 1, perPage: 500,
  });
  let planRecord = existingPlans.items.find(record => {
    const plan = socialObject(socialJson(record.plan));
    return socialText(plan?.schemaVersion) === 'social-content-weekly-plan.v1'
      && socialText(plan?.createIdempotencyKey) === input.idempotencyKey;
  });
  const timestamp = (input.now ?? new Date()).toISOString();
  if (!planRecord) {
    const weeklyPlanId = socialPublicId('socialweek');
    planRecord = await input.repository.create(STARTER_COLLECTIONS.plans, input.tenantId, {
      id: weeklyPlanId,
      goal_id: `social-content:${weeklyPlanId}`,
      status: 'draft',
      plan: {
        schemaVersion: 'social-content-weekly-plan.v1',
        weeklyPlanId,
        createIdempotencyKey: input.idempotencyKey,
        title: input.value.title,
        objective: input.value.objective,
        productRef: input.value.productRef ?? null,
        audience: input.value.audience ?? null,
        taskIds: [],
        version: '1',
      },
      created_at: timestamp,
      updated_at: timestamp,
    });
  }
  const currentPlan = socialWeeklyPlan(planRecord);
  if (!currentPlan) throw new SocialContentWorkflowError('social_weekly_plan_record_invalid', 503);
  const tasks: SocialContentTaskDetail[] = [];
  for (const [index, item] of input.value.items.entries()) {
    tasks.push(await createSocialContentTask({
      repository: input.repository,
      tenantId: input.tenantId,
      userId: input.userId,
      idempotencyKey: `${input.idempotencyKey}:content-task:${index + 1}`,
      value: {
        title: item.title,
        objective: item.objective,
        productRef: input.value.productRef ?? null,
        audience: input.value.audience ?? null,
        mode: 'weekly',
        weeklyPlanId: currentPlan.weeklyPlanId,
        themeId: item.themeId ?? null,
        customTopic: item.customTopic ?? null,
        topic: item.topic ?? null,
        requestedOutputCount: 1,
      },
      now: input.now,
    }));
  }
  const storedPlan = socialObject(socialJson(planRecord.plan));
  if (!storedPlan) throw new SocialContentWorkflowError('social_weekly_plan_record_invalid', 503);
  const taskIds = tasks.map(task => task.taskId);
  const storedTaskIds = socialJson(storedPlan.taskIds);
  const alreadyCurrent = socialText(planRecord.status) === 'active'
    && Array.isArray(storedTaskIds)
    && storedTaskIds.map(socialText).join('|') === taskIds.join('|');
  if (!alreadyCurrent) {
    const nextPlanVersion = String(Math.max(1, Number(storedPlan.version) || 1) + 1);
    await input.repository.update(STARTER_COLLECTIONS.plans, input.tenantId, planRecord.id, {
      status: 'active',
      plan: { ...storedPlan, taskIds, version: nextPlanVersion },
      updated_at: timestamp,
    });
  }
  const updated = await input.repository.get(STARTER_COLLECTIONS.plans, input.tenantId, planRecord.id);
  const weeklyPlan = updated && socialWeeklyPlan(updated);
  if (!weeklyPlan) throw new SocialContentWorkflowError('social_weekly_plan_record_invalid', 503);
  return { weeklyPlan, tasks };
}

export async function listSocialContentTasks(input: {
  repository: Starter198Repository;
  tenantId: string;
  status?: string;
  page?: number;
  perPage?: number;
}): Promise<SocialContentTaskPage> {
  const result = await input.repository.list(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, {
    ...(input.status ? { where: { status: input.status } } : {}),
    sort: '-updated_at',
    page: input.page,
    perPage: input.perPage,
  });
  return { ...result, items: result.items.map(socialTaskSummary) };
}

export async function readSocialContentWorkspace(input: {
  repository: Starter198Repository;
  tenantId: string;
  now?: Date;
}): Promise<SocialContentWorkspace> {
  const [catalog, list, weeklyPlans] = await Promise.all([
    listActiveSocialWorkPackageCards(input),
    listSocialContentTasks({ ...input, page: 1, perPage: 50 }),
    listSocialWeeklyPlans(input),
  ]);
  const current = list.items.find(item => !['reviewed'].includes(item.status)) ?? list.items[0] ?? null;
  return {
    catalog,
    tasks: list.items,
    taskList: {
      page: list.page,
      perPage: list.perPage,
      totalItems: list.totalItems,
      totalPages: list.totalPages,
    },
    currentTask: current ? await readSocialTaskDetail({ ...input, taskId: current.taskId }) : null,
    weeklyPlans,
    themes: [...SOCIAL_THEME_CATALOG],
  };
}
