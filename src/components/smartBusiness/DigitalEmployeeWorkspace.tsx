import { projectWeeklyGoalCalendar } from './weeklyGoalCalendar';
import InitialPreparationStatusPanel from '../InitialPreparationStatusPanel';
import { useState } from 'react';
import { Tag } from 'antd';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import AgentRoleIcon, { AGENT_ROLE_PALETTE, type AgentVisualRole } from '../ui/AgentRoleIcon';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import RestoredAgentWorkCalendar from './RestoredAgentWorkCalendar';
import ConnectedAgentCalendar from './ConnectedAgentCalendar';
import { projectAgentWorkMonitor } from './AgentWorkMonitor';
import { projectAccountBindingCalendar } from './accountBindingCalendar';

const statusLabels = { working: '执行中', needs_action: '待处理', queued: '待执行', standby: '待命' };
export default function DigitalEmployeeWorkspace({ data, calendarTasks, calendarDemo = false, onRefresh }: { data: DigitalEmployeeOverview; calendarTasks?: AgentCalendarTask[]; calendarDemo?: boolean; onRefresh?: () => void }) {
  const [selectedAgent, setSelectedAgent] = useState<AgentVisualRole | ''>('');
  const items = data.contentQueue?.items || [];
  const agents = projectAgentWorkMonitor(items, Date.now(), { workflowTasks: data.tasks, planTasks: data.plan?.tasks, agentStatuses: data.agents });
  const bindingTasks = projectAccountBindingCalendar(items, (data.config?.publishingTargets || []).map(account => ({...account, connected: true})));
  const goalCalendar = data.goal && !data.run ? projectWeeklyGoalCalendar(data) : undefined;
  return <div className="space-y-4">
    {data.goal && <InitialPreparationStatusPanel goalId={data.goal.id} onRunning={() => onRefresh?.()}/>}
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
      {calendarTasks !== undefined || calendarDemo || goalCalendar !== undefined
        ? <RestoredAgentWorkCalendar tasks={calendarTasks || goalCalendar || []} startsAt={data.goal?.startsAt} demo={calendarDemo} agentRole={selectedAgent}/>
        : <ConnectedAgentCalendar startsAt={data.goal?.startsAt} agentRole={selectedAgent} accountBindingTasks={bindingTasks}/>}
    </section>
  </div>;
}
