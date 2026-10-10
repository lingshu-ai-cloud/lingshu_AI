import { useState } from 'react';
import AgentWeeklyCalendar, { type AgentCalendarTask } from './AgentWeeklyCalendar';
import ConnectedAgentCalendar from './ConnectedAgentCalendar';
import type { AgentStatus, ContentQueueItem, PlanTask, WorkflowTask } from '../../lib/digitalEmployees';
import { Alert, Button } from 'antd';
import { MATERIAL_TYPE_LABELS } from '../../../shared/benchmarkAnalysis';
import type { VideoCreationPlan } from '../../lib/videoCreationPlan';
import type { MatrixScheduleAccount } from '../SmartBusinessDashboard';
import { LsCalendar, calendarDayKey, type LsCalendarEvent } from '../ui/LsCalendar';
import AgentWorkMonitor from './AgentWorkMonitor';

type Props = { calendarTasks?: AgentCalendarTask[]; calendarDemo?: boolean; taskItems?: ContentQueueItem[]; workflowTasks?: WorkflowTask[]; planTasks?: PlanTask[]; agentStatuses?: AgentStatus[]; onOpenTask?: (taskId: string, contentItemId: string) => void; startsAt?: string; endsAt?: string; accounts: MatrixScheduleAccount[]; plans: VideoCreationPlan[]; selectedAccountId?: string; onOpenPublishing?: () => void };
function safeDate(value: string | undefined, fallback = new Date()) {
  const parsed = value ? new Date(`${value.slice(0, 10)}T00:00:00+08:00`) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
function addDays(value: Date, count: number) { return new Date(value.getTime() + count * 86_400_000); }
function scheduleTime(day: Date, accountIndex: number, itemIndex: number) {
  // Keep every account on a stable publishing rhythm while giving concurrent
  // accounts their own visible lane in the weekly time grid.
  const startMinutes = 9 * 60 + (accountIndex % 4) * 120 + (itemIndex % 2) * 15;
  const endMinutes = startMinutes + 75;
  const date = calendarDayKey(day);
  const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
  return {
    start: `${date}T${clock(startMinutes)}+08:00`,
    end: `${date}T${clock(endMinutes)}+08:00`,
  };
}
function spreadAccountDate(start: Date, end: Date, slotIndex: number, accountTotal: number) {
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const total = Math.max(1, accountTotal);
  const index = Math.max(0, Math.min(total - 1, slotIndex));
  return addDays(start, total === 1 ? Math.floor((days - 1) / 2) : Math.round(index * (days - 1) / (total - 1)));
}
function previewFrames(plan?: VideoCreationPlan) {
  const matched = (plan?.preproduction?.materials.storyboard || []).map(step => ({ url: step.materialPreviewUrl || step.referenceFirstFrameUrl, label: step.materialLabel || MATERIAL_TYPE_LABELS[step.materialType] }));
  if (matched.some(item => item.url)) return matched.slice(0, 5);
  const analysis = plan?.benchmarkAnalysis;
  return (analysis?.structure || []).slice(0, 5).map(step => {
    const shot = step.shotIds.map(id => analysis?.shots.find(item => item.shotId === id)).find(Boolean);
    return { url: shot?.firstFrameRef || '', label: MATERIAL_TYPE_LABELS[step.materialType] };
  });
}
function planBlockers(plan?: VideoCreationPlan) {
  if (!plan) return ['等待生成内容计划'];
  return [...(!plan.productName ? ['未绑定产品'] : []), ...(!plan.referenceId ? ['缺少已完成精确分析的爆款参考'] : []), ...(plan.preproduction && !plan.preproduction.readiness.canStart ? plan.preproduction.readiness.blockers : [])];
}

export default function MatrixWorkSchedule({ calendarTasks, calendarDemo = false, taskItems = [], workflowTasks, planTasks, agentStatuses, onOpenTask, startsAt, endsAt, accounts, plans, selectedAccountId, onOpenPublishing }: Props) {
  const [view, setView] = useState<'calendar' | 'board'>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('scheduleView') === 'board' ? 'board' : 'calendar');
  const visibleTasks = taskItems.filter(item => !selectedAccountId || item.accountId === selectedAccountId);
  const goalStart = safeDate(startsAt), goalEnd = safeDate(endsAt, addDays(goalStart, 6));
  const visibleAccounts = selectedAccountId ? accounts.filter(account => account.accountId === selectedAccountId) : accounts;
  const rows = visibleAccounts.flatMap((account, accountIndex) => {
    const accountPlans = plans.filter(plan => plan.matrix?.accountId === account.accountId);
    const accountTotal = Math.max(accountPlans.length, account.weeklyCount);
    return Array.from({ length: accountTotal }, (_, index) => ({ account, accountIndex, plan: accountPlans[index], index, accountTotal }));
  });
  const scheduledRows = rows.map(row => ({
    ...row,
    day: calendarDayKey(safeDate(row.plan?.plannedPublishDate, spreadAccountDate(goalStart, goalEnd, row.index, row.accountTotal))),
  }));
  const events: LsCalendarEvent[] = scheduledRows.map(row => {
    const { account, accountIndex, plan, index } = row;
    const blockers = planBlockers(plan), frames = previewFrames(plan);
    const taskItem = visibleTasks.find(item => item.contentId === plan?.contentId && item.accountId === account.accountId)
      || visibleTasks.find(item => item.contentId === plan?.contentId)
      || null;
    const confirmedPublishAt = taskItem?.contentPlan?.publishAt;
    const hasConfirmedTime = Boolean(confirmedPublishAt && Number.isFinite(Date.parse(confirmedPublishAt)));
    const fallbackTime = scheduleTime(safeDate(row.day), accountIndex, index);
    const start = hasConfirmedTime ? confirmedPublishAt! : fallbackTime.start;
    const end = hasConfirmedTime ? new Date(Date.parse(start) + 90 * 60_000).toISOString() : fallbackTime.end;
    return {
      id: `${account.accountId}-${plan?.contentId || index}`, title: plan?.publication?.title || plan?.theme || `待编排内容 ${index + 1}`,
      start, end, allDay: false,
      timeZone: 'Asia/Shanghai', status: blockers.length ? 'needs_action' : plan?.directorStatus === 'in_production' ? 'working' : 'planned',
      statusLabel: blockers.length ? '待处理' : plan?.directorStatus === 'in_production' ? '制作中' : '可执行', eventType: 'content',
      platform: account.platform, accountId: account.accountId, accountName: account.accountLabel,
      thumbnailUrl: frames[0]?.url || plan?.planningEvidence?.referenceThumbnailUrl || plan?.preproduction?.benchmark.thumbnailUrl,
      sourceId: plan?.contentId, ownerAgent: '内容 Agent', costEstimate: plan?.estimatedCost,
      description: plan ? `${plan.productName || '待选产品'} · ${plan.productionRole === 'platform_adaptation' ? '平台轻适配' : '原创母版'}` : '周目标已分配，等待可执行爆款参考',
      data: { ...row, taskItem, hasConfirmedTime },
    };
  });
  return <section className="bg-white" aria-label="数字员工工作排期">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
      <h2 className="text-xl font-semibold text-text-primary">数字员工工作排期</h2>
      {onOpenPublishing && <Button onClick={onOpenPublishing}>打开发布日历</Button>}
    </header>
    <div className="flex gap-2 border-b border-border p-3" role="tablist" aria-label="发布排期视图">{([['calendar', '发布日历'], ['board', 'Agent 任务看板']] as const).map(([id, label]) => <Button key={id} role="tab" id={`schedule-tab-${id}`} aria-selected={view === id} aria-controls={`schedule-panel-${id}`} type={view === id ? 'primary' : 'default'} onClick={() => setView(id)}>{label}</Button>)}</div>
    {view === 'board' ? <div id="schedule-panel-board" role="tabpanel" aria-labelledby="schedule-tab-board">{calendarTasks !== undefined || calendarDemo ? <AgentWeeklyCalendar startsAt={startsAt} demo={calendarDemo} tasks={calendarTasks ?? []}/> : <ConnectedAgentCalendar/>}</div> : <div id="schedule-panel-calendar" role="tabpanel" aria-labelledby="schedule-tab-calendar">
    <LsCalendar events={events} initialDate={calendarDayKey(goalStart)} date={calendarDayKey(goalStart)} initialView="timeGridWeek" firstDay={goalStart.getDay()} eventCardMode="media" timeGridHeight={760} label="数字员工工作排期" renderDetails={(event, closeDetails) => {
      const { plan, hasConfirmedTime } = event.data as (typeof scheduledRows)[number] & { taskItem: ContentQueueItem | null; hasConfirmedTime: boolean };
      const blockers = planBlockers(plan), frames = previewFrames(plan);
      return <div className="space-y-4">
        <div aria-label="素材结构预览" className="flex gap-2 overflow-x-auto">{frames.map((frame, index) => <figure key={index} className="w-24 shrink-0"><div className="aspect-video overflow-hidden rounded-lg border border-border bg-surface-2">{frame.url ? <img src={frame.url} alt={`${frame.label}首帧`} className="h-full w-full object-cover"/> : <span className="text-xs text-text-muted">待补素材</span>}</div><figcaption className="mt-1 text-xs text-text-secondary">{frame.label}</figcaption></figure>)}</div>
        <dl className="ls-calendar-details"><div><dt>制作时长</dt><dd>待生产任务确认；成片 {plan?.duration || '—'} 秒</dd></div><div><dt>工期</dt><dd>目标周期 {calendarDayKey(goalStart)} 至 {calendarDayKey(goalEnd)}</dd></div><div><dt>{hasConfirmedTime ? '发布时间' : '执行窗口'}</dt><dd>{new Date(event.start).toLocaleString('zh-CN', { timeZone: event.timeZone, hour12: false })}{hasConfirmedTime ? '' : ' · 周计划自动排布，发布时分待确认'}</dd></div><div><dt>发布账号</dt><dd>{event.accountName}</dd></div><div><dt>爆款参考</dt><dd>{plan?.planningEvidence?.referenceTitle || '等待精确分析'}</dd></div><div><dt>预计成本</dt><dd>{plan?.estimatedCostRange ? `¥${plan.estimatedCostRange.minCny}–¥${plan.estimatedCostRange.maxCny}` : plan?.estimatedCost !== undefined ? `¥${plan.estimatedCost}` : '尚未估算'}</dd></div><div><dt>产品</dt><dd>{plan?.productName || '未绑定产品'}</dd></div><div><dt>内容家族</dt><dd>{plan?.contentFamilyId || plan?.contentId || '待生成'}</dd></div></dl>
        {blockers.length > 0 && <Alert type="warning" showIcon title="需要处理" description={blockers.join('；')}/>}
        {onOpenPublishing && <Button onClick={() => { closeDetails(); onOpenPublishing(); }}>打开发布与内容详情</Button>}
      </div>;
    }}/>
    </div>}
    {view === 'board' && <AgentWorkMonitor items={visibleTasks} workflowTasks={workflowTasks} planTasks={planTasks} agentStatuses={agentStatuses} onOpenTask={onOpenTask}/>}
  </section>;
}
