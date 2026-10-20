import InitialPreparationStatusPanel from '../InitialPreparationStatusPanel';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Empty, Switch, Tag } from 'antd';
import { Activity, ArrowRight, BrainCircuit, CalendarDays, CircleCheckBig, Headphones, Layers3, LoaderCircle, Megaphone, Settings2, Sparkles } from 'lucide-react';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import AgentRoleIcon, { AGENT_ROLE_PALETTE, type AgentVisualRole } from '../ui/AgentRoleIcon';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import RestoredAgentWorkCalendar from './RestoredAgentWorkCalendar';
import ConnectedAgentCalendar from './ConnectedAgentCalendar';
import { projectAgentWorkMonitor } from './AgentWorkMonitor';
import { projectAccountBindingCalendar } from './accountBindingCalendar';
import { projectIndependentContentCalendar } from './independentContentCalendar';

const statusLabels = { working: '执行中', needs_action: '待处理', queued: '待执行', standby: '待命' };

type MonitorItem = { id: string; title: string; status: string; reason: string };

function taskTone(status: string): string | undefined {
  if (/failed|blocked|error|需处理|失败/.test(status)) return 'warning';
  if (/active|running|working|执行中|进行中/.test(status)) return 'processing';
  if (/completed|succeeded|done|已完成/.test(status)) return 'success';
  return undefined;
}

function taskStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    planned: '待执行', pending: '待执行', queued: '排队中', active: '进行中', running: '进行中',
    completed: '已完成', succeeded: '已完成', blocked: '需处理', failed: '执行失败', waiting_external: '等待回执',
    waiting_approval: '待确认', handed_off: '待承接', cancelled: '已取消', no_data: '暂无数据',
  };
  return labels[status] || status;
}

function MonitorModule({ title, subtitle, icon: Icon, items }: { title: string; subtitle: string; icon: typeof Megaphone; items: MonitorItem[] }) {
  return <section className="overflow-hidden rounded-lg border border-border bg-white">
    <header className="border-b border-border px-4 py-3">
      <div className="flex items-center gap-2 text-text-primary"><Icon size={16}/><h3 className="text-sm font-semibold">{title}</h3></div>
      <p className="mt-1 text-[11px] text-text-secondary">{subtitle}</p>
    </header>
    {items.length === 0
      ? <Empty className="my-5" image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有可核验任务"/>
      : <div className="divide-y divide-border">{items.slice(0, 4).map(item => <article key={item.id} className="px-4 py-3">
          <div className="flex items-start justify-between gap-3"><strong className="min-w-0 flex-1 truncate text-xs text-text-primary" title={item.title}>{item.title}</strong><Tag className="!m-0 shrink-0" color={taskTone(item.status)}>{taskStatusLabel(item.status)}</Tag></div>
          {item.reason && <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-amber-800">{item.reason}</p>}
        </article>)}</div>}
  </section>;
}

export default function DigitalEmployeeWorkspace({ data, calendarTasks, calendarDemo = false, onRefresh, onOpenContent, onOpenAgentSettings, publishingCalendar }: { data: DigitalEmployeeOverview; calendarTasks?: AgentCalendarTask[]; calendarDemo?: boolean; onRefresh?: () => void; onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void; onOpenAgentSettings?: () => void; publishingCalendar?: ReactNode }) {
  const [selectedAgent, setSelectedAgent] = useState<AgentVisualRole | ''>('');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [publishingExpanded, setPublishingExpanded] = useState(false);
  const currentRunId = data.run?.id;
  const runTasks = currentRunId ? data.tasks.filter(task => task.run_id === currentRunId) : [];
  const runTaskIds = new Set(runTasks.map(task => task.id));
  const items = (data.contentQueue?.items || []).filter(item => !currentRunId || !item.taskId || runTaskIds.has(item.taskId));
  const agents = projectAgentWorkMonitor(items, Date.now(), { workflowTasks: runTasks, planTasks: data.plan?.tasks, agentStatuses: data.agents });
  const bindingTasks = [...projectAccountBindingCalendar(items, (data.config?.publishingTargets || []).map(account => ({ ...account, connected: true }))), ...projectIndependentContentCalendar(runTasks, currentRunId || '')];

  useEffect(() => {
    if (!publishingExpanded || typeof window === 'undefined') return;
    const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    return () => window.cancelAnimationFrame(frame);
  }, [publishingExpanded]);

  const monitorTasks = useMemo<MonitorItem[]>(() => calendarTasks
    ? calendarTasks.map(task => ({ id: task.id, title: task.title, status: task.status, reason: task.reason || '' }))
    : runTasks.map(task => ({ id: task.id, title: task.title, status: task.status, reason: task.blocked_reason || '' })), [calendarTasks, runTasks]);
  const sourceTasks = calendarTasks || [];
  const publicationItems = useMemo(() => monitorTasks.filter(item => /发布|投流|账号|数据复盘|publish|distribution|performance/i.test(`${item.title} ${item.reason}`)), [monitorTasks]);
  const customerItems = useMemo(() => monitorTasks.filter(item => /客服|询盘|客户|跟进|销售|customer|inquiry|sales/i.test(`${item.title} ${item.reason}`)), [monitorTasks]);
  const productionCount = items.length || new Set(sourceTasks.map(task => task.videoTaskId).filter(Boolean)).size;
  const workingCount = agents.filter(agent => agent.status === 'working').length;
  const completedCount = monitorTasks.filter(item => ['completed', 'succeeded'].includes(item.status)).length;
  const queuedCount = agents.reduce((sum, agent) => sum + agent.queuedCount, 0);
  const workingNames = agents.filter(agent => agent.status === 'working').map(agent => agent.name);
  const activeAgent = agents.find(agent => agent.status === 'working' || agent.status === 'needs_action');
  const activeAssignment = activeAgent?.assignments[0] || activeAgent?.nextAssignment;

  return <div className="space-y-4">
    {data.goal && <InitialPreparationStatusPanel goalId={data.goal.id} onRunning={() => onRefresh?.()}/>}

    <section aria-labelledby="operations-monitor-title" className="relative overflow-hidden rounded-lg border border-border bg-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-br from-accent-glow via-white to-white"/>
      <header className="relative flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-5 sm:px-5">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-accent"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-30 motion-safe:animate-ping"/><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent"/></span><span className="text-xs font-bold">多 Agent 协同引擎在线</span></div>
          <h1 id="operations-monitor-title" className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">数字员工生产指挥舱</h1>
          <p className="mt-1.5 text-xs leading-5 text-text-secondary">围绕每条内容工程组织经营、编导、内容与客服 Agent；实时展示它们正在判断什么、交付什么，以及下一手由谁承接。</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {onOpenAgentSettings && <Button icon={<Settings2 size={15}/>} onClick={onOpenAgentSettings}>Agent 设置</Button>}
            {publishingCalendar && <Button icon={<CalendarDays size={15}/>} type={publishingExpanded ? 'primary' : 'default'} onClick={() => setPublishingExpanded(value => !value)}>{publishingExpanded ? '收起发布日历' : '展开发布日历'}</Button>}
          </div>
          <div className="hidden max-w-sm items-start gap-2 rounded-lg border border-accent/20 bg-white/85 px-3 py-2.5 shadow-sm backdrop-blur sm:flex">
            <BrainCircuit size={16} className="mt-0.5 shrink-0 text-accent"/>
            <p className="text-[11px] leading-4 text-text-secondary"><strong className="text-text-primary">实时判断：</strong>{activeAgent && activeAssignment ? `${activeAgent.name}正在处理“${activeAssignment.stepLabel}”，完成后回传到当前内容工程。` : '当前没有执行中的内容节点，Agent 会在新任务进入后自动接力。'}</p>
          </div>
        </div>
      </header>

      <div className="relative grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4" aria-label="数字员工本周运营指标">
        {[
          { label: 'Agent 协作在线', value: `${workingCount} 位执行`, detail: workingNames.length ? `${workingNames.join('、')}正在工作 · 共 ${agents.length} 位` : `共 ${agents.length} 位，等待新任务`, icon: Activity, tone: 'text-blue-700' },
          { label: '内容工程', value: `${productionCount} 条`, detail: '从选题到复盘，按内容持续追踪', icon: Layers3, tone: 'text-violet-700' },
          { label: '本周真实交付', value: `${completedCount} 项`, detail: '只统计已有完成回执的任务', icon: CircleCheckBig, tone: 'text-emerald-700' },
          { label: '等待 Agent 接力', value: `${queuedCount} 项`, detail: activeAssignment ? `下一交付：${activeAssignment.stepLabel}` : '当前没有排队中的协作任务', icon: Sparkles, tone: 'text-accent' },
        ].map(metric => <article key={metric.label} className="min-h-[108px] bg-white px-4 py-4"><div className="flex items-start gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${metric.tone}`}><metric.icon size={17}/></span><span className="min-w-0"><span className="block text-[11px] font-medium text-text-secondary">{metric.label}</span><strong className="mt-1 block text-lg text-text-primary">{metric.value}</strong><span className="mt-1 block text-[10px] leading-4 text-text-muted">{metric.detail}</span></span></div></article>)}
      </div>
    </section>

    <section aria-label="数字员工实时状态" className="rounded-lg border border-border bg-white px-4 py-3">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-text-primary">四位数字员工正在如何协作</h2><p className="mt-1 text-xs text-text-secondary">状态来自真实任务回执；点击任一 Agent，可只看它参与的内容工程与交付。</p></div><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text-secondary"><Switch size="small" checked={hideCompleted} onChange={setHideCompleted} aria-label="隐藏已完成"/><span>隐藏已完成</span></label></div>
      <div className="mt-2 grid gap-2 md:grid-cols-2 lg:grid-cols-4">{agents.map(agent => {
        const active = selectedAgent === agent.role;
        const working = agent.status === 'working';
        const palette = AGENT_ROLE_PALETTE[agent.role];
        const currentTask = agent.assignments[0]?.taskTitle || agent.reportedCurrentTask;
        const nextTask = agent.nextAssignment?.taskTitle;
        const assignment = agent.assignments[0] || agent.nextAssignment;
        const taskLabel = currentTask || nextTask || '当前没有排期任务';
        const progress = assignment?.elapsedMinutes !== null && assignment?.elapsedMinutes !== undefined && assignment.estimatedMinutes > 0
          ? Math.min(100, Math.round(assignment.elapsedMinutes / assignment.estimatedMinutes * 100)) : null;
        return <button type="button" key={agent.role} data-agent-running={working ? 'true' : undefined} aria-pressed={active} onClick={() => setSelectedAgent(active ? '' : agent.role)} className="relative min-h-[108px] rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-accent motion-reduce:hover:translate-y-0" style={{ borderColor: active || working ? palette.color : 'var(--color-border)', backgroundColor: active ? palette.tint : '#FFFFFF' }}>
          <span className="flex items-center gap-2.5"><AgentRoleIcon role={agent.role} size="sm" active={active || working}/><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="truncate text-xs text-text-primary">{agent.name}</strong><Tag className="!m-0" icon={working ? <LoaderCircle size={11} className="motion-safe:animate-spin" aria-hidden="true"/> : undefined} color={working ? 'processing' : agent.status === 'needs_action' ? 'warning' : 'default'}>{statusLabels[agent.status]}</Tag></span></span></span>
          <span className="mt-2 block truncate text-[11px] font-semibold text-text-primary" title={taskLabel}>{assignment?.stepLabel || '等待内容工程派单'}</span>
          <span className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[10px] text-text-muted"><span className="truncate">{taskLabel}</span><span className="ml-2 shrink-0">{agent.queuedCount ? `${agent.queuedCount} 项` : '空闲'}<ArrowRight size={11} className="ml-1 inline"/></span></span>
          {progress !== null && <span className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }}/></span>}
        </button>;
      })}</div>
    </section>

    <section aria-label="数字员工内容工程监控" className="overflow-hidden rounded-lg border border-border bg-white">
      {calendarTasks !== undefined || calendarDemo
        ? <RestoredAgentWorkCalendar tasks={calendarTasks || []} startsAt={data.goal?.startsAt} demo={calendarDemo} agentRole={selectedAgent} hideCompleted={hideCompleted} onOpenProduction={onOpenContent ? task => onOpenContent(task.id, task.productionTaskId) : undefined}/>
        : <ConnectedAgentCalendar startsAt={data.goal?.startsAt} agentRole={selectedAgent} hideCompleted={hideCompleted} accountBindingTasks={bindingTasks} currentRunId={currentRunId}/>}
    </section>

    <section className="grid gap-4 md:grid-cols-2" aria-label="发布与客户承接监控">
      <MonitorModule title="发布与投流" subtitle="发布回执、投流执行与数据复盘" icon={Megaphone} items={publicationItems}/>
      <MonitorModule title="客服承接" subtitle="询盘、回复、跟进与销售协同" icon={Headphones} items={customerItems}/>
    </section>

    {publishingExpanded && publishingCalendar && <section aria-label="完整发布日历" className="overflow-hidden rounded-lg border border-border bg-white"><header className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-text-primary">完整发布日历</h2><p className="mt-1 text-xs text-text-secondary">仍在同一监控台中查看，不跳转新的一级页面。</p></header>{publishingCalendar}</section>}
  </div>;
}
