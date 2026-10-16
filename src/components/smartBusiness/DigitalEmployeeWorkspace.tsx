import InitialPreparationStatusPanel from '../InitialPreparationStatusPanel';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Segmented, Tag } from 'antd';
import { Settings2 } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import AgentRoleIcon, { AGENT_ROLE_PALETTE, type AgentVisualRole } from '../ui/AgentRoleIcon';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import RestoredAgentWorkCalendar from './RestoredAgentWorkCalendar';
import ConnectedAgentCalendar from './ConnectedAgentCalendar';
import { projectAgentWorkMonitor } from './AgentWorkMonitor';
import { projectAccountBindingCalendar } from './accountBindingCalendar';
import {projectIndependentContentCalendar} from './independentContentCalendar';

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
  const bindingTasks = [...projectAccountBindingCalendar(items, (data.config?.publishingTargets || []).map(account => ({...account, connected: true}))),...projectIndependentContentCalendar(runTasks,currentRunId||'')];
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
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-text-primary">数字员工</h2><span className="text-xs text-text-secondary">点击 Agent 筛选排期，再次点击查看全部</span></div>
        <div className="flex gap-3 overflow-x-auto pb-1">{agents.map(agent => {
          const active = selectedAgent === agent.role;
          const palette = AGENT_ROLE_PALETTE[agent.role];
          return <button type="button" key={agent.role} aria-pressed={active} onClick={() => setSelectedAgent(active ? '' : agent.role)} className="flex min-w-[190px] flex-1 items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent" style={{borderColor: active ? palette.color : 'var(--color-border)', backgroundColor: active ? palette.tint : '#FFFFFF'}}>
            <AgentRoleIcon role={agent.role} active={active}/><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-primary">{agent.name}</span><span className="mt-1 block text-xs text-text-secondary">{agent.scope}</span><span className="mt-2 block"><Tag color={agent.status === 'working' ? 'processing' : agent.status === 'needs_action' ? 'warning' : 'default'}>{statusLabels[agent.status]}</Tag></span></span>
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
