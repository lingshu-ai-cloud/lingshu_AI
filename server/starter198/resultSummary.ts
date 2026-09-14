import {
  readStarterPublicationEvidenceSnapshot,
  type VerifiedPublicationEvidence,
} from '../publishing/starterPublicationPackage.js';
import { evidenceHash } from '../quotation/canonical.js';
import { parseExactDecimal } from '../quotation/fixedDecimal.js';
import type { DataStore } from '../storage/datastore.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import {
  verifiedStarterPublicationEvidenceOutput,
  type StarterPublicationEvidenceProjectionOutput,
} from './publicationEvidenceProjection.js';
import { prepareStarterQuoteDraftAdapter } from './salesArtifactAdapter.js';
import { integer, object, stableHash, text } from './orchestratorWorkerValues.js';
import { starter198TaskInScope, STARTER_198_STANDARD_TASK_KEYS } from './workflowScope.js';

const EVIDENCE_TASK_KEY = 'starter_publication_evidence';
const QUOTE_TASK_KEY = 'starter_quote_draft';
const SUMMARY_TASK_KEY = 'starter_result_summary';
const HASH = /^[a-f0-9]{64}$/;
const QUOTE_STATES = Object.freeze({
  draft_ready: { approvalState: 'pending_human_approval', requiresHumanApproval: true },
  exception_pending: { approvalState: 'internal_exception_review', requiresHumanApproval: true },
  approved: { approvalState: 'approved', requiresHumanApproval: false },
  returned: { approvalState: 'returned', requiresHumanApproval: false },
});
const NO_EFFECTS = Object.freeze({
  sourceReadOnly: true,
  providerCalls: 0,
  externalEffectsPerformed: false,
  externalMessageSent: false,
});

export interface StarterResultSummaryContext {
  dataStore: DataStore;
  repository: Starter198Repository;
  tenantId: string;
  run: StarterRecord;
  task: StarterRecord;
  now: Date;
}

export interface StarterResultSummaryPrepared {
  status: 'succeeded' | 'waiting_external';
  output: Record<string, unknown>;
  blockedReason: string;
  runPauseReason: string;
}

function wait(reasonCode: string): StarterResultSummaryPrepared {
  const output = {
    schemaVersion: 'starter-198.result-summary-wait.v1',
    executionStatus: 'waiting_external',
    reasonCode,
    ...NO_EFFECTS,
  };
  return {
    status: 'waiting_external',
    output: { ...output, outputHash: stableHash(output) },
    blockedReason: reasonCode,
    runPauseReason: `灵小枢等待可核验的真实结果：${reasonCode}。未调用模型，也未把未知结果写成成功。`,
  };
}

function exactGraph(input: {
  rows: StarterRecord[];
  total: number;
  tenantId: string;
  runId: string;
}): Map<string, StarterRecord> | null {
  const keys = input.rows.map(row => text(row.task_key));
  if (input.total !== input.rows.length
    || input.rows.length !== STARTER_198_STANDARD_TASK_KEYS.length
    || new Set(keys).size !== keys.length
    || stableHash(keys) !== stableHash(STARTER_198_STANDARD_TASK_KEYS)
    || input.rows.some((row, index) => !starter198TaskInScope(row, input.tenantId, input.runId)
      || Number(row.sequence) !== index + 1)) return null;
  return new Map(input.rows.map(row => [text(row.task_key), row]));
}

type QuoteOutput = {
  outputHash: string;
  canonicalQuote: {
    draftRef: string;
    inquiryId: string;
    inquiryVersion: string;
    status: string;
    approvalState: string;
    requiresHumanApproval: boolean;
    total: { currency: string; decimal: string };
    validUntil: string;
    inputHash: string;
    ruleHash: string;
    calculationHash: string;
    lineageHash: string;
    exceptionCount: number;
  };
};

function legalMoney(total: Record<string, unknown>): boolean {
  if (!/^[A-Z]{3}$/.test(text(total.currency)) || typeof total.decimal !== 'string') return false;
  try {
    parseExactDecimal(total.decimal, 'starter result summary quote total');
    return true;
  } catch {
    return false;
  }
}

function verifiedQuoteOutput(value: unknown): QuoteOutput | null {
  const output = object(value);
  const quote = object(output?.canonicalQuote);
  const total = object(quote?.total);
  if (!output || !quote || !total) return null;
  const core = {
    schemaVersion: output.schemaVersion,
    executionStatus: output.executionStatus,
    canonicalQuote: output.canonicalQuote,
    sourceReadOnly: output.sourceReadOnly,
    providerCalls: output.providerCalls,
    externalEffectsPerformed: output.externalEffectsPerformed,
    externalMessageSent: output.externalMessageSent,
    usageObservation: output.usageObservation,
  };
  const state = QUOTE_STATES[text(quote.status) as keyof typeof QUOTE_STATES];
  if (core.schemaVersion !== 'starter-198.quote-draft-adapter-output.v1'
    || core.executionStatus !== 'completed'
    || !/^quote_[a-f0-9]{24}$/.test(text(quote.draftRef))
    || !/^inq_[a-f0-9]{24}$/.test(text(quote.inquiryId))
    || !/^v_[a-f0-9]{16}$/.test(text(quote.inquiryVersion))
    || !state
    || text(quote.approvalState) !== state.approvalState
    || quote.requiresHumanApproval !== state.requiresHumanApproval
    || !legalMoney(total)
    || !Number.isFinite(Date.parse(text(quote.validUntil)))
    || ![quote.inputHash, quote.ruleHash, quote.calculationHash, quote.lineageHash]
      .every(hash => HASH.test(text(hash)))
    || integer(quote.exceptionCount) === null || integer(quote.exceptionCount)! < 0
    || core.sourceReadOnly !== true || core.providerCalls !== 0
    || core.externalEffectsPerformed !== false || core.externalMessageSent !== false
    || text(output.outputHash) !== stableHash(core)) return null;
  return output as unknown as QuoteOutput;
}

async function approvedQuoteEvidenceMatches(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  taskId: string;
  quote: QuoteOutput['canonicalQuote'];
}): Promise<boolean> {
  let listed;
  try {
    listed = await input.repository.list(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, {
      where: {
        run_id: input.runId,
        workflow_task_id: input.taskId,
        inquiry_id: input.quote.inquiryId,
        inquiry_version: input.quote.inquiryVersion,
      },
      perPage: 100,
    });
  } catch {
    return false;
  }
  if (!Array.isArray(listed.items)
    || !Number.isFinite(listed.totalItems)
    || listed.totalItems !== listed.items.length) return false;
  const matches = listed.items.filter(draft => (
    `quote_${stableHash({
      tenantId: input.tenantId,
      draftId: draft.id,
      lineageHash: text(draft.lineage_hash),
    }).slice(0, 24)}` === input.quote.draftRef
  ));
  if (matches.length !== 1) return false;
  const draft = matches[0];
  const calculation = object(draft.calculation);
  const fxSnapshot = object(calculation?.fxSnapshot);
  const approvalId = text(draft.approval_evidence_id);
  if (text(draft.tenant_id) !== input.tenantId
    || text(draft.run_id) !== input.runId
    || text(draft.workflow_task_id) !== input.taskId
    || text(draft.inquiry_id) !== input.quote.inquiryId
    || text(draft.inquiry_version) !== input.quote.inquiryVersion
    || text(draft.status) !== 'approved'
    || draft.approval_valid !== true
    || text(draft.input_hash) !== input.quote.inputHash
    || text(draft.rule_hash) !== input.quote.ruleHash
    || text(draft.calculation_hash) !== input.quote.calculationHash
    || text(draft.lineage_hash) !== input.quote.lineageHash
    || !approvalId) return false;
  let approval: StarterRecord | null;
  try {
    approval = await input.repository.get(
      STARTER_COLLECTIONS.quoteApprovalEvidence,
      input.tenantId,
      approvalId,
    );
  } catch {
    return false;
  }
  const envelope = object(approval?.envelope);
  const subject = object(envelope?.subject);
  const binding = object(envelope?.binding);
  const actor = object(envelope?.actor);
  const recordedAt = text(approval?.recorded_at);
  if (!approval || !envelope || !subject || !binding || !actor || !calculation || !fxSnapshot
    || approval.id !== approvalId
    || text(approval.tenant_id) !== input.tenantId
    || text(approval.draft_id) !== draft.id
    || text(approval.input_hash) !== input.quote.inputHash
    || text(approval.rule_hash) !== input.quote.ruleHash
    || text(approval.calculation_hash) !== input.quote.calculationHash
    || text(approval.decision) !== 'approved'
    || text(approval.status) !== 'approved'
    || !HASH.test(text(approval.envelope_hash))
    || text(approval.envelope_hash) !== evidenceHash(envelope)
    || text(approval.request_hash) !== evidenceHash({
      draftId: draft.id,
      inputHash: input.quote.inputHash,
      ruleHash: input.quote.ruleHash,
      calculationHash: input.quote.calculationHash,
      decision: 'approved',
      note: text(envelope.note),
    })
    || envelope.schemaVersion !== 'EvidenceEnvelopeV1'
    || envelope.action !== 'quote_draft_decision'
    || envelope.decision !== 'approved'
    || subject.type !== 'quote_draft'
    || subject.id !== draft.id
    || subject.inquiryId !== input.quote.inquiryId
    || subject.inquiryVersion !== input.quote.inquiryVersion
    || binding.inputHash !== input.quote.inputHash
    || binding.ruleHash !== input.quote.ruleHash
    || binding.calculationHash !== input.quote.calculationHash
    || binding.validUntil !== input.quote.validUntil
    || binding.ruleSetKey !== text(draft.rule_set_key)
    || binding.ruleSetVersion !== text(draft.rule_set_version)
    || binding.fxSnapshotId !== text(fxSnapshot.id)
    || integer(binding.marginBps) === null
    || integer(binding.marginBps) !== integer(calculation.marginBps)
    || !text(actor.userId) || !text(actor.role)
    || !Number.isFinite(Date.parse(recordedAt))
    || envelope.recordedAt !== recordedAt
    || text(draft.decided_at) !== recordedAt) return false;
  return true;
}

function evidenceMatchesStored(input: {
  tenantId: string;
  runId: string;
  taskId: string;
  output: StarterPublicationEvidenceProjectionOutput;
  evidence: VerifiedPublicationEvidence;
  publication: NonNullable<Awaited<ReturnType<typeof readStarterPublicationEvidenceSnapshot>>>['package'];
}): boolean {
  const workflow = input.publication.workflowBinding;
  const binding = {
    tenantId: input.tenantId,
    runId: input.runId,
    taskId: input.taskId,
    packageId: input.publication.packageId,
    packageHash: input.publication.packageHash,
    contentId: input.publication.contentId,
    contentVersion: input.publication.contentVersion,
    contentHash: input.publication.contentHash,
    platform: input.publication.platform,
    evidenceHash: input.evidence.evidenceHash,
    verificationReceiptHash: input.evidence.verificationReceiptHash,
  };
  return workflow?.schemaVersion === 'starter-198.publication-workflow-binding.v1'
    && workflow.runId === input.runId
    && input.publication.status === 'published'
    && input.evidence.verificationStatus === 'verified'
    && input.output.runId === input.runId
    && input.output.taskId === input.taskId
    && input.output.packageId === input.publication.packageId
    && input.output.packageHash === input.publication.packageHash
    && input.output.contentId === input.publication.contentId
    && input.output.contentVersion === input.publication.contentVersion
    && input.output.contentHash === input.publication.contentHash
    && input.output.platform === input.publication.platform
    && input.output.evidenceHash === input.evidence.evidenceHash
    && input.output.verifier === input.evidence.verifier
    && input.output.verifiedAt === input.evidence.verifiedAt
    && input.output.verificationReceiptHash === input.evidence.verificationReceiptHash
    && input.output.bindingHash === stableHash(binding);
}

/** Deterministic, zero-cost summary over verified fixed-graph outputs only. */
export async function prepareStarterResultSummaryHandler(
  context: StarterResultSummaryContext,
): Promise<StarterResultSummaryPrepared> {
  const listed = await context.repository.list(STARTER_COLLECTIONS.tasks, context.tenantId, {
    where: { run_id: context.run.id }, sort: 'sequence', perPage: 500,
  });
  const tasks = exactGraph({
    rows: listed.items, total: listed.totalItems, tenantId: context.tenantId, runId: context.run.id,
  });
  if (!tasks || tasks.get(SUMMARY_TASK_KEY)?.id !== context.task.id) return wait('result_summary_graph_invalid');
  const evidenceTask = tasks.get(EVIDENCE_TASK_KEY);
  const quoteTask = tasks.get(QUOTE_TASK_KEY);
  if (!evidenceTask || !quoteTask
    || text(evidenceTask.status) !== 'succeeded'
    || text(quoteTask.status) !== 'succeeded') return wait('result_summary_dependencies_not_succeeded');
  const publicationOutput = verifiedStarterPublicationEvidenceOutput(evidenceTask.output);
  const quoteOutput = verifiedQuoteOutput(quoteTask.output);
  if (!publicationOutput || !quoteOutput) return wait('result_summary_output_hash_invalid');
  const runContext = object(context.run.starter_context);
  const canonicalQuote = await prepareStarterQuoteDraftAdapter({
    repository: context.repository,
    tenantId: context.tenantId,
    run: context.run,
    task: quoteTask,
    frozen: {
      initializationId: text(runContext?.initializationId),
      inputVersion: text(runContext?.inputVersion),
      entitlementSnapshotId: text(runContext?.entitlementSnapshotId),
    },
  });
  const canonicalQuoteOutput = canonicalQuote.status === 'succeeded'
    ? verifiedQuoteOutput(canonicalQuote.output)
    : null;
  if (!canonicalQuoteOutput || canonicalQuoteOutput.outputHash !== quoteOutput.outputHash) {
    return wait('result_summary_quote_canonical_changed');
  }
  const quote = canonicalQuoteOutput.canonicalQuote;
  if (quote.status !== 'approved' || quote.approvalState !== 'approved' || quote.requiresHumanApproval) {
    return wait('result_summary_quote_approval_required');
  }
  if (!await approvedQuoteEvidenceMatches({
    repository: context.repository,
    tenantId: context.tenantId,
    runId: context.run.id,
    taskId: quoteTask.id,
    quote,
  })) return wait('result_summary_quote_approval_evidence_invalid');
  const snapshot = await readStarterPublicationEvidenceSnapshot(
    context.tenantId, publicationOutput.packageId, context.dataStore,
  );
  const evidence = snapshot?.evidence?.verificationStatus === 'verified'
    ? snapshot.evidence as VerifiedPublicationEvidence
    : null;
  if (!snapshot || !evidence || !evidenceMatchesStored({
    tenantId: context.tenantId,
    runId: context.run.id,
    taskId: evidenceTask.id,
    output: publicationOutput,
    evidence,
    publication: snapshot.package,
  })) return wait('result_summary_publication_evidence_changed');

  const gaps = [
    'publication_performance_not_observed',
    'quote_not_sent',
    'commercial_outcome_not_observed',
  ];
  const core = {
    schemaVersion: 'starter-198.result-summary-output.v1',
    executionStatus: 'completed',
    runId: context.run.id,
    publication: {
      status: 'verified_published',
      packageId: publicationOutput.packageId,
      packageHash: publicationOutput.packageHash,
      contentHash: publicationOutput.contentHash,
      platform: publicationOutput.platform,
      evidenceHash: publicationOutput.evidenceHash,
      verificationReceiptHash: publicationOutput.verificationReceiptHash,
      verifier: publicationOutput.verifier,
      verifiedAt: publicationOutput.verifiedAt,
    },
    quotation: {
      status: 'verified_draft',
      draftRef: quote.draftRef,
      draftStatus: quote.status,
      approvalState: quote.approvalState,
      requiresHumanApproval: quote.requiresHumanApproval,
      total: quote.total,
      validUntil: quote.validUntil,
      calculationHash: quote.calculationHash,
      lineageHash: quote.lineageHash,
      externalMessageSent: false,
    },
    observedCounts: { verifiedPublications: 1, verifiedQuoteDrafts: 1, externalMessagesSent: 0 },
    gaps,
    sourceTaskHashes: {
      publicationEvidence: publicationOutput.outputHash,
      quoteDraft: canonicalQuoteOutput.outputHash,
    },
    ...NO_EFFECTS,
  };
  return {
    status: 'succeeded',
    output: { ...core, outputHash: stableHash(core) },
    blockedReason: '',
    runPauseReason: '灵小枢已汇总可核验发布与报价草稿；未观察到的流量、发送和成交结果继续明确标记为缺口。',
  };
}
