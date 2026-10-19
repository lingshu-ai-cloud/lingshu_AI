import { requestSocialContentJson } from './socialContentApi';

export interface OrderPlanningSnapshot {
  scope: { tenantId: string; programId: string; weekStart: string };
  revision: number;
  limit: number;
  orders: Array<{ contentId: string; title: string; state: string; replaceable: boolean; blockedReason: string | null }>;
}
export interface TaskOrderPlanning {
  taskId: string;
  taskVersion: string;
  scope: OrderPlanningSnapshot['scope'] | null;
  planning: OrderPlanningSnapshot | null;
  cancelable: boolean;
  cancelBlockedReason?: string | null;
  cancelTarget?: { taskId: string; taskVersion: string; groupHash: string; participants: Array<{ taskId: string; title: string; status: string; role: 'original' | 'revision' }> } | null;
  cancellation?: { executionStopped: boolean; externalSettlementPending: boolean; quotaReleased: boolean; retainedReasons: string[]; participants: Array<{ taskId: string; status: string; preservedStatus: string | null; jobIds: string[]; retainedReasons: string[] }> } | null;
  cancellationPending?: boolean;
  replacementTasks?: Array<{ taskId: string; title: string }>;
}
type PlanningCommand = { programId: string; weekStart: string; commandId: string; reason: string; expectedRevision: number };
export const socialContentOrderOperationsApi = {
  read: (taskId: string, signal?: AbortSignal) => requestSocialContentJson<TaskOrderPlanning>(`/tasks/${encodeURIComponent(taskId)}/order-planning`, { signal }),
  cancel: (taskId: string, input: { expectedVersion: string; expectedGroupHash?: string; reason: string }, commandId: string) => requestSocialContentJson<{ item: { taskId: string; status: string; quotaReleased: boolean; retainedReasons: string[]; executionStopped?: boolean; externalSettlementPending?: boolean; participants?: NonNullable<TaskOrderPlanning['cancellation']>['participants'] } }>(`/tasks/${encodeURIComponent(taskId)}/cancel-order`, { method: 'POST', body: JSON.stringify(input) }, commandId),
  replace: (input: PlanningCommand & { selectedContentId: string; replacementTaskId: string }) => requestSocialContentJson<{ item: OrderPlanningSnapshot }>('/order-planning/replace', { method: 'POST', body: JSON.stringify(input) }, input.commandId),
  increase: (input: PlanningCommand & { newLimit: number; confirmed: true }) => requestSocialContentJson<{ item: OrderPlanningSnapshot }>('/order-planning/increase-target', { method: 'POST', body: JSON.stringify(input) }, input.commandId),
};
