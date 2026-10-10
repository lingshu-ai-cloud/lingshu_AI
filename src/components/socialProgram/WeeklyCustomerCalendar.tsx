import {validateWeeklySalesTask} from './weeklySalesNavigation';
import {projectCustomerSendRecoveries,validCustomerSendRecoveryTarget} from './weeklyCustomerSendRecoveryNavigation';
import type {WeeklyCustomerSendRecovery} from '../../../shared/contracts/weeklyCustomerSendRecovery';
import {isWeeklyContentNavigationExecution} from './sceneCalendarNavigation';
import {validatedTemplateCalendarTask} from './templateCalendarNavigation';
import {validatedReviewCalendarTask} from './reviewCalendarNavigation';
import {validatedPlanningCalendarTask} from './planningCalendarNavigation';
import {validCustomerExecutionTarget} from './customerExecutionCalendarNavigation';
import {validPublicationExecutionTarget} from './publicationExecutionCalendarNavigation';
import {weeklySalesHandoffApi} from '../../lib/weeklySalesHandoffApi';
import {projectWeeklySalesCalendar} from './weeklySalesCalendarProjection';
import type {WeeklySalesHandoff} from '../../../shared/contracts/socialWeeklySalesHandoff';
import { useEffect, useState } from 'react';
import type { WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
import type { WeeklyMaterialRequest } from '../../../server/socialPrograms/weeklyMaterialRequests';
import { weeklyMaterialRequestsApi } from '../../lib/weeklyMaterialRequestsApi';
import { projectWeeklyMaterialCalendar, isMaterialCalendarTask, materialReferenceIsOverdue, type WeeklyMaterialCalendarScope } from './weeklyMaterialCalendarProjection';
import { socialProgramApi } from '../../lib/socialProgramApi';
import { openCustomerCalendarTask, type CustomerCalendarProjection } from './CustomerWeeklyCalendar';

import AgentWeeklyCalendar, { type AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';
import { customerCalendarTasks } from './weeklyCustomerCalendarProjection';
import {openAccountBindingNavigation} from '../../lib/accountBindingNavigation';

export function forwardCalendarExecution(card:AgentCalendarTask,scope:{programId:string;packageId:string;packageVersion:number},tasks:WeeklyExecutionTask[],handlers:{customer?:(task:WeeklyExecutionTask)=>void;publication?:(card:AgentCalendarTask)=>void}):boolean {
  if(card.customerExecutionTarget){
    const actual=validCustomerExecutionTarget(card,scope,tasks);
    if(!actual)throw Error('客服执行卡片与当前周版本、渠道或任务身份不一致，请刷新。');
    if(!handlers.customer)throw Error('真实客服任务入口尚未加载，请刷新。');
    handlers.customer(actual);return true;
  }
  if(card.publicationExecutionTarget){
    if(!validPublicationExecutionTarget(card,scope,tasks))throw Error('发布执行卡片与当前周版本或任务身份不一致，请刷新。');
    if(!handlers.publication)throw Error('真实发布任务入口尚未加载，请刷新。');
    handlers.publication(card);return true;
  }
  return false;
}

export function forwardCalendarSales(card:AgentCalendarTask,scope:{tenantId:string;programId:string;packageId:string;packageVersion:number},items:WeeklySalesHandoff[],handler?: (card:AgentCalendarTask)=>void):void {if(!validateWeeklySalesTask(card,scope,items))throw Error('销售卡片与原租户、客户、成员、动作或版本不一致，请刷新。');if(!handler)throw Error('真实销售动作入口尚未加载。');handler(card);}

/** Resolve the card again from the actual request and consumers; forged or stale cards cannot open a control. */
export function forwardCalendarMaterial(card:AgentCalendarTask,scope:WeeklyMaterialCalendarScope,requests:WeeklyMaterialRequest[],tasks:WeeklyExecutionTask[],handler?:(requestId:string,action:'upload'|'verification')=>void):void {
  if(!isMaterialCalendarTask(card))throw Error('素材卡片动作身份不完整，请刷新。');
  const matches=projectWeeklyMaterialCalendar(requests,scope,tasks).tasks.filter(actual=>actual.id===card.id);
  if(matches.length!==1)throw Error('素材卡片与当前租户、周版本或真实消费者不一致，请刷新。');
  const actual=matches[0]!;
  const keys=['agent','materialRequestId','materialAction','materialTenantId','materialProgramId','materialPackageId','materialPackageVersion','materialSubmissionVersion','materialConsumerTaskIds','affectedPublicationIds','assignee','humanAction','status','submission','availableForHuman','dueAt'] as const;
  if(keys.some(key=>JSON.stringify(card[key])!==JSON.stringify(actual[key])))throw Error('素材卡片与当前请求、上传版本、动作或消费者不一致，请刷新。');
  if(!handler)throw Error('真实素材动作入口尚未加载。');
  handler(actual.materialRequestId,actual.materialAction);
}

export default function WeeklyCustomerCalendar({ programId, packageId, packageVersion, weekStart, weekEnd, executionTasks = [], mainTasks = [], onOpenContent, onOpenExecutionTask, onOpenMaterial, onOpenSales,onOpenPlanning,onOpenReview,onOpenTemplate,onOpenSupplement,sendRecoveries=[],onOpenSendRecovery }: {
  programId: string; packageId: string; packageVersion: number; weekStart: string;
  weekEnd?: string; executionTasks?: WeeklyExecutionTask[];
  sendRecoveries?:WeeklyCustomerSendRecovery[];onOpenSendRecovery?:(card:AgentCalendarTask)=>void;
  onOpenSupplement?:(task:AgentCalendarTask)=>void;onOpenExecutionTask?:(task:WeeklyExecutionTask)=>void;onOpenTemplate?:(task:AgentCalendarTask)=>void;onOpenReview?:(task:AgentCalendarTask)=>void;onOpenPlanning?:(task:AgentCalendarTask)=>void; mainTasks?: AgentCalendarTask[]; onOpenContent?: (task: AgentCalendarTask) => void; onOpenMaterial?: (requestId: string, action: 'upload'|'verification') => void; onOpenSales?:(card:AgentCalendarTask)=>void;
}) {
  const identity = JSON.stringify([programId, packageId, packageVersion]);
  const ownedExecutions=executionTasks.filter(task=>task.programId===programId&&task.packageId===packageId&&task.packageVersion===packageVersion);
  const tenants=[...new Set(ownedExecutions.map(task=>task.tenantId))];
  const tenantId=tenants.length===1?tenants[0]:null;
  const materialIdentity=JSON.stringify([tenantId,programId,packageId,packageVersion]);
  const [salesState,setSalesState]=useState<{identity:string;items:WeeklySalesHandoff[];error:string}|null>(null);
  useEffect(()=>{let active=true,reading=false;const refresh=async()=>{if(reading||document.hidden)return;reading=true;try{const items=await weeklySalesHandoffApi.list(programId,packageId,packageVersion);if(active)setSalesState({identity,items,error:''});}catch(e){if(active)setSalesState({identity,items:[],error:e instanceof Error?e.message:'销售交接读取失败'});}finally{reading=false;}};void refresh();const timer=window.setInterval(()=>void refresh(),10000);window.addEventListener('lingshu:agent-business-refresh',refresh);return()=>{active=false;window.clearInterval(timer);window.removeEventListener('lingshu:agent-business-refresh',refresh);};},[identity]);
  const [materialState,setMaterialState]=useState<{identity:string;requests:WeeklyMaterialRequest[]}|null>(null);
  const [materialError,setMaterialError]=useState<{identity:string;message:string}|null>(null);
  const [state, setState] = useState<{ identity: string; item: CustomerCalendarProjection } | null>(null);
  const [error, setError] = useState<{ identity: string; message: string } | null>(null);
  useEffect(() => {
    let active = true; let loading = false;
    const refresh = async () => {
      if (!active || loading || document.hidden) return;
      loading = true;
      try {
        const item = await socialProgramApi.readCustomerCalendar(programId, packageId, packageVersion);
        if (active) { setState({ identity, item }); setError(null); }
      } catch (error) { if (active) setError({ identity, message: error instanceof Error ? error.message : '客服任务加载失败' }); }
      finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('lingshu:agent-business-refresh', onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('lingshu:agent-business-refresh', onVisible); };
  }, [identity, programId, packageId, packageVersion]);
  useEffect(()=>{let active=true;let reading=false;
    const refresh=async()=>{if(!active||reading||document.hidden||!tenantId)return;reading=true;try{const requests=await weeklyMaterialRequestsApi.list(programId);if(requests.some(request=>request.programId!==programId||request.tenantId!==tenantId))throw Error('素材任务与所选经营项目或租户不一致，请重新核验。');if(active){setMaterialState({identity:materialIdentity,requests});setMaterialError(null);}}catch(error){if(active){setMaterialState(null);setMaterialError({identity:materialIdentity,message:error instanceof Error?error.message:'素材任务加载失败'});}}finally{reading=false;}};
    void refresh();const timer=window.setInterval(()=>{void refresh();},10000);const visible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visible);window.addEventListener('lingshu:agent-business-refresh',visible);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('lingshu:agent-business-refresh',visible);};
  },[materialIdentity,tenantId,programId]);
  const end=weekEnd??(()=>{const date=new Date(`${weekStart}T00:00:00`);date.setDate(date.getDate()+6);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;})();
  const materialProjection=tenantId&&materialState?.identity===materialIdentity?projectWeeklyMaterialCalendar(materialState.requests,{tenantId,programId,packageId,packageVersion,weekStart,weekEnd:end},ownedExecutions):null;
  const salesProjection=tenantId&&salesState?.identity===identity?projectWeeklySalesCalendar(salesState.items,{tenantId,programId,packageId,packageVersion,weekStart,weekEnd:end}):null;
  const materialMessage=materialError?.identity===materialIdentity?materialError.message:null;
  const item = state?.identity === identity ? state.item : null;
  const message = error?.identity === identity ? error.message : null;
  const missing = item?.tasks.filter(task => !task.scheduledAt || !Number.isFinite(Date.parse(task.scheduledAt))) ?? [];
  const recoveryScope=tenantId?{tenantId,programId,packageId,packageVersion}:null;
  const recoveryTasks=recoveryScope?projectCustomerSendRecoveries(sendRecoveries,recoveryScope):[];
  const canOpenContentTask=(card:AgentCalendarTask)=>ownedExecutions.filter(t=>t.taskId===(card.productionExecutionTaskId||card.id)&&t.tenantId===tenantId&&isWeeklyContentNavigationExecution(t)).length===1;
  return <div>
    <AgentWeeklyCalendar onBindAccount={openAccountBindingNavigation} onOpenCustomerExecution={task=>{try{forwardCalendarExecution(task,{programId,packageId,packageVersion},ownedExecutions,{customer:onOpenExecutionTask});}catch(cause){setError({identity,message:cause instanceof Error?cause.message:'客服入口读取失败。'});}}} canOpenContentTask={canOpenContentTask} onOpenSupplement={onOpenSupplement?task=>{const t=task.supplementTarget;if(!t||!['submission','verification'].includes(t.action)||!t.tenantId||t.programId!==programId||t.packageId!==packageId||t.packageVersion!==packageVersion||task.id!==`supplement:${t.requestId}:${t.action}`){setError({identity,message:"补齐任务与当前周版本不一致，请刷新。"});return;}onOpenSupplement(task);}:undefined} onOpenTemplate={onOpenTemplate?task=>{if(!validatedTemplateCalendarTask({programId,packageId,packageVersion},ownedExecutions,task)){setError({identity,message:"模板任务与来源身份不一致，请刷新。"});return;}onOpenTemplate(task);}:undefined} onOpenReview={onOpenReview?task=>{if(!validatedReviewCalendarTask({programId,packageId,packageVersion},ownedExecutions,task)){setError({identity,message:"复盘卡片与所选周包执行身份不一致，请刷新。"});return;}onOpenReview(task);}:undefined} scopeKey={materialIdentity} startsAt={weekStart} onOpenPlanning={onOpenPlanning?task=>{if(!validatedPlanningCalendarTask({programId,packageId,packageVersion},ownedExecutions,task)){setError({identity,message:"规划卡片与所选周包执行身份不一致，请刷新。"});return;}onOpenPlanning(task);}:undefined} tasks={[...mainTasks,...recoveryTasks, ...(item ? customerCalendarTasks(item) : []), ...(materialProjection?.tasks??[]),...(salesProjection?.tasks??[])]} onOpenProduction={task => {
      if(task.publicationExecutionTarget){try{forwardCalendarExecution(task,{programId,packageId,packageVersion},ownedExecutions,{publication:onOpenContent});}catch(cause){setError({identity,message:cause instanceof Error?cause.message:'发布入口读取失败。'});}return;}
      if(task.sendRecoveryTarget){if(!recoveryScope||!validCustomerSendRecoveryTarget(task,recoveryScope)){setError({identity,message:'发送异常任务与当前租户或周包版本不一致，请刷新。'});return;}onOpenSendRecovery?.(task);}
      else if(task.salesTarget||task.salesHandoffId){try{if(!recoveryScope)throw Error('销售租户身份尚未读取。');forwardCalendarSales(task,recoveryScope,salesState?.identity===identity?salesState.items:[],onOpenSales);}catch(cause){setError({identity,message:cause instanceof Error?cause.message:'销售入口读取失败。'});}}
      else if(task.materialRequestId||task.materialAction){try{if(!tenantId||materialState?.identity!==materialIdentity)throw Error('素材任务身份尚未加载。');forwardCalendarMaterial(task,{tenantId,programId,packageId,packageVersion,weekStart,weekEnd:end},materialState.requests,ownedExecutions,onOpenMaterial);}catch(cause){setError({identity,message:cause instanceof Error?cause.message:'素材入口读取失败。'});}}
      else if (task.agent === 'customer' && task.customerRunId && task.customerWorkflowTaskId && task.customerTaskKey) {
        openCustomerCalendarTask(task.customerRunId, { taskId: task.customerWorkflowTaskId, taskKey: task.customerTaskKey });
      } else if (task.inventoryTarget||task.crossWeekMaterialTarget||task.customerExceptionTarget||task.publicationRecoveryTarget||task.nativeRecoveryTarget||task.productionTaskId||canOpenContentTask(task)) onOpenContent?.(task);
    }} />
    {salesState?.identity===identity&&salesState.error&&<p role="alert" className="mx-5 my-3 text-xs text-red-700">销售交接读取失败：{salesState.error}</p>}
    {Boolean(salesProjection?.references.length)&&<section className="mx-5 mb-4 space-y-2"><h4 className="text-xs font-bold text-slate-700">跨周销售交接引用 · 不重复计入本周交付</h4>{salesProjection?.references.map(item=><button key={item.id} className="block rounded border p-2 text-xs" disabled onClick={()=>{}}>{item.customerId} · 原周包 v{item.packageVersion} · 查看原交接任务</button>)}</section>}
    {materialMessage&&<p role="alert" className="mx-5 my-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">人工素材任务暂未更新：{materialMessage}</p>}
    {materialProjection?.issues.map(issue=><p role="alert" key={issue.requestId} className="mx-5 my-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">素材任务需核验：{issue.reason}</p>)}
    {Boolean(materialProjection?.unscheduledVerification.length)&&<section className="mx-5 mb-4 space-y-2"><h4 className="text-xs font-bold text-amber-800">素材核验待排期</h4>{materialProjection?.unscheduledVerification.map(task=><button type="button" key={task.requestId} onClick={()=>onOpenMaterial?.(task.requestId,'verification')} className="block w-full rounded-lg border border-amber-200 bg-white p-3 text-left text-xs"><strong>{task.title}</strong><p className="mt-1 text-slate-600">指定核验人：{task.assigneeUserId} · {task.reason}</p><p className="mt-1 text-emerald-800">进入真实素材核验 →</p></button>)}</section>}
    {Boolean(materialProjection?.sharedReferences.length)&&<section className="mx-5 mb-4 space-y-2"><h4 className="text-xs font-bold text-slate-600">跨周共享素材引用 · 不重复计入本周交付</h4>{materialProjection?.sharedReferences.map(reference=><button type="button" key={`${reference.requestId}:${reference.action}`} onClick={()=>onOpenMaterial?.(reference.requestId,reference.action)} className={`block w-full rounded-lg border p-3 text-left text-xs ${materialReferenceIsOverdue(reference)?'border-red-300 bg-red-50 text-red-800':'border-slate-200 bg-white text-slate-600'}`}>{reference.action==='upload'?'共享素材上传':'共享素材核验'} · {reference.requestId} · 真实截止 {new Date(reference.deadline).toLocaleString('zh-CN')}{materialReferenceIsOverdue(reference)?' · 已逾期':''}<p className="mt-1">查看同一素材任务 →</p></button>)}</section>}
    {message && <p role="alert" className="mx-5 my-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">客服生产任务暂未更新：{message}</p>}
    {item && !item.binding && <p className="mx-5 my-3 rounded-lg bg-slate-100 p-3 text-xs text-slate-600">尚未绑定本周客服生产运行，请明确选择客群及对应运行后接入。</p>}
    {missing.length > 0 && <section className="mx-5 mb-5 space-y-2"><h4 className="text-xs font-bold text-amber-800">客服任务待排期 · {missing.length} 项缺少具体执行时间</h4><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{missing.map(task => <button key={task.taskId} type="button" onClick={() => item?.binding && openCustomerCalendarTask(item.binding.runId, task)} className="rounded-lg border border-orange-200 bg-white p-3 text-left"><p className="text-[10px] font-bold text-orange-700">主负责 · 客服 Agent</p><p className="mt-1 text-xs font-bold text-slate-900">{task.title}</p><p className="mt-1 text-[11px] text-slate-500">具体执行时间待排定 · {task.estimateDurationMinutes === null ? '工时待估' : `预计 ${task.estimateDurationMinutes} 分钟`}</p><p className="mt-2 text-[10px] text-orange-700">进入真实客服工作区 →</p></button>)}</div></section>}
    {!item && !message && <p className="px-5 py-3 text-xs text-slate-500">正在读取本周真实客服任务…</p>}
  </div>;
}
