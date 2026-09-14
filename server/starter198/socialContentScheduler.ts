import { createHash } from 'node:crypto';
import type { SocialTaskSource } from '../../shared/contracts/socialContentWorkflow.js';
import {
  buildStarter198CapabilityManifest,
  starter198CapabilityAllowed,
} from './profile.js';
import { assertStarter198AccessCycleOpen, Starter198QuotaError } from './quota.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import type {
  Starter198OrchestratorQueuePort,
  Starter198OrchestratorQueueResult,
} from './runtimePorts.js';
import { Starter198RuntimePortError } from './runtimePorts.js';
import {
  assertSocialContentSubjectLease,
  withSocialContentSubjectLease,
} from './socialContentMutation.js';
import {
  requireSocialTask,
  socialTaskReadiness,
  socialTaskSource,
  socialTaskSummary,
} from './socialContentRecords.js';
import {
  SocialContentWorkflowError,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';
import { resolveSelectedPackages } from './socialWorkPackages.js';

type SocialQueueInput = Parameters<Starter198OrchestratorQueuePort['enqueue']>[0];

const STARTABLE_STATUSES = new Set(['draft', 'needs_input', 'plan_review', 'paused', 'attention']);
const MANUAL_PRODUCTION_REASON = 'social_content_package_executor_requires_professional_workspace';

function fail(code: string, status: number): never {
  throw new Starter198RuntimePortError(code, status);
}

function nextVersion(record: StarterRecord): string {
  const current = Number(record.version);
  if (!Number.isSafeInteger(current) || current < 1) {
    fail('social_content_task_record_invalid', 503);
  }
  return String(current + 1);
}

function queueItemId(input: SocialQueueInput): string {
  const digest = createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    tenantId: input.tenantId,
    commandId: input.commandId,
    taskId: input.subject?.id,
  })).digest('hex').slice(0, 32);
  return `social-content:${digest}`;
}

function normalizedSources(sources: Array<{ id: string; version?: string }>): Array<{ id: string; version: string }> {
  return sources.map(source => ({ id: socialText(source.id), version: socialText(source.version) }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
}

function normalizedPackages(
  packages: Array<{ kind: string; packageKey: string; version: string }>,
): Array<{ kind: string; packageKey: string; version: string }> {
  return packages.map(item => ({
    kind: socialText(item.kind),
    packageKey: socialText(item.packageKey),
    version: socialText(item.version),
  })).sort((left, right) => left.kind.localeCompare(right.kind));
}

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function requireStartOperation(input: {
  repository: Starter198Repository;
  queue: SocialQueueInput;
}): Promise<StarterRecord> {
  const result = await input.repository.list(
    STARTER_COLLECTIONS.socialContentOperations,
    input.queue.tenantId,
    { where: { operation_id: input.queue.commandId }, perPage: 2 },
  );
  if (result.totalItems !== result.items.length || result.items.length > 1) {
    fail('social_content_schedule_receipt_integrity_violation', 503);
  }
  const operation = result.items[0];
  const subjectId = socialText(input.queue.subject?.id);
  if (!operation) fail('social_content_schedule_receipt_not_found', 409);
  if (socialText(operation.operation_id) !== input.queue.commandId
    || socialText(operation.idempotency_key) !== input.queue.idempotencyKey
    || socialText(operation.operation) !== 'start_social_content_task'
    || socialText(operation.target_id) !== subjectId
    || socialText(operation.request_hash) !== socialRequestHash({ expectedVersion: input.queue.subject?.version })
    || socialText(operation.created_by) !== input.queue.userId
    || !['processing', 'succeeded'].includes(socialText(operation.status))) {
    fail('social_content_schedule_receipt_integrity_violation', 503);
  }
  return operation;
}

async function activeSources(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
}): Promise<SocialTaskSource[]> {
  const result = await input.repository.list(STARTER_COLLECTIONS.socialTaskSources, input.tenantId, {
    where: { task_id: input.taskId, status: 'active' },
    sort: 'source_id',
    perPage: 101,
  });
  if (result.totalItems !== result.items.length || result.totalItems > 100) {
    fail('social_content_source_integrity_violation', 503);
  }
  return result.items.map(socialTaskSource);
}

function assertSubjectMatches(input: {
  record: StarterRecord;
  sources: SocialTaskSource[];
  queue: SocialQueueInput;
}): void {
  const subject = input.queue.subject;
  if (!subject || subject.type !== 'social_content_task') fail('social_content_orchestrator_subject_invalid', 400);
  const task = socialTaskSummary(input.record);
  if (task.taskId !== subject.id) fail('social_content_orchestrator_subject_invalid', 400);
  if (task.version !== subject.version) fail('social_content_task_version_conflict', 409);
  if (!STARTABLE_STATUSES.has(task.status)) fail('social_content_task_not_startable', 409);
  if (input.sources.length !== task.sourceCount) fail('social_content_source_integrity_violation', 503);
  if (input.sources.some(source => !socialText(source.sourceId))
    || subject.sourceRefs.some(source => !source || !socialText(source.id))
    || subject.packageSelection.some(item => !item || !socialText(item.kind)
      || !socialText(item.packageKey) || !socialText(item.version))) {
    fail('social_content_orchestrator_lineage_invalid', 409);
  }
  const readiness = socialTaskReadiness(task.brief, {
    total: input.sources.length,
    knowledge: input.sources.filter(source => ['knowledge', 'text_note'].includes(source.kind)).length,
    material: input.sources.filter(source => ['material', 'reference_link'].includes(source.kind)).length,
  });
  if (!readiness.complete) fail('social_content_task_inputs_incomplete', 409);

  const expectedSources = normalizedSources(input.sources.map(source => ({
    id: source.sourceId,
    ...(source.sourceVersion ? { version: source.sourceVersion } : {}),
  })));
  const receivedSources = normalizedSources(subject.sourceRefs);
  if (new Set(receivedSources.map(source => `${source.id}\u0000${source.version}`)).size !== receivedSources.length
    || !exactJson(receivedSources, expectedSources)) {
    fail('social_content_orchestrator_source_lineage_invalid', 409);
  }

  const expectedPackages = normalizedPackages(task.packageSelection);
  const receivedPackages = normalizedPackages(subject.packageSelection);
  if (receivedPackages.length !== 3
    || new Set(receivedPackages.map(item => item.kind)).size !== 3
    || !exactJson(receivedPackages, expectedPackages)) {
    fail('social_content_orchestrator_package_lineage_invalid', 409);
  }
  if (subject.conversionObjective !== Boolean(task.brief.callToAction)) {
    fail('social_content_orchestrator_objective_lineage_invalid', 409);
  }
}

function manualResult(input: SocialQueueInput): Starter198OrchestratorQueueResult {
  return {
    queueItemId: queueItemId(input),
    disposition: 'requires_manual_production',
    missingFacts: [],
    nextDestination: 'smartAssets',
    reasonCode: MANUAL_PRODUCTION_REASON,
  };
}

/**
 * Durable social-content admission path. It deliberately does not create a
 * workflow_run or the standard ten-node graph: that graph contains inquiry and
 * quotation work unrelated to a social-content order. Until a true package
 * executor exists, the honest terminal scheduling state is `attention`, which
 * remains editable and accepts real artifacts from the existing content studio.
 */
export async function scheduleSocialContentWork(input: {
  repository: Starter198Repository;
  queue: SocialQueueInput;
  now: Date;
}): Promise<Starter198OrchestratorQueueResult> {
  const subject = input.queue.subject;
  if (!subject || subject.type !== 'social_content_task' || !socialText(subject.id)
    || !socialText(subject.version)
    || !Array.isArray(subject.sourceRefs)
    || !Array.isArray(subject.packageSelection)
    || typeof subject.conversionObjective !== 'boolean') {
    fail('social_content_orchestrator_subject_invalid', 400);
  }
  return withSocialContentSubjectLease({
    repository: input.repository,
    tenantId: input.queue.tenantId,
    subjectId: subject.id,
    action: async () => {
      await requireStartOperation(input);
      const access = await input.repository.access(input.queue.tenantId);
      try {
        assertStarter198AccessCycleOpen({ access, now: input.now });
      } catch (error) {
        if (error instanceof Starter198QuotaError) fail(error.code, error.status);
        throw error;
      }
      const manifest = buildStarter198CapabilityManifest(access, input.now);
      if (!starter198CapabilityAllowed(manifest, 'orchestrator.command.submit')
        || !starter198CapabilityAllowed(manifest, 'workflow.standard.run')) {
        fail('social_content_not_entitled', 403);
      }

      let record: StarterRecord;
      try {
        record = await requireSocialTask({
          repository: input.repository,
          tenantId: input.queue.tenantId,
          taskId: subject.id,
        });
      } catch (error) {
        if (error instanceof SocialContentWorkflowError) fail(error.code, error.status);
        throw error;
      }
      const result = manualResult(input.queue);
      if (socialText(record.last_operation_id) === input.queue.commandId) {
        if (socialText(record.orchestrator_item_id) !== result.queueItemId
          || socialText(record.status) !== 'attention') {
          fail('social_content_schedule_state_integrity_violation', 503);
        }
        return result;
      }

      const sources = await activeSources({
        repository: input.repository,
        tenantId: input.queue.tenantId,
        taskId: subject.id,
      });
      assertSubjectMatches({ record, sources, queue: input.queue });
      try {
        await resolveSelectedPackages({
          repository: input.repository,
          selections: socialTaskSummary(record).packageSelection,
          now: input.now,
        });
      } catch (error) {
        if (error instanceof SocialContentWorkflowError) fail(error.code, error.status);
        throw error;
      }

      await assertSocialContentSubjectLease({
        repository: input.repository,
        tenantId: input.queue.tenantId,
        subjectId: subject.id,
      });
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.queue.tenantId, record.id, {
        status: 'attention',
        run_id: '',
        orchestrator_item_id: result.queueItemId,
        version: nextVersion(record),
        last_operation_id: input.queue.commandId,
        updated_by: input.queue.userId,
        updated_at: input.now.toISOString(),
      });
      const written = await requireSocialTask({
        repository: input.repository,
        tenantId: input.queue.tenantId,
        taskId: subject.id,
      });
      if (socialText(written.status) !== 'attention'
        || socialText(written.last_operation_id) !== input.queue.commandId
        || socialText(written.orchestrator_item_id) !== result.queueItemId) {
        fail('social_content_schedule_state_integrity_violation', 503);
      }
      return result;
    },
  });
}
