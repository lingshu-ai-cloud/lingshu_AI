import { store } from '../storage/index.js';
import { buildTaskOutput, type DigitalEmployeeConfig, type WeeklyGoalInput } from './domain.js';
import type { ExecutionContract } from './executionContract.js';
import { generateDigitalEmployeeStudioDraft } from '../studio/digitalEmployeeDraftService.js';
import { executeApprovedOutboundAction, type OutboundActionProposal } from './outboundActionService.js';

export async function executeSocialLoopTask(input: {
  tenantId: string; userId: string; runId: string; taskId: string; taskKey: string; goal: WeeklyGoalInput; config: DigitalEmployeeConfig; contract?: ExecutionContract; signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  if (input.signal?.aborted) throw input.signal.reason || new Error('task_aborted');
  if (input.taskKey === 'context_readiness' && input.contract) {
    return { summary: '执行契约与正式数据源已校验', contractHash: input.contract.payloadHash, readiness: input.contract.readiness, facts: input.contract.facts.map(fact => ({ key: fact.key, source: fact.source, sourceVersion: fact.sourceVersion })), assumptions: input.contract.assumptions, gaps: input.contract.gaps };
  }
  if (input.taskKey === 'content_execution_pack') {
    if (!input.contract) throw new Error('execution_contract_missing');
    const draft = await generateDigitalEmployeeStudioDraft({
      tenantId: input.tenantId,
      userId: input.userId,
      runId: input.runId,
      taskId: input.taskId,
      goalTitle: input.goal.title,
      contract: input.contract,
      signal: input.signal,
    });
    if (input.signal?.aborted) throw input.signal.reason || new Error('task_aborted');
    return {
      summary: '已通过现有脚本与 Studio 服务生成真实可编辑草稿',
      script: draft.script,
      studioProject: draft.studioProject,
      draftSummary: draft.summary,
      draftSnapshot: draft.draftSnapshot,
      artifactPayloadHash: draft.payloadHash,
    };
  }
  if (input.taskKey === 'schedule_activation') {
    const approvals = await store.list<{ id: string; [key: string]: unknown }>('approval_requests', {
      where: { tenant_id: input.tenantId, run_id: input.runId }, sort: '-decided_at', perPage: 100,
    });
    const approval = approvals.items.find(item => ['approved', 'approved_with_changes'].includes(String(item.status)));
    if (!approval) throw new Error('approved_action_missing');
    const rawProposal = typeof approval.action_payload === 'string'
      ? JSON.parse(approval.action_payload) as OutboundActionProposal
      : approval.action_payload as OutboundActionProposal;
    if (!rawProposal || rawProposal.actionType !== 'register_schedule') throw new Error('approved_action_payload_invalid');
    const approvedPayloadHash = String(approval.approved_payload_hash || approval.payload_hash || '');
    if (!approvedPayloadHash) throw new Error('approved_action_hash_missing');
    if (input.signal?.aborted) throw input.signal.reason || new Error('task_aborted');
    const result = await executeApprovedOutboundAction({
      tenantId: input.tenantId,
      runId: input.runId,
      taskId: input.taskId,
      approvalId: approval.id,
      proposal: rawProposal,
      approvedPayloadHash,
    });
    if (input.signal?.aborted) throw input.signal.reason || new Error('task_aborted');
    return result;
  }
  return buildTaskOutput(input.taskKey, input.goal, input.config);
}
