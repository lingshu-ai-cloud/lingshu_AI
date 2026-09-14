import type { Starter198Capability, StarterAgentRole } from '../../shared/contracts/starter198.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { readStarterProductionModel } from './productionReadModel.js';
import { createStarter198Repository, STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { reserveStarterUsage, settleStarterUsage } from './usageLedger.js';
import { starterWorkerRuntimeIssue } from './workerRuntime.js';
import { starterWorkerDataStore } from './workerStorage.js';
import { clamp, integer, object, queueInputHash, stableHash, stringArray, text } from './orchestratorWorkerValues.js';
import {
  prepareStarterContentProductionHandler,
  prepareStarterContentQualityHandler,
} from './contentArtifactAdapter.js';
import {
  prepareStarterInquiryIntakeHandler,
  prepareStarterQuoteDraftHandler,
} from './salesArtifactAdapter.js';
import { executeStarterContentApprovalBridge } from './orchestratorApprovalHandler.js';
import { prepareStarterResultSummaryHandler } from './resultSummary.js';
import {
  Starter198RunMutationLeaseError,
  withStarter198RunMutationLease,
} from './runMutationLease.js';
import {
  acquireStarterOrchestratorLease,
  assertStarterOrchestratorLease,
  releaseStarterOrchestratorLease,
  Starter198OrchestratorWorkerError,
  type StarterOrchestratorLease,
} from './orchestratorLease.js';
export { Starter198OrchestratorWorkerError } from './orchestratorLease.js';
const STARTER_PROFILE = 'starter_198';
const STARTER_RUN_STATUSES = new Set(['queued', 'running']);
let preferRunningOnNextScan = false;
const MUTABLE_RUN_STATUSES = new Set([...STARTER_RUN_STATUSES, 'waiting_external']);
const HANDLER_VERSION = 1;
const ZERO_UNITS = Object.freeze({ contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 });
const NO_EFFECTS = Object.freeze({ providerCalls: 0, externalEffectsPerformed: false });
const READ_ONLY = Object.freeze({ sourceReadOnly: true, ...NO_EFFECTS });
export const STARTER_198_ORCHESTRATOR_TASK_KEYS = [
  'starter_context_snapshot', 'starter_content_research', 'starter_content_production',
  'starter_content_quality_gate', 'starter_content_release_approval', 'starter_publication_package',
  'starter_publication_evidence', 'starter_inquiry_intake', 'starter_quote_draft', 'starter_result_summary',
] as const;
export type Starter198OrchestratorTaskKey = typeof STARTER_198_ORCHESTRATOR_TASK_KEYS[number];
const CANONICAL_GRAPH: Record<Starter198OrchestratorTaskKey, readonly string[]> = {
  starter_context_snapshot: [], starter_content_research: ['starter_context_snapshot'],
  starter_content_production: ['starter_content_research'], starter_content_quality_gate: ['starter_content_production'],
  starter_content_release_approval: ['starter_content_quality_gate'], starter_publication_package: ['starter_content_release_approval'],
  starter_publication_evidence: ['starter_publication_package'], starter_inquiry_intake: ['starter_context_snapshot'],
  starter_quote_draft: ['starter_inquiry_intake'],
  starter_result_summary: ['starter_publication_evidence', 'starter_quote_draft'],
};
const CANONICAL_CAPABILITY: Record<Starter198OrchestratorTaskKey, Starter198Capability> = {
  starter_context_snapshot: 'workflow.standard.run', starter_content_research: 'production_site.read',
  starter_content_production: 'workflow.standard.run', starter_content_quality_gate: 'workflow.standard.run',
  starter_content_release_approval: 'orchestrator.decision.resolve', starter_publication_package: 'publishing.package.generate',
  starter_publication_evidence: 'publishing.evidence.submit', starter_inquiry_intake: 'quotation.calculate',
  starter_quote_draft: 'quotation.calculate', starter_result_summary: 'workflow.standard.run',
};
type Row = StarterRecord;
type HandlerMode = 'implemented_zero_cost' | 'registered_wait' | 'approval_bridge' | 'external_projection';
type TaskTerminalStatus = 'succeeded' | 'waiting_external';
interface FrozenStarterContext {
  initializationId: string; inputVersion: string; factsVersion: string; policyVersion: string;
  entitlementSnapshotId: string; configVersion: number; primaryPlatform: string; primaryLanguage: string;
  snapshotHash: string; evidence: Array<{ type: string; id: string; version: string }>;
  maximumContentArtifacts: number;
}
interface PreparedTaskResult { status: TaskTerminalStatus; output: Record<string, unknown>; blockedReason: string; runPauseReason: string }
interface HandlerContext { dataStore: DataStore; repository: Starter198Repository; tenantId: string; run: Row; task: Row; now: Date; frozen: FrozenStarterContext; publishingRoot?: string }
interface HandlerRegistration {
  mode: HandlerMode; agentRole: StarterAgentRole; executionMode: 'internal' | 'observe' | 'draft_executor' | 'approval';
  externalEffect: 'none' | 'draft'; meteredCapability?: Starter198Capability; waitReason?: string;
  prepare: (context: HandlerContext) => Promise<PreparedTaskResult>;
}
interface PreparedCheckpoint { schemaVersion: 'starter-198.orchestrator-worker-checkpoint.v1'; handlerKey: Starter198OrchestratorTaskKey; handlerVersion: number; attemptVersion: string; prepared: PreparedTaskResult; preparedHash: string; usageReservationId: string }
export interface Starter198OrchestratorWorkerDependencies { dataStore?: DataStore; repository?: Starter198Repository; now?: () => Date; workerId?: string; leaseDurationMs?: number; minimumCommitWindowMs?: number; leaseReclaimGraceMs?: number; publishingRoot?: string }
export type Starter198OrchestratorRunOutcome = {
  state: 'advanced' | 'no_progress' | 'ignored' | 'lease_busy' | 'fenced_out' | 'blocked';
  runId: string; processed: number; succeeded: number; waiting: number; failed: number; code?: string;
};
export interface Starter198OrchestratorWorkerCycleResult { scanned: number; advanced: number; ignored: number; leaseBusy: number; blocked: number; errors: Array<{ tenantId: string; runId: string; code: string }> }
interface ResolvedDependencies { dataStore: DataStore; repository: Starter198Repository; now: () => Date; workerId: string; leaseDurationMs: number; minimumCommitWindowMs: number; leaseReclaimGraceMs: number; publishingRoot?: string }
function workerDependencies(input: Starter198OrchestratorWorkerDependencies): ResolvedDependencies {
  const dataStore = starterWorkerDataStore(input.dataStore ?? store);
  const leaseDurationMs = clamp(input.leaseDurationMs, 120_000, 30_000, 300_000);
  const minimumCommitWindowMs = clamp(
    input.minimumCommitWindowMs,
    5_000,
    1_000,
    Math.min(30_000, leaseDurationMs - 1_000),
  );
  const leaseReclaimGraceMs = Math.max(
    minimumCommitWindowMs,
    clamp(input.leaseReclaimGraceMs, 30_000, 5_000, 300_000),
  );
  return {
    dataStore,
    repository: input.repository ?? createStarter198Repository(dataStore),
    now: input.now ?? (() => new Date()),
    workerId: text(input.workerId) || `${process.pid}`,
    leaseDurationMs,
    minimumCommitWindowMs,
    leaseReclaimGraceMs,
    ...(input.publishingRoot ? { publishingRoot: input.publishingRoot } : {}),
  };
}
function taskAttemptVersion(task: Row): string {
  return `${integer(task.task_version) ?? 0}:${integer(task.correction_version) ?? 0}`;
}
function usageIdentity(input: {
  tenantId: string; runId: string; task: Row; key: Starter198OrchestratorTaskKey; frozen: FrozenStarterContext;
}): string {
  return stableHash({
    tenantId: input.tenantId,
    runId: input.runId,
    taskId: input.task.id,
    taskKey: input.key,
    attemptVersion: taskAttemptVersion(input.task),
    handlerVersion: HANDLER_VERSION,
    factsVersion: input.frozen.factsVersion,
    policyVersion: input.frozen.policyVersion,
    entitlementSnapshotId: input.frozen.entitlementSnapshotId,
  }).slice(0, 40);
}
async function readFrozenContext(input: {
  dataStore: DataStore; repository: Starter198Repository; tenantId: string; run: Row;
}): Promise<FrozenStarterContext> {
  const context = object(input.run.starter_context);
  if (!context || context.schemaVersion !== 'starter-198.run-initialization.v1') {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_context_invalid');
  }
  const initializationId = text(context.initializationId);
  const rawInput = text(context.input);
  const inputVersion = text(context.inputVersion);
  const factsVersion = text(context.factsVersion);
  const policyVersion = text(context.policyVersion);
  const entitlementSnapshotId = text(context.entitlementSnapshotId);
  const goalId = text(context.goalId);
  const planId = text(context.planId);
  const runId = text(context.runId);
  const primaryPlatform = text(context.primaryPlatform);
  const primaryLanguage = text(context.primaryLanguage);
  const configVersion = integer(context.configVersion);
  const config = object(context.config);
  const knowledgeBinding = object(context.knowledgeBinding);
  if (!initializationId || !rawInput || !inputVersion || !factsVersion || !policyVersion
    || !entitlementSnapshotId || !goalId || !planId || runId !== input.run.id
    || !primaryPlatform || !primaryLanguage || !configVersion || !config || !knowledgeBinding
    || text(input.run.tenant_id) !== input.tenantId
    || text(input.run.product_profile) !== STARTER_PROFILE
    || text(input.run.starter_initialization_id) !== initializationId
    || text(input.run.goal_id) !== goalId || text(input.run.plan_id) !== planId
    || inputVersion !== queueInputHash(rawInput)
    || text(knowledgeBinding.factsVersion) !== factsVersion) {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_context_integrity_violation');
  }
  if (config.allowRealPublishing !== false || config.allowRealCustomerMessages !== false
    || config.allowGeneratedVisuals !== false
    || !Array.isArray(config.publishingTargets) || config.publishingTargets.length !== 0) {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_external_effect_policy_invalid');
  }
  const [access, goal, planRecord] = await Promise.all([
    input.repository.access(input.tenantId),
    input.dataStore.getById<Row>('weekly_goals', goalId),
    input.dataStore.getById<Row>('weekly_plans', planId),
  ]);
  if (!goal || !planRecord) {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_context_storage_unavailable', true);
  }
  const plan = object(planRecord.plan);
  if (access.entitlementSnapshotId !== entitlementSnapshotId
    || text(goal.tenant_id) !== input.tenantId || text(planRecord.tenant_id) !== input.tenantId
    || text(planRecord.goal_id) !== goalId || !plan
    || plan.schemaVersion !== 'starter-198.standard-plan.v1'
    || integer(plan.planVersion) !== 1
    || text(plan.initializationId) !== initializationId
    || text(plan.inputVersion) !== inputVersion
    || text(plan.factsVersion || context.factsVersion) !== factsVersion
    || text(plan.policyVersion) !== policyVersion
    || text(plan.entitlementSnapshotId) !== entitlementSnapshotId
    || integer(plan.configVersion) !== configVersion
    || text(plan.primaryPlatform) !== primaryPlatform
    || text(plan.primaryLanguage) !== primaryLanguage
    || plan.publicationMode !== 'self_service_package'
    || plan.officialApiPublishingAllowed !== false
    || plan.paidAdsAllowed !== false
    || plan.quotationMode !== 'deterministic_draft_with_human_approval') {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_plan_integrity_violation');
  }
  const snapshotValue = {
    initializationId, inputVersion, factsVersion, policyVersion, entitlementSnapshotId,
    configVersion, primaryPlatform, primaryLanguage,
    config, knowledgeBinding,
    maximumContentArtifacts: Math.min(20, Math.floor(access.resourceLimits.contentArtifactCountPerCycle)),
  };
  return {
    initializationId,
    inputVersion,
    factsVersion,
    policyVersion,
    entitlementSnapshotId,
    configVersion,
    primaryPlatform,
    primaryLanguage,
    maximumContentArtifacts: snapshotValue.maximumContentArtifacts,
    snapshotHash: stableHash(snapshotValue),
    evidence: [
      { type: 'workflow_run', id: input.run.id, version: initializationId },
      { type: 'weekly_goal', id: goalId, version: text(goal.updated_at) || text(goal.created_at) || '1' },
      { type: 'weekly_plan', id: planId, version: `${integer(plan.planVersion) ?? 1}` },
    ],
  };
}

async function prepareContextSnapshot(context: HandlerContext): Promise<PreparedTaskResult> {
  return {
    status: 'succeeded',
    blockedReason: '',
    runPauseReason: '灵小枢已核验本轮冻结事实、策略与预算；专用执行器继续处理安全任务。',
    output: {
      schemaVersion: 'starter-198.context-snapshot-output.v1', executionStatus: 'completed',
      snapshotHash: context.frozen.snapshotHash, initializationId: context.frozen.initializationId,
      inputVersion: context.frozen.inputVersion, factsVersion: context.frozen.factsVersion,
      policyVersion: context.frozen.policyVersion, entitlementSnapshotId: context.frozen.entitlementSnapshotId,
      configVersion: context.frozen.configVersion, primaryPlatform: context.frozen.primaryPlatform,
      primaryLanguage: context.frozen.primaryLanguage,
      maximumContentArtifacts: context.frozen.maximumContentArtifacts,
      evidence: context.frozen.evidence, ...READ_ONLY,
    },
  };
}
function researchWait(input: {
  missingFact: string; blockedReason: string; runPauseReason: string; truncated?: boolean;
}): PreparedTaskResult {
  return {
    status: 'waiting_external', blockedReason: input.blockedReason, runPauseReason: input.runPauseReason,
    output: {
      schemaVersion: 'starter-198.content-research-wait.v1', executionStatus: 'waiting_external',
      missingFacts: [input.missingFact], ...(input.truncated === undefined ? {} : { sourceTruncated: input.truncated }),
      ...READ_ONLY,
    },
  };
}
async function prepareContentResearch(context: HandlerContext): Promise<PreparedTaskResult> {
  const readModel = await readStarterProductionModel(context.tenantId, context.dataStore);
  if (!readModel.inspiration.available) {
    return researchWait({
      missingFact: 'tenant_scoped_inspiration_source_unavailable',
      blockedReason: '租户内灵感数据源暂不可用；未生成或臆造内容方向。',
      runPauseReason: '灵小图等待租户内可读取的灵感证据；未调用模型、未生成内容。',
    });
  }
  const candidates = readModel.inspiration.items
    .filter(item => Boolean(item.id && item.evidence && (item.summary || item.title))
      && ['analyzed', 'completed', 'ready'].includes(item.status.toLowerCase()))
    .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || '') || left.id.localeCompare(right.id))
    .slice(0, 20)
    .map(item => ({
      sourceType: 'trend_video', sourceId: item.id, title: item.title, summary: item.summary,
      evidence: item.evidence, sourceStatus: item.status, sourceUpdatedAt: item.updatedAt,
      evidenceHash: stableHash(item),
    }));
  if (!candidates.length) {
    return researchWait({
      missingFact: 'tenant_scoped_analyzed_inspiration_evidence',
      blockedReason: '尚无带来源且已完成分析的租户灵感证据；未生成或臆造内容方向。',
      runPauseReason: '灵小图等待有来源的已分析灵感；未调用模型、未生成内容。',
      truncated: readModel.inspiration.truncated,
    });
  }
  return {
    status: 'succeeded',
    blockedReason: '',
    runPauseReason: '灵小图已从租户内现有证据形成候选方向；尚未生成内容或执行外部动作。',
    output: {
      schemaVersion: 'starter-198.content-research-output.v1', executionStatus: 'completed',
      factsVersion: context.frozen.factsVersion, candidates,
      researchHash: stableHash({ factsVersion: context.frozen.factsVersion, candidates }),
      sourceTruncated: readModel.inspiration.truncated, ...READ_ONLY,
    },
  };
}
function zeroCost(
  agentRole: StarterAgentRole,
  executionMode: HandlerRegistration['executionMode'],
  capability: Starter198Capability,
  prepare: HandlerRegistration['prepare'],
  externalEffect: HandlerRegistration['externalEffect'] = 'none',
): HandlerRegistration {
  return { mode: 'implemented_zero_cost', agentRole, executionMode, externalEffect, meteredCapability: capability, prepare };
}
function waitHandler(
  agentRole: StarterAgentRole,
  executionMode: HandlerRegistration['executionMode'],
  externalEffect: HandlerRegistration['externalEffect'],
  reason: string,
): HandlerRegistration {
  return {
    mode: 'registered_wait', agentRole, executionMode, externalEffect, waitReason: reason,
    prepare: async context => ({
      status: 'waiting_external', blockedReason: reason, runPauseReason: reason,
      output: {
        schemaVersion: 'starter-198.registered-handler-wait.v1', executionStatus: 'waiting_external',
        taskKey: text(context.task.task_key), handlerRegistered: true, implementationAvailable: false,
        reason, meteringState: 'not_started', providerCalls: 0, externalEffectsPerformed: false,
      },
    }),
  };
}
function delegatedHandler(
  mode: Extract<HandlerMode, 'approval_bridge' | 'external_projection'>,
  agentRole: StarterAgentRole,
  executionMode: HandlerRegistration['executionMode'],
  externalEffect: HandlerRegistration['externalEffect'],
  reason: string,
): HandlerRegistration {
  return { ...waitHandler(agentRole, executionMode, externalEffect, reason), mode };
}
export const STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY = Object.freeze({
  starter_context_snapshot: zeroCost('orchestrator', 'internal', 'workflow.standard.run', prepareContextSnapshot),
  starter_content_research: zeroCost('content', 'observe', 'production_site.read', prepareContentResearch),
  starter_content_production: zeroCost('content', 'draft_executor', 'workflow.standard.run', prepareStarterContentProductionHandler, 'draft'),
  starter_content_quality_gate: zeroCost('content', 'observe', 'workflow.standard.run', prepareStarterContentQualityHandler),
  starter_content_release_approval: delegatedHandler('approval_bridge', 'content', 'approval', 'none', '等待 canonical 内容审批桥接。'),
  starter_publication_package: delegatedHandler('external_projection', 'traffic', 'internal', 'draft', '由发布包 Worker 投影；编排 Worker 不写此节点。'),
  starter_publication_evidence: delegatedHandler('external_projection', 'traffic', 'observe', 'none', '由发布包或证据 Worker 投影；编排 Worker 不写此节点。'),
  starter_inquiry_intake: zeroCost('sales', 'observe', 'quotation.calculate', prepareStarterInquiryIntakeHandler),
  starter_quote_draft: zeroCost('sales', 'internal', 'quotation.calculate', prepareStarterQuoteDraftHandler, 'draft'),
  starter_result_summary: zeroCost('orchestrator', 'internal', 'workflow.standard.run', prepareStarterResultSummaryHandler),
} satisfies Record<Starter198OrchestratorTaskKey, HandlerRegistration>);
function handlerFor(key: string): HandlerRegistration | null {
  return Object.prototype.hasOwnProperty.call(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY, key)
    ? STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY[key as Starter198OrchestratorTaskKey]
    : null;
}
interface FencedPatchInput { dependencies: ResolvedDependencies; lease: StarterOrchestratorLease; tenantId: string; runId: string; taskId: string; allowedStatuses: string[]; status: string; output: Record<string, unknown>; blockedReason: string; runPauseReason: string; stopRun?: boolean; completeRun?: boolean; runController?: 'agent' | 'human' | 'system' }
interface TaskExecutionInput { dependencies: ResolvedDependencies; tenantId: string; run: Row; task: Row }
async function fencedTaskPatch(input: FencedPatchInput): Promise<void> {
  const { dependencies, lease } = input;
  return withStarter198RunMutationLease({
    tenantId: input.tenantId, runId: input.runId, dataStore: dependencies.dataStore,
    action: async () => {
    await assertStarterOrchestratorLease(dependencies, lease);
    const runBeforeTaskWrite = await dependencies.repository.get(
      STARTER_COLLECTIONS.runs,
      input.tenantId,
      input.runId,
    );
    if (!runBeforeTaskWrite
      || text(runBeforeTaskWrite.product_profile) !== STARTER_PROFILE
      || !MUTABLE_RUN_STATUSES.has(text(runBeforeTaskWrite.status))) {
      throw new Starter198OrchestratorWorkerError('starter_orchestrator_run_changed', true);
    }
    const currentTask = await dependencies.repository.get(STARTER_COLLECTIONS.tasks, input.tenantId, input.taskId);
    if (!currentTask || text(currentTask.run_id) !== input.runId
      || !input.allowedStatuses.includes(text(currentTask.status))) {
      throw new Starter198OrchestratorWorkerError('starter_orchestrator_task_changed', true);
    }
    const fence = stableHash(lease.lease_token).slice(0, 24);
    const output = { ...input.output, executionFence: fence };
    // The shared run lease closes cross-worker lifecycle races. Task + run are
    // still separate writes, so replay must idempotently repair a crash between them.
    await dependencies.repository.update(STARTER_COLLECTIONS.tasks, input.tenantId, input.taskId, {
      status: input.status,
      output,
      blocked_reason: input.blockedReason,
      updated_at: dependencies.now().toISOString(),
    });
    await assertStarterOrchestratorLease(dependencies, lease);
    const written = await dependencies.repository.get(STARTER_COLLECTIONS.tasks, input.tenantId, input.taskId);
    if (!written || text(written.status) !== input.status || object(written.output)?.executionFence !== fence) {
      throw new Starter198OrchestratorWorkerError('starter_orchestrator_fenced_write_lost', true);
    }
    const currentRun = await dependencies.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
    if (!currentRun || text(currentRun.product_profile) !== STARTER_PROFILE
      || !MUTABLE_RUN_STATUSES.has(text(currentRun.status))) {
      throw new Starter198OrchestratorWorkerError('starter_orchestrator_run_changed', true);
    }
    await assertStarterOrchestratorLease(dependencies, lease);
    await dependencies.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, input.runId, {
      status: input.completeRun ? 'succeeded' : input.stopRun ? 'waiting_human' : input.status === 'waiting_external' ? 'waiting_external' : 'running',
      current_controller: input.completeRun ? 'system' : input.runController ?? (input.stopRun ? 'human' : 'agent'),
      pause_reason: input.runPauseReason,
      ...(input.completeRun ? { completed_at: dependencies.now().toISOString() } : {}),
    });
    await assertStarterOrchestratorLease(dependencies, lease);
    },
  });
}
function parseCheckpoint(input: {
  task: Row; key: Starter198OrchestratorTaskKey; expectedReservationId?: string;
}): PreparedCheckpoint | null {
  const value = object(input.task.output);
  const prepared = object(value?.prepared);
  if (!value || value.schemaVersion !== 'starter-198.orchestrator-worker-checkpoint.v1'
    || text(value.handlerKey) !== input.key || integer(value.handlerVersion) !== HANDLER_VERSION
    || text(value.attemptVersion) !== taskAttemptVersion(input.task)
    || !prepared || !['succeeded', 'waiting_external'].includes(text(prepared.status))
    || !object(prepared.output) || typeof prepared.blockedReason !== 'string'
    || typeof prepared.runPauseReason !== 'string'
    || text(value.preparedHash) !== stableHash(prepared)
    || !text(value.usageReservationId)
    || (input.expectedReservationId && text(value.usageReservationId) !== input.expectedReservationId)) {
    return null;
  }
  return value as unknown as PreparedCheckpoint;
}
async function executeZeroCostHandler(input: TaskExecutionInput & {
  lease: StarterOrchestratorLease; key: Starter198OrchestratorTaskKey; handler: HandlerRegistration;
}): Promise<'succeeded' | 'waiting'> {
  const frozen = await readFrozenContext({ dataStore: input.dependencies.dataStore,
    repository: input.dependencies.repository, tenantId: input.tenantId, run: input.run });
  const identity = usageIdentity({ tenantId: input.tenantId, runId: input.run.id, task: input.task, key: input.key, frozen });
  const reserveKey = `starter-worker-reserve:${identity}`;
  const terminalKey = `starter-worker-terminal:${identity}`;
  let checkpoint = text(input.task.status) === 'running'
    ? parseCheckpoint({ task: input.task, key: input.key })
    : null;
  if (text(input.task.status) === 'running' && !checkpoint) {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_checkpoint_invalid');
  }
  await assertStarterOrchestratorLease(input.dependencies, input.lease);
  const reservation = await reserveStarterUsage({
    tenantId: input.tenantId, runId: input.run.id, taskId: input.task.id,
    agentRole: input.handler.agentRole, capability: input.handler.meteredCapability!, idempotencyKey: reserveKey,
    cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
    resourceUnits: ZERO_UNITS, repository: input.dependencies.repository, now: input.dependencies.now(),
  });
  if (reservation.state === 'failed' || (!reservation.executable && reservation.state !== 'settled')) {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_usage_reservation_closed');
  }
  if (checkpoint && checkpoint.usageReservationId !== reservation.reservationId) {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_checkpoint_usage_conflict');
  }
  if (!checkpoint) {
    const prepared = await input.handler.prepare({
      dataStore: input.dependencies.dataStore, repository: input.dependencies.repository,
      tenantId: input.tenantId, run: input.run, task: input.task, now: input.dependencies.now(), frozen,
      ...(input.dependencies.publishingRoot ? { publishingRoot: input.dependencies.publishingRoot } : {}),
    });
    checkpoint = {
      schemaVersion: 'starter-198.orchestrator-worker-checkpoint.v1', handlerKey: input.key,
      handlerVersion: HANDLER_VERSION, attemptVersion: taskAttemptVersion(input.task), prepared,
      preparedHash: stableHash(prepared), usageReservationId: reservation.reservationId,
    };
    await fencedTaskPatch({
      dependencies: input.dependencies, lease: input.lease, tenantId: input.tenantId,
      runId: input.run.id, taskId: input.task.id, allowedStatuses: ['pending'], status: 'running',
      output: checkpoint as unknown as Record<string, unknown>,
      blockedReason: '', runPauseReason: `${text(input.task.title) || input.key} 已形成只读检查点，正在结算零成本用量。`,
    });
  }
  await assertStarterOrchestratorLease(input.dependencies, input.lease);
  await settleStarterUsage({
    tenantId: input.tenantId, reservationId: reservation.reservationId, idempotencyKey: terminalKey,
    tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
    cost: { status: 'known', settledCostCny: 0 }, outputCount: 0, resourceUnits: ZERO_UNITS,
    repository: input.dependencies.repository, now: input.dependencies.now(),
  });
  await fencedTaskPatch({
    dependencies: input.dependencies, lease: input.lease, tenantId: input.tenantId,
    runId: input.run.id, taskId: input.task.id, allowedStatuses: ['running'], status: checkpoint.prepared.status,
    output: {
      ...checkpoint.prepared.output,
      metering: {
        capability: input.handler.meteredCapability, reservationId: reservation.reservationId,
        tokenStatus: 'known', inputTokens: 0, outputTokens: 0, cacheTokens: 0, settledCostCny: 0,
      },
    },
    blockedReason: checkpoint.prepared.blockedReason, runPauseReason: checkpoint.prepared.runPauseReason,
    completeRun: input.key === 'starter_result_summary' && checkpoint.prepared.status === 'succeeded',
    ...(checkpoint.prepared.status === 'waiting_external' ? { runController: 'system' as const } : {}),
  });
  return checkpoint.prepared.status === 'succeeded' ? 'succeeded' : 'waiting';
}
async function failTask(input: Omit<TaskExecutionInput, 'run'> & {
  lease: StarterOrchestratorLease; runId: string; task: Row; code: string;
}): Promise<void> {
  await fencedTaskPatch({
    dependencies: input.dependencies, lease: input.lease, tenantId: input.tenantId,
    runId: input.runId, taskId: input.task.id, allowedStatuses: [text(input.task.status)], status: 'failed',
    output: {
      schemaVersion: 'starter-198.orchestrator-worker-failure.v1', executionStatus: 'failed',
      anomalyCode: input.code, ...NO_EFFECTS,
    },
    blockedReason: input.code, runPauseReason: `198 专用工作图完整性检查失败：${input.code}`, stopRun: true,
  });
}
async function consumeTask(input: TaskExecutionInput & {
  failureCode?: string;
}): Promise<'succeeded' | 'waiting' | 'failed' | 'lease_busy' | 'fenced_out'> {
    let lease: Awaited<ReturnType<typeof acquireStarterOrchestratorLease>>;
    try {
      lease = await acquireStarterOrchestratorLease({ dependencies: input.dependencies, tenantId: input.tenantId, taskId: input.task.id });
    } catch (error) {
      if (error instanceof Starter198OrchestratorWorkerError
        && (error.code.includes('lease_claim_lost') || error.code.includes('lease_integrity'))) {
        return 'fenced_out';
      }
      throw error;
    }
    if (!lease) return 'lease_busy';
    try {
      if (input.failureCode) {
        await failTask({
          dependencies: input.dependencies, lease, tenantId: input.tenantId, runId: input.run.id,
          task: input.task, code: input.failureCode,
        });
        return 'failed';
      }
      const key = text(input.task.task_key);
      const handler = handlerFor(key);
      if (!handler) {
        await failTask({
          dependencies: input.dependencies, lease, tenantId: input.tenantId, runId: input.run.id,
          task: input.task, code: 'starter_orchestrator_unknown_task_key',
        });
        return 'failed';
      }
      if (text(input.task.agent_role) !== handler.agentRole
        || text(input.task.execution_mode) !== handler.executionMode
        || text(input.task.external_effect) !== handler.externalEffect) {
        await failTask({
          dependencies: input.dependencies, lease, tenantId: input.tenantId, runId: input.run.id,
          task: input.task, code: 'starter_orchestrator_task_contract_mismatch',
        });
        return 'failed';
      }
      if (handler.mode === 'approval_bridge') {
        await readFrozenContext({
          dataStore: input.dependencies.dataStore, repository: input.dependencies.repository,
          tenantId: input.tenantId, run: input.run,
        });
        await withStarter198RunMutationLease({
          tenantId: input.tenantId, runId: input.run.id, dataStore: input.dependencies.dataStore,
          action: () => executeStarterContentApprovalBridge({
            dataStore: input.dependencies.dataStore, repository: input.dependencies.repository,
            tenantId: input.tenantId, runId: input.run.id, approvalTaskId: input.task.id,
            leaseToken: lease.lease_token,
            assertLease: () => assertStarterOrchestratorLease(input.dependencies, lease),
            now: input.dependencies.now,
            ...(input.dependencies.publishingRoot ? { publishingRoot: input.dependencies.publishingRoot } : {}),
          }),
        });
        return 'waiting';
      }
      if (handler.mode === 'external_projection') {
        throw new Starter198OrchestratorWorkerError('starter_orchestrator_projection_task_claim_forbidden');
      }
      if (handler.mode === 'registered_wait') {
        const frozen = await readFrozenContext({
          dataStore: input.dependencies.dataStore, repository: input.dependencies.repository,
          tenantId: input.tenantId, run: input.run,
        });
        const prepared = await handler.prepare({
          dataStore: input.dependencies.dataStore, repository: input.dependencies.repository,
          tenantId: input.tenantId, run: input.run, task: input.task, now: input.dependencies.now(), frozen,
          ...(input.dependencies.publishingRoot ? { publishingRoot: input.dependencies.publishingRoot } : {}),
        });
        await fencedTaskPatch({
          dependencies: input.dependencies, lease, tenantId: input.tenantId, runId: input.run.id,
          taskId: input.task.id, allowedStatuses: ['pending', 'running'], status: 'waiting_external',
          output: prepared.output, blockedReason: prepared.blockedReason, runPauseReason: prepared.runPauseReason,
          runController: 'system',
        });
        return 'waiting';
      }
      return await executeZeroCostHandler({
        dependencies: input.dependencies, lease, tenantId: input.tenantId, run: input.run,
        task: input.task, key: key as Starter198OrchestratorTaskKey, handler,
      });
    } catch (error) {
      if (error instanceof Starter198RunMutationLeaseError) {
        if (error.code === 'starter_run_mutation_busy') return 'lease_busy';
        throw new Starter198OrchestratorWorkerError(error.code, true);
      }
      if (error instanceof Starter198OrchestratorWorkerError) {
        if (error.code.includes('fence') || error.code.includes('lease_claim_lost')) return 'fenced_out';
        if (!error.retryable) {
          try {
            await failTask({
              dependencies: input.dependencies, lease, tenantId: input.tenantId, runId: input.run.id,
              task: input.task, code: error.code,
            });
            return 'failed';
          } catch (failureError) {
            if (failureError instanceof Starter198RunMutationLeaseError) {
              if (failureError.code === 'starter_run_mutation_busy') return 'lease_busy';
              throw new Starter198OrchestratorWorkerError(failureError.code, true);
            }
            if (failureError instanceof Starter198OrchestratorWorkerError
              && failureError.code.includes('fence')) return 'fenced_out';
            throw failureError;
          }
        }
      }
      throw error;
    } finally {
      await releaseStarterOrchestratorLease(input.dependencies.dataStore, lease);
    }
}
function graphProblem(tasks: Row[]): { task: Row; code: string } | null {
  const byKey = new Map<string, Row>();
  for (const task of tasks) {
    const key = text(task.task_key);
    if (!key || byKey.has(key)) return { task, code: 'starter_orchestrator_task_key_duplicate_or_missing' };
    byKey.set(key, task);
  }
  const fallback = tasks[0];
  if (tasks.length !== STARTER_198_ORCHESTRATOR_TASK_KEYS.length || !fallback) {
    return fallback ? { task: fallback, code: 'starter_orchestrator_task_set_incomplete' } : null;
  }
  for (const [index, key] of STARTER_198_ORCHESTRATOR_TASK_KEYS.entries()) {
    const task = byKey.get(key);
    const dependencies = stringArray(task?.depends_on);
    const handler = handlerFor(key);
    if (!task || !dependencies || integer(task.sequence) !== index + 1
      || stableHash(dependencies) !== stableHash(CANONICAL_GRAPH[key])
      || text(task.capability_key) !== CANONICAL_CAPABILITY[key]
      || integer(task.task_version) === null || (integer(task.task_version) ?? 0) < 1
      || integer(task.correction_version) === null
      || text(task.agent_role) !== handler?.agentRole || text(task.execution_mode) !== handler.executionMode
      || text(task.external_effect) !== handler.externalEffect
      || task.automatic_execution_allowed !== (key !== 'starter_content_release_approval')) {
      return { task: task ?? fallback, code: 'starter_orchestrator_dependency_graph_invalid' };
    }
  }
  return null;
}
function readyTask(tasks: Row[], excluded = new Set<string>()): Row | null {
  const byKey = new Map(tasks.map(task => [text(task.task_key), task]));
  return [...tasks]
    .filter(task => ['pending', 'running'].includes(text(task.status)))
    .filter(task => handlerFor(text(task.task_key))?.mode !== 'external_projection')
    .filter(task => !excluded.has(task.id))
    .filter(task => (stringArray(task.depends_on) ?? []).every(key => ['succeeded', 'skipped'].includes(text(byKey.get(key)?.status))))
    .sort((left, right) => (integer(left.sequence) ?? 999) - (integer(right.sequence) ?? 999) || left.id.localeCompare(right.id))[0] ?? null;
}
async function listRunTasks(repository: Starter198Repository, tenantId: string, runId: string): Promise<Row[]> {
  const result = await repository.list(STARTER_COLLECTIONS.tasks, tenantId, {
    where: { run_id: runId }, sort: 'sequence', perPage: 500,
  });
  if (!Array.isArray(result.items) || result.totalItems > result.items.length
    || result.items.some(task => text(task.run_id) !== runId)) {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_task_list_incomplete', true);
  }
  return result.items;
}
export async function consumeStarter198OrchestratorRun(input: {
  tenantId: string;
  runId: string;
  dependencies?: Starter198OrchestratorWorkerDependencies;
}): Promise<Starter198OrchestratorRunOutcome> {
  const dependencies = workerDependencies(input.dependencies ?? {});
  const run = await dependencies.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
  if (!run || text(run.tenant_id) !== input.tenantId || text(run.product_profile) !== STARTER_PROFILE
    || !STARTER_RUN_STATUSES.has(text(run.status))) {
    return { state: 'ignored', runId: input.runId, processed: 0, succeeded: 0, waiting: 0, failed: 0 };
  }
  let tasks = await listRunTasks(dependencies.repository, input.tenantId, input.runId);
  if (!tasks.length) return { state: 'blocked', runId: input.runId, processed: 0, succeeded: 0,
    waiting: 0, failed: 0, code: 'starter_orchestrator_task_set_incomplete' };
  const unknown = tasks.find(task => !handlerFor(text(task.task_key)));
  const problem = unknown ? { task: unknown, code: 'starter_orchestrator_unknown_task_key' } : graphProblem(tasks);
  if (problem) {
    const outcome = await consumeTask({
      dependencies, tenantId: input.tenantId, run, task: problem.task, failureCode: problem.code,
    });
    return {
      state: outcome === 'lease_busy' ? 'lease_busy' : outcome === 'fenced_out' ? 'fenced_out' : 'blocked',
      runId: input.runId,
      processed: outcome === 'lease_busy' ? 0 : 1,
      succeeded: 0,
      waiting: 0,
      failed: outcome === 'failed' ? 1 : 0,
      code: problem.code,
    };
  }
  let processed = 0;
  let succeeded = 0;
  let waiting = 0;
  let failed = 0;
  let leaseBusy = false;
  const busyTaskIds = new Set<string>();
  for (let index = 0; index < Math.min(tasks.length, 50); index += 1) {
    const candidate = readyTask(tasks, busyTaskIds);
    if (!candidate) break;
    const outcome = await consumeTask({ dependencies, tenantId: input.tenantId, run, task: candidate });
    if (outcome === 'lease_busy') { leaseBusy = true; busyTaskIds.add(candidate.id); continue; }
    if (outcome === 'fenced_out') {
      return { state: 'fenced_out', runId: input.runId, processed, succeeded, waiting, failed, code: 'starter_orchestrator_fence_lost' };
    }
    processed += 1;
    if (outcome === 'succeeded') succeeded += 1;
    else if (outcome === 'waiting') waiting += 1;
    else failed += 1;
    if (outcome === 'failed') break;
    // The approval bridge moves the run to waiting_approval. Stop this pass so
    // an independent branch cannot continue with the stale pre-approval run
    // snapshot and overwrite the human-control transition.
    if (outcome === 'waiting' && text(candidate.task_key) === 'starter_content_release_approval') break;
    tasks = await listRunTasks(dependencies.repository, input.tenantId, input.runId);
  }
  return {
    state: failed ? 'blocked' : processed ? 'advanced' : leaseBusy ? 'lease_busy' : 'no_progress',
    runId: input.runId,
    processed,
    succeeded,
    waiting,
    failed,
  };
}
export async function runStarter198OrchestratorWorkerCycle(input: {
  maxRuns?: number;
  dependencies?: Starter198OrchestratorWorkerDependencies;
} = {}): Promise<Starter198OrchestratorWorkerCycleResult> {
  const dependencies = workerDependencies(input.dependencies ?? {});
  const maxRuns = clamp(input.maxRuns, 20, 1, 100);
  const statuses = preferRunningOnNextScan ? ['running', 'queued'] : ['queued', 'running'];
  preferRunningOnNextScan = !preferRunningOnNextScan;
  const pages = await Promise.all(statuses.map(status => dependencies.dataStore.list<Row>(STARTER_COLLECTIONS.runs, {
    where: { product_profile: STARTER_PROFILE, status }, sort: 'started_at', page: 1, perPage: maxRuns,
  })));
  if (pages.some(page => !Array.isArray(page.items) || !Number.isFinite(page.totalItems))) {
    throw new Starter198OrchestratorWorkerError('starter_orchestrator_run_scan_invalid', true);
  }
  const primaryLimit = Math.ceil(maxRuns / 2);
  const runs = [...pages[0].items.slice(0, primaryLimit), ...pages[1].items.slice(0, maxRuns - primaryLimit)];
  for (const run of pages.flatMap(page => page.items)) {
    if (runs.length < maxRuns && !runs.some(selected => selected.id === run.id)) runs.push(run);
  }
  const cycle: Starter198OrchestratorWorkerCycleResult = {
    scanned: 0, advanced: 0, ignored: 0, leaseBusy: 0, blocked: 0, errors: [],
  };
  for (const run of runs) {
    const tenantId = text(run.tenant_id);
    if (!tenantId || text(run.product_profile) !== STARTER_PROFILE || !STARTER_RUN_STATUSES.has(text(run.status))) {
      cycle.ignored += 1;
      continue;
    }
    cycle.scanned += 1;
    try {
      const outcome = await consumeStarter198OrchestratorRun({ tenantId, runId: run.id, dependencies });
      if (outcome.state === 'advanced') cycle.advanced += 1;
      else if (outcome.state === 'lease_busy' || outcome.state === 'fenced_out') cycle.leaseBusy += 1;
      else if (outcome.state === 'blocked') cycle.blocked += 1;
      else cycle.ignored += 1;
    } catch (error) {
      cycle.errors.push({
        tenantId,
        runId: run.id,
        code: error instanceof Starter198OrchestratorWorkerError ? error.code : 'starter_orchestrator_worker_unexpected_error',
      });
    }
  }
  return cycle;
}
let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerCycleRunning = false;
async function guardedWorkerCycle(): Promise<void> {
  if (workerCycleRunning) return;
  workerCycleRunning = true;
  try {
    const maxRuns = clamp(Number(process.env.STARTER_198_ORCHESTRATOR_WORKER_MAX_RUNS), 20, 1, 100);
    const result = await runStarter198OrchestratorWorkerCycle({ maxRuns });
    if (result.advanced || result.blocked) {
      console.log(`[starter-198-orchestrator-worker] advanced=${result.advanced} blocked=${result.blocked}`);
    }
    if (result.errors.length) {
      console.error(`[starter-198-orchestrator-worker] errors=${result.errors.length} codes=${result.errors.map(error => error.code).join(',')}`);
    }
  } catch (error) {
    console.error('[starter-198-orchestrator-worker] cycle failed:', error instanceof Error ? error.message : error);
  } finally {
    workerCycleRunning = false;
  }
}
export function initStarter198OrchestratorWorker(): void {
  const runtimeIssue = starterWorkerRuntimeIssue('STARTER_198_ORCHESTRATOR_WORKER_ENABLED');
  if (runtimeIssue || workerTimer) {
    if (runtimeIssue && runtimeIssue !== 'not_explicitly_enabled') {
      console.error(`[starter-198-orchestrator-worker] not started: ${runtimeIssue}`);
    }
    return;
  }
  const intervalMs = clamp(Number(process.env.STARTER_198_ORCHESTRATOR_WORKER_INTERVAL_MS), 30_000, 10_000, 15 * 60_000);
  void guardedWorkerCycle();
  workerTimer = setInterval(() => { void guardedWorkerCycle(); }, intervalMs);
  workerTimer.unref?.();
}
export function stopStarter198OrchestratorWorker(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
