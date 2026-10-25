import type { SocialContentTaskSummary } from '../../shared/contracts/socialContentWorkflow.js';
import type { DataStore } from '../storage/datastore.js';
import { listContentExecutionJobs } from '../contentExecution/durableQueue.js';
import type { SocialContentExecutionSummary, SocialContentQueueRecovery } from '../../shared/contracts/socialContentQueue.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { classifyContentExecutionFailure } from '../contentExecution/retryPolicy.js';

const LABEL: Record<string, string> = {
  queued: '已入队', running: '制作中', retry_wait: '等待恢复', reconciling: '核对服务回执',
  blocked: '需要处理', paused: '已暂停', succeeded: '执行完成 · 待验收', cancelled: '已取消', dead_letter: '需要处理',
};

/** Shared public projection for task lists and inspection. Raw errors, worker
 * identities and supplier response bodies never cross this read boundary. */
export function socialContentQueueProjection(job: ContentExecutionJob): SocialContentExecutionSummary {
  const unsettled = ['submitting', 'accepted', 'unknown'].includes(job.providerState)
    || (job.providerReceipts || []).some(receipt => ['submitting', 'accepted', 'unknown'].includes(receipt.state));
  const amendment = job.checkpoints?.['social.voice_route_amendment']?.payload as Record<string, unknown> | undefined;
  const legacyIntent = amendment?.newIntent as Record<string, unknown> | undefined;
  const nativeFailure = [...(job.providerReceipts || [])].reverse().find(receipt => receipt.state === 'failed'
    && receipt.provider === 'heygen' && receipt.metadata.stage === 'tts' && receipt.metadata.model === 'avatar_iv'
    && typeof receipt.metadata.operationId === 'string' && receipt.metadata.operationId === legacyIntent?.operationId);
  // Resume retains lastError and prior terminal receipts for audit. A queue
  // admission/running state supersedes that old failure for display; unsettled
  // receipts below still require reconciliation and prevent duplicate payment.
  const executing = ['queued', 'running'].includes(job.status);
  const qualityFailure = /^social_graph_quality_failed:/.test(job.lastError || '');
  const failureSource = executing ? null : qualityFailure ? job.lastError : typeof nativeFailure?.metadata.failureCode === 'string' ? nativeFailure.metadata.failureCode : job.lastError;
  const failure = failureSource ? classifyContentExecutionFailure(failureSource, {
    attempt: job.attempt, hasUnsettledProviderReceipt: unsettled,
  }) : null;
  const requiresReconciliation = job.status === 'reconciling' || unsettled || failure?.failureClass === 'provider_reconciliation';
  const stopped = ['blocked', 'dead_letter', 'paused'].includes(job.status);
  const pendingReceipts = (job.providerReceipts || []).filter(receipt => ['submitting', 'accepted', 'unknown'].includes(receipt.state));
  const supplierProcessing = ['queued', 'running', 'retry_wait', 'reconciling'].includes(job.status)
    && job.providerState !== 'unknown' && job.providerState !== 'submitting' && pendingReceipts.length > 0
    && pendingReceipts.every(receipt => receipt.state === 'accepted' && Boolean(receipt.providerTaskId));
  const qualityNeedsAction = stopped && qualityFailure;
  const balance = stopped && !requiresReconciliation && failure?.failureClass === 'insufficient_balance';

  // Historic workers wrote the canonical terminal failure before job receipts
  // were synchronized. This is only a candidate for the locked server check.
  const legacyFailed = !job.providerReceipts?.length && amendment?.executionMode === 'native_video'
    && legacyIntent?.model === 'avatar_iv' && legacyIntent?.stage === 'tts'
    && /^native_speech_track_provider_(?:failed|rejected):/.test(job.lastError || '');
  const failedOperationId = nativeFailure?.metadata.operationId || (legacyFailed ? legacyIntent?.operationId : null);
  const completed = job.providerState === 'completed' || (job.providerReceipts || []).some(receipt => receipt.state === 'completed');
  const canRecover = !job.workerId && !job.leaseExpiresAt;
  const recovery: SocialContentQueueRecovery | undefined = !qualityNeedsAction && ['blocked', 'paused'].includes(job.status) && !requiresReconciliation && typeof failedOperationId === 'string' && failedOperationId
    ? { action: 'retry_failed_native_voice' as const, failedOperationId,
      canRequest: canRecover,
      reason: '将核验原供应商失败回执、授权与剩余额度，通过后恢复原任务；已支付记录不会清除。' }
      : !qualityNeedsAction && ['blocked', 'paused'].includes(job.status) && !requiresReconciliation && completed
        ? { action: 'resume_existing_execution', canRequest: canRecover, reason: '复用已完成的供应商产物，继续后续处理；不重新生成已完成的内容。' } : undefined;
  return {
    id: job.id, status: job.status, attempt: job.attempt, nextAttemptAt: job.nextAttemptAt,
    label: supplierProcessing ? '供应商制作中' : requiresReconciliation ? '供应商结果待核对' : qualityNeedsAction ? '质量检查待处理' : balance ? '余额不足 · 可恢复' : LABEL[job.status] || '队列状态待核验',
    tone: supplierProcessing ? 'processing' : requiresReconciliation || stopped ? 'warning' : job.status === 'succeeded' ? 'success'
      : ['queued', 'running', 'retry_wait'].includes(job.status) ? 'processing' : 'default',
    failureCode: failure?.failureClass || null,
    reason: supplierProcessing ? '供应商正在处理原请求，系统会自动获取进度，无需重复提交。'
      : requiresReconciliation ? '供应商请求已受理或结果未知，需核对原回执；不能直接重新付费。'
      : qualityNeedsAction ? '成片已保留，部分质量检查未通过；请打开原任务查看成片与检查结果，处理后继续验收。'
      : balance ? '供应商余额或任务预算不足。补充后可检查恢复条件，原任务与已付费回执保留。'
        : failure?.publicReason || null,
    requiresReconciliation,
    ...(recovery ? { recovery } : {}),
  };
}


/** Hydrate a page in one tenant-scoped queue scan, retaining exact current-run identity. */
export async function hydrateSocialContentExecutionSummaries(input: {
  store?: DataStore; tenantId: string; items: SocialContentTaskSummary[];
}): Promise<SocialContentTaskSummary[]> {
  if (!input.store || !input.items.some(task => task.runId)) return input.items;
  const jobs = await listContentExecutionJobs(input.store, input.tenantId);
  return input.items.map(task => {
    if (!task.runId) return task;
    const matching = jobs.filter(job => job.tenantId === input.tenantId && job.taskId === task.taskId && job.runId === task.runId);
    if (matching.length > 1) throw Error('content_execution_job_integrity_violation');
    return { ...task, execution: matching[0] ? socialContentQueueProjection(matching[0]) : null };
  });
}
