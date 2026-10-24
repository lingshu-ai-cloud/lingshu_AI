import type { DigitalEmployeeOverview, WorkflowTask } from '../../lib/digitalEmployees';

const keys = new Set(['customer_attribution', 'customer_segmentation', 'followup_batch_draft', 'followup_batch_approval', 'followup_dispatch']);
/** Use the original overview and task identity; never manufacture a run or sending scope. */
export function customerWorkspaceTasks(overview: DigitalEmployeeOverview | null): WorkflowTask[] {
  if (!overview?.run) return [];
  return overview.tasks.filter(task => task.run_id === overview.run!.id && task.agent_role === 'customer' && keys.has(task.task_key));
}
