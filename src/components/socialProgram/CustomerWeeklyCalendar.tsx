import { dispatchDigitalEmployeeDeepLink } from '../../lib/digitalEmployees';

export type CustomerCalendarTask = {
  step: string; taskId: string; taskKey: string; title: string; status: string;
  evidenceStatus: 'succeeded' | 'blocked' | 'no_data'; reason: string | null;
  scheduledAt: string | null; latestFinishAt: string | null; estimateDurationMinutes: number | null;
};
export type CustomerCalendarProjection = {
  binding: { bindingId: string; runId: string; goalId: string; planId: string; boundBy: string; boundAt: string } | null;
  tasks: CustomerCalendarTask[];
  scheduleGaps: Array<{ step: string; taskId: string; reason: string }>;
};
export function openCustomerCalendarTask(runId: string, task: Pick<CustomerCalendarTask, 'taskId' | 'taskKey'>) {
  dispatchDigitalEmployeeDeepLink({ page: 'conversion', runId, taskId: task.taskId, businessRef: { taskKey: task.taskKey, businessDomain: 'customer', statusSource: '真实客服运行、客群快照、草稿审批和平台回执' } });
}
