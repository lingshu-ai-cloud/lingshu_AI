import { normalizeAssistantDecisionExecutionReceipt, type AssistantDecisionExecutionReceipt } from '../../shared/contracts/assistantDecisionCenter';

export const WEEKLY_WORK_UPDATED_EVENT = 'lingshu:weekly-work-updated';
export type WeeklyWorkUpdatedDetail = {
  source: 'page' | 'assistant';
  goalId: string;
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
}
