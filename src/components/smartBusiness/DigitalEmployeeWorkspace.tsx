import InitialPreparationStatusPanel from '../InitialPreparationStatusPanel';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Empty, Switch, Tag } from 'antd';
import { AlertTriangle, CalendarDays, Clapperboard, Gauge, Headphones, LoaderCircle, Megaphone, Radio, Settings2 } from 'lucide-react';
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
  const attentionItems = useMemo(() => monitorTasks.filter(item => ['blocked', 'failed'].includes(item.status) || /需处理|失败|异常/.test(item.status)), [monitorTasks]);
  const productionCount = items.length || new Set(sourceTasks.map(task => task.videoTaskId).filter(Boolean)).size;
  const workingCount = agents.filter(agent => agent.status === 'working').length;
  const completedCount = monitorTasks.filter(item => ['completed', 'succeeded'].includes(item.status)).length;

  return <div className="space-y-4">
    {data.goal && <InitialPreparationStatusPanel goalId={data.goal.id} onRunning={() => onRefresh?.()}/>}

    <section aria-labelledby="operations-monitor-title" className="overflow-hidden rounded-lg border border-border bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2 text-accent"><Radio size={16}/><span className="text-xs font-bold">实时运营监控</span></div>
          <h1 id="operations-monitor-title" className="mt-1 text-xl font-semibold text-text-primary">数字员工运营监控台</h1>
          <p className="mt-1 text-xs text-text-secondary">一屏查看内容生产、发布投流、客服承接和异常；内容是工作对象，Agent 是执行责任人。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenAgentSettings && <Button icon={<Settings2 size={15}/>} onClick={onOpenAgentSettings}>Agent 设置</Button>}
          {publishingCalendar && <Button icon={<CalendarDays size={15}/>} type={publishingExpanded ? 'primary' : 'default'} onClick={() => setPublishingExpanded(value => !value)}>{publishingExpanded ? '收起发布日历' : '展开发布日历'}</Button>}
        </div>
      </header>

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4" aria-label="数字员工本周运营指标">
        {[
          { label: '正在工作的数字员工', value: workingCount, suffix: `/ ${agents.length}`, icon: Gauge, tone: 'text-blue-700' },
          { label: '视频生产档案', value: productionCount, suffix: ' 条', icon: Clapperboard, tone: 'text-violet-700' },
          { label: '本周已完成任务', value: completedCount, suffix: ' 项', icon: Radio, tone: 'text-emerald-700' },
          { label: '需要立即处理', value: attentionItems.length, suffix: ' 项', icon: AlertTriangle, tone: attentionItems.length ? 'text-amber-700' : 'text-text-secondary' },
        ].map(metric => <article key={metric.label} className="flex min-h-[86px] items-center gap-3 bg-white px-4 py-3"><span className={`flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 ${metric.tone}`}><metric.icon size={17}/></span><span><span className="block text-[11px] text-text-secondary">{metric.label}</span><strong className="mt-0.5 block text-xl text-text-primary">{metric.value}<small className="ml-1 text-xs font-medium text-text-secondary">{metric.suffix}</small></strong></span></article>)}
      </div>
    </section>

    <section aria-label="数字员工实时状态" className="rounded-lg border border-border bg-white px-4 py-3">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-text-primary">数字员工实时状态</h2><p className="mt-1 text-xs text-text-secondary">状态随当前周任务回执实时更新；点击 Agent 即可过滤其负责节点，不改变以内容为主的生产视图。</p></div><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs text-text-secondary"><Switch size="small" checked={hideCompleted} onChange={setHideCompleted} aria-label="隐藏已完成"/><span>隐藏已完成</span></label></div>
      <div className="mt-2 grid gap-2 md:grid-cols-2 lg:grid-cols-4">{agents.map(agent => {
        const active = selectedAgent === agent.role;
        const working = agent.status === 'working';
        const palette = AGENT_ROLE_PALETTE[agent.role];
        const currentTask = agent.assignments[0]?.taskTitle || agent.reportedCurrentTask;
        const nextTask = agent.nextAssignment?.taskTitle;
        const taskLabel = currentTask ? `当前：${currentTask}` : nextTask ? `下一项：${nextTask}` : '当前没有排期任务';
        return <button type="button" key={agent.role} data-agent-running={working ? 'true' : undefined} aria-pressed={active} onClick={() => setSelectedAgent(active ? '' : agent.role)} className="relative flex min-h-[74px] items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent" style={{ borderColor: active || working ? palette.color : 'var(--color-border)', backgroundColor: active ? palette.tint : '#FFFFFF' }}>
          <AgentRoleIcon role={agent.role} size="sm" active={active || working}/><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><strong className="truncate text-xs text-text-primary">{agent.name}</strong><Tag className="!m-0" icon={working ? <LoaderCircle size={11} className="motion-safe:animate-spin" aria-hidden="true"/> : undefined} color={working ? 'processing' : agent.status === 'needs_action' ? 'warning' : 'default'}>{statusLabels[agent.status]}</Tag></span><span className="mt-1 block truncate text-[10px] text-text-muted" title={taskLabel}>{taskLabel}</span></span>
        </button>;
      })}</div>
    </section>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-label="数字员工视频生产监控" className="overflow-hidden rounded-lg border border-border bg-white">
        {calendarTasks !== undefined || calendarDemo
          ? <RestoredAgentWorkCalendar tasks={calendarTasks || []} startsAt={data.goal?.startsAt} demo={calendarDemo} agentRole={selectedAgent} hideCompleted={hideCompleted} onOpenProduction={onOpenContent ? task => onOpenContent(task.id, task.productionTaskId) : undefined}/>
          : <ConnectedAgentCalendar startsAt={data.goal?.startsAt} agentRole={selectedAgent} hideCompleted={hideCompleted} accountBindingTasks={bindingTasks} currentRunId={currentRunId}/>}
      </section>
      <aside className="grid gap-4" aria-label="发布、客服与异常监控">
        <MonitorModule title="发布与投流" subtitle="发布回执、投流执行与数据复盘" icon={Megaphone} items={publicationItems}/>
        <MonitorModule title="客服承接" subtitle="询盘、回复、跟进与销售协同" icon={Headphones} items={customerItems}/>
        <MonitorModule title="异常与待处理" subtitle="只显示真实受阻或执行失败的任务" icon={AlertTriangle} items={attentionItems}/>
      </aside>
    </div>

    {publishingExpanded && publishingCalendar && <section aria-label="完整发布日历" className="overflow-hidden rounded-lg border border-border bg-white"><header className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-text-primary">完整发布日历</h2><p className="mt-1 text-xs text-text-secondary">仍在同一监控台中查看，不跳转新的一级页面。</p></header>{publishingCalendar}</section>}
  </div>;
}
