import InitialPreparationStatusPanel from '../InitialPreparationStatusPanel';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Segmented, Tag } from 'antd';
import { LoaderCircle, Settings2 } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import AgentRoleIcon, { AGENT_ROLE_PALETTE, type AgentVisualRole } from '../ui/AgentRoleIcon';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import RestoredAgentWorkCalendar from './RestoredAgentWorkCalendar';
import ConnectedAgentCalendar from './ConnectedAgentCalendar';
import { projectAgentWorkMonitor } from './AgentWorkMonitor';
import { projectAccountBindingCalendar } from './accountBindingCalendar';

const statusLabels = { working: '执行中', needs_action: '待处理', queued: '待执行', standby: '待命' };
type DigitalEmployeeWorkspaceView = 'agents' | 'publishing';

export default function DigitalEmployeeWorkspace({ data, calendarTasks, calendarDemo = false, onRefresh, onOpenContent, onOpenAgentSettings, publishingCalendar }: { data: DigitalEmployeeOverview; calendarTasks?: AgentCalendarTask[]; calendarDemo?: boolean; onRefresh?: () => void; onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void; onOpenAgentSettings?: () => void; publishingCalendar?: ReactNode }) {
  const [selectedAgent, setSelectedAgent] = useState<AgentVisualRole | ''>('');
  const [workspaceView, setWorkspaceView] = useState<DigitalEmployeeWorkspaceView>('agents');
  const [publishingVisited, setPublishingVisited] = useState(false);
  const currentRunId = data.run?.id;
  const runTasks = currentRunId ? data.tasks.filter(task => task.run_id === currentRunId) : [];
  const runTaskIds = new Set(runTasks.map(task => task.id));
  const items = (data.contentQueue?.items || []).filter(item => !currentRunId || !item.taskId || runTaskIds.has(item.taskId));
  const agents = projectAgentWorkMonitor(items, Date.now(), { workflowTasks: runTasks, planTasks: data.plan?.tasks, agentStatuses: data.agents });
  const bindingTasks = projectAccountBindingCalendar(items, (data.config?.publishingTargets || []).map(account => ({...account, connected: true})));
  useEffect(() => {
    if (workspaceView !== 'publishing' || typeof window === 'undefined') return;
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => window.cancelAnimationFrame(frame);
  }, [workspaceView]);
  const changeWorkspaceView = (view: DigitalEmployeeWorkspaceView) => {
    if (view === 'publishing') setPublishingVisited(true);
    setWorkspaceView(view);
  };
  return <div className="space-y-4">
    {data.goal && <InitialPreparationStatusPanel goalId={data.goal.id} onRunning={() => onRefresh?.()}/>}
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <Segmented<DigitalEmployeeWorkspaceView>
        aria-label="数字员工视图"
        size="large"
        value={workspaceView}
        options={[{ label: '员工排期', value: 'agents' }, { label: '发布日历', value: 'publishing' }]}
        onChange={changeWorkspaceView}
      />
      {workspaceView === 'agents' && onOpenAgentSettings && <Button icon={<Settings2 size={15}/>} onClick={onOpenAgentSettings}>Agent 设置</Button>}
    </div>
    <div hidden={workspaceView !== 'agents'} aria-hidden={workspaceView !== 'agents'} className="space-y-4">
      <section aria-label="数字员工列表" className="rounded-lg border border-border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-text-primary">数字员工</h2><p className="mt-1 text-xs text-text-secondary">状态随当前周任务回执实时更新；点击 Agent 筛选排期，再次点击查看全部</p></div></div>
        <div className="flex gap-3 overflow-x-auto pb-1">{agents.map(agent => {
          const active = selectedAgent === agent.role;
          const working = agent.status === 'working';
          const palette = AGENT_ROLE_PALETTE[agent.role];
          const currentTask = agent.assignments[0]?.taskTitle || agent.reportedCurrentTask;
          const nextTask = agent.nextAssignment?.taskTitle;
          const taskLabel = currentTask ? `当前：${currentTask}` : nextTask ? `下一项：${nextTask}` : '当前没有排期任务';
          return <button type="button" key={agent.role} data-agent-running={working ? 'true' : undefined} aria-pressed={active} onClick={() => setSelectedAgent(active ? '' : agent.role)} className="relative flex min-w-[190px] flex-1 items-center gap-3 overflow-hidden rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent" style={{borderColor: active || working ? palette.color : 'var(--color-border)', backgroundColor: active ? palette.tint : '#FFFFFF', boxShadow: working ? `0 0 0 2px ${palette.tint}` : undefined}}>
            <AgentRoleIcon role={agent.role} active={active || working}/><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-primary">{agent.name}</span><span className="mt-1 block text-xs text-text-secondary">{agent.scope}</span><span className="mt-1 block truncate text-xs text-text-muted" title={taskLabel}>{taskLabel}</span><span className="mt-2 block" aria-live="polite"><Tag icon={working ? <LoaderCircle size={12} className="motion-safe:animate-spin" aria-hidden="true"/> : undefined} color={working ? 'processing' : agent.status === 'needs_action' ? 'warning' : 'default'}>{statusLabels[agent.status]}</Tag></span></span>
          </button>;
        })}</div>
      </section>
      <section aria-label="数字员工工作排期" className="overflow-hidden rounded-lg border border-border bg-white">
        {calendarTasks !== undefined || calendarDemo
          ? <RestoredAgentWorkCalendar tasks={calendarTasks || []} startsAt={data.goal?.startsAt} demo={calendarDemo} agentRole={selectedAgent} onOpenProduction={onOpenContent ? task => onOpenContent(task.id, task.productionTaskId) : undefined}/>
          : <ConnectedAgentCalendar startsAt={data.goal?.startsAt} agentRole={selectedAgent} accountBindingTasks={bindingTasks} currentRunId={currentRunId}/>}
      </section>
    </div>
    {publishingVisited && <div hidden={workspaceView !== 'publishing'} aria-hidden={workspaceView !== 'publishing'}>{publishingCalendar}</div>}
  </div>;
}
