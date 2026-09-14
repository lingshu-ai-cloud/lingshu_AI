import type {
  AddSocialTaskSourceInput,
  CreateSocialContentTaskInput,
  SelectSocialWorkPackagesInput,
  SocialContentTaskDetail,
  SocialContentTaskPage,
  SocialContentTaskSummary,
  SocialContentWorkspace,
  SocialTaskSource,
  UpdateSocialContentTaskInput,
} from '../../shared/contracts/socialContentWorkflow.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import { Starter198RuntimePortError } from './runtimePorts.js';
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

const TASK_EDITABLE_STATES = new Set(['draft', 'needs_input', 'plan_review', 'paused', 'attention']);
const SOURCE_EDITABLE_STATES = new Set(['draft', 'needs_input', 'plan_review', 'paused', 'attention']);

function nextVersion(record: StarterRecord): string {
  const current = Number(record.version);
  if (!Number.isSafeInteger(current) || current < 1) {
    throw new SocialContentWorkflowError('social_content_task_record_invalid', 503);
  }
  return String(current + 1);
}

function assertVersion(record: StarterRecord, expectedVersion: string): void {
  if (socialText(record.version) !== expectedVersion) {
    throw new SocialContentWorkflowError('social_content_task_version_conflict', 409);
  }
}

async function taskCreatedByOperation(input: {
  repository: Starter198Repository;
  tenantId: string;
  idempotencyKey: string;
}): Promise<StarterRecord | null> {
  const result = await input.repository.list(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, {
    where: { create_idempotency_key: input.idempotencyKey }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new SocialContentWorkflowError('social_content_task_integrity_violation', 503);
  }
  return result.items[0] ?? null;
}

async function sourceCreatedByOperation(input: {
  repository: Starter198Repository;
  tenantId: string;
  operationId: string;
}): Promise<StarterRecord | null> {
  const result = await input.repository.list(STARTER_COLLECTIONS.socialTaskSources, input.tenantId, {
    where: { created_operation_id: input.operationId }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new SocialContentWorkflowError('social_content_source_integrity_violation', 503);
  }
  return result.items[0] ?? null;
}

function defaultBrief(value: CreateSocialContentTaskInput) {
  return {
    title: value.title,
    objective: value.objective,
    productRef: value.productRef ?? null,
    audience: value.audience ?? null,
    markets: value.markets ?? [],
    languages: value.languages ?? [],
    platforms: value.platforms ?? [],
    formats: value.formats ?? [],
    aspectRatio: value.aspectRatio ?? null,
    cadence: value.cadence ?? null,
    requestedOutputCount: value.requestedOutputCount ?? null,
    weeklyBudgetCny: value.weeklyBudgetCny ?? null,
    perItemBudgetCny: value.perItemBudgetCny ?? null,
    retryReserveCny: value.retryReserveCny ?? null,
    planningMode: value.planningMode ?? 'auto_adjust',
    shootingWindowMinutes: value.shootingWindowMinutes ?? null,
    specialRequirements: value.specialRequirements ?? null,
    dueAt: value.dueAt ?? null,
    brandNotes: value.brandNotes ?? null,
    restrictions: value.restrictions ?? [],
    callToAction: value.callToAction ?? null,
  };
}

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
        return { task: (await readSocialTaskDetail({ ...input, taskId: socialText(existing.task_id) }))! };
      }
      await assertSocialTaskCapacity(input);
      const timestamp = (input.now ?? new Date()).toISOString();
      const taskId = socialPublicId('socialtask');
      await input.repository.create(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, {
        task_id: taskId,
        brief: defaultBrief(input.value),
        package_selection: packageSelection,
        status: 'draft',
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
      const brief = { ...current, ...input.value.changes };
      const readiness = socialTaskReadiness(brief, {
        total: currentSummary.sourceCount,
        knowledge: currentSummary.knowledgeSourceCount,
        material: currentSummary.materialSourceCount,
      });
      const status = readiness.complete ? 'plan_review' : socialText(record.status) === 'needs_input' ? 'needs_input' : 'draft';
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
        brief,
        status,
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

export async function addSocialTaskSource(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  idempotencyKey: string;
  value: AddSocialTaskSourceInput;
  storage?: { kind: 'local' | 'object'; key: string; mimeType: string; byteSize: number; sha256: string };
  sourceOptions?: SocialContentSourceOptionsPort;
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
      return { source: socialTaskSource(existing), task: (await readSocialTaskDetail(input))! };
    },
    action: async operationId => {
      const task = await requireSocialTask(input);
      const existing = await sourceCreatedByOperation({ ...input, operationId });
      if (existing) {
        await reconcileSocialContentTask({ ...input, operationId });
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
      return { source: socialTaskSource(await sourceRecord()), task: (await readSocialTaskDetail(input))! };
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
    now: input.now,
    replay: async () => ({ task: (await readSocialTaskDetail(input))! }),
    action: async operationId => {
      const record = await requireSocialTask(input);
      if (socialText(record.last_operation_id) === operationId) return { task: (await readSocialTaskDetail(input))! };
      assertVersion(record, input.expectedVersion);
      if (!['draft', 'needs_input', 'plan_review', 'paused', 'attention'].includes(socialText(record.status))) {
        throw new SocialContentWorkflowError('social_content_task_not_startable', 409);
      }
      const summary = socialTaskSummary(record);
      const coverage = await readSocialContentSourceCoverage(input);
      const readiness = socialTaskReadiness(summary.brief, coverage);
      if (!readiness.complete) {
        await reconcileSocialContentTask({ ...input, operationId, enforceReadiness: true });
        throw new SocialContentWorkflowError('social_content_task_inputs_incomplete', 409);
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
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
        status: queued.disposition === 'awaiting_initial_confirmation'
          ? 'plan_review'
          : queued.disposition === 'requires_manual_production'
            ? 'attention'
            : 'producing',
        run_id: queued.runId ?? '',
        orchestrator_item_id: queued.queueItemId,
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
  const [catalog, list] = await Promise.all([
    listActiveSocialWorkPackageCards(input),
    listSocialContentTasks({ ...input, page: 1, perPage: 50 }),
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
  };
}
