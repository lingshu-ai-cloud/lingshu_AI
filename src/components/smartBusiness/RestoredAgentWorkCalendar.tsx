import { calendarDurationLabel, hasCalendarProductionBinding, isCalendarTaskOverdue, calendarOverdueDuration, calendarPendingReferences, type AgentCalendarTask } from './AgentWeeklyCalendar';
import {agentCalendarAuthIdentity, captureAgentCalendarReturnContext, readAgentCalendarReturnContext, registerAgentCalendarReturnState, restoreAgentCalendarReturnContext} from '../../lib/agentCalendarReturnContext';
import type {LsCalendarView} from '../ui/LsCalendar';
import { flushSync } from 'react-dom';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Steps, Switch, Tag } from 'antd';
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
import { hourCalendarCard } from './agentHourCalendarPolicy';
import { projectCalendarDeliverables } from './calendarDeliverables';
import AgentRoleIcon, { AGENT_ROLE_PALETTE, type AgentVisualRole } from '../ui/AgentRoleIcon';
import {agentCalendarIdentityLabel,agentCalendarTaskGroup,agentCalendarTaskType,buildAgentCalendarSummaries,calendarDisplayPlaceholders,taskHasDeliverableOrWorkspace,type AgentCalendarSummary} from './agentCalendarGroups';
import {readWeeklyTaskWorkspace} from '../../lib/weeklyTaskWorkspaceApi';
import type {WeeklyTaskWorkspace} from '../../../shared/contracts/weeklyTaskWorkspace';

const LsCalendar = typeof document === 'undefined'
  ? function ServerCalendar({ events, label }: { events: LsCalendarEvent[]; label: string }) {
      return <div aria-label={label}>{events.map(event => <span key={event.id}>{event.title} · {event.statusLabel}</span>)}</div>;
    }
  : lazy(() => import('../ui/LsCalendar').then(module => ({ default: module.LsCalendar })));

const agentLabels: Record<AgentCalendarTask['agent'], string> = {
  human: '人工处理',
  business: '经营智能体',
  director: '编导智能体',
  content: '内容智能体',
  customer: '客服智能体',
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
type AggregateEventData = {
  kind: 'aggregate';
  group: 'weekly-start' | 'production-chain' | 'publishing' | 'weekly-review';
  date: string;
  childIds: string[];
};
function isSummaryEventData(value: unknown): value is SummaryEventData {
  return Boolean(value && typeof value === 'object' && (value as SummaryEventData).kind === 'summary');
}
function isAggregateEventData(value: unknown): value is AggregateEventData {
  return Boolean(value && typeof value === 'object' && (value as AggregateEventData).kind === 'aggregate');
}

/** Keep placeholder clicks separate from persisted task details. */
export function agentCalendarDetailKind(event: Pick<LsCalendarEvent, 'data'>): 'placeholder' | 'task' {
  return isSummaryEventData(event.data) ? 'placeholder' : 'task';
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
  if (summary.group === 'production' || summary.group === 'quality' || summary.group === 'publishing') return 'content';
  if (summary.group === 'inquiries') return 'customer';
  return 'business';
}

function clockMinutes(time: string | undefined): number {
  const [hour, minute] = (time || '00:00').split(':').map(Number);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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
  const [activeFilter, setActiveFilter] = useState<'attention' | AgentCalendarTask['agent'] | 'all'>(agentRole || 'all');
  const [hideCompleted, setHideCompleted] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [taskWorkspace,setTaskWorkspace]=useState<{task:AgentCalendarTask;item:WeeklyTaskWorkspace|null;error:string;loading:boolean}|null>(null);
  useEffect(() => setActiveFilter(agentRole || 'all'), [agentRole]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const deliverables = useMemo(() => projectCalendarDeliverables(tasks), [tasks]);
  const timeZone = tasks.find(task => task.calendarClock?.timeZone)?.calendarClock?.timeZone || 'Asia/Shanghai';
  const attentionCount = useMemo(() => deliverables.filter(task => ['blocked', 'failed'].includes(task.status) || task.agent === 'human' || taskIsOverdue(task, now)).length, [deliverables, now]);
  const scopedDeliverables = useMemo(() => deliverables.filter(task => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'attention') return ['blocked', 'failed'].includes(task.status) || task.agent === 'human' || taskIsOverdue(task, now);
    return task.agent === activeFilter || task.agent === 'human';
  }), [deliverables, activeFilter, now]);
  const pendingReferences = demo ? [] : calendarPendingReferences(scopedDeliverables, now);
  const dates = useMemo(() => weekDates(calendarDate), [calendarDate]);
  const mondayContentStart = useMemo(() => {
    const monday = dates[0];
    const lastBusinessFinish = deliverables
      .filter(task => task.date === monday && task.agent === 'business' && agentCalendarTaskGroup(task) === 'foundation')
      .reduce((latest, task) => Math.max(latest, clockMinutes(task.time) + Math.max(30, task.minutes ?? 60)), 0);
    // Monday production never begins before lunch. When business work runs
    // later, leave one half-hour handoff window before directing starts.
    return clockLabel(Math.max(13 * 60, Math.ceil((lastBusinessFinish + 30) / 30) * 30));
  }, [dates, deliverables]);
  const summaries = useMemo(() => buildAgentCalendarSummaries(scopedDeliverables, dates), [scopedDeliverables, dates]);
  const independentTasks = useMemo(() => scopedDeliverables.filter(taskHasDeliverableOrWorkspace), [scopedDeliverables]);
  // Cadence placeholders are useful only in the explicit demo preview. A
  // connected weekly package must render persisted backend tasks exclusively:
  // missing work is a contract/blocker problem and must never look executable.
  const placeholders = useMemo(
    () => demo ? calendarDisplayPlaceholders(summaries, calendarDate) : [],
    [demo, summaries, calendarDate],
  );
  const events = useMemo<LsCalendarEvent[]>(() => {
    const summaryEvents: LsCalendarEvent[] = placeholders.map(summary => {
      const mondayStart = clockMinutes(mondayContentStart);
      const mondayContentTimes: Partial<Record<AgentCalendarSummary['group'], string>> = { directing: mondayContentStart, production: clockLabel(mondayStart + 75), quality: clockLabel(mondayStart + 135) };
      const displayTime = summary.date === dates[0] ? mondayContentTimes[summary.group] || summary.startTime : summary.startTime;
      const start = calendarInstant(`${summary.date}T${displayTime}`, timeZone).toISOString();
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
      cardLines: [
        agentCalendarIdentityLabel(owner),
        summary.title,
        `${displayTime} · 待排`,
      ],
      planPlaceholder: true,
      identity: {kind: 'agent', role: owner},
      data: {kind:'summary',summary} satisfies SummaryEventData,
    });});
    const taskEvents: LsCalendarEvent[] = independentTasks
    .filter(task => !hideCompleted || !['completed', 'cancelled', 'no_data'].includes(task.status))
    .map(task => {
    const overdue = !demo && taskIsOverdue(task, now);
    const allDay = taskIsAllDay(task);
    const start = allDay ? task.date : taskInstant(task);
    const duration = Math.max(30, task.minutes ?? 60) * 60_000;
    const card = hourCalendarCard(task, now);
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
      cardLines: task.status === 'completed' ? [card.lines[0], card.lines[1], card.lines[2].split(' · ')[0]] : card.lines,
      planPlaceholder: false,
      identity: { kind: 'agent', role: task.agent },
      data: task,
    };
    });
    const rawEvents = [...summaryEvents, ...taskEvents];
    const productionGroups = new Set(['directing', 'production', 'quality']);
    const grouped = new Map<string, LsCalendarEvent[]>();
    const passthrough: LsCalendarEvent[] = [];
    for (const event of rawEvents) {
      const summary = isSummaryEventData(event.data) ? event.data.summary : null;
      const task = !summary ? event.data as AgentCalendarTask : null;
      const group = summary?.group || (task ? agentCalendarTaskGroup(task) : null);
      const rawDate = summary?.date || task?.date;
      const aggregate = group === 'foundation'
        ? 'weekly-start'
        : group && productionGroups.has(group)
          ? 'production-chain'
          : group === 'publishing'
            ? 'publishing'
            : group === 'review'
              ? 'weekly-review'
              : null;
      const date = aggregate === 'weekly-start' ? dates[0] : aggregate === 'weekly-review' ? dates[6] : rawDate;
      if (!aggregate || !date) { passthrough.push(event); continue; }
      const key = `${date}:${aggregate}`;
      grouped.set(key, [...(grouped.get(key) || []), event]);
    }
    const aggregateEvents = [...grouped.entries()].flatMap(([key, children]) => {
      const [date, group] = key.split(':') as [string, AggregateEventData['group']];
      const expanded = expandedGroups.has(key);
      const attention = children.some(event => ['needs_action', 'failed'].includes(event.status));
      const working = children.some(event => event.status === 'working');
      const allDone = children.length > 0 && children.every(event => event.status === 'done');
      const status: LsCalendarEvent['status'] = attention ? 'needs_action' : working ? 'working' : allDone ? 'done' : 'planned';
      const startTime = group === 'weekly-start' ? '08:00' : group === 'production-chain' ? date === dates[0] ? mondayContentStart : '08:30' : group === 'publishing' ? '17:30' : '20:00';
      const start = calendarInstant(`${date}T${startTime}`, timeZone).toISOString();
      const title = group === 'weekly-start' ? '本周经营准备' : group === 'production-chain' ? '今日内容生产' : group === 'publishing' ? '今日内容发布' : '本周数据复盘';
      const label = group === 'weekly-start'
        ? '目标与排期确认'
        : group === 'production-chain'
          ? date === dates[0] ? '经营准备完成后开始' : '编导 → 制作 → 质检'
          : group === 'publishing'
            ? `${children.length} 项发布安排`
            : '内容与发布完成后复盘';
      const owner = group === 'weekly-start' || group === 'weekly-review' ? 'business' : group === 'production-chain' ? 'director' : 'content';
      const aggregateEvent: LsCalendarEvent = {
        id: `aggregate:${key}`,
        title,
        start,
        end: new Date(Date.parse(start) + 60 * 60_000).toISOString(),
        allDay: false,
        timeZone,
        status,
        statusLabel: expanded ? '点击收起' : '点击展开',
        eventType: 'agent_task',
        ownerAgent: group === 'weekly-start' ? '周经营入口' : group === 'production-chain' ? '生产链摘要' : group === 'publishing' ? '内容发布摘要' : '周复盘入口',
        sourceId: key,
        description: label,
        cardLines: [agentCalendarIdentityLabel(owner), title, ''],
        planPlaceholder: children.every(event => event.planPlaceholder),
        identity: {kind: 'agent', role: owner},
        data: {kind: 'aggregate', group, date, childIds: children.map(event => event.id)} satisfies AggregateEventData,
      };
      return expanded ? [aggregateEvent, ...children] : [aggregateEvent];
    });
    return [...passthrough, ...aggregateEvents];
  }, [placeholders, independentTasks, demo, now, timeZone, hideCompleted, expandedGroups, dates, mondayContentStart]);

  const renderDetails = (event: LsCalendarEvent, closeDetails: () => void) => {
    if (agentCalendarDetailKind(event) === 'placeholder') {
      const { summary } = event.data as SummaryEventData;
      const owner = summaryAgent(summary);
      return <div className="space-y-5">
        <div>
          <Tag>待排计划环节</Tag>
          <h3 className="mt-2 ls-type-title-medium text-text-primary">{summary.title}</h3>
          <p className="mt-2 text-sm text-text-secondary">这个时间段用于提示本周流程仍缺少真实执行任务，不代表已经创建或执行了 Agent 任务。</p>
        </div>
        <AgentIdentityCard role={owner} relation="主 Agent"/>
        <dl className="grid gap-3 rounded-lg border border-border bg-white p-4 sm:grid-cols-2">
          <div><dt className="text-xs text-text-secondary">计划时间</dt><dd className="mt-1 text-sm font-medium text-text-primary">{summary.date} {summary.startTime}</dd></div>
          <div><dt className="text-xs text-text-secondary">当前状态</dt><dd className="mt-1 text-sm font-medium text-text-primary">{summary.progress}</dd></div>
        </dl>
        <Alert type="info" showIcon title="等待真实任务" description="运行层生成真实任务后，此占位会被对应任务卡替换；届时点击任务卡可查看交付内容、负责 Agent、进度与业务入口。"/>
      </div>;
    }
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
    const action = !demo && task.workspaceTarget
      ? {label:'进入任务生产现场',run:()=>{const target=task.workspaceTarget!;captureAgentCalendarReturnContext({positionKey,offset:0,cardId:task.id});flushSync(closeDetails);setTaskWorkspace({task,item:null,error:'',loading:true});void readWeeklyTaskWorkspace(target).then(item=>setTaskWorkspace(current=>current?.task.id===task.id?{task,item,error:'',loading:false}:current)).catch(cause=>setTaskWorkspace(current=>current?.task.id===task.id?{task,item:null,error:cause instanceof Error?cause.message:'任务生产现场读取失败。',loading:false}:current));}}
      : !demo && task.enterpriseFactExceptionId && onOpenEnterpriseFacts
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
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按智能体筛选">
          {([
            ['attention', `需我处理 ${attentionCount}`],
            ['business', '经营'],
            ['director', '编导'],
            ['content', '内容'],
            ['customer', '客服'],
            ['all', '全部'],
          ] as const).map(([value, label]) => <Button key={value} size="small" type={activeFilter === value ? 'primary' : 'default'} aria-pressed={activeFilter === value} onClick={() => setActiveFilter(value)}>{label}</Button>)}
          <span className="ml-1 inline-flex items-center gap-2 text-xs text-text-secondary"><Switch size="small" checked={hideCompleted} onChange={setHideCompleted}/>隐藏已完成</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-text-secondary">{demo ? '参考预览会持续标记；真实任务以执行回执为准。' : `${independentTasks.length} 项真实任务${placeholders.length ? ` · ${placeholders.length} 个待排计划环节` : ''} · ${calendarDurationLabel(independentTasks)}`}</p></div>
    </div>
    {!demo && tasks.length === 0 && <Alert className="m-4" type="info" showIcon title="尚无 Agent 执行排期" description="发布计划不会自动视为制作任务；生成执行排期后将在此显示。"/>}
    {pendingReferences.length > 0 && <Alert className="m-4" type="error" showIcon title={`当前待处理 · ${pendingReferences.length} 项原任务（按各任务冻结时区）`} description={<div><p>引用原任务，原计划卡保留；不计为新增交付。</p><p className="mt-1">{pendingReferences.map(task => `${task.title} · 原计划 ${task.date} · 逾期 ${calendarOverdueDuration(task, now)}${task.affectedPublicationIds?.length ? ` · 受影响发布 ${task.affectedPublicationIds.join('、')}` : ''}`).join('；')}</p></div>}/>}
    {demo && <Alert className="m-4" type="warning" showIcon title="参考排期" description="任务、工时与执行状态为参考预览，异常副链路仅用于验收。"/>}
    <ul className="sr-only">{events.map(event => {
      if(isAggregateEventData(event.data))return <li key={event.id}>{event.title} · {event.statusLabel}</li>;
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
        onEventClick={event => {
          if (!isAggregateEventData(event.data)) return false;
          const key = `${event.data.date}:${event.data.group}`;
          setExpandedGroups(current => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
          });
          return true;
        }}
        onDatesSet={info => { const next = calendarDayKey(info.view.calendar.getDate(), timeZone); setCalendarDate(next); setCalendarView(info.view.type as LsCalendarView); }}
        firstDay={1}
        timeZone={timeZone}
        timeGridHeight="clamp(420px, calc(100dvh - 380px), 560px)"
        collapseEmptyTimeRanges
        detailsLayout="custom"
        renderDetails={renderDetails}
      /></Suspense>}
    {taskWorkspace&&<div className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/35 p-4" onClick={()=>setTaskWorkspace(null)}><section role="dialog" aria-modal="true" aria-label="任务生产现场" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={event=>event.stopPropagation()}><div className="flex items-center justify-between gap-3"><div><Tag color="blue">任务生产现场</Tag><h3 className="mt-2 ls-type-title-medium">{taskWorkspace.task.title}</h3></div><Button onClick={()=>setTaskWorkspace(null)}>关闭</Button></div>{taskWorkspace.loading&&<p role="status" className="mt-5 text-sm text-text-secondary">正在核验持久化生产现场…</p>}{taskWorkspace.error&&<Alert className="mt-5" type="error" showIcon title="生产现场无法读取" description={taskWorkspace.error}/>} {taskWorkspace.item&&<div className="mt-5 space-y-4"><dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"><div><dt className="text-xs text-text-secondary">现场身份</dt><dd className="break-all text-sm">{taskWorkspace.item.workspaceId}</dd></div><div><dt className="text-xs text-text-secondary">当前阶段</dt><dd className="text-sm font-semibold">{taskWorkspace.item.phase}</dd></div><div><dt className="text-xs text-text-secondary">执行任务</dt><dd className="break-all text-sm">{taskWorkspace.item.executionTaskId}</dd></div><div><dt className="text-xs text-text-secondary">负责角色</dt><dd className="text-sm">{taskWorkspace.item.responsibleActor}</dd></div></dl><section className="rounded-xl bg-surface-2 p-4"><h4 className="text-sm font-semibold">真实依赖与卡点</h4>{taskWorkspace.item.upstreamTaskIds.length?<p className="mt-2 break-all text-xs">上游：{taskWorkspace.item.upstreamTaskIds.join('、')}</p>:<p className="mt-2 text-xs">无上游依赖</p>}{taskWorkspace.item.blockingCodes.length?<ul className="mt-2 list-disc pl-5 text-sm text-amber-800">{taskWorkspace.item.blockingCodes.map(code=><li key={code}>{code}</li>)}</ul>:<p className="mt-2 text-sm text-emerald-700">当前没有后端阻塞记录</p>}</section><section className="rounded-xl border p-4"><h4 className="text-sm font-semibold">真实业务对象</h4><p className="mt-2 text-xs">内容任务：{taskWorkspace.item.contentTaskId||'尚未由上游创建'}</p><p className="mt-1 text-xs">运行：{taskWorkspace.item.runId||'尚未启动'}</p><p className="mt-1 text-xs">结果引用：{taskWorkspace.item.resultRefs.length?taskWorkspace.item.resultRefs.map(ref=>`${ref.type}:${ref.id}:v${ref.version}`).join('、'):'尚无权威结果'}</p></section>{(taskWorkspace.task.enterpriseFactExceptionId&&onOpenEnterpriseFacts||taskWorkspace.task.accountBindingTarget&&onBindAccount||taskWorkspace.task.customerExecutionTarget&&onOpenCustomerExecution||taskWorkspace.task.supplementTarget&&onOpenSupplement||hasTemplateCalendarTarget(taskWorkspace.task)&&onOpenTemplate||hasReviewCalendarTarget(taskWorkspace.task)&&onOpenReview||hasPlanningCalendarTarget(taskWorkspace.task)&&onOpenPlanning||(hasCalendarProductionBinding(taskWorkspace.task)||canOpenContentTask?.(taskWorkspace.task))&&onOpenProduction)&&<Button type="primary" onClick={()=>{const task=taskWorkspace.task;setTaskWorkspace(null);if(task.enterpriseFactExceptionId&&onOpenEnterpriseFacts)return onOpenEnterpriseFacts(task);if(task.accountBindingTarget&&onBindAccount)return onBindAccount(task);if(task.customerExecutionTarget&&onOpenCustomerExecution)return onOpenCustomerExecution(task);if(task.supplementTarget&&onOpenSupplement)return onOpenSupplement(task);if(hasTemplateCalendarTarget(task)&&onOpenTemplate)return onOpenTemplate(task);if(hasReviewCalendarTarget(task)&&onOpenReview)return onOpenReview(task);if(hasPlanningCalendarTarget(task)&&onOpenPlanning)return onOpenPlanning(task);if(onOpenProduction)return onOpenProduction(task);}}>进入对应业务执行页面</Button>}</div>}</section></div>}
  </section>;
}
