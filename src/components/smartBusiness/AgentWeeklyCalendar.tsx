import {validWeeklySalesTaskBinding,type WeeklySalesNavigationTarget} from '../socialProgram/weeklySalesNavigation';
import {projectCalendarDeliverables} from './calendarDeliverables';
import type {CrossWeekMaterialTarget} from '../socialProgram/crossWeekMaterialCalendar';
import type {CustomerExceptionTarget} from '../socialProgram/weeklyCustomerExceptionCalendar';
import type {PublicationRecoveryTarget} from '../socialProgram/weeklyPublicationRecoveryCalendar';
import type {NativeRecoveryTarget} from '../socialProgram/weeklyNativeRecoveryCalendar';
import type {CustomerSendRecoveryTarget} from '../socialProgram/weeklyCustomerSendRecoveryNavigation';
import {calendarClock,calendarDateTime,calendarTimestampLabel,type CalendarClock} from '../socialProgram/calendarTime';
import {hasTemplateCalendarTarget,type TemplateCalendarTarget} from '../socialProgram/templateCalendarNavigation';
import type {ReviewCalendarTarget} from '../socialProgram/reviewCalendarNavigation';
import {hasReviewCalendarTarget} from '../socialProgram/reviewCalendarNavigation';
import type {PlanningCalendarTarget} from '../socialProgram/planningCalendarNavigation';
import type {CustomerExecutionCalendarTarget} from '../socialProgram/customerExecutionCalendarNavigation';
import type {PublicationExecutionTarget} from '../socialProgram/publicationExecutionCalendarNavigation';
import {hasPlanningCalendarTarget} from '../socialProgram/planningCalendarNavigation';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import {agentCalendarAuthIdentity,captureAgentCalendarReturnContext,readAgentCalendarReturnContext,restoreAgentCalendarReturnContext} from '../../lib/agentCalendarReturnContext';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, X } from 'lucide-react';

export type AgentCalendarTask = {
  id: string;
  deliverableGroup?: string;
  executionStep?: string;
  calendarInternal?: boolean;
  accountBindingTarget?: {platform:string;accountId:string|null;consumerIds:string[]};
  internalNodes?: AgentCalendarTask[];
  date: string;
  time: string;
  agent: 'business' | 'director' | 'content' | 'customer' | 'human';
  title: string;
  output: string;
  context: string;
  minutes: number | null;
  status: 'planned' | 'active' | 'completed' | 'blocked' | 'cancelled' | 'failed' | 'no_data';
  reason?: string;
  chain?: string;
  dependsOn?: string[];
  assignee?: string;
  dueAt?: string;
  deadlineRecovery?: { assessmentId: string; assessedAt: string; status: 'evaluated' | 'blocked'; blockingReasons: string[]; affectedPublicationIds: string[] };
  calendarClock?: CalendarClock;
  deadlineTracked?: boolean;
  sourceDeadlineAt?: string;
  sourceVersion?: number;
  actualFinishedAt?: string;
  deliveryTiming?: 'on_time' | 'late' | 'unknown';
  affectedPublicationIds?: string[];
  submission?: "missing" | "pending" | "accepted" | "rejected";
  humanAction?: 'upload' | 'approval';
  availableForHuman?: boolean;
  salesTarget?: WeeklySalesNavigationTarget;
  salesHandoffId?:string; salesPackageId?:string; salesPackageVersion?:number; salesAction?:'claim'|'feedback';
  supplementTarget?:{tenantId:string;programId:string;packageId:string;packageVersion:number;requestId:string;action:'submission'|'verification'};
  templateTarget?: TemplateCalendarTarget;
  reviewTarget?: ReviewCalendarTarget;
  planningTarget?: PlanningCalendarTarget;
  customerExecutionTarget?: CustomerExecutionCalendarTarget;
  sendRecoveryTarget?: CustomerSendRecoveryTarget;
  nativeRecoveryTarget?: NativeRecoveryTarget;
  publicationRecoveryTarget?: PublicationRecoveryTarget;
  publicationExecutionTarget?: PublicationExecutionTarget;
  inventoryTarget?: {tenantId:string;programId:string;packageId:string;packageVersion:number;bindingId:string;publicationTaskId:string;taskId:string};
  crossWeekMaterialTarget?: CrossWeekMaterialTarget;
  customerExceptionTarget?: CustomerExceptionTarget;
  productionTaskId?: string;
  /** Exact persisted weekly execution task that owns the production binding. */
  productionExecutionTaskId?: string;
  materialRequestId?: string;
  materialAction?: 'upload' | 'verification';
  materialConsumerTaskIds?: string[];
  customerRunId?: string;
  customerWorkflowTaskId?: string;
  customerTaskKey?: string;
  timeSemantics?: 'start' | 'finish';
};
const agents = {
  human: { label: "人工任务", tone: "bg-rose-50 text-rose-800", stripe: "border-t-rose-500" },
  business: { label: '经营 Agent', tone: 'bg-emerald-50 text-emerald-800', stripe: 'border-t-emerald-500' },
  director: { label: '编导 Agent', tone: 'bg-violet-50 text-violet-800', stripe: 'border-t-violet-500' },
  content: { label: '内容 Agent', tone: 'bg-sky-50 text-sky-800', stripe: 'border-t-sky-500' },
  customer: { label: '客服 Agent', tone: 'bg-orange-50 text-orange-800', stripe: 'border-t-orange-400' },
};
const statuses = { planned: '待执行', active: '进行中', completed: '已完成', blocked: '需处理', cancelled: '已取消', failed: '执行失败', no_data: '无符合条件的客户' };
export function calendarDurationLabel(tasks: AgentCalendarTask[]): string {
  const known=tasks.filter(task=>task.minutes!==null),unknown=tasks.length-known.length;
  const hours=Math.round(known.reduce((sum,task)=>sum+(task.minutes??0),0)/60*10)/10;
  return known.length ? `${unknown?'已估':'预计'} ${hours} 小时${unknown?` · ${unknown} 项待估`:''}` : unknown ? `${unknown} 项工时待估` : '暂无工时';
}
export function hasCalendarProductionBinding(task: AgentCalendarTask): boolean {
  return Boolean((task.publicationExecutionTarget&&task.id===task.publicationExecutionTarget.taskId)||(task.inventoryTarget&&task.id===task.inventoryTarget.taskId&&task.inventoryTarget.bindingId&&task.inventoryTarget.publicationTaskId)||(task.agent==='human'&&task.crossWeekMaterialTarget&&task.id===`cross-week-material:${task.crossWeekMaterialTarget.continuationId}:verification`&&task.crossWeekMaterialTarget.requestId&&task.crossWeekMaterialTarget.consumerTaskId)||(task.agent==='human'&&task.customerExceptionTarget&&task.id===`customer-exception:${task.customerExceptionTarget.requestId}:${task.customerExceptionTarget.action}`&&task.customerExceptionTarget.runId&&task.customerExceptionTarget.itemId&&task.customerExceptionTarget.memberId&&['submission','verification'].includes(task.customerExceptionTarget.action))||(task.agent==='human'&&task.publicationRecoveryTarget&&task.id===`publication-recovery:${task.publicationRecoveryTarget.id}`&&task.publicationRecoveryTarget.taskId&&task.publicationRecoveryTarget.attemptId&&task.publicationRecoveryTarget.tenantId&&task.publicationRecoveryTarget.programId&&task.publicationRecoveryTarget.packageId&&Number.isSafeInteger(task.publicationRecoveryTarget.packageVersion)&&task.publicationRecoveryTarget.packageVersion>0)||(task.agent==='human'&&task.nativeRecoveryTarget&&task.id===`native-send-recovery:${task.nativeRecoveryTarget.id}`&&task.nativeRecoveryTarget.requestId&&task.nativeRecoveryTarget.taskId&&task.nativeRecoveryTarget.runId&&task.nativeRecoveryTarget.itemId&&task.nativeRecoveryTarget.tenantId&&task.nativeRecoveryTarget.programId&&task.nativeRecoveryTarget.packageId&&Number.isSafeInteger(task.nativeRecoveryTarget.packageVersion)&&task.nativeRecoveryTarget.packageVersion>0&&['messenger','instagram'].includes(task.nativeRecoveryTarget.channel))||(task.agent==='human'&&task.sendRecoveryTarget&&task.id===`send-recovery:${task.sendRecoveryTarget.id}`&&task.sendRecoveryTarget.channel==='whatsapp'&&task.sendRecoveryTarget.tenantId&&task.sendRecoveryTarget.programId&&task.sendRecoveryTarget.packageId&&Number.isSafeInteger(task.sendRecoveryTarget.packageVersion)&&task.sendRecoveryTarget.packageVersion>0&&task.sendRecoveryTarget.runId&&task.sendRecoveryTarget.taskId&&task.sendRecoveryTarget.itemId)||validWeeklySalesTaskBinding(task) || task.productionExecutionTaskId || task.productionTaskId || (task.agent === 'human' && task.materialRequestId && ['upload','verification'].includes(task.materialAction || '')) || (task.agent === 'customer' && task.customerRunId && task.customerWorkflowTaskId && task.customerTaskKey));
}
export function isHumanTaskOverdue(task: AgentCalendarTask, now = Date.now()): boolean {
  return task.agent === 'human' && task.availableForHuman !== false && !['completed','cancelled'].includes(task.status)
    && Boolean(task.dueAt && now > Date.parse(task.dueAt) && (task.supplementTarget || task.salesHandoffId || ['missing','rejected'].includes(task.submission || '')));
}
export function isCalendarTaskOverdue(task: AgentCalendarTask, now = Date.now()): boolean {
  if (['completed','cancelled','no_data'].includes(task.status)) return false;
  if (task.agent === 'human' && !task.deadlineTracked) return isHumanTaskOverdue(task, now);
  return Boolean(task.dueAt && now > Date.parse(task.dueAt));
}
export function calendarOverdueDuration(task: AgentCalendarTask, now = Date.now()): string {
  const minutes = Math.max(1, Math.floor((now - Date.parse(task.dueAt || '')) / 60000));
  return minutes >= 1440 ? `${Math.floor(minutes / 1440)} 天 ${Math.floor(minutes % 1440 / 60)} 小时` : minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟` : `${minutes} 分钟`;
}
export function calendarPendingReferences(tasks: AgentCalendarTask[], now = Date.now()): AgentCalendarTask[] {
  return [...new Map(tasks.filter(task => task.date < calendarDateTime(now,task.calendarClock??calendarClock(task.dueAt)).date && isCalendarTaskOverdue(task, now)).map(task => [task.id, task])).values()];
}
function key(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function shift(date: Date, count: number) { const result = new Date(date); result.setDate(result.getDate() + count); return result; }

const calendarPositions = new Map<string,{offset:number;selectedId:null;lastCardId?:string|null}>();
function calendarVisible(positionKey:string){return typeof document!=='undefined'&&Array.from(document.querySelectorAll<HTMLElement>('[data-agent-calendar-position-key]')).some(node=>node.dataset.agentCalendarPositionKey===positionKey&&node.getClientRects().length>0);}
function savedCalendarPosition(positionKey:string){const returned=readAgentCalendarReturnContext()?.calendar;return returned?.positionKey===positionKey?{offset:returned.offset,selectedId:null,lastCardId:returned.cardId}:calendarPositions.get(positionKey);}

export default function AgentWeeklyCalendar({ startsAt, tasks, demo = false, onOpenProduction,onOpenPlanning,onOpenReview,onOpenTemplate,onOpenSupplement,onOpenCustomerExecution,scopeKey,canOpenContentTask,onBindAccount }: { startsAt?: string; tasks: AgentCalendarTask[]; demo?: boolean; onOpenProduction?: (task: AgentCalendarTask) => void;onOpenPlanning?: (task:AgentCalendarTask)=>void;onOpenReview?:(task:AgentCalendarTask)=>void;onOpenSupplement?:(task:AgentCalendarTask)=>void;onOpenTemplate?:(task:AgentCalendarTask)=>void;onOpenCustomerExecution?:(task:AgentCalendarTask)=>void;scopeKey?:string;canOpenContentTask?:(task:AgentCalendarTask)=>boolean;onBindAccount?:(task:AgentCalendarTask)=>void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  const deliverables = projectCalendarDeliverables(tasks);
  const pendingReferences = demo ? [] : calendarPendingReferences(deliverables, now);
  const positionKey = JSON.stringify([agentCalendarAuthIdentity(),scopeKey,startsAt,demo]);
  const [offset, setOffset] = useState(()=>savedCalendarPosition(positionKey)?.offset ?? 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedScope,setSelectedScope]=useState(positionKey);
  const [lastCardId,setLastCardId]=useState<string|null>(()=>savedCalendarPosition(positionKey)?.lastCardId??null);
  useEffect(()=>{const saved=savedCalendarPosition(positionKey);setOffset(saved?.offset??0);setSelectedId(null);setLastCardId(saved?.lastCardId??null);setSelectedScope(positionKey);restoreAgentCalendarReturnContext();},[positionKey]);
  useEffect(()=>{if(selectedScope===positionKey)calendarPositions.set(positionKey,{offset,selectedId:null,lastCardId});},[positionKey,selectedScope,offset,lastCardId]);
  const changeOffset=(next:number)=>{captureAgentCalendarReturnContext({positionKey,offset:next,cardId:lastCardId??''});setOffset(next);};
  const startUserScroll=()=>{if(calendarVisible(positionKey)&&selectedScope===positionKey)captureAgentCalendarReturnContext({positionKey,offset,cardId:lastCardId??''});};
  const selectCard=(task:AgentCalendarTask)=>{captureAgentCalendarReturnContext({positionKey,offset,cardId:task.id});setSelectedScope(positionKey);setLastCardId(task.id);setSelectedId(task.id);};
  const selected = selectedScope===positionKey ? deliverables.find(task => task.id === selectedId) ?? null : null;
  const openTaskDestination = (task: AgentCalendarTask, open: (task: AgentCalendarTask) => void) => {
    // Commit dismissal before callbacks navigate or reveal another page's controls.
    captureAgentCalendarReturnContext({positionKey,offset,cardId:task.id});
    flushSync(() => {setSelectedId(null);setLastCardId(task.id);});
    calendarPositions.set(positionKey, {offset, selectedId: null,lastCardId:task.id});
    open(task);
  };
  const displayClock = tasks.find(task=>task.calendarClock)?.calendarClock ?? calendarClock();
  const currentDate = calendarDateTime(now,displayClock).date;
  const parsed = new Date(`${(startsAt || currentDate).slice(0,10)}T00:00:00`);
  const anchor = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const monday = shift(anchor, -((anchor.getDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => shift(monday, i));
  const weekTasks = deliverables.filter(task => task.date >= key(days[0]) && task.date <= key(days[6]));
  const establishedDemo = demo && tasks.some(task=>task.chain?.startsWith('H-'));
  const demoSourceAllocation = establishedDemo ? tasks.find(task=>task.chain==='H-M1')?.output.match(/自有 \d+% \/ 外部 \d+%/)?.[0] ?? '来源配额待核验' : '';
  const earlierTasks = deliverables.filter(task => task.date < key(days[0]));
  return <div id="agent-weekly-calendar" data-agent-calendar-position-key={positionKey} className="scroll-mt-4 p-5 sm:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div><h3 className="text-lg font-black text-slate-950">{demo ? establishedDemo ? "B2B 有基础 · 增长周任务日历" : "B2B 零基础 · 首周任务日历" : "Agent 周任务日历"}</h3><p className="mt-1 text-xs text-slate-500">{demo ? establishedDemo ? `${demoSourceAllocation} · 按播放与赞转评诊断 · H 主链路与副链路` : "外部参考 100% · 3 条母版 / 6 个平台版本 · 主链路与按需触发的副链路" : "按每日交付展示已生成的任务、主负责 Agent 和上游依赖"}</p></div>
      <div className="flex items-center gap-2"><button type="button" aria-label="上一周" onClick={() => changeOffset(offset - 1)} className="rounded-lg border border-slate-200 p-2"><ArrowLeft size={14}/></button><span className="text-xs font-bold text-slate-700">{days[0].toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} — {days[6].toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span><button type="button" aria-label="下一周" onClick={() => changeOffset(offset + 1)} className="rounded-lg border border-slate-200 p-2"><ArrowRight size={14}/></button><button type="button" onClick={() => changeOffset(0)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">本周</button></div>
    </div>
    <div className="mb-4 flex flex-wrap items-center gap-3 text-[10px] font-bold">{Object.values(agents).map(agent => <span key={agent.label} className={`rounded-full px-2.5 py-1 ${agent.tone}`}>{agent.label}</span>)}<span className="ml-auto text-slate-400">{weekTasks.length} 项交付{demo ? ' · 示例排期' : ''}</span></div>
    {!demo && tasks.length === 0 && <p className="mb-4 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-600">尚无可展示的 Agent 执行排期。发布计划不会自动视为制作任务；生成执行排期后将在此显示。</p>}
    {earlierTasks.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><p>当前周之前还有 {earlierTasks.length} 项任务，请核对前置素材与生产交付。周一发布所需成片应在前一天完成。</p><button type="button" onClick={() => changeOffset(offset - 1)} className="rounded border border-amber-300 px-2 py-1 font-bold">查看上一周任务</button></div>}
    {pendingReferences.length > 0 && <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900"><p className="font-bold">当前待处理 · {pendingReferences.length} 项原任务（按各任务冻结时区）</p><div className="mt-2 flex flex-wrap gap-2">{pendingReferences.map(task => <button key={task.id} type="button" className="rounded border border-red-200 bg-white px-2 py-1 text-left" onClick={() => selectCard(task)}>{task.title} · 当前 {calendarDateTime(now,task.calendarClock??calendarClock(task.dueAt)).date} {task.calendarClock?.label || calendarClock(task.dueAt).label} · 原计划 {task.date} · 逾期 {calendarOverdueDuration(task, now)}</button>)}</div><p className="mt-2">引用原任务，原计划卡保留；不计为新增交付。</p></div>}
    {demo && <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">效果验收示例：任务、工时与执行状态为演示数据；异常副链路展示触发示例，不代表所有任务都必然发生。点击卡片查看任务详情。</p>}
    <div data-agent-calendar-scroll onWheel={startUserScroll} onTouchStart={startUserScroll} onPointerDown={startUserScroll} onScroll={()=>{const saved=readAgentCalendarReturnContext()?.calendar;if(calendarVisible(positionKey)&&selectedScope===positionKey&&saved?.positionKey===positionKey&&saved.offset===offset)captureAgentCalendarReturnContext({positionKey,offset,cardId:lastCardId??''});}} className="overflow-x-auto rounded-2xl border border-slate-200"><div className="grid min-w-[1260px] grid-cols-7">
      {days.map((day, index) => {
        const items = weekTasks.filter(task => task.date === key(day)).sort((a, b) => a.time.localeCompare(b.time));
        const today = key(day) === currentDate;
        return <section key={key(day)} aria-label={`${['周一','周二','周三','周四','周五','周六','周日'][index]}任务`} className="min-w-0 border-r border-slate-200 last:border-r-0">
          <header className={`border-b border-slate-200 p-4 ${today ? 'bg-emerald-50' : 'bg-slate-50'}`}><div className="flex justify-between text-xs font-black text-slate-700"><span>{['周一','周二','周三','周四','周五','周六','周日'][index]}</span>{today && <span className="text-emerald-700">今天</span>}</div><p className="mt-1 text-xl font-black text-slate-950">{day.getMonth() + 1}/{day.getDate()}</p><p className="mt-2 text-[10px] text-slate-500">{items.length} 项交付 · {calendarDurationLabel(items)}</p></header>
          <div className="min-h-[420px] space-y-3 bg-slate-50/40 p-2.5">{items.map(task => {
            const agent = agents[task.agent];
            const overdue = isCalendarTaskOverdue(task, now);
            return <button type="button" key={task.id} data-agent-calendar-card-id={task.id} aria-current={lastCardId===task.id?'true':undefined} onClick={() => selectCard(task)} className={`w-full rounded-xl border border-slate-200 border-t-[3px] bg-white p-3 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md focus-visible:outline-emerald-600 ${lastCardId===task.id?"ring-2 ring-emerald-500 ring-offset-2":""} ${overdue ? "border-red-400 border-t-red-500 bg-red-50" : agent.stripe}`}>
              <div className="flex items-center justify-between gap-1 text-[9px]"><span className="font-bold text-slate-500">{task.time}{task.calendarClock ? ` ${task.calendarClock.label}` : ''}{task.timeSemantics === 'start' ? ' 开始' : ' 前完成'}</span><span className={task.status === 'blocked' ? 'text-amber-700' : task.status === 'active' ? 'text-sky-700' : 'text-slate-500'}>{overdue ? (task.agent !== 'human' ? '交付已逾期' : task.supplementTarget ? (task.supplementTarget.action==='submission'?'补齐提交已逾期':'补齐核验已逾期') : task.humanAction === "approval" ? "验收已逾期" : "上传已逾期") : task.submission === "pending" ? "已提交待核验" : task.deliveryTiming === 'late' ? '已完成 · 晚交付' : task.deliveryTiming === 'on_time' ? '已完成 · 按时' : task.deliveryTiming === 'unknown' ? '已完成 · 完成时间待核验' : statuses[task.status]}</span></div>
              {task.chain && <p className="mt-2 text-[9px] font-bold text-slate-400">{task.chain} · {task.chain.includes("-S") ? "副链路" : "主链路"}</p>}<h4 className="mt-2 text-xs font-black leading-5 text-slate-950">{task.title}</h4><span className={`mt-2 inline-block rounded-full px-2 py-1 text-[9px] font-bold ${agent.tone}`}>主负责 · {task.assignee || agent.label}</span>
              {task.deadlineRecovery && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] text-amber-900">补救评估：{task.deadlineRecovery.status === 'blocked' ? '受阻，等待真实预算、产能与工作时段核对' : '已评估，方案尚未生效'} · 经营 Agent</p>}
              {overdue && <p className="mt-2 text-[10px] text-red-800">逾期 {calendarOverdueDuration(task, now)} · 实际状态：{statuses[task.status]} · {task.reason || '截止前尚未取得本任务核验交付'}<br/>受影响发布：{task.affectedPublicationIds?.join('、') || '待核对真实下游依赖'}</p>}
              <p className="mt-2 text-[10px] leading-4 text-slate-500">{task.context}</p><p className="mt-3 border-t border-slate-100 pt-2 text-[10px] leading-4 text-slate-700"><span className="font-bold">交付：</span>{task.output}</p>
              <p className="mt-2 flex items-center gap-1 text-[9px] text-slate-400">{task.status === 'completed' ? <CheckCircle2 size={11}/> : <Clock3 size={11}/>}{task.minutes === null ? '工时待估' : `预计 ${task.minutes} 分钟`}</p>{task.dependsOn?.length ? <p className="mt-2 text-[9px] text-slate-500">等待 {task.dependsOn.length} 项上游交付</p> : null}{task.reason && <p className={`mt-2 rounded-lg p-2 text-[9px] leading-4 ${overdue ? "bg-red-100 text-red-800" : "bg-amber-50 text-amber-800"}`}>{task.reason}</p>}
            </button>;
          })}{!items.length && <p className="py-12 text-center text-xs text-slate-400">暂无已排期任务</p>}</div>
        </section>;
      })}
    </div></div>
    {selected && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/35 p-4" onClick={() => setSelectedId(null)}><section role="dialog" aria-modal="true" aria-label="任务详情" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()}><div className="flex items-center justify-between"><span className={`rounded-full px-3 py-1 text-xs font-bold ${agents[selected.agent].tone}`}>主负责 · {agents[selected.agent].label}</span><button type="button" autoFocus onClick={() => setSelectedId(null)} aria-label="关闭任务详情" className="rounded-full bg-slate-100 p-2"><X size={16}/></button></div><h3 className="mt-4 text-xl font-black text-slate-950">{selected.title}</h3><p className="mt-2 text-sm text-slate-500">{selected.context}</p><p className="mt-3 text-xs text-slate-500">{selected.chain ? `${selected.chain} · ` : ""}{selected.assignee ? `人工负责人：${selected.assignee}` : "Agent 执行任务"}</p><dl className="mt-5 space-y-3 text-sm"><div><dt className="text-slate-400">{selected.timeSemantics === 'start' ? '计划开始' : '计划完成'}</dt><dd>{selected.date} {selected.time} · {selected.calendarClock?.label || "冻结时区未知"}</dd></div>{selected.dueAt && <div><dt className="text-slate-400">规定完成截止</dt><dd>{calendarTimestampLabel(selected.dueAt,selected.calendarClock)}</dd></div>}{selected.sourceVersion !== undefined && <div><dt className="text-slate-400">原 v{selected.sourceVersion} 任务规定截止</dt><dd>{selected.sourceDeadlineAt ? calendarTimestampLabel(selected.sourceDeadlineAt) : '原截止待核验'}</dd></div>}{selected.status === 'completed' && <div><dt className="text-slate-400">实际完成</dt><dd>{selected.actualFinishedAt ? calendarTimestampLabel(selected.actualFinishedAt,selected.sourceVersion!==undefined?calendarClock(selected.sourceDeadlineAt):selected.calendarClock) : '完成时间待核验'} · {selected.deliveryTiming === 'late' ? '晚交付' : selected.deliveryTiming === 'on_time' ? '按时交付' : '是否按时待核验'}</dd></div>}{isCalendarTaskOverdue(selected,now) && <div className="text-red-800"><dt>交付已逾期 · {calendarOverdueDuration(selected, now)}</dt><dd>负责人：{selected.assignee || agents[selected.agent].label}；原因：{selected.reason || '截止前尚未取得本任务核验交付'}；受影响发布：{selected.affectedPublicationIds?.join('、') || '待核对真实下游依赖'}</dd></div>}<div><dt className="text-slate-400">当天交付</dt><dd>{selected.output}</dd></div><div><dt className="text-slate-400">执行状态</dt><dd>{statuses[selected.status]} · {selected.minutes === null ? '工时待估' : `预计 ${selected.minutes} 分钟`}</dd></div></dl>{selected.internalNodes?.length ? <section aria-label="Agent 协作任务流" className="mt-4 max-h-60 overflow-y-auto rounded-xl bg-slate-50 p-3"><h4 className="text-xs font-bold">Agent 协作任务流</h4><ol className="mt-2 space-y-3">{selected.internalNodes.map(node=><li key={node.id} className="border-l-2 border-slate-200 pl-3 text-xs"><p className="font-bold">{node.title}</p><p>{agents[node.agent].label} · {statuses[node.status]}</p><p className="text-slate-500">{node.date} {node.time} 前完成</p>{node.reason&&<p className="text-amber-800">{node.reason}</p>}</li>)}</ol></section> : null}{selected.dependsOn?.length ? <div className="mt-4"><p className="text-xs font-bold text-slate-500">上游交付</p>{selected.dependsOn.map(id => <p key={id} className="mt-1 text-xs text-slate-700">{tasks.find(task => task.id === id)?.title || id}</p>)}</div> : null}{selected.deadlineRecovery && <div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><p>经营 Agent 补救评估 · {selected.deadlineRecovery.status === 'blocked' ? '评估受阻' : '已评估，方案未生效'}</p><p className="mt-1">{selected.deadlineRecovery.assessmentId} · {calendarTimestampLabel(selected.deadlineRecovery.assessedAt,selected.calendarClock)}</p>{selected.deadlineRecovery.blockingReasons.map(reason => <p key={reason}>{reason === 'fresh_remaining_budget_capacity_work_windows_required' ? '缺少实时剩余预算、实际并发产能与人工工作时段，不能承诺补救可达' : reason}</p>)}<p>受影响发布：{selected.deadlineRecovery.affectedPublicationIds.join('、') || '无已绑定发布'}</p></div>}{selected.reason && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{selected.reason}</p>}{demo&&selected.agent==='content'&&onOpenProduction?<button type="button" className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white" onClick={()=>openTaskDestination(selected,onOpenProduction)}>进入这条任务的生产实况</button> : !demo && selected.accountBindingTarget&&onBindAccount?<button type="button" className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white" onClick={()=>openTaskDestination(selected,onBindAccount)}>绑定发布账号</button> : !demo && selected.customerExecutionTarget&&onOpenCustomerExecution?<button type="button" className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white" onClick={()=>openTaskDestination(selected,onOpenCustomerExecution)}>进入真实客服承接任务</button> : !demo && selected.supplementTarget&&onOpenSupplement?<button type="button" className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white" onClick={()=>openTaskDestination(selected,onOpenSupplement)}>处理当前真实补齐任务</button> : !demo && hasTemplateCalendarTarget(selected)&&onOpenTemplate?<button type="button" className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white" onClick={()=>openTaskDestination(selected,onOpenTemplate)}>查看真实模板来源与经营核验</button> : !demo && hasReviewCalendarTarget(selected)&&onOpenReview?<button type="button" className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white" onClick={()=>openTaskDestination(selected,onOpenReview)}>查看这条任务的真实社媒指标与冻结复盘</button> : !demo && hasPlanningCalendarTarget(selected) && onOpenPlanning ? <button type="button" className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white" onClick={()=>openTaskDestination(selected,onOpenPlanning)}>查看本周真实参考分析与排期</button> : !demo && (hasCalendarProductionBinding(selected)||canOpenContentTask?.(selected)) && onOpenProduction ? <button type="button" className="mt-5 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white" onClick={() => openTaskDestination(selected,onOpenProduction)}>{selected.publicationExecutionTarget ? '查看真实发布安排与平台尝试' : selected.sendRecoveryTarget ? '核验原发送异常与真实回执' : selected.productionTaskId ? '进入这条任务的生产实况' : '核验此任务生产对象与上游'}</button> : <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{demo ? "该示例任务没有对应的生产工作台。" : "此任务尚无可打开的生产对象；执行状态以后台记录为准。"}</p>}</section></div>}
  </div>;
}
