import { calendarDurationLabel, hasCalendarProductionBinding, isCalendarTaskOverdue, calendarOverdueDuration, calendarPendingReferences, type AgentCalendarTask } from './AgentWeeklyCalendar';
import {agentCalendarAuthIdentity, captureAgentCalendarReturnContext, readAgentCalendarReturnContext, registerAgentCalendarReturnState, restoreAgentCalendarReturnContext} from '../../lib/agentCalendarReturnContext';
import type {LsCalendarView} from '../ui/LsCalendar';
import { flushSync } from 'react-dom';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Tag } from 'antd';
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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const deliverables = useMemo(() => projectCalendarDeliverables(tasks), [tasks]);
  const pendingReferences = demo ? [] : calendarPendingReferences(deliverables, now);
  const timeZone = tasks.find(task => task.calendarClock?.timeZone)?.calendarClock?.timeZone || 'Asia/Shanghai';
  const events = useMemo<LsCalendarEvent[]>(() => deliverables.filter(task => !agentRole || task.agent === agentRole || task.agent === "human").map(task => {
    const overdue = !demo && isCalendarTaskOverdue(task, now);
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
      statusLabel: overdue ? `交付已逾期 · ${calendarOverdueDuration(task, now)}` : task.deliveryTiming === 'late' ? '已完成 · 晚交付' : task.deliveryTiming === 'on_time' ? '已完成 · 按时' : statusLabels[task.status],
      eventType: task.agent === 'customer' ? 'follow_up' : 'agent_task',
      ownerAgent: task.assignee || agentLabels[task.agent],
      sourceId: task.productionTaskId || task.id,
      description: task.context,
      data: task,
    };
  }), [deliverables, agentRole, demo, now, timeZone]);

  const renderDetails = (event: LsCalendarEvent, closeDetails: () => void) => {
    const task = event.data as AgentCalendarTask;
    const overdue = !demo && isCalendarTaskOverdue(task, now);
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

    return <div className="space-y-4">
      <dl className="ls-calendar-details">
        <div><dt>{task.timeSemantics === 'start' ? '计划开始' : '计划完成'}</dt><dd>{taskIsAllDay(task) ? `${task.date} · 当天事项` : `${task.date} ${task.time} · ${task.calendarClock?.label || '冻结时区未知'}`}</dd></div>
        {task.dueAt && <div><dt>规定完成截止</dt><dd>{calendarTimestampLabel(task.dueAt, task.calendarClock)}</dd></div>}
        {task.sourceVersion !== undefined && <div><dt>原 v{task.sourceVersion} 任务规定截止</dt><dd>{task.sourceDeadlineAt ? calendarTimestampLabel(task.sourceDeadlineAt) : '原截止待核验'}</dd></div>}
        {task.status === 'completed' && <div><dt>实际完成</dt><dd>{task.actualFinishedAt ? calendarTimestampLabel(task.actualFinishedAt, task.sourceVersion !== undefined ? calendarClock(task.sourceDeadlineAt) : task.calendarClock) : '完成时间待核验'} · {task.deliveryTiming === 'late' ? '晚交付' : task.deliveryTiming === 'on_time' ? '按时交付' : '是否按时待核验'}</dd></div>}
        <div><dt>当天交付</dt><dd>{task.output}</dd></div>
        <div><dt>执行状态</dt><dd>{statusLabels[task.status]} · {task.minutes === null ? '工时待估' : `预计 ${task.minutes} 分钟`}</dd></div>
      </dl>
      {task.chain && <p className="text-xs text-text-secondary">{task.chain} · {task.chain.includes('-S') ? '副链路' : '主链路'}</p>}
      {task.dependsOn?.length ? <div><p className="text-xs font-semibold text-text-secondary">上游交付</p><p className="mt-1 text-xs text-text-primary">{task.dependsOn.join('、')}</p></div> : null}
      {task.internalNodes?.length ? <section aria-label="Agent 协作任务流" className="max-h-60 overflow-y-auto rounded-lg bg-surface-2 p-3"><h4 className="text-xs font-semibold text-text-primary">Agent 协作任务流</h4><ol className="mt-2 space-y-2">{task.internalNodes.map(node => <li key={node.id} className="border-l-2 border-border pl-3 text-xs"><p className="font-semibold text-text-primary">{node.title}</p><p className="text-text-secondary">{agentLabels[node.agent]} · {statusLabels[node.status]} · {node.date} {node.time}</p>{node.reason && <p className="text-amber-700">{node.reason}</p>}</li>)}</ol></section> : null}
      {overdue && <Alert type="error" showIcon title={`交付已逾期 · ${calendarOverdueDuration(task, now)}`} description={`负责人：${task.assignee || agentLabels[task.agent]}；原因：${task.reason || '截止前尚未取得本任务核验交付'}；受影响发布：${task.affectedPublicationIds?.join('、') || '待核对真实下游依赖'}`}/>}
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
      <p className="mt-1 text-xs text-text-secondary">{demo ? '参考预览会持续标记；真实任务以执行回执为准。' : `${deliverables.length} 项真实交付 · ${calendarDurationLabel(deliverables)}`}</p>
    </div>
    {!demo && tasks.length === 0 && <Alert className="m-4" type="info" showIcon title="尚无 Agent 执行排期" description="发布计划不会自动视为制作任务；生成执行排期后将在此显示。"/>}
    {pendingReferences.length > 0 && <Alert className="m-4" type="error" showIcon title={`当前待处理 · ${pendingReferences.length} 项原任务（按各任务冻结时区）`} description={<div><p>引用原任务，原计划卡保留；不计为新增交付。</p><p className="mt-1">{pendingReferences.map(task => `${task.title} · 原计划 ${task.date} · 逾期 ${calendarOverdueDuration(task, now)}`).join('；')}</p></div>}/>}
    {demo && <Alert className="m-4" type="warning" showIcon title="参考排期" description="任务、工时与执行状态为参考预览，异常副链路仅用于验收。"/>}
    <ul className="sr-only">{events.map(event => {
      const task = event.data as AgentCalendarTask;
      return <li key={event.id}>{event.title} · {event.statusLabel}{task.affectedPublicationIds?.length ? ` · 受影响发布 ${task.affectedPublicationIds.join('、')}` : ''}</li>;
    })}</ul>
    {<Suspense fallback={<p className="p-5 text-xs text-text-secondary">正在加载日历…</p>}><LsCalendar
        key={positionKey}
        label={demo ? 'B2B 零基础首周任务日历' : 'Agent 周任务日历'}
        events={events}
        initialDate={calendarDate}
        date={calendarDate}
        view={calendarView}
        initialView={calendarView}
        onDatesSet={info => { const next = calendarDayKey(info.view.currentStart, timeZone); setCalendarDate(next); setCalendarView(info.view.type as LsCalendarView); }}
        firstDay={1}
        timeZone={timeZone}
        timeGridHeight="clamp(420px, calc(100dvh - 260px), 760px)"
        renderDetails={renderDetails}
      /></Suspense>}
  </section>;
}
