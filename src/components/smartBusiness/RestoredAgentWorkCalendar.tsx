import { hasCalendarProductionBinding, isCalendarTaskOverdue, calendarOverdueDuration, type AgentCalendarTask } from './AgentWeeklyCalendar';
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
import { hourCalendarCard } from './agentHourCalendarPolicy';
import { projectCalendarDeliverables, projectDailyCustomerServiceCards, isAlwaysOnCalendarTask, orderDailyCalendarTasks, projectDailyMilestones, conciseCalendarTitle } from './calendarDeliverables';
import AgentRoleIcon, { AGENT_ROLE_PALETTE, type AgentVisualRole } from '../ui/AgentRoleIcon';
import {agentCalendarTaskType,taskHasDeliverableOrWorkspace} from './agentCalendarGroups';
import {readOrRepairWeeklyTaskWorkspace} from '../../lib/weeklyTaskWorkspaceApi';
import type {WeeklyTaskWorkspace} from '../../../shared/contracts/weeklyTaskWorkspace';
import {socialProgramApi} from '../../lib/socialProgramApi';
import WeeklyTaskQuickActions from '../socialProgram/WeeklyTaskQuickActions';

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
  if(task.executionStep==='weekly_review')return '目标交付核验清单与冻结周报';
  if(task.executionStep==='business_outline')return '周目标、验收标准与规划确认回执';
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

const terminalTaskStatuses = new Set<AgentCalendarTask['status']>(['completed', 'cancelled', 'no_data']);
export function calendarExecutionMark(task:AgentCalendarTask,today:string):LsCalendarEvent['executionMark']{
 const sources=task.dailyTaskGroup?.tasks??task.customerServiceSummary?.sourceTasks??[task];
 if(sources.length&&sources.every(source=>source.status==='completed'))return 'complete';
 if(task.date>=today)return undefined;
 if(sources.some(source=>!terminalTaskStatuses.has(source.status)))return 'missing';
 return undefined;
}

export function calendarTaskPresentation(task: AgentCalendarTask, today: string): Pick<LsCalendarEvent, 'status' | 'statusLabel' | 'muted'> {
  const terminal = terminalTaskStatuses.has(task.status);
  if (task.date < today) return {
    status: terminal ? 'done' : 'needs_action',
    statusLabel: terminal ? statusLabels[task.status] : '结果未完成',
    muted: true,
  };
  if (task.date > today) return {
    status: terminal ? 'done' : 'planned',
    statusLabel: terminal ? statusLabels[task.status] : '待执行',
    muted: false,
  };
  return {
    status: terminal ? 'done' : task.status === 'active' ? 'working' : 'planned',
    statusLabel: terminal ? statusLabels[task.status] : task.status === 'active' ? '进行中' : '今日待执行',
    muted: false,
  };
}

function taskEndInstant(task: AgentCalendarTask): number {
  const start = Date.parse(taskInstant(task));
  return Number.isFinite(start) ? start + Math.max(30, task.minutes ?? 60) * 60_000 : Number.NaN;
}

/** A passed calendar slot is overdue unless the persisted task has a terminal result. */
export function isPastUnfinishedCalendarTask(task: AgentCalendarTask, now: number): boolean {
  return !['completed', 'cancelled', 'no_data'].includes(task.status) && taskEndInstant(task) < now;
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

export function taskProgressPercent(task: AgentCalendarTask): number | undefined {
  const sources = task.dailyTaskGroup?.tasks ?? task.customerServiceSummary?.sourceTasks ?? task.internalNodes;
  if (sources?.length) {
    const completed = sources.filter(source => ['completed', 'no_data'].includes(source.status)).length;
    const active = sources.filter(source => source.status === 'active').length;
    return Math.round(((completed + active * 0.5) / sources.length) * 100);
  }
  if (task.status === 'active') return 50;
  if (['completed', 'no_data'].includes(task.status)) return 100;
  return undefined;
}

function hasActiveExecution(task: AgentCalendarTask): boolean {
  const sources = task.dailyTaskGroup?.tasks ?? task.customerServiceSummary?.sourceTasks ?? task.internalNodes;
  return task.status === 'active' || Boolean(sources?.some(source => source.status === 'active'));
}

type Props = {
  startsAt?: string;
  tasks: AgentCalendarTask[];
  demo?: boolean;
  onOpenProduction?: (task: AgentCalendarTask) => void;
  onEnterExecution?: (task:AgentCalendarTask,signal?:AbortSignal)=>Promise<void>;
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
  hideCompleted?: boolean;
};

export default function RestoredAgentWorkCalendar({
  startsAt,
  agentRole = "",
  onOpenEnterpriseFacts,
  tasks,
  demo = false,
  onOpenProduction,
  onEnterExecution,
  onOpenPlanning,
  onOpenReview,
  onOpenSupplement,
  onOpenTemplate,
  onOpenCustomerExecution,
  onBindAccount,
  scopeKey,
  canOpenContentTask,
  hideCompleted = false,
}: Props) {
  const positionKey = JSON.stringify([agentCalendarAuthIdentity(),scopeKey,startsAt,demo,'milestones-monday-v3']);
  const stateKey = `restoredAgentCalendar:${positionKey}`;
  const saved = readAgentCalendarReturnContext();
  const previous = saved?.calendar.positionKey === positionKey ? saved.states[stateKey] as {date?: string; view?: LsCalendarView} | undefined : undefined;
  const [calendarDate, setCalendarDate] = useState(previous?.date || startsAt || tasks[0]?.date || calendarDayKey(new Date()));
  const [calendarView, setCalendarView] = useState<LsCalendarView>('dayGridWeek');
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
    setCalendarView('dayGridWeek');
    if(context?.calendar.positionKey===positionKey)restoreAgentCalendarReturnContext(context);
  }, [positionKey]);
  const [now, setNow] = useState(() => Date.now());
  const [entryState,setEntryState]=useState<{id:string;busy:boolean;error:string}|null>(null);
  const entryController=useRef<AbortController|null>(null);
  useEffect(()=>{entryController.current?.abort();setEntryState(null);return()=>entryController.current?.abort();},[positionKey]);
  const [executionRuntime,setExecutionRuntime]=useState<'checking'|'disabled'|'ready'|'unavailable'>('checking');
  const runtimeScopes=[...new Set(tasks.flatMap(t=>t.workspaceTarget?[JSON.stringify([t.workspaceTarget.programId,t.workspaceTarget.packageId,t.workspaceTarget.packageVersion])]:[]))];
  const runtimeScopeKey=runtimeScopes.length===1?runtimeScopes[0]!:null;
  useEffect(()=>{
    if(demo)return;
    setExecutionRuntime('checking');
    if(!runtimeScopeKey){setExecutionRuntime('unavailable');return;}
    const [programId,packageId,version]=JSON.parse(runtimeScopeKey) as [string,string,number];
    const controller=new AbortController();let reading=false;
    const refresh=async()=>{if(reading||controller.signal.aborted)return;reading=true;try{const result=await socialProgramApi.readExecutionPipeline(programId,packageId,version);const runtime=result.worker;if(!controller.signal.aborted)setExecutionRuntime(runtime.configuredEnabled&&runtime.started&&runtime.state!=='failed'?'ready':runtime.configuredEnabled===false||runtime.started===false?'disabled':'unavailable');}catch{if(!controller.signal.aborted)setExecutionRuntime('unavailable');}finally{reading=false;}};
    void refresh();const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},30000);
    return()=>{controller.abort();window.clearInterval(timer);};
  },[demo,positionKey,runtimeScopeKey]);
  const [taskWorkspace,setTaskWorkspace]=useState<{task:AgentCalendarTask;item:WeeklyTaskWorkspace|null;error:string;loading:boolean}|null>(null);
  const workspaceReadGeneration=useRef(0);
  useEffect(()=>{workspaceReadGeneration.current++;setTaskWorkspace(null);},[positionKey]);
  const openWorkspace=(task:AgentCalendarTask)=>{
    const target=task.workspaceTarget;
    if(!target)return;
    const generation=++workspaceReadGeneration.current;
    captureAgentCalendarReturnContext({positionKey,offset:0,cardId:task.id});
    setTaskWorkspace({task,item:null,error:'',loading:true});
    void readOrRepairWeeklyTaskWorkspace(target).then(item=>{
      if(workspaceReadGeneration.current===generation)setTaskWorkspace(current=>current?.task.id===task.id?{task,item,error:'',loading:false}:current);
    }).catch(cause=>{
      if(workspaceReadGeneration.current===generation)setTaskWorkspace(current=>current?.task.id===task.id?{task,item:null,error:cause instanceof Error?cause.message:'任务生产现场读取失败。',loading:false}:current);
    });
  };
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const deliverables = useMemo(() => projectDailyMilestones(projectDailyCustomerServiceCards(projectCalendarDeliverables(tasks, true), startsAt)), [tasks, startsAt]);
  const timeZone = tasks.find(task => task.calendarClock?.timeZone)?.calendarClock?.timeZone || 'Asia/Shanghai';
  const todayKey = calendarDayKey(new Date(now), timeZone);
  const scopedDeliverables = useMemo(() => deliverables.filter(task => {
    if (!agentRole) return true;
    return task.agent === agentRole || task.agent === 'human' || task.dailyTaskGroup?.tasks.some(source=>source.agent==='human');
  }), [deliverables, agentRole]);
  const independentTasks = useMemo(() => scopedDeliverables.filter(taskHasDeliverableOrWorkspace), [scopedDeliverables]);
  const events = useMemo<LsCalendarEvent[]>(() => {
    const orderedTasks = orderDailyCalendarTasks(independentTasks);
    const currentTaskId = orderedTasks.find(task => task.date === todayKey && !isAlwaysOnCalendarTask(task) && hasActiveExecution(task))?.id;
    return orderedTasks
    .filter(task => !hideCompleted || !['completed', 'cancelled', 'no_data'].includes(task.status))
    .map(task => {
    const overdue = false;
    const allDay = true;
    const resident = isAlwaysOnCalendarTask(task);
    const start = task.date;
    const card = hourCalendarCard(task, now);
    const presentation = calendarTaskPresentation(task, todayKey);
    return {
      id: task.id,
      title: task.title,
      start,
      end: undefined,
      allDay,
      timeZone: task.calendarClock?.timeZone || timeZone,
      status: presentation.status,
      executionMark: calendarExecutionMark(task, todayKey),
      statusLabel: presentation.statusLabel,
      eventType: task.agent === 'customer' ? 'follow_up' : 'agent_task',
      ownerAgent: calendarCardOwner(task, overdue),
      platform: task.platform,
      sourceId: task.productionTaskId || task.id,
      description: task.context,
      cardLines: [card.lines[0], task.title, `${resident?'24小时值守':task.dailyTaskGroup?`${task.dailyTaskGroup.tasks.length} 项任务`:'按流程执行'} · ${presentation.statusLabel}`],
      planPlaceholder: false,
      progress: task.id === currentTaskId ? taskProgressPercent(task) : undefined,
      muted: presentation.muted,
      identity: { kind: 'agent', role: task.agent },
      data: task,
    };
    });
  }, [independentTasks, demo, now, timeZone, hideCompleted, todayKey]);

  const renderDetails = (event: LsCalendarEvent, closeDetails: () => void) => {
    const task = event.data as AgentCalendarTask;
    const overdue = false;
    const workflowNodes = task.internalNodes?.length ? task.internalNodes : [task];
    const assistantRoles = agentRoleOrder.filter(role => role !== task.agent && role !== 'human' && workflowNodes.some(node => node.agent === role));
    const deliveryTime = `${task.date} · ${isAlwaysOnCalendarTask(task)?'全天值守':'当日按任务流程执行'}`;
    const open = (action: ((task: AgentCalendarTask) => void) | undefined, source = task) => {
      if (!action) return;
      captureAgentCalendarReturnContext({positionKey,offset:0,cardId:source.id});
      flushSync(closeDetails);
      action(source);
    };
    const primarySource=task.dailyTaskGroup?.tasks.find(source=>source.executionStep===task.executionStep)??task.dailyTaskGroup?.tasks[0];
    const executionSources=task.dailyTaskGroup?.tasks??task.customerServiceSummary?.sourceTasks??[task];
    const blockerLabels:Record<string,string>={weekly_package_pending_activation:'周任务包仍为草稿，尚未启用执行',business_goal_unavailable:'经营目标未就绪：需要已验证的客户转化入口',capacity_plan_unavailable:'容量决策尚未通过校验',automation_policy_unavailable:'自动化策略尚未就绪',weekly_initial_capacity_schedule_required:'首次容量排期尚未确认',business_dispatch_required:'等待排期确认及正式派单'};
    const blockers=[...new Set([...(executionRuntime==='disabled'?['周任务自动执行器未启动，不会自动消费任务队列']:executionRuntime==='unavailable'?['自动执行器状态无法核验，不能确认管线已启动']:[]),...executionSources.flatMap(source=>source.executionBlockers??(source.reason?[source.reason]:[]))])];
    const resultRefs=[...new Map(executionSources.flatMap(source=>source.executionResultRefs??[]).map(ref=>[JSON.stringify(ref),ref])).values()];
    const entryTarget=primarySource??task.customerServiceSummary?.sourceTasks.find(source=>source.customerExecutionTarget)??task;
    const enterSource=(source:AgentCalendarTask)=>{if(!onEnterExecution)return;entryController.current?.abort();const controller=new AbortController();entryController.current=controller;const id=task.id;setEntryState({id,busy:true,error:''});void onEnterExecution(source,controller.signal).then(()=>{if(controller.signal.aborted)return;setEntryState(null);closeDetails();}).catch(cause=>{if(!controller.signal.aborted)setEntryState({id,busy:false,error:cause instanceof Error?cause.message:'真实执行入口不可用'});});};
    const openSource=(source:AgentCalendarTask)=>{
      if(['user_approval','publishing'].includes(source.executionStep??'')&&onEnterExecution)return enterSource(source);
      if(source.enterpriseFactExceptionId&&onOpenEnterpriseFacts)return open(onOpenEnterpriseFacts,source);
      if(source.accountBindingTarget&&onBindAccount)return open(onBindAccount,source);
      if(source.customerExecutionTarget&&onOpenCustomerExecution)return open(onOpenCustomerExecution,source);
      if(source.supplementTarget&&onOpenSupplement)return open(onOpenSupplement,source);
      if(hasTemplateCalendarTarget(source)&&onOpenTemplate)return open(onOpenTemplate,source);
      if(hasReviewCalendarTarget(source)&&onOpenReview)return open(onOpenReview,source);
      if(hasPlanningCalendarTarget(source)&&onOpenPlanning)return open(onOpenPlanning,source);
      if((hasCalendarProductionBinding(source)||canOpenContentTask?.(source))&&onOpenProduction)return open(onOpenProduction,source);
      if(onEnterExecution)return enterSource(source);
      if(source.workspaceTarget){flushSync(closeDetails);openWorkspace(source);}
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
              : !demo && onEnterExecution && (task.dailyTaskGroup||task.customerServiceSummary||task.workspaceTarget)
                ? {label:'进入真实执行界面',run:()=>openSource(entryTarget)}
                : !demo && primarySource?.workspaceTarget
                  ? {label:'进入对应生产现场',run:()=>openSource(primarySource)}
                  : !demo && task.workspaceTarget
                    ? {label:'进入任务生产现场',run:()=>openSource(task)}
              : demo && onOpenProduction ? {label: '打开参考生产预览', run: () => open(onOpenProduction)} : null;

    const channelLabel={whatsapp:'WhatsApp',messenger:'Messenger',instagram:'Instagram'} as const;
    const summary=task.customerServiceSummary;

    return <div className="space-y-5">
      {!demo&&<WeeklyTaskQuickActions sources={executionSources} onOpen={source=>enterSource(source)} onPlanning={onOpenPlanning?()=>open(onOpenPlanning):undefined}/>}
      <div><div className="flex flex-wrap items-center gap-2"><Tag color={event.status === 'failed' ? 'error' : event.status === 'needs_action' ? 'warning' : event.status === 'working' ? 'processing' : event.status === 'done' ? 'success' : 'default'}>{event.statusLabel || statusLabels[task.status]}</Tag>{task.minutes !== null && <span className="text-xs text-text-secondary">预计 {task.minutes} 分钟</span>}</div><h3 className="mt-2 ls-type-title-medium text-text-primary">{task.title}</h3></div>
      <section aria-label="负责 Agent" className="space-y-2"><div className="flex flex-wrap gap-2"><AgentIdentityCard role={task.agent} relation="主 Agent"/>{assistantRoles.map(role => <AgentIdentityCard key={role} role={role} relation="辅助 Agent"/>)}</div>{assistantRoles.length === 0 && <p className="text-xs text-text-secondary">当前没有记录辅助 Agent；流程只显示已分配的真实责任。</p>}</section>
      <dl className="grid gap-3 rounded-lg border border-border bg-white p-4 sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-xs text-text-secondary">交付时间</dt><dd className="mt-1 break-words text-sm font-medium text-text-primary">{deliveryTime}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-text-secondary">交付内容</dt><dd className="mt-1 break-words text-sm font-medium text-text-primary">{task.output}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-text-secondary">交付形式</dt><dd className="mt-1 break-words text-sm font-medium text-text-primary">{deliveryFormLabel(task)}</dd></div>
      </dl>
      <section aria-label="交付物与当前受阻原因" className="rounded-lg border border-border p-4"><h4 className="text-sm font-semibold">交付物与当前受阻原因</h4><p className="mt-2 text-sm">预期交付：{task.output}</p><p className="mt-2 text-sm">实际结果：{resultRefs.length?`已有 ${resultRefs.length} 项后端结果凭据；不等同于整个节点已交付`:'尚无后端结果凭据，未生成可核验交付物'}</p>{resultRefs.length>0&&<details className="mt-2 text-xs"><summary>查看真实结果引用</summary>{resultRefs.map(ref=><p key={JSON.stringify(ref)} className="break-all">{ref.type} · {ref.id} · v{ref.version}</p>)}</details>}<h5 className="mt-3 text-xs font-semibold">当前受阻原因</h5>{blockers.length?<ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-800">{blockers.map(code=><li key={code}>{blockerLabels[code]??code}</li>)}</ul>:<p className="mt-2 text-xs text-text-secondary">后端暂无独立阻塞记录；不代表任务已启动或完成。</p>}{entryState?.id===task.id&&entryState.error&&<Alert className="mt-3" showIcon type="warning" title="真实执行入口未就绪" description={entryState.error}/>}</section>
{summary&&<section aria-label="常驻客服任务详情" className="rounded-lg border border-border bg-white p-4"><h4 className="text-sm font-semibold text-text-primary">渠道运行状态</h4><div className="mt-3 flex flex-wrap gap-2">{summary.channels.map(item=><Tag key={item.channel} color={item.status==='failed'?'error':item.status==='blocked'?'warning':item.status==='active'?'processing':item.status==='completed'?'success':'default'}>{channelLabel[item.channel]} · {statusLabels[item.status]}</Tag>)}</div><dl className="mt-4 grid gap-3 sm:grid-cols-3"><div><dt className="text-xs text-text-secondary">关联运行记录</dt><dd className="mt-1 text-lg font-semibold">{summary.sourceTaskCount}</dd></div><div><dt className="text-xs text-text-secondary">已完成核验</dt><dd className="mt-1 text-lg font-semibold">{summary.completedCount}</dd></div><div><dt className="text-xs text-text-secondary">需要处理</dt><dd className="mt-1 text-lg font-semibold">{summary.attentionCount}</dd></div></dl><p className="mt-3 text-xs text-text-secondary">常驻卡片是每日客服入口；真实客户会话、审批、交接和渠道回执仍以后台持久化记录为准。</p></section>}
      {summary&&<section aria-label="客服真实任务与生产线程" className="space-y-2"><h4 className="text-sm font-semibold">客服真实任务与生产线程</h4>{summary.channels.map(({channel})=><details key={channel} className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{channelLabel[channel]} · {summary.sourceTasks.filter(source=>source.customerExecutionTarget?.channel===channel).length} 项真实任务</summary><div className="mt-2 space-y-2">{summary.sourceTasks.filter(source=>source.customerExecutionTarget?.channel===channel).map(source=><Button key={source.id} data-customer-execution-id={source.id} block className="!h-auto !whitespace-normal !text-left" onClick={()=>openSource(source)}>{source.date} · {source.title} · {statusLabels[source.status]}</Button>)}</div></details>)}</section>}
      {task.dailyTaskGroup&&<details aria-label="同日合并的真实任务" className="space-y-2"><summary className="cursor-pointer text-sm font-semibold">包含 {task.dailyTaskGroup.tasks.length} 项真实生产步骤与对象</summary>{task.dailyTaskGroup.tasks.map(source=><Button key={source.id} data-daily-execution-id={source.id} block className="!h-auto !whitespace-normal !text-left" onClick={()=>openSource(source)}>{conciseCalendarTitle(source.title)} · {statusLabels[source.status]}<span className="block text-xs text-text-secondary">{source.context}</span></Button>)}</details>}
      {!summary&&!task.dailyTaskGroup&&<section aria-label="当前进度" className="rounded-lg bg-surface-2 p-4"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-text-primary">当前进度</h4><span className="text-xs text-text-secondary">{workflowNodes.filter(node => ['completed', 'cancelled', 'no_data'].includes(node.status)).length}/{workflowNodes.length} 步完成</span></div><Steps direction="vertical" size="small" current={Math.max(0, workflowNodes.findIndex(node => !['completed', 'cancelled', 'no_data'].includes(node.status)))} items={workflowNodes.map(node => ({ status: stepStatus(node.status), title: node.title, description: <span className="text-xs text-text-secondary">{agentLabels[node.agent]} · {statusLabels[node.status]} · {node.date} {node.time}{node.reason ? <><br/><span className="text-amber-700">{node.reason}</span></> : null}</span> }))}/></section>}
      {!summary&&task.dependsOn?.length ? <section aria-label="真实上游依赖" className="space-y-2"><h4 className="text-sm font-semibold">真实上游依赖</h4>{task.dependsOn.map(id=>{const source=tasks.find(candidate=>candidate.id===id);return source?.workspaceTarget?<Button key={id} block className="!h-auto !whitespace-normal !text-left" onClick={()=>openSource(source)}>{source.title} · {statusLabels[source.status]}</Button>:<p key={id} className="text-xs text-text-secondary">{source?.title||id}</p>;})}</section>:null}
      {overdue && <Alert type="error" showIcon title={`交付已逾期 · ${taskOverdueLabel(task, now)}`}/>}
      {task.deadlineRecovery && <Alert type="warning" showIcon title={`经营 Agent 补救评估 · ${task.deadlineRecovery.status === 'blocked' ? '评估受阻' : '已评估，方案未生效'}`} description={`${task.deadlineRecovery.assessmentId} · ${calendarTimestampLabel(task.deadlineRecovery.assessedAt, task.calendarClock)}；受影响发布：${task.deadlineRecovery.affectedPublicationIds.join('、') || '无已绑定发布'}`}/>}
      {task.reason && !overdue && <Alert type="warning" showIcon title="当前卡点" description={task.reason}/>}
      {action ? <Button type="primary" loading={entryState?.id===task.id&&entryState.busy} onClick={action.run}>{action.label}</Button> : !summary&&!task.dailyTaskGroup&&<p className="rounded-lg bg-surface-2 p-3 text-xs text-text-secondary">{demo ? '示例任务仅用于验收日历与详情。' : '此任务尚无可打开的真实业务对象；执行状态以后台记录为准。'}</p>}
    </div>;
  };

  return <section id="agent-weekly-calendar" key={scopeKey} data-agent-calendar-position-key={positionKey} className="scroll-mt-4 bg-white" aria-label={demo ? 'B2B 零基础首周任务日历' : 'Agent 周任务日历'}>
    {!demo && tasks.length === 0 && <Alert className="m-4" type="info" showIcon title="尚无 Agent 执行排期" description="发布计划不会自动视为制作任务；生成执行排期后将在此显示。"/>}
    {demo && <Alert className="m-4" type="warning" showIcon title="参考排期" description="任务、工时与执行状态为参考预览，异常副链路仅用于验收。"/>}
    <ul className="sr-only">{events.map(event => {
      const task = event.data as AgentCalendarTask;
      return <li key={event.id}>{agentCalendarTaskType(task)} · {event.title} · {event.statusLabel}{task.affectedPublicationIds?.length ? ` · 受影响发布 ${task.affectedPublicationIds.join('、')}` : ''}</li>;
    })}</ul>
    {<Suspense fallback={<p className="p-5 text-xs text-text-secondary">正在加载日历…</p>}><LsCalendar
        key={positionKey}
        label={demo ? 'B2B 零基础首周任务日历' : 'Agent 周任务日历'}
        events={events}
        initialDate={calendarDate}
        view={calendarView}
        initialView={calendarView}
        dateOnly
        taskBoard
        showAllEvents
        visualVariant="agent"
        narrowView="listWeek"
        detailsTitle="任务详情"
        onDetailsClose={()=>{entryController.current?.abort();setEntryState(null);}}
        onDatesSet={info => { const next = calendarDayKey(info.view.calendar.getDate(), timeZone); setCalendarDate(next); setCalendarView(info.view.type as LsCalendarView); }}
        firstDay={1}
        timeZone={timeZone}
        timeGridHeight={calendarView === 'listWeek' ? 'auto' : 'clamp(680px, calc(100dvh - 120px), 800px)'}
        collapseEmptyTimeRanges
        detailsLayout="custom"
        renderDetails={renderDetails}
      /></Suspense>}
    {taskWorkspace&&<div className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/35 p-4" onClick={()=>setTaskWorkspace(null)}><section role="dialog" aria-modal="true" aria-label="任务生产现场" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={event=>event.stopPropagation()}><div className="flex items-center justify-between gap-3"><div><Tag color="blue">任务生产现场</Tag><h3 className="mt-2 ls-type-title-medium">{taskWorkspace.task.title}</h3></div><Button onClick={()=>setTaskWorkspace(null)}>关闭</Button></div>{taskWorkspace.loading&&<p role="status" className="mt-5 text-sm text-text-secondary">正在核验持久化生产现场…</p>}{taskWorkspace.error&&<Alert className="mt-5" type="error" showIcon title="生产现场无法读取" description={taskWorkspace.error}/>} {taskWorkspace.item&&<div className="mt-5 space-y-4"><dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"><div><dt className="text-xs text-text-secondary">现场身份</dt><dd className="break-all text-sm">{taskWorkspace.item.workspaceId}</dd></div><div><dt className="text-xs text-text-secondary">当前阶段</dt><dd className="text-sm font-semibold">{taskWorkspace.item.phase}</dd></div><div><dt className="text-xs text-text-secondary">执行任务</dt><dd className="break-all text-sm">{taskWorkspace.item.executionTaskId}</dd></div><div><dt className="text-xs text-text-secondary">负责角色</dt><dd className="text-sm">{taskWorkspace.item.responsibleActor}</dd></div></dl><section className="rounded-xl bg-surface-2 p-4"><h4 className="text-sm font-semibold">真实依赖与卡点</h4>{taskWorkspace.item.upstreamTaskIds.length?<p className="mt-2 break-all text-xs">上游：{taskWorkspace.item.upstreamTaskIds.join('、')}</p>:<p className="mt-2 text-xs">无上游依赖</p>}{taskWorkspace.item.blockingCodes.length?<ul className="mt-2 list-disc pl-5 text-sm text-amber-800">{taskWorkspace.item.blockingCodes.map(code=><li key={code}>{code}</li>)}</ul>:<p className="mt-2 text-sm text-emerald-700">当前没有后端阻塞记录</p>}</section><section className="rounded-xl border p-4"><h4 className="text-sm font-semibold">真实业务对象</h4><p className="mt-2 text-xs">内容任务：{taskWorkspace.item.contentTaskId||'尚未由上游创建'}</p><p className="mt-1 text-xs">运行：{taskWorkspace.item.runId||'尚未启动'}</p><p className="mt-1 text-xs">结果引用：{taskWorkspace.item.resultRefs.length?taskWorkspace.item.resultRefs.map(ref=>`${ref.type}:${ref.id}:v${ref.version}`).join('、'):'尚无权威结果'}</p></section>{(taskWorkspace.task.enterpriseFactExceptionId&&onOpenEnterpriseFacts||taskWorkspace.task.accountBindingTarget&&onBindAccount||taskWorkspace.task.customerExecutionTarget&&onOpenCustomerExecution||taskWorkspace.task.supplementTarget&&onOpenSupplement||hasTemplateCalendarTarget(taskWorkspace.task)&&onOpenTemplate||hasReviewCalendarTarget(taskWorkspace.task)&&onOpenReview||hasPlanningCalendarTarget(taskWorkspace.task)&&onOpenPlanning||(hasCalendarProductionBinding(taskWorkspace.task)||canOpenContentTask?.(taskWorkspace.task))&&onOpenProduction)&&<Button type="primary" onClick={()=>{const task=taskWorkspace.task;setTaskWorkspace(null);if(task.enterpriseFactExceptionId&&onOpenEnterpriseFacts)return onOpenEnterpriseFacts(task);if(task.accountBindingTarget&&onBindAccount)return onBindAccount(task);if(task.customerExecutionTarget&&onOpenCustomerExecution)return onOpenCustomerExecution(task);if(task.supplementTarget&&onOpenSupplement)return onOpenSupplement(task);if(hasTemplateCalendarTarget(task)&&onOpenTemplate)return onOpenTemplate(task);if(hasReviewCalendarTarget(task)&&onOpenReview)return onOpenReview(task);if(hasPlanningCalendarTarget(task)&&onOpenPlanning)return onOpenPlanning(task);if(onOpenProduction)return onOpenProduction(task);}}>进入对应业务执行页面</Button>}</div>}</section></div>}
  </section>;
}
