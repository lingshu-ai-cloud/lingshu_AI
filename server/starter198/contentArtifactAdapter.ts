import type { DataStore } from '../storage/datastore.js';
import {
  DIGITAL_EMPLOYEE_CONTENT_TASK_KEYS,
  requireIndexedContentProjectLineage,
} from '../digitalEmployees/contentProjectLineage.js';
import {
  readCanonicalStarterContentArtifact,
  StarterPublicationPackageWorkerError,
} from './publicationPackageArtifact.js';
import { buildStarterContentQualityBinding } from './contentApprovalBridge.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import { integer, object, stableHash, text } from './orchestratorWorkerValues.js';

const STUDIO_COLLECTION = 'studio_projects';
const CONTENT_SCHEMA_VERSION = 3;
const QUALITY_RULE_VERSION = 9;
const MAX_INDEXED_QUERY_ROWS = 21;
const PRODUCTION_OUTPUT_SCHEMA = 'starter-198.content-production-adapter-output.v1' as const;
const REQUIRED_QUALITY_CHECKS = [
  'renderedFile',
  'visualContent',
  'groundedScript',
  'materialBound',
  'voiceAndSubtitles',
  'semanticAlignment',
  'routeDifferentiation',
  'internalMarkerFree',
  'subtitleSafe',
  'platformBriefApplied',
  'sceneDiversity',
] as const;

const NO_EFFECTS = Object.freeze({
  sourceReadOnly: true,
  providerCalls: 0,
  externalEffectsPerformed: false,
});

export interface StarterContentFrozenBinding {
  initializationId: string;
  inputVersion: string;
  factsVersion: string;
  policyVersion: string;
  entitlementSnapshotId: string;
  snapshotHash: string;
}

export interface StarterContentHandlerContext {
  dataStore: DataStore;
  repository: Starter198Repository;
  tenantId: string;
  run: StarterRecord;
  task: StarterRecord;
  frozen: StarterContentFrozenBinding & { maximumContentArtifacts: number };
  publishingRoot?: string;
}

export interface StarterContentArtifactEvidence {
  type: 'studio_project';
  contentId: string;
  contentVersion: number;
  sourceContentHash: string;
  publicationSubjectHash: string;
  platform: string;
  fileName: string;
  fileHash: string;
  assetHashes: string[];
  evidenceSnapshotHash: string;
  qualityRuleVersion: number;
  qualityReceiptHash: string;
  artifactBindingHash: string;
}

export interface StarterContentAdapterPrepared {
  status: 'succeeded' | 'waiting_external';
  output: Record<string, unknown>;
  blockedReason: string;
  runPauseReason: string;
}

export class StarterContentArtifactAdapterError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    this.name = 'StarterContentArtifactAdapterError';
  }
}

type Row = StarterRecord;

function versionHash(value: unknown): string {
  const candidate = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(candidate) ? candidate : '';
}

function validTimestamp(value: unknown): boolean {
  const candidate = text(value);
  return Boolean(candidate) && Number.isFinite(Date.parse(candidate));
}

function validIdentity(value: string): boolean {
  return Boolean(value) && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseRecordObject(value: unknown): Record<string, unknown> | null {
  return object(value);
}

function waitResult(input: {
  code: string;
  blockedReason: string;
  runPauseReason: string;
  observedArtifacts?: number;
}): StarterContentAdapterPrepared {
  return {
    status: 'waiting_external',
    blockedReason: input.blockedReason,
    runPauseReason: input.runPauseReason,
    output: {
      schemaVersion: 'starter-198.content-adapter-wait.v1',
      executionStatus: 'waiting_external',
      adapter: 'indexed_studio_artifact_read_v2',
      reasonCode: input.code,
      observedArtifacts: input.observedArtifacts ?? 0,
      ...NO_EFFECTS,
    },
  };
}

function artifactStillMaturing(row: Row): boolean {
  const spec = parseRecordObject(row.spec);
  const automation = parseRecordObject(spec?.automation);
  const quality = parseRecordObject(automation?.quality);
  if (!spec || !automation || text(automation.managedBy) !== 'digital_employee'
    || text(spec.source) === 'demo_data' || automation.synthetic === true) return false;
  return !['ready_for_approval', 'completed'].includes(text(row.status))
    || text(automation.stage) !== 'completed'
    || text(automation.status) !== 'ready_for_approval'
    || !text(automation.renderOutputPath)
    || quality?.passed !== true
    || integer(quality.ruleVersion) !== QUALITY_RULE_VERSION
    || (integer(quality.outputBytes) ?? 0) <= 0;
}

async function listIndexedTaskProjects(
  dataStore: DataStore,
  tenantId: string,
  runId: string,
  taskId: string,
): Promise<{ rows: Row[]; total: number }> {
  let result;
  try {
    result = await dataStore.list<Row>(STUDIO_COLLECTION, {
      where: {
        tenant_id: tenantId,
        workflow_run_id: runId,
        workflow_task_id: taskId,
      },
      sort: 'id',
      page: 1,
      perPage: MAX_INDEXED_QUERY_ROWS,
    });
  } catch {
    throw new StarterContentArtifactAdapterError('starter_content_source_unavailable', true);
  }
  const expectedRows = Math.min(result.totalItems, MAX_INDEXED_QUERY_ROWS);
  if (!Array.isArray(result.items)
    || !Number.isSafeInteger(result.totalItems) || result.totalItems < 0
    || !Number.isSafeInteger(result.totalPages) || result.totalPages < 0
    || result.totalPages !== Math.ceil(result.totalItems / MAX_INDEXED_QUERY_ROWS)
    || result.page !== 1 || result.perPage !== MAX_INDEXED_QUERY_ROWS
    || result.items.length !== expectedRows
    || new Set(result.items.map(row => text(row.id))).size !== result.items.length) {
    throw new StarterContentArtifactAdapterError('starter_content_source_integrity_violation');
  }
  for (const row of result.items) {
    let lineage;
    try { lineage = requireIndexedContentProjectLineage(row); }
    catch { throw new StarterContentArtifactAdapterError('starter_content_source_lineage_integrity_violation'); }
    if (!text(row.id) || lineage.tenantId !== tenantId || lineage.runId !== runId
      || lineage.taskId !== taskId || !DIGITAL_EMPLOYEE_CONTENT_TASK_KEYS.has(lineage.taskKey)) {
      throw new StarterContentArtifactAdapterError('starter_content_source_tenant_or_identity_violation');
    }
  }
  return { rows: result.items, total: result.totalItems };
}

function evidenceSnapshotHash(spec: Record<string, unknown>, automation: Record<string, unknown>): string {
  const snapshot = parseRecordObject(spec.evidenceSnapshot);
  const product = parseRecordObject(snapshot?.product);
  const storedHash = versionHash(snapshot?.hash);
  const automationHash = versionHash(automation.evidenceSnapshotHash);
  if (!snapshot || integer(snapshot.schemaVersion) !== CONTENT_SCHEMA_VERSION
    || !storedHash || storedHash !== automationHash) return '';
  const computed = stableHash({
    productId: text(product?.id),
    assets: Array.isArray(snapshot.assets) ? snapshot.assets : [],
    reference: snapshot.reference,
  });
  return computed === storedHash ? storedHash : '';
}

function qualityReceipt(input: {
  tenantId: string;
  runId: string;
  taskId: string;
  contentId: string;
  contentVersion: number;
  sourceContentHash: string;
  publicationSubjectHash: string;
  assetHashes: string[];
  automation: Record<string, unknown>;
}): { ruleVersion: number; receiptHash: string } | null {
  const quality = parseRecordObject(input.automation.quality);
  const checks = parseRecordObject(quality?.checks);
  const ruleVersion = integer(quality?.ruleVersion);
  const outputBytes = integer(quality?.outputBytes);
  const completedAt = Date.parse(text(input.automation.completedAt));
  const renderedAt = Date.parse(text(input.automation.renderedAt));
  if (!quality || quality.passed !== true || quality.synthetic === true
    || ruleVersion !== QUALITY_RULE_VERSION || outputBytes === null || outputBytes <= 0
    || !checks || REQUIRED_QUALITY_CHECKS.some(key => checks[key] !== true)
    || !validTimestamp(input.automation.completedAt)
    || !validTimestamp(input.automation.renderedAt)
    || renderedAt > completedAt) return null;
  const receipt = {
    schemaVersion: 'starter-198.content-quality-receipt-binding.v1',
    tenantId: input.tenantId,
    runId: input.runId,
    taskId: input.taskId,
    contentId: input.contentId,
    contentVersion: input.contentVersion,
    sourceContentHash: input.sourceContentHash,
    publicationSubjectHash: input.publicationSubjectHash,
    assetHashes: input.assetHashes,
    ruleVersion,
    outputBytes,
    completedAt: text(input.automation.completedAt),
    renderedAt: text(input.automation.renderedAt),
    checks: Object.fromEntries(REQUIRED_QUALITY_CHECKS.map(key => [key, true])),
  };
  return { ruleVersion, receiptHash: stableHash(receipt) };
}

async function verifyArtifact(input: {
  dataStore: DataStore;
  publishingRoot?: string;
  tenantId: string;
  runId: string;
  taskId: string;
  row: Row;
  frozen: StarterContentFrozenBinding;
}): Promise<StarterContentArtifactEvidence | null> {
  const spec = parseRecordObject(input.row.spec);
  const automation = parseRecordObject(spec?.automation);
  const contentVersion = integer(automation?.contentVersion);
  const sourceContentHash = versionHash(automation?.contentHash);
  const snapshotHash = spec && automation ? evidenceSnapshotHash(spec, automation) : '';
  if (!spec || !automation
    || text(spec.workflowRunId) !== input.runId
    || text(spec.workflowTaskId) !== input.taskId
    || !DIGITAL_EMPLOYEE_CONTENT_TASK_KEYS.has(text(spec.workflowTaskKey))
    || text(automation.managedBy) !== 'digital_employee'
    || integer(automation.schemaVersion) !== CONTENT_SCHEMA_VERSION
    || text(automation.stage) !== 'completed'
    || !['ready_for_approval', 'completed'].includes(text(input.row.status))
    || text(spec.source) === 'demo_data' || automation.synthetic === true
    || contentVersion === null || contentVersion <= 0
    || !sourceContentHash || !snapshotHash) return null;

  let canonical;
  try {
    canonical = await readCanonicalStarterContentArtifact({
      tenantId: input.tenantId,
      runId: input.runId,
      contentId: input.row.id,
      dataStore: input.dataStore,
      ...(input.publishingRoot ? { publishingRoot: input.publishingRoot } : {}),
    });
  } catch (error) {
    if (error instanceof StarterPublicationPackageWorkerError) return null;
    throw new StarterContentArtifactAdapterError('starter_content_artifact_read_unavailable', true);
  }
  const assetHashes = canonical.subject.assets.map(asset => versionHash(asset.contentHash));
  if (assetHashes.length !== 1 || assetHashes.some(hash => !hash)
    || canonical.subject.contentVersion !== String(contentVersion)
    || canonical.subject.sourceContentHash !== sourceContentHash) return null;
  const receipt = qualityReceipt({
    tenantId: input.tenantId,
    runId: input.runId,
    taskId: input.taskId,
    contentId: input.row.id,
    contentVersion,
    sourceContentHash,
    publicationSubjectHash: canonical.subject.contentHash,
    assetHashes,
    automation,
  });
  if (!receipt) return null;
  const evidence = {
    type: 'studio_project' as const,
    contentId: input.row.id,
    contentVersion,
    sourceContentHash,
    publicationSubjectHash: canonical.subject.contentHash,
    platform: canonical.subject.platform,
    fileName: canonical.subject.assets[0]!.fileName,
    fileHash: assetHashes[0]!,
    assetHashes,
    evidenceSnapshotHash: snapshotHash,
    qualityRuleVersion: receipt.ruleVersion,
    qualityReceiptHash: receipt.receiptHash,
  };
  return {
    ...evidence,
    artifactBindingHash: stableHash({
      schemaVersion: 'starter-198.content-artifact-binding.v1',
      tenantId: input.tenantId,
      runId: input.runId,
      taskId: input.taskId,
      frozen: input.frozen,
      evidence,
    }),
  };
}

async function currentArtifactSet(input: {
  dataStore: DataStore;
  publishingRoot?: string;
  tenantId: string;
  runId: string;
  taskId: string;
  maximumArtifacts: number;
  frozen: StarterContentFrozenBinding;
}): Promise<
  | { state: 'ready'; artifacts: StarterContentArtifactEvidence[] }
  | { state: 'waiting'; result: StarterContentAdapterPrepared }
> {
  if (!validIdentity(input.tenantId) || !validIdentity(input.runId) || !validIdentity(input.taskId)
    || !Number.isSafeInteger(input.maximumArtifacts) || input.maximumArtifacts < 0 || input.maximumArtifacts > 20) {
    throw new StarterContentArtifactAdapterError('starter_content_adapter_scope_invalid');
  }
  const listed = await listIndexedTaskProjects(
    input.dataStore,
    input.tenantId,
    input.runId,
    input.taskId,
  );
  const taskScoped = listed.rows;
  if (!listed.total) {
    return { state: 'waiting', result: waitResult({
      code: 'tenant_content_pipeline_not_connected',
      blockedReason: '当前任务尚无带数据库索引的精确内容产物绑定；starter worker 未调用 legacy 模型、配音或渲染服务。',
      runPauseReason: '灵小图等待内部内容生产能力写入与本轮 run/task 精确绑定的真实成片；未生成模拟内容。',
    }) };
  }
  if (input.maximumArtifacts <= 0 || listed.total > input.maximumArtifacts) {
    return { state: 'waiting', result: waitResult({
      code: 'tenant_content_artifact_limit_exceeded',
      blockedReason: '本轮绑定作品数量超过 198 标准版内容配额，未自动选择或丢弃作品。',
      runPauseReason: '灵小图等待内部团队明确本轮标准版作品集合。',
      observedArtifacts: listed.total,
    }) };
  }
  if (taskScoped.length !== 1) {
    return { state: 'waiting', result: waitResult({
      code: 'tenant_content_canonical_subject_ambiguous',
      blockedReason: '本轮存在多个内容项目，单一内容审批与发布包不能安全自动选择其中一个。',
      runPauseReason: '灵小图等待内部团队将本轮首发与优化稿收口为一个当前 canonical 版本。',
      observedArtifacts: taskScoped.length,
    }) };
  }
  if (artifactStillMaturing(taskScoped[0]!)) {
    return { state: 'waiting', result: waitResult({
      code: 'tenant_content_artifact_not_ready',
      blockedReason: '本轮精确绑定内容仍在生产或现行质检中，尚未达到可复核状态。',
      runPauseReason: '灵小图等待真实成片达到可复核状态；未把草稿标记为完成。',
      observedArtifacts: taskScoped.length,
    }) };
  }
  const verified = await Promise.all(taskScoped.map(row => verifyArtifact({ ...input, row })));
  if (verified.some(item => !item)) {
    return { state: 'waiting', result: waitResult({
      code: 'tenant_content_artifact_not_verifiable',
      blockedReason: '本轮内容尚未形成可核验的现行版本成片：需同时满足来源快照、内容哈希、质检规则与租户文件证据。',
      runPauseReason: '灵小图等待真实成片及现行质检证据；未把草稿、旧质检或缺失文件标记为完成。',
      observedArtifacts: taskScoped.length,
    }) };
  }
  return {
    state: 'ready',
    artifacts: (verified as StarterContentArtifactEvidence[])
      .sort((left, right) => left.contentId.localeCompare(right.contentId)),
  };
}

function productionSetHash(input: {
  tenantId: string;
  runId: string;
  task: Row;
  frozen: StarterContentFrozenBinding;
  artifacts: StarterContentArtifactEvidence[];
}): string {
  return stableHash({
    schemaVersion: PRODUCTION_OUTPUT_SCHEMA,
    tenantId: input.tenantId,
    runId: input.runId,
    taskId: input.task.id,
    taskVersion: integer(input.task.task_version),
    correctionVersion: integer(input.task.correction_version),
    frozen: input.frozen,
    artifacts: input.artifacts,
  });
}

export async function prepareStarterContentProductionAdapter(input: {
  dataStore: DataStore;
  publishingRoot?: string;
  tenantId: string;
  runId: string;
  task: Row;
  maximumArtifacts: number;
  frozen: StarterContentFrozenBinding;
}): Promise<StarterContentAdapterPrepared> {
  const current = await currentArtifactSet({
    ...input,
    taskId: input.task.id,
  });
  if (current.state === 'waiting') return current.result;
  const artifactSetHash = productionSetHash({ ...input, artifacts: current.artifacts });
  return {
    status: 'succeeded',
    blockedReason: '',
    runPauseReason: '灵小图已核验租户内真实成片及版本证据；没有调用模型、发布接口或生成新内容。',
    output: {
      schemaVersion: PRODUCTION_OUTPUT_SCHEMA,
      executionStatus: 'completed',
      adapter: 'indexed_studio_artifact_read_v2',
      runId: input.runId,
      taskId: input.task.id,
      factsVersion: input.frozen.factsVersion,
      policyVersion: input.frozen.policyVersion,
      artifacts: current.artifacts,
      artifactSetHash,
      observedArtifactCount: current.artifacts.length,
      ...NO_EFFECTS,
    },
  };
}

export async function prepareStarterContentQualityAdapter(input: {
  dataStore: DataStore;
  publishingRoot?: string;
  tenantId: string;
  runId: string;
  qualityTask: Row;
  productionTask: Row;
  maximumArtifacts: number;
  frozen: StarterContentFrozenBinding;
}): Promise<StarterContentAdapterPrepared> {
  const productionOutput = parseRecordObject(input.productionTask.output);
  const recordedArtifacts = Array.isArray(productionOutput?.artifacts)
    ? productionOutput.artifacts
    : [];
  const expectedSetHash = productionSetHash({
    tenantId: input.tenantId,
    runId: input.runId,
    task: input.productionTask,
    frozen: input.frozen,
    artifacts: recordedArtifacts as StarterContentArtifactEvidence[],
  });
  if (text(input.productionTask.status) !== 'succeeded'
    || productionOutput?.schemaVersion !== PRODUCTION_OUTPUT_SCHEMA
    || text(productionOutput.runId) !== input.runId
    || text(productionOutput.taskId) !== input.productionTask.id
    || !recordedArtifacts.length
    || text(productionOutput.artifactSetHash) !== expectedSetHash) {
    throw new StarterContentArtifactAdapterError('starter_content_production_checkpoint_invalid');
  }
  const current = await currentArtifactSet({
    dataStore: input.dataStore,
    ...(input.publishingRoot ? { publishingRoot: input.publishingRoot } : {}),
    tenantId: input.tenantId,
    runId: input.runId,
    taskId: input.productionTask.id,
    maximumArtifacts: input.maximumArtifacts,
    frozen: input.frozen,
  });
  if (current.state === 'waiting') return current.result;
  if (stableHash(current.artifacts) !== stableHash(recordedArtifacts)) {
    return waitResult({
      code: 'tenant_content_artifact_changed_after_production',
      blockedReason: '内容生产检查点之后作品版本或文件证据已变化，旧质检结果不再有效。',
      runPauseReason: '灵小图等待重新绑定当前成片版本；未沿用过期质检。',
      observedArtifacts: current.artifacts.length,
    });
  }
  let canonical;
  try {
    canonical = await readCanonicalStarterContentArtifact({
      tenantId: input.tenantId,
      runId: input.runId,
      contentId: current.artifacts[0]!.contentId,
      dataStore: input.dataStore,
      ...(input.publishingRoot ? { publishingRoot: input.publishingRoot } : {}),
    });
  } catch {
    return waitResult({
      code: 'tenant_content_artifact_changed_after_production',
      blockedReason: '质检绑定前无法重新读取当前 canonical 成片，旧检查点不能用于审批。',
      runPauseReason: '灵小图等待当前内容文件恢复并重新核验；未沿用旧文件哈希。',
      observedArtifacts: current.artifacts.length,
    });
  }
  const observed = current.artifacts[0]!;
  const canonicalAsset = canonical.subject.assets[0];
  if (!canonicalAsset
    || canonical.subject.contentVersion !== String(observed.contentVersion)
    || canonical.subject.sourceContentHash !== observed.sourceContentHash
    || canonical.subject.contentHash !== observed.publicationSubjectHash
    || canonical.subject.platform !== observed.platform
    || canonicalAsset.fileName !== observed.fileName
    || canonicalAsset.contentHash !== observed.fileHash) {
    return waitResult({
      code: 'tenant_content_artifact_changed_after_production',
      blockedReason: '质检绑定时成片版本或文件哈希发生变化，旧检查点不再有效。',
      runPauseReason: '灵小图等待重新绑定当前成片版本；未沿用过期质检。',
      observedArtifacts: current.artifacts.length,
    });
  }
  const qualityBinding = buildStarterContentQualityBinding({
    tenantId: input.tenantId,
    runId: input.runId,
    qualityTaskId: input.qualityTask.id,
    qualityTaskVersion: String(integer(input.qualityTask.task_version) ?? ''),
    artifact: canonical,
  });
  const receiptBindingHash = stableHash({
    frozen: input.frozen,
    productionArtifactSetHash: expectedSetHash,
    qualityReceiptHash: observed.qualityReceiptHash,
    artifactBindingHash: observed.artifactBindingHash,
    approvalBindingHash: qualityBinding.bindingHash,
  });
  return {
    status: 'succeeded',
    blockedReason: '',
    runPauseReason: '灵小图已复核当前成片版本、来源快照、文件哈希与现行质检回执；等待后续人工审批。',
    output: {
      ...qualityBinding,
      adapter: 'indexed_studio_artifact_read_v2',
      taskId: input.qualityTask.id,
      factsVersion: input.frozen.factsVersion,
      policyVersion: input.frozen.policyVersion,
      productionTaskId: input.productionTask.id,
      productionArtifactSetHash: expectedSetHash,
      artifactCount: current.artifacts.length,
      receiptBindingHash,
      receipts: current.artifacts.map(artifact => ({
        contentId: artifact.contentId,
        contentVersion: artifact.contentVersion,
        qualityRuleVersion: artifact.qualityRuleVersion,
        qualityReceiptHash: artifact.qualityReceiptHash,
        artifactBindingHash: artifact.artifactBindingHash,
      })),
      ...NO_EFFECTS,
    },
  };
}

function handlerFailure(error: unknown): StarterContentAdapterPrepared {
  const code = error instanceof StarterContentArtifactAdapterError
    ? error.code
    : 'starter_content_adapter_unexpected_failure';
  return waitResult({
    code,
    blockedReason: `内容产物安全适配未通过（${code}）；未生成或伪造内容。`,
    runPauseReason: '灵小图等待租户内可核验的内容产物；没有调用模型、渲染或发布服务。',
  });
}

function frozenBinding(
  value: StarterContentHandlerContext['frozen'],
): StarterContentFrozenBinding {
  return {
    initializationId: value.initializationId,
    inputVersion: value.inputVersion,
    factsVersion: value.factsVersion,
    policyVersion: value.policyVersion,
    entitlementSnapshotId: value.entitlementSnapshotId,
    snapshotHash: value.snapshotHash,
  };
}

function bindWaitingTaskIdentity(
  result: StarterContentAdapterPrepared,
  context: StarterContentHandlerContext,
): StarterContentAdapterPrepared {
  return result.status !== 'waiting_external' ? result : {
    ...result,
    output: {
      ...result.output,
      runId: context.run.id,
      taskId: context.task.id,
      taskKey: text(context.task.task_key),
    },
  };
}

export async function prepareStarterContentProductionHandler(
  context: StarterContentHandlerContext,
): Promise<StarterContentAdapterPrepared> {
  try {
    return bindWaitingTaskIdentity(await prepareStarterContentProductionAdapter({
      dataStore: context.dataStore,
      ...(context.publishingRoot ? { publishingRoot: context.publishingRoot } : {}),
      tenantId: context.tenantId,
      runId: context.run.id,
      task: context.task,
      maximumArtifacts: context.frozen.maximumContentArtifacts,
      frozen: frozenBinding(context.frozen),
    }), context);
  } catch (error) {
    return bindWaitingTaskIdentity(handlerFailure(error), context);
  }
}

export async function prepareStarterContentQualityHandler(
  context: StarterContentHandlerContext,
): Promise<StarterContentAdapterPrepared> {
  try {
    const tasks = await context.repository.list(STARTER_COLLECTIONS.tasks, context.tenantId, {
      where: { run_id: context.run.id }, perPage: 20,
    });
    const production = tasks.items.filter(task => text(task.task_key) === 'starter_content_production');
    if (tasks.totalItems !== tasks.items.length || production.length !== 1) {
      throw new StarterContentArtifactAdapterError('starter_content_production_task_integrity_violation');
    }
    return bindWaitingTaskIdentity(await prepareStarterContentQualityAdapter({
      dataStore: context.dataStore,
      ...(context.publishingRoot ? { publishingRoot: context.publishingRoot } : {}),
      tenantId: context.tenantId,
      runId: context.run.id,
      qualityTask: context.task,
      productionTask: production[0]!,
      maximumArtifacts: context.frozen.maximumContentArtifacts,
      frozen: frozenBinding(context.frozen),
    }), context);
  } catch (error) {
    return bindWaitingTaskIdentity(handlerFailure(error), context);
  }
}
