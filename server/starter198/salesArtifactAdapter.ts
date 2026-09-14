import { evidenceHash } from '../quotation/canonical.js';
import type { ListResult } from '../storage/datastore.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import {
  STARTER_QUOTE_DRAFT_SCHEMA,
  STARTER_QUOTE_INQUIRY_SCHEMA,
  starterQuoteDraftLineageValid,
  starterQuoteInquiryLineageHash,
  starterQuoteInquiryRequestHash,
  starterQuoteInquiryStorageFields,
  starterQuoteWorkflowBindingForRun,
  type StarterQuoteInquiryIdentity,
  type StarterQuoteInquiryLineage,
  type StarterQuoteWorkflowBinding,
} from './quoteLineage.js';
import { integer, object, stableHash, text } from './orchestratorWorkerValues.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const INQUIRY_ID_PATTERN = /^inq_[a-f0-9]{24}$/;
const INQUIRY_VERSION_PATTERN = /^v_[a-f0-9]{16}$/;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,79}$/;
const SOURCE_CHANNELS = new Set(['manual', 'whatsapp', 'email', 'trade_show', 'other']);
const CURRENT_DRAFT_STATUSES = new Set(['draft_ready', 'exception_pending', 'approved', 'returned']);
const OBSOLETE_DRAFT_STATUSES = new Set(['superseded', 'expired']);
const MAX_DRAFT_VERSIONS_PER_TASK = 20;
const ZERO_USAGE = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheTokens: 0,
  costCny: 0,
});
const NO_EFFECTS = Object.freeze({
  sourceReadOnly: true,
  providerCalls: 0,
  externalEffectsPerformed: false,
  externalMessageSent: false,
  usageObservation: ZERO_USAGE,
});

export interface StarterSalesFrozenBinding {
  initializationId: string;
  inputVersion: string;
  entitlementSnapshotId: string;
}

export interface StarterSalesHandlerContext {
  repository: Starter198Repository;
  tenantId: string;
  run: StarterRecord;
  task: StarterRecord;
  frozen: StarterSalesFrozenBinding;
}

export interface StarterSalesAdapterPrepared {
  status: 'succeeded' | 'waiting_external';
  output: Record<string, unknown>;
  blockedReason: string;
  runPauseReason: string;
}

type InquiryEvidence = {
  row: StarterRecord;
  identity: StarterQuoteInquiryIdentity;
  lineage: StarterQuoteInquiryLineage;
  binding: StarterQuoteWorkflowBinding;
  publicValue: Record<string, unknown>;
};

type InquiryRead =
  | { state: 'ready'; evidence: InquiryEvidence }
  | { state: 'waiting'; prepared: StarterSalesAdapterPrepared };

function waitResult(input: {
  taskKey: 'starter_inquiry_intake' | 'starter_quote_draft';
  code: string;
  blockedReason: string;
  runPauseReason: string;
  observedRecords?: number;
}): StarterSalesAdapterPrepared {
  return {
    status: 'waiting_external',
    blockedReason: input.blockedReason,
    runPauseReason: input.runPauseReason,
    output: {
      schemaVersion: 'starter-198.sales-artifact-adapter-wait.v1',
      executionStatus: 'waiting_external',
      taskKey: input.taskKey,
      adapter: 'indexed_quote_lineage_observer_v1',
      reasonCode: input.code,
      observedRecords: input.observedRecords ?? 0,
      ...NO_EFFECTS,
    },
  };
}

function validTimestampWithinCycle(value: unknown, binding: StarterQuoteWorkflowBinding, access: {
  cycleStartedAt: string;
  cycleEndsAt: string;
}): boolean {
  const timestamp = Date.parse(text(value));
  const start = Date.parse(access.cycleStartedAt);
  const end = Date.parse(access.cycleEndsAt);
  return binding.cycleId.startsWith('cycle:')
    && Number.isFinite(timestamp)
    && Number.isFinite(start)
    && Number.isFinite(end)
    && timestamp >= start
    && timestamp < end;
}

function completeResult<T>(result: ListResult<T>): boolean {
  return Array.isArray(result.items)
    && Number.isFinite(result.totalItems)
    && result.totalItems >= 0
    && result.totalItems === result.items.length;
}

async function expectedBinding(
  context: StarterSalesHandlerContext,
  expectedTaskKey: 'starter_inquiry_intake' | 'starter_quote_draft',
): Promise<{ binding: StarterQuoteWorkflowBinding; access: Awaited<ReturnType<Starter198Repository['access']>> } | null> {
  try {
    const access = await context.repository.access(context.tenantId);
    if (access.entitlementSnapshotId !== context.frozen.entitlementSnapshotId) return null;
    const binding = await starterQuoteWorkflowBindingForRun({
      repository: context.repository,
      tenantId: context.tenantId,
      access,
      run: context.run,
    });
    if (binding.initializationId !== context.frozen.initializationId
      || binding.inputVersion !== context.frozen.inputVersion
      || context.task.id !== (expectedTaskKey === 'starter_inquiry_intake'
        ? binding.inquiryTaskId
        : binding.quoteTaskId)
      || text(context.task.run_id) !== binding.runId
      || text(context.task.task_key) !== expectedTaskKey) return null;
    return { binding, access };
  } catch {
    return null;
  }
}

function inquiryIdentity(row: StarterRecord): StarterQuoteInquiryIdentity | null {
  const identity: StarterQuoteInquiryIdentity = {
    inquiryId: text(row.inquiry_id),
    inquiryVersion: text(row.inquiry_version),
    sourceChannel: text(row.source_channel),
    sourceReferenceHash: text(row.source_reference_hash),
    sku: text(row.sku),
    quantity: integer(row.quantity) ?? 0,
    destinationCountry: text(row.destination_country),
  };
  return INQUIRY_ID_PATTERN.test(identity.inquiryId)
    && INQUIRY_VERSION_PATTERN.test(identity.inquiryVersion)
    && SOURCE_CHANNELS.has(identity.sourceChannel)
    && HASH_PATTERN.test(identity.sourceReferenceHash)
    && SKU_PATTERN.test(identity.sku)
    && identity.quantity > 0
    && /^[A-Z]{2}$/.test(identity.destinationCountry)
    ? identity
    : null;
}

function verifiedInquiry(input: {
  row: StarterRecord;
  tenantId: string;
  binding: StarterQuoteWorkflowBinding;
  access: { cycleStartedAt: string; cycleEndsAt: string };
}): InquiryEvidence | null {
  const identity = inquiryIdentity(input.row);
  if (!identity
    || text(input.row.schema_version) !== STARTER_QUOTE_INQUIRY_SCHEMA
    || text(input.row.tenant_id) !== input.tenantId
    || text(input.row.status) !== 'received'
    || text(input.row.source_type) !== 'manual_structured'
    || input.row.test_record !== false
    || text(input.row.source_reference_hint) !== `${identity.sourceChannel}:${identity.sourceReferenceHash.slice(0, 10)}`
    || !text(input.row.created_by)
    || !text(input.row.idempotency_key)
    || !validTimestampWithinCycle(input.row.created_at, input.binding, input.access)) return null;
  const requestHash = starterQuoteInquiryRequestHash({ identity, binding: input.binding });
  const lineageHash = starterQuoteInquiryLineageHash({
    tenantId: input.tenantId,
    identity,
    requestHash,
    binding: input.binding,
  });
  const expectedFields = starterQuoteInquiryStorageFields({
    tenantId: input.tenantId,
    identity,
    requestHash,
    binding: input.binding,
  });
  if (text(input.row.request_hash) !== requestHash
    || text(input.row.lineage_hash) !== lineageHash
    || Object.entries(expectedFields).some(([key, value]) => input.row[key] !== value)) return null;
  const facts = {
    inquiryId: identity.inquiryId,
    inquiryVersion: identity.inquiryVersion,
    sourceChannel: identity.sourceChannel,
    sku: identity.sku,
    quantity: identity.quantity,
    destinationCountry: identity.destinationCountry,
  };
  const publicValue = {
    ...facts,
    factsHash: stableHash(facts),
    lineageHash,
    evidenceRef: `inquiry_${stableHash({
      tenantId: input.tenantId,
      recordId: input.row.id,
      lineageHash,
    }).slice(0, 24)}`,
  };
  return {
    row: input.row,
    identity,
    binding: input.binding,
    publicValue,
    lineage: {
      ...identity,
      tenantId: input.tenantId,
      requestHash,
      inquiryRecordId: input.row.id,
      lineageHash,
      binding: input.binding,
    },
  };
}

async function readCanonicalInquiry(context: StarterSalesHandlerContext): Promise<InquiryRead> {
  const resolved = await expectedBinding(context, 'starter_inquiry_intake');
  if (!resolved) {
    return { state: 'waiting', prepared: waitResult({
      taskKey: 'starter_inquiry_intake',
      code: 'quote_workflow_binding_invalid',
      blockedReason: '本轮询盘任务的运行、周期或冻结版本绑定不完整；未接收任何未绑定询盘。',
      runPauseReason: '灵小售等待可核验的本轮询盘任务绑定；未调用模型、未生成报价。',
    }) };
  }
  let result: ListResult<StarterRecord>;
  try {
    result = await context.repository.list(STARTER_COLLECTIONS.quoteInquiries, context.tenantId, {
      where: {
        run_id: resolved.binding.runId,
        cycle_id: resolved.binding.cycleId,
        workflow_task_id: resolved.binding.inquiryTaskId,
      },
      perPage: 2,
    });
  } catch {
    return { state: 'waiting', prepared: waitResult({
      taskKey: 'starter_inquiry_intake',
      code: 'quote_inquiry_indexed_query_unavailable',
      blockedReason: '本轮询盘索引查询暂不可用；未降级为全表扫描。',
      runPauseReason: '灵小售等待索引化询盘读取恢复；未调用模型、未生成报价。',
    }) };
  }
  if (!completeResult(result)) {
    return { state: 'waiting', prepared: waitResult({
      taskKey: 'starter_inquiry_intake',
      code: 'quote_inquiry_query_incomplete',
      blockedReason: '本轮询盘查询结果被截断或计数异常；拒绝选择不完整结果。',
      runPauseReason: '灵小售等待完整的本轮询盘查询结果；未调用模型、未生成报价。',
      observedRecords: result.items.length,
    }) };
  }
  if (result.items.length !== 1) {
    return { state: 'waiting', prepared: waitResult({
      taskKey: 'starter_inquiry_intake',
      code: result.items.length ? 'quote_inquiry_canonical_ambiguous' : 'quote_inquiry_not_received',
      blockedReason: result.items.length
        ? '本轮存在多个候选询盘，无法确定唯一 canonical；未自动挑选。'
        : '本轮尚未收到带完整运行血缘的真实结构化询盘。',
      runPauseReason: result.items.length
        ? '灵小售等待人工消除本轮询盘歧义；未调用模型、未生成报价。'
        : '灵小售等待用户提交本轮真实询盘；未调用模型、未生成报价。',
      observedRecords: result.items.length,
    }) };
  }
  const evidence = verifiedInquiry({
    row: result.items[0],
    tenantId: context.tenantId,
    binding: resolved.binding,
    access: resolved.access,
  });
  return evidence
    ? { state: 'ready', evidence }
    : { state: 'waiting', prepared: waitResult({
      taskKey: 'starter_inquiry_intake',
      code: text(result.items[0].status) === 'received'
        ? 'quote_inquiry_integrity_invalid'
        : 'quote_inquiry_status_not_mature',
      blockedReason: '本轮询盘状态或哈希血缘尚不可验证；未把未知记录当作真实输入。',
      runPauseReason: '灵小售等待询盘证据达到可验证状态；未调用模型、未生成报价。',
      observedRecords: 1,
    }) };
}

export async function prepareStarterInquiryIntakeAdapter(
  context: StarterSalesHandlerContext,
): Promise<StarterSalesAdapterPrepared> {
  const read = await readCanonicalInquiry(context);
  if (read.state === 'waiting') return read.prepared;
  const outputCore = {
    schemaVersion: 'starter-198.inquiry-intake-adapter-output.v1',
    executionStatus: 'completed',
    canonicalInquiry: read.evidence.publicValue,
    workflowBindingHash: stableHash({
      schemaVersion: read.evidence.binding.schemaVersion,
      runId: read.evidence.binding.runId,
      cycleId: read.evidence.binding.cycleId,
      inquiryTaskId: read.evidence.binding.inquiryTaskId,
    }),
    ...NO_EFFECTS,
  };
  return {
    status: 'succeeded',
    blockedReason: '',
    runPauseReason: '灵小售已核验本轮唯一真实询盘；仅整理必要字段，未调用模型、未对外回复。',
    output: { ...outputCore, outputHash: stableHash(outputCore) },
  };
}

function jsonArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function calculationHashValid(draft: StarterRecord): boolean {
  const calculation = object(draft.calculation);
  const inputValue = object(draft.input);
  if (!calculation || !inputValue) return false;
  const embeddedHash = text(calculation.calculationHash);
  const commercialTerms = Object.fromEntries(Object.entries(calculation)
    .filter(([key]) => key !== 'calculationHash'));
  return evidenceHash(inputValue) === text(draft.input_hash)
    && embeddedHash === text(draft.calculation_hash)
    && evidenceHash({
      inputHash: text(draft.input_hash),
      ruleSetHash: text(draft.rule_hash),
      commercialTerms,
    }) === embeddedHash;
}

function validDraft(input: {
  tenantId: string;
  draft: StarterRecord;
  inquiry: InquiryEvidence;
  access: { cycleStartedAt: string; cycleEndsAt: string };
}): boolean {
  const draft = input.draft;
  const quoteInput = object(draft.input);
  const exceptions = jsonArray(draft.exceptions);
  const status = text(draft.status);
  if (!quoteInput || !exceptions
    || text(draft.schema_version) !== STARTER_QUOTE_DRAFT_SCHEMA
    || text(draft.tenant_id) !== input.tenantId
    || !CURRENT_DRAFT_STATUSES.has(status)
    || text(draft.inquiry_id) !== input.inquiry.identity.inquiryId
    || text(draft.inquiry_version) !== input.inquiry.identity.inquiryVersion
    || text(quoteInput.inquiryId) !== input.inquiry.identity.inquiryId
    || text(quoteInput.inquiryVersion) !== input.inquiry.identity.inquiryVersion
    || text(quoteInput.sku) !== input.inquiry.identity.sku
    || integer(quoteInput.quantity) !== input.inquiry.identity.quantity
    || text(quoteInput.destinationCountry) !== input.inquiry.identity.destinationCountry
    || !HASH_PATTERN.test(text(draft.rule_hash))
    || !HASH_PATTERN.test(text(draft.input_hash))
    || !HASH_PATTERN.test(text(draft.calculation_hash))
    || !HASH_PATTERN.test(text(draft.request_hash))
    || !validTimestampWithinCycle(draft.created_at, input.inquiry.binding, input.access)
    || !calculationHashValid(draft)
    || !starterQuoteDraftLineageValid({
      tenantId: input.tenantId,
      draft,
      inquiry: input.inquiry.lineage,
    })) return false;
  if (status === 'draft_ready' && (exceptions.length !== 0 || draft.approval_valid === true)) return false;
  if (status === 'exception_pending' && (exceptions.length === 0 || draft.approval_valid === true
    || !text(draft.exception_request_id))) return false;
  if (status === 'approved' && (draft.approval_valid !== true || !text(draft.approval_evidence_id))) return false;
  if (status === 'returned' && (draft.approval_valid === true || !text(draft.approval_evidence_id))) return false;
  return true;
}

export async function prepareStarterQuoteDraftAdapter(
  context: StarterSalesHandlerContext,
): Promise<StarterSalesAdapterPrepared> {
  const resolved = await expectedBinding(context, 'starter_quote_draft');
  if (!resolved) return waitResult({
    taskKey: 'starter_quote_draft',
    code: 'quote_workflow_binding_invalid',
    blockedReason: '本轮报价任务的运行、周期或冻结版本绑定不完整；未采用未绑定草稿。',
    runPauseReason: '灵小售等待可核验的本轮报价任务绑定；未调用模型、未发送报价。',
  });
  const intakeTask = await context.repository.get(
    STARTER_COLLECTIONS.tasks,
    context.tenantId,
    resolved.binding.inquiryTaskId,
  );
  const intakeOutput = object(intakeTask?.output);
  const intakeOutputCore = intakeOutput ? {
    schemaVersion: intakeOutput.schemaVersion,
    executionStatus: intakeOutput.executionStatus,
    canonicalInquiry: intakeOutput.canonicalInquiry,
    workflowBindingHash: intakeOutput.workflowBindingHash,
    sourceReadOnly: intakeOutput.sourceReadOnly,
    providerCalls: intakeOutput.providerCalls,
    externalEffectsPerformed: intakeOutput.externalEffectsPerformed,
    externalMessageSent: intakeOutput.externalMessageSent,
    usageObservation: intakeOutput.usageObservation,
  } : null;
  if (!intakeTask
    || text(intakeTask.run_id) !== resolved.binding.runId
    || text(intakeTask.task_key) !== 'starter_inquiry_intake'
    || text(intakeTask.status) !== 'succeeded'
    || intakeOutput?.schemaVersion !== 'starter-198.inquiry-intake-adapter-output.v1'
    || !intakeOutputCore
    || text(intakeOutput.outputHash) !== stableHash(intakeOutputCore)) return waitResult({
    taskKey: 'starter_quote_draft',
    code: 'quote_draft_inquiry_checkpoint_not_ready',
    blockedReason: '本轮询盘节点尚未形成可验证的成功检查点；未采用任何报价草稿。',
    runPauseReason: '灵小售等待本轮询盘检查点完成；未调用模型、未发送报价。',
  });
  const inquiryContext: StarterSalesHandlerContext = {
    ...context,
    task: { ...context.task, id: resolved.binding.inquiryTaskId, task_key: 'starter_inquiry_intake' },
  };
  const inquiry = await readCanonicalInquiry(inquiryContext);
  if (inquiry.state === 'waiting') return waitResult({
    taskKey: 'starter_quote_draft',
    code: 'quote_draft_inquiry_lineage_not_ready',
    blockedReason: '本轮唯一真实询盘尚未通过哈希与血缘核验；未接受任何报价草稿。',
    runPauseReason: '灵小售等待本轮询盘证据完成；未调用模型、未发送报价。',
  });
  if (stableHash(intakeOutput?.canonicalInquiry) !== stableHash(inquiry.evidence.publicValue)) return waitResult({
    taskKey: 'starter_quote_draft',
    code: 'quote_draft_inquiry_checkpoint_changed',
    blockedReason: '本轮询盘检查点与当前 immutable 询盘证据不一致；未采用任何报价草稿。',
    runPauseReason: '灵小售等待询盘检查点重新核验；未调用模型、未发送报价。',
  });
  let result: ListResult<StarterRecord>;
  try {
    result = await context.repository.list(STARTER_COLLECTIONS.quoteDrafts, context.tenantId, {
      where: {
        run_id: resolved.binding.runId,
        cycle_id: resolved.binding.cycleId,
        workflow_task_id: resolved.binding.quoteTaskId,
        inquiry_id: inquiry.evidence.identity.inquiryId,
        inquiry_version: inquiry.evidence.identity.inquiryVersion,
      },
      perPage: MAX_DRAFT_VERSIONS_PER_TASK,
    });
  } catch {
    return waitResult({
      taskKey: 'starter_quote_draft',
      code: 'quote_draft_indexed_query_unavailable',
      blockedReason: '本轮报价草稿索引查询暂不可用；未降级为全表扫描。',
      runPauseReason: '灵小售等待索引化报价读取恢复；未调用模型、未发送报价。',
    });
  }
  if (!completeResult(result)) return waitResult({
    taskKey: 'starter_quote_draft',
    code: 'quote_draft_query_incomplete',
    blockedReason: '本轮报价查询结果被截断或计数异常；拒绝选择不完整结果。',
    runPauseReason: '灵小售等待完整的本轮报价查询结果；未调用模型、未发送报价。',
    observedRecords: result.items.length,
  });
  const current = result.items.filter(row => !OBSOLETE_DRAFT_STATUSES.has(text(row.status)));
  if (current.length !== 1) return waitResult({
    taskKey: 'starter_quote_draft',
    code: current.length ? 'quote_draft_canonical_ambiguous' : 'quote_draft_not_ready',
    blockedReason: current.length
      ? '本轮存在多个当前报价草稿，无法确定唯一 canonical；未自动挑选。'
      : '本轮尚无达到可核验状态的确定性报价草稿。',
    runPauseReason: current.length
      ? '灵小售等待人工消除本轮报价歧义；未调用模型、未发送报价。'
      : '灵小售等待确定性计价服务产出本轮草稿；未调用模型、未发送报价。',
    observedRecords: result.items.length,
  });
  const draft = current[0];
  if (!CURRENT_DRAFT_STATUSES.has(text(draft.status))) return waitResult({
    taskKey: 'starter_quote_draft',
    code: 'quote_draft_status_not_mature',
    blockedReason: '本轮报价草稿状态尚未成熟；未把处理中或未知状态写成成功。',
    runPauseReason: '灵小售等待确定性报价草稿达到可审核状态；未发送报价。',
    observedRecords: 1,
  });
  if (!validDraft({
    tenantId: context.tenantId,
    draft,
    inquiry: inquiry.evidence,
    access: resolved.access,
  })) return waitResult({
    taskKey: 'starter_quote_draft',
    code: 'quote_draft_integrity_invalid',
    blockedReason: '本轮报价草稿的输入、金额、规则或血缘哈希不可验证；未展示为成功。',
    runPauseReason: '灵小售等待报价证据修复；未调用模型、未发送报价。',
    observedRecords: 1,
  });
  const calculation = object(draft.calculation)!;
  const total = object(calculation.total);
  if (!total || !/^[A-Z]{3}$/.test(text(total.currency))
    || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text(total.decimal))) return waitResult({
    taskKey: 'starter_quote_draft',
    code: 'quote_draft_total_invalid',
    blockedReason: '本轮报价总额格式不可验证；未展示为成功。',
    runPauseReason: '灵小售等待确定性报价金额证据修复；未发送报价。',
    observedRecords: 1,
  });
  const status = text(draft.status);
  const outputCore = {
    schemaVersion: 'starter-198.quote-draft-adapter-output.v1',
    executionStatus: 'completed',
    canonicalQuote: {
      draftRef: `quote_${stableHash({
        tenantId: context.tenantId,
        draftId: draft.id,
        lineageHash: text(draft.lineage_hash),
      }).slice(0, 24)}`,
      inquiryId: inquiry.evidence.identity.inquiryId,
      inquiryVersion: inquiry.evidence.identity.inquiryVersion,
      status,
      approvalState: status === 'approved'
        ? 'approved'
        : status === 'returned'
          ? 'returned'
          : status === 'exception_pending'
            ? 'internal_exception_review'
            : 'pending_human_approval',
      requiresHumanApproval: status === 'draft_ready' || status === 'exception_pending',
      total: { currency: text(total.currency), decimal: text(total.decimal) },
      validUntil: text(calculation.validUntil),
      inputHash: text(draft.input_hash),
      ruleHash: text(draft.rule_hash),
      calculationHash: text(draft.calculation_hash),
      lineageHash: text(draft.lineage_hash),
      exceptionCount: jsonArray(draft.exceptions)!.length,
    },
    ...NO_EFFECTS,
  };
  return {
    status: 'succeeded',
    blockedReason: '',
    runPauseReason: '灵小售已核验确定性报价草稿；金额来自版本化规则与计算哈希，尚未对外发送。',
    output: { ...outputCore, outputHash: stableHash(outputCore) },
  };
}

export const prepareStarterInquiryIntakeHandler = prepareStarterInquiryIntakeAdapter;
export const prepareStarterQuoteDraftHandler = prepareStarterQuoteDraftAdapter;
