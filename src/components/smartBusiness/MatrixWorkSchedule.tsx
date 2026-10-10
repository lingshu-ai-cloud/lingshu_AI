import AgentWeeklyCalendar, { type AgentCalendarTask } from './AgentWeeklyCalendar';
import ConnectedAgentCalendar from './ConnectedAgentCalendar';
import type { AgentStatus, ContentQueueItem, PlanTask, WorkflowTask } from '../../lib/digitalEmployees';
import AgentWorkMonitor from './AgentWorkMonitor';

type Props = {
  calendarTasks?: AgentCalendarTask[];
  calendarDemo?: boolean;
  taskItems?: ContentQueueItem[];
  workflowTasks?: WorkflowTask[];
  planTasks?: PlanTask[];
  agentStatuses?: AgentStatus[];
  onOpenTask?: (taskId: string, contentItemId: string) => void;
  startsAt?: string;
  selectedAccountId?: string;
};

export default function MatrixWorkSchedule({
  calendarTasks,
  calendarDemo = false,
  taskItems = [],
  workflowTasks,
  planTasks,
  agentStatuses,
  onOpenTask,
  startsAt,
  selectedAccountId,
}: Props) {
  const visibleTasks = taskItems.filter(item => !selectedAccountId || item.accountId === selectedAccountId);

  return <section className="overflow-hidden rounded-lg border border-border bg-white" aria-label="Agent 任务看板">
    <header className="border-b border-border px-5 py-4">
      <h2 className="text-xl font-semibold text-text-primary">Agent 任务看板</h2>
    </header>
    <div>
      {calendarTasks !== undefined || calendarDemo
        ? <AgentWeeklyCalendar startsAt={startsAt} demo={calendarDemo} tasks={calendarTasks ?? []}/>
        : <ConnectedAgentCalendar/>}
    </div>
    <AgentWorkMonitor items={visibleTasks} workflowTasks={workflowTasks} planTasks={planTasks} agentStatuses={agentStatuses} onOpenTask={onOpenTask}/>
  </section>;
}
