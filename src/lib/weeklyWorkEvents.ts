import { normalizeAssistantDecisionExecutionReceipt, type AssistantDecisionExecutionReceipt } from '../../shared/contracts/assistantDecisionCenter';
import { notifyAssistantStateInvalidated } from './assistantStateInvalidation';

export const WEEKLY_WORK_UPDATED_EVENT = 'lingshu:weekly-work-updated';
export type WeeklyWorkUpdatedDetail = {
  source: 'page' | 'assistant';
  goalId: string;
  factsSynchronized?: boolean;
  execution?: AssistantDecisionExecutionReceipt;
};

/** A refresh notification only; it never authorizes or starts a workflow. */
export function notifyWeeklyWorkUpdated(detail: WeeklyWorkUpdatedDetail): void {
  if (typeof window === 'undefined' || !detail.goalId.trim()) return;
  const execution = normalizeAssistantDecisionExecutionReceipt(detail.execution);
  window.dispatchEvent(new CustomEvent<WeeklyWorkUpdatedDetail>(WEEKLY_WORK_UPDATED_EVENT, {
    detail: {
      source: detail.source, goalId: detail.goalId,
      ...(execution?.goalId === detail.goalId ? { execution } : {}),
    },
  }));
  notifyAssistantStateInvalidated({ domain: 'weekly-work', source: detail.source, entityId: detail.goalId });
  if (detail.factsSynchronized) window.dispatchEvent(new CustomEvent('lingshu-assistant-open', { detail: {
    assistantText: '周计划已按最新企业资料同步。新版计划待你核对确认，生产尚未开始。你可以查看当前周计划，继续核对参考与制作条件。',
  } }));
}
