import { calendarDurationLabel, hasCalendarProductionBinding, isCalendarTaskOverdue, calendarOverdueDuration, calendarPendingReferences, type AgentCalendarTask } from './AgentWeeklyCalendar';
import {agentCalendarAuthIdentity, captureAgentCalendarReturnContext, readAgentCalendarReturnContext, registerAgentCalendarReturnState, restoreAgentCalendarReturnContext} from '../../lib/agentCalendarReturnContext';
import type {LsCalendarView} from '../ui/LsCalendar';
import { flushSync } from 'react-dom';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Steps, Tag } from 'antd';
import { UserRound } from 'lucide-react';
import type { CrossWeekMaterialTarget } from '../socialProgram/crossWeekMaterialCalendar';
import type { CustomerExecutionCalendarTarget } from '../socialProgram/customerExecutionCalendarNavigation';
import type { CustomerExceptionTarget } from '../socialProgram/weeklyCustomerExceptionCalendar';
import type { NativeRecoveryTarget } from '../socialProgram/weeklyNativeRecoveryCalendar';
import type { PublicationExecutionTarget } from '../socialProgram/publicationExecutionCalendarNavigation';
import type { PublicationRecoveryTarget } from '../socialProgram/weeklyPublicationRecoveryCalendar';
import type { CustomerSendRecoveryTarget } from '../socialProgram/weeklyCustomerSendRecoveryNavigation';
import { calendarClock, calendarTimestampLabel } from '../socialProgram/calendarTime';
import { hasTemplateCalendarTarget, type TemplateCalendarTarget } from '../socialProgram/templateCalendarNavigation';
import { hasReviewCalendarTarget, type ReviewCalendarTarget } from '../socialProgram/reviewCalendarNavigation';
import { hasPlanningCalendarTarget, type PlanningCalendarTarget } from '../socialProgram/planningCalendarNavigation';
import { calendarDayKey, calendarInstant, type LsCalendarEvent } from '../../lib/calendarModel';
import { projectCalendarDeliverables } from './calendarDeliverables';
import AgentRoleIcon, { AGENT_ROLE_PALETTE, type AgentVisualRole } from '../ui/AgentRoleIcon';
import {agentCalendarTaskType,buildAgentCalendarSummaries,taskHasDeliverableOrWorkspace,type AgentCalendarSummary} from './agentCalendarGroups';

const LsCalendar = typeof document === 'undefined'
  ? function ServerCalendar({ events, label }: { events: LsCalendarEvent[]; label: string }) {
      return <div aria-label={label}>{events.map(event => <span key={event.id}>{event.title} · {event.statusLabel}</span>)}</div>;
    }
  : lazy(() => import('../ui/LsCalendar').then(module => ({ default: module.LsCalendar })));

const agentLabels: Record<AgentCalendarTask['agent'], string> = {
  human: '人工处理',
  business: '经营 Agent',
  director: '编导 Agent',
  content: '内容 Agent',
  customer: '客服 Agent',
};

const statusLabels: Record<AgentCalendarTask['status'], string> = {
  planned: '待执行',
  active: '进行中',
  completed: '已完成',
  blocked: '需处理',
  cancelled: '已取消',
  failed: '执行失败',
  no_data: '无符合条件的客户',
};

const agentRoleOrder: AgentCalendarTask['agent'][] = ['business', 'director', 'content', 'customer', 'human'];

function AgentIdentityCard({ role, relation }: { role: AgentCalendarTask['agent']; relation: '主 Agent' | '辅助 Agent' }) {
  const isHuman = role === 'human';
  const palette = isHuman ? { color: '#BE123C', tint: '#FFF1F2' } : AGENT_ROLE_PALETTE[role as AgentVisualRole];
  return <div className="flex min-w-[148px] items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: palette.color, backgroundColor: palette.tint }}>
    {isHuman
      ? <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-white" style={{ borderColor: palette.color, color: palette.color }}><UserRound size={17}/></span>
      : <AgentRoleIcon role={role as AgentVisualRole} size="sm" active label={agentLabels[role]}/>}
    <span className="min-w-0"><span className="block text-[11px] font-medium text-text-secondary">{relation}</span><strong className="block truncate text-sm text-text-primary">{agentLabels[role]}</strong></span>
  </div>;
}

function deliveryFormLabel(task: AgentCalendarTask): string {
  if (task.publicationExecutionTarget || task.publicationRecoveryTarget) return '社媒发布与回执';
  if (task.customerExecutionTarget || task.agent === 'customer') return '客户承接与跟进';
  if (task.agent === 'director') return '脚本、分镜或审核结论';
  if (task.agent === 'content' || task.productionTaskId) return '视频或图文制作结果';
  if (task.agent === 'human') return '人工资料或审批结果';
  return '经营计划与排期结果';
}

function stepStatus(status: AgentCalendarTask['status']): 'wait' | 'process' | 'finish' | 'error' {
  if (['completed', 'cancelled', 'no_data'].includes(status)) return 'finish';
  if (status === 'active') return 'process';
  if (status === 'blocked' || status === 'failed') return 'error';
  return 'wait';
}

function offsetSuffix(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function taskInstant(task: AgentCalendarTask): string {
  if (task.dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(task.dueAt) && Number.isFinite(Date.parse(task.dueAt))) return task.dueAt;
  if (task.calendarClock?.timeZone) return calendarInstant(`${task.date}T${task.time || '09:00'}`, task.calendarClock.timeZone).toISOString();
  const suffix = offsetSuffix(task.calendarClock?.offsetMinutes ?? 8 * 60);
  return `${task.date}T${task.time || '09:00'}:00${suffix}`;
}

function taskIsAllDay(task: AgentCalendarTask): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(task.dueAt || '') && (!task.time || task.time === '00:00');
}

function eventStatus(task: AgentCalendarTask, overdue: boolean): LsCalendarEvent['status'] {
  if (overdue || task.status === 'blocked') return 'needs_action';
  if (task.status === 'active') return 'working';
  if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'no_data') return 'done';
  if (task.status === 'failed') return 'failed';
  return 'planned';
}

function taskEndInstant(task: AgentCalendarTask): number {
  const start = Date.parse(taskInstant(task));
  return Number.isFinite(start) ? start + Math.max(30, task.minutes ?? 60) * 60_000 : Number.NaN;
}

/** A passed calendar slot is overdue unless the persisted task has a terminal result. */
export function isPastUnfinishedCalendarTask(task: AgentCalendarTask, now: number): boolean {
  return !['completed', 'cancelled', 'no_data'].includes(task.status) && taskEndInstant(task) < now;
}

function taskIsOverdue(task: AgentCalendarTask, now: number): boolean {
  return isCalendarTaskOverdue(task, now) || isPastUnfinishedCalendarTask(task, now);
}

function taskOverdueLabel(task: AgentCalendarTask, now: number): string {
  if (task.dueAt && Number.isFinite(Date.parse(task.dueAt))) return calendarOverdueDuration(task, now);
  const minutes = Math.max(1, Math.floor((now - taskEndInstant(task)) / 60_000));
  return minutes >= 1440 ? `${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes % 1440 / 60)} 小时` : minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}

function calendarCardOwner(task: AgentCalendarTask, overdue: boolean): string {
  const state = task.status === 'completed' ? '✓' : overdue ? '逾期' : statusLabels[task.status];
  return `${agentCalendarTaskType(task)} · ${agentLabels[task.agent]} · ${state}`;
}

type SummaryEventData = { kind: 'summary'; summary: AgentCalendarSummary };
function isSummaryEventData(value: unknown): value is SummaryEventData {
  return Boolean(value && typeof value === 'object' && (value as SummaryEventData).kind === 'summary');
}
function weekDates(anchor: string): string[] {
  const parsed = new Date(`${anchor.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return [];
  const monday = new Date(parsed);
  monday.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  return Array.from({length: 7}, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}
function summaryStatus(summary: AgentCalendarSummary): LsCalendarEvent['status'] {
  if (summary.children.some(task => task.status === 'failed')) return 'failed';
  if (summary.children.some(task => task.status === 'blocked')) return 'needs_action';
  if (summary.children.some(task => task.status === 'active')) return 'working';
  if (summary.children.length && summary.children.every(task => ['completed','cancelled','no_data'].includes(task.status))) return 'done';
  return 'planned';
}

function summaryAgent(summary: AgentCalendarSummary): Exclude<AgentCalendarTask['agent'], 'human'> {
  if (summary.group === 'directing') return 'director';
  if (summary.group === 'production' || summary.group === 'quality') return 'content';
  if (summary.group === 'inquiries') return 'customer';
  return 'business';
}

type Props = {
  startsAt?: string;
  tasks: AgentCalendarTask[];
  demo?: boolean;
  onOpenProduction?: (task: AgentCalendarTask) => void;
  agentRole?: AgentCalendarTask["agent"] | "";
  onOpenEnterpriseFacts?: (task: AgentCalendarTask) => void;
  onOpenPlanning?: (task: AgentCalendarTask) => void;
  onOpenReview?: (task: AgentCalendarTask) => void;
  onOpenSupplement?: (task: AgentCalendarTask) => void;
  onOpenTemplate?: (task: AgentCalendarTask) => void;
  onOpenCustomerExecution?: (task: AgentCalendarTask) => void;
  onBindAccount?: (task: AgentCalendarTask) => void;
  scopeKey?: string;
  canOpenContentTask?: (task: AgentCalendarTask) => boolean;
};

export default function RestoredAgentWorkCalendar({
  startsAt,
  agentRole = "",
  onOpenEnterpriseFacts,
  tasks,
  demo = false,
  onOpenProduction,
  onOpenPlanning,
  onOpenReview,
  onOpenSupplement,
  onOpenTemplate,
  onOpenCustomerExecution,
  onBindAccount,
  scopeKey,
  canOpenContentTask,
}: Props) {
  const positionKey = JSON.stringify([agentCalendarAuthIdentity(),scopeKey,startsAt,demo]);
  const stateKey = `restoredAgentCalendar:${positionKey}`;
  const saved = readAgentCalendarReturnContext();
  const previous = saved?.calendar.positionKey === positionKey ? saved.states[stateKey] as {date?: string; view?: LsCalendarView} | undefined : undefined;
  const [calendarDate, setCalendarDate] = useState(previous?.date || startsAt || tasks[0]?.date || calendarDayKey(new Date()));
  const [calendarView, setCalendarView] = useState<LsCalendarView>(previous?.view || 'timeGridWeek');
  const viewport = useRef({date:calendarDate,view:calendarView});
  viewport.current = {date:calendarDate,view:calendarView};
  useEffect(() => registerAgentCalendarReturnState(stateKey, {
    read: () => viewport.current,
    restore: value => { const state = value as typeof viewport.current; if(state?.date)setCalendarDate(state.date); if(state?.view)setCalendarView(state.view); },
  }), [stateKey]);
  useEffect(() => {
    const context = readAgentCalendarReturnContext();
    const state = context?.calendar.positionKey === positionKey ? context.states[stateKey] as typeof viewport.current | undefined : undefined;
    setCalendarDate(state?.date || startsAt || tasks[0]?.date || calendarDayKey(new Date()));
    setCalendarView(state?.view || 'timeGridWeek');
    restoreAgentCalendarReturnContext();
  }, [positionKey]);
  const [now, setNow] = useState(() => Date.now());
  const [showAllIndependent, setShowAllIndependent] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const deliverables = useMemo(() => projectCalendarDeliverables(tasks), [tasks]);
  const timeZone = tasks.find(task => task.calendarClock?.timeZone)?.calendarClock?.timeZone || 'Asia/Shanghai';
  const scopedDeliverables = useMemo(() => deliverables.filter(task => !agentRole || task.agent === agentRole || task.agent === 'human'), [deliverables, agentRole]);
  const pendingReferences = demo ? [] : calendarPendingReferences(scopedDeliverables, now);
  const dates = useMemo(() => weekDates(calendarDate), [calendarDate]);
  const summaries = useMemo(() => buildAgentCalendarSummaries(scopedDeliverables, dates), [scopedDeliverables, dates]);
  const independentTasks = useMemo(() => scopedDeliverables.filter(taskHasDeliverableOrWorkspace), [scopedDeliverables]);
  const visibleIndependentIds = useMemo(() => new Set(summaries.flatMap(summary => showAllIndependent || expandedSummaries.has(summary.key) ? summary.children.map(task => task.id) : [])), [summaries, showAllIndependent, expandedSummaries]);
  const events = useMemo<LsCalendarEvent[]>(() => {
    const summaryEvents: LsCalendarEvent[] = summaries.map(summary => {
      const start = calendarInstant(`${summary.date}T${summary.startTime}`, timeZone).toISOString();
      const owner = summaryAgent(summary);
      return ({
      id: `summary:${summary.key}`,
      title: summary.title,
      start,
      end: new Date(Date.parse(start) + summary.durationMinutes * 60_000).toISOString(),
      allDay: false,
      timeZone,
      status: summaryStatus(summary),
      statusLabel: summary.progress,
      eventType: 'agent_task',
      ownerAgent: `计划占位 · ${agentLabels[owner]} · ${summary.progress}`,
      sourceId: summary.key,
      description: summary.progress,
      identity: {kind: 'agent', role: owner},
      data: {kind:'summary',summary} satisfies SummaryEventData,
    });});
    const taskEvents = independentTasks.filter(task => visibleIndependentIds.has(task.id)).map(task => {
    const overdue = !demo && taskIsOverdue(task, now);
    const allDay = taskIsAllDay(task);
    const start = allDay ? task.date : taskInstant(task);
    const duration = Math.max(30, task.minutes ?? 60) * 60_000;
    return {
      id: task.id,
      title: task.title,
      start,
      end: allDay ? undefined : new Date(Date.parse(start) + duration).toISOString(),
      allDay,
      timeZone: task.calendarClock?.timeZone || timeZone,
      status: eventStatus(task, overdue),
      statusLabel: overdue ? `交付已逾期 · ${taskOverdueLabel(task, now)}` : task.deliveryTiming === 'late' ? '已完成 · 晚交付' : task.deliveryTiming === 'on_time' ? '已完成 · 按时' : statusLabels[task.status],
      eventType: task.agent === 'customer' ? 'follow_up' : 'agent_task',
      ownerAgent: calendarCardOwner(task, overdue),
      platform: task.platform,
      sourceId: task.productionTaskId || task.id,
      description: task.context,
      identity: task.platform ? { kind: 'platform', platform: task.platform } : { kind: 'agent', role: task.agent },
      data: task,
    };
    });
    return [...summaryEvents, ...taskEvents];
  }, [summaries, independentTasks, visibleIndependentIds, demo, now, timeZone]);

  const renderDetails = (event: LsCalendarEvent, closeDetails: () => void) => {
    const task = event.data as AgentCalendarTask;
    const overdue = !demo && taskIsOverdue(task, now);
    const workflowNodes = task.internalNodes?.length ? task.internalNodes : [task];
    const assistantRoles = agentRoleOrder.filter(role => role !== task.agent && role !== 'human' && workflowNodes.some(node => node.agent === role));
    const deliveryTime = task.dueAt
      ? calendarTimestampLabel(task.dueAt, task.calendarClock)
      : taskIsAllDay(task) ? `${task.date} · 当天事项` : `${task.date} ${task.time} · ${task.calendarClock?.label || '冻结时区未知'}`;
    const open = (action: ((task: AgentCalendarTask) => void) | undefined) => {
      if (!action) return;
      captureAgentCalendarReturnContext({positionKey,offset:0,cardId:task.id});
      flushSync(closeDetails);
      action(task);
    };
    const action = !demo && task.enterpriseFactExceptionId && onOpenEnterpriseFacts
      ? { label: "进入企业知识库补齐原任务事实", run: () => open(onOpenEnterpriseFacts) }
      : !demo && task.accountBindingTarget && onBindAccount
      ? { label: '绑定发布账号', run: () => open(onBindAccount) }
      : !demo && task.customerExecutionTarget && onOpenCustomerExecution
      ? { label: '进入真实客服承接任务', run: () => open(onOpenCustomerExecution) }
      : !demo && task.supplementTarget && onOpenSupplement
      ? { label: '处理当前真实补齐任务', run: () => open(onOpenSupplement) }
      : !demo && hasTemplateCalendarTarget(task) && onOpenTemplate
        ? { label: '查看真实模板来源与经营核验', run: () => open(onOpenTemplate) }
        : !demo && hasReviewCalendarTarget(task) && onOpenReview
          ? { label: '查看真实社媒指标与冻结复盘', run: () => open(onOpenReview) }
          : !demo && hasPlanningCalendarTarget(task) && onOpenPlanning
            ? { label: '查看本周真实参考分析与排期', run: () => open(onOpenPlanning) }
            : !demo && (hasCalendarProductionBinding(task) || canOpenContentTask?.(task)) && onOpenProduction
              ? { label: task.publicationExecutionTarget ? '查看真实发布安排与平台尝试' : task.nativeRecoveryTarget ? '核验原生发送异常与真实回执' : task.publicationRecoveryTarget ? '处理发布恢复任务' : task.sendRecoveryTarget ? '核验原发送异常与真实回执' : task.productionTaskId ? '进入这条任务的生产实况' : '核验此任务生产对象与上游', run: () => open(onOpenProduction) }
              : demo && onOpenProduction ? {label: '打开参考生产预览', run: () => open(onOpenProduction)} : null;

    return <div className="space-y-5">
      <div><div className="flex flex-wrap items-center gap-2"><Tag color={event.status === 'failed' ? 'error' : event.status === 'needs_action' ? 'warning' : event.status === 'working' ? 'processing' : event.status === 'done' ? 'success' : 'default'}>{event.statusLabel || statusLabels[task.status]}</Tag>{task.minutes !== null && <span className="text-xs text-text-secondary">预计 {task.minutes} 分钟</span>}</div><h3 className="mt-2 ls-type-title-medium text-text-primary">{task.title}</h3></div>
      <section aria-label="负责 Agent" className="space-y-2"><div className="flex flex-wrap gap-2"><AgentIdentityCard role={task.agent} relation="主 Agent"/>{assistantRoles.map(role => <AgentIdentityCard key={role} role={role} relation="辅助 Agent"/>)}</div>{assistantRoles.length === 0 && <p className="text-xs text-text-secondary">当前没有记录辅助 Agent；流程只显示已分配的真实责任。</p>}</section>
      <dl className="grid gap-3 rounded-lg border border-border bg-white p-4 sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-xs text-text-secondary">交付时间</dt><dd className="mt-1 break-words text-sm font-medium text-text-primary">{deliveryTime}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-text-secondary">交付内容</dt><dd className="mt-1 break-words text-sm font-medium text-text-primary">{task.output}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-text-secondary">交付形式</dt><dd className="mt-1 break-words text-sm font-medium text-text-primary">{deliveryFormLabel(task)}</dd></div>
      </dl>
      <section aria-label="当前进度" className="rounded-lg bg-surface-2 p-4"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-text-primary">当前进度</h4><span className="text-xs text-text-secondary">{workflowNodes.filter(node => ['completed', 'cancelled', 'no_data'].includes(node.status)).length}/{workflowNodes.length} 步完成</span></div><Steps direction="vertical" size="small" current={Math.max(0, workflowNodes.findIndex(node => !['completed', 'cancelled', 'no_data'].includes(node.status)))} items={workflowNodes.map(node => ({ status: stepStatus(node.status), title: node.title, description: <span className="text-xs text-text-secondary">{agentLabels[node.agent]} · {statusLabels[node.status]} · {node.date} {node.time}{node.reason ? <><br/><span className="text-amber-700">{node.reason}</span></> : null}</span> }))}/></section>
      {overdue && <Alert type="error" showIcon title={`交付已逾期 · ${taskOverdueLabel(task, now)}`} description={`负责人：${task.assignee || agentLabels[task.agent]}；原因：${task.reason || '截止前尚未取得本任务核验交付'}；受影响发布：${task.affectedPublicationIds?.join('、') || '待核对真实下游依赖'}`}/>}
      {task.deadlineRecovery && <Alert type="warning" showIcon title={`经营 Agent 补救评估 · ${task.deadlineRecovery.status === 'blocked' ? '评估受阻' : '已评估，方案未生效'}`} description={`${task.deadlineRecovery.assessmentId} · ${calendarTimestampLabel(task.deadlineRecovery.assessedAt, task.calendarClock)}；受影响发布：${task.deadlineRecovery.affectedPublicationIds.join('、') || '无已绑定发布'}`}/>}
      {task.reason && !overdue && <Alert type="warning" showIcon title="当前卡点" description={task.reason}/>}
      {action ? <Button type="primary" onClick={action.run}>{action.label}</Button> : <p className="rounded-lg bg-surface-2 p-3 text-xs text-text-secondary">{demo ? '示例任务仅用于验收日历与详情。' : '此任务尚无可打开的真实业务对象；执行状态以后台记录为准。'}</p>}
    </div>;
  };

  return <section id="agent-weekly-calendar" key={scopeKey} data-agent-calendar-position-key={positionKey} className="scroll-mt-4 bg-white" aria-label={demo ? 'B2B 零基础首周任务日历' : 'Agent 周任务日历'}>
    <div className="border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="ls-type-title-large text-text-primary">{demo ? 'B2B 零基础 · 首周任务日历' : 'Agent 周任务日历'}</h3>
        <div className="flex flex-wrap gap-2">{Object.entries(agentLabels).map(([agent, label]) => <Tag key={agent}>{label}</Tag>)}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-text-secondary">{demo ? '参考预览会持续标记；真实任务以执行回执为准。' : `${independentTasks.length} 项独立任务 · ${calendarDurationLabel(independentTasks)}`}</p><Button size="small" aria-pressed={showAllIndependent} onClick={()=>{setShowAllIndependent(value=>!value);setExpandedSummaries(new Set());}}>{showAllIndependent?'隐藏所有独立卡':'显示所有独立卡'}</Button></div>
    </div>
    {!demo && tasks.length === 0 && <Alert className="m-4" type="info" showIcon title="尚无 Agent 执行排期" description="发布计划不会自动视为制作任务；生成执行排期后将在此显示。"/>}
    {pendingReferences.length > 0 && <Alert className="m-4" type="error" showIcon title={`当前待处理 · ${pendingReferences.length} 项原任务（按各任务冻结时区）`} description={<div><p>引用原任务，原计划卡保留；不计为新增交付。</p><p className="mt-1">{pendingReferences.map(task => `${task.title} · 原计划 ${task.date} · 逾期 ${calendarOverdueDuration(task, now)}${task.affectedPublicationIds?.length ? ` · 受影响发布 ${task.affectedPublicationIds.join('、')}` : ''}`).join('；')}</p></div>}/>}
    {demo && <Alert className="m-4" type="warning" showIcon title="参考排期" description="任务、工时与执行状态为参考预览，异常副链路仅用于验收。"/>}
    <ul className="sr-only">{events.map(event => {
      if(isSummaryEventData(event.data))return <li key={event.id}>{event.title} · {event.statusLabel}</li>;
      const task = event.data as AgentCalendarTask;
      return <li key={event.id}>{agentCalendarTaskType(task)} · {event.title} · {event.statusLabel}{task.affectedPublicationIds?.length ? ` · 受影响发布 ${task.affectedPublicationIds.join('、')}` : ''}</li>;
    })}</ul>
    {<Suspense fallback={<p className="p-5 text-xs text-text-secondary">正在加载日历…</p>}><LsCalendar
        key={positionKey}
        label={demo ? 'B2B 零基础首周任务日历' : 'Agent 周任务日历'}
        events={events}
        initialDate={calendarDate}
        date={calendarDate}
        view={calendarView}
        initialView={calendarView}
        onDatesSet={info => { const next = calendarDayKey(info.view.calendar.getDate(), timeZone); setCalendarDate(next); setCalendarView(info.view.type as LsCalendarView); }}
        firstDay={1}
        timeZone={timeZone}
        timeGridHeight="clamp(420px, calc(100dvh - 260px), 760px)"
        detailsLayout="custom"
        renderDetails={renderDetails}
        onEventClick={event=>{if(!isSummaryEventData(event.data))return false;const key=event.data.summary.key;if(showAllIndependent){setShowAllIndependent(false);setExpandedSummaries(new Set([key]));}else setExpandedSummaries(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});return true;}}
      /></Suspense>}
  </section>;
}
