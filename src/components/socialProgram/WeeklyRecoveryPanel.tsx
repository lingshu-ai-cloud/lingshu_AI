import { useEffect, useRef, useState } from 'react';
import type { WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
import type { WeeklyRecoveryAssessment, RecoveryResource, RecoveryTaskConstraint } from '../../../server/socialPrograms/weeklyRecoveryAssessment';
import { STEP_LABEL } from './weeklyExecutionLabels';

export interface WeeklyRecoveryScenario {
  changedTaskIds: string[];
  constraints: Record<string, RecoveryTaskConstraint>;
  resources: Record<string, RecoveryResource>;
  remainingBudgetCny: number;
}
export interface WeeklyRecoveryPanelProps {
  tasks: WeeklyExecutionTask[];
  packageVersion: number;
  onAssess: (input: WeeklyRecoveryScenario) => Promise<WeeklyRecoveryAssessment>;
}
type WorkDraft = { resourceKey: string; remainingMinutes: string; remainingCostCny: string; bufferMinutes: string; availableAt: string };
type ResourceDraft = { key:string; concurrency:string; startAt:string; finishAt:string };
export function buildRecoveryScenario(budget:string,changedTaskIds:string[],work:Record<string,WorkDraft>,resourceDrafts:ResourceDraft[]):WeeklyRecoveryScenario {
  const number = (value:string,label:string)=> {
    if (!value.trim() || !Number.isFinite(Number(value)) || Number(value)<0) throw new Error(`请明确填写${label}，允许明确填写 0。`);
    return Number(value);
  };
  const date = (value:string)=> {
    if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('时间需包含时区，例如 2026-10-09T09:00:00+08:00。');
    return value;
  };
  const resources:Record<string,RecoveryResource>=Object.create(null);
  for (const draft of resourceDrafts) {
    if (![draft.key,draft.concurrency,draft.startAt,draft.finishAt].some(value=>value.trim())) continue;
    const key=draft.key.trim();
    if (!key) throw new Error('请填写产能名称。');
    const concurrency=number(draft.concurrency,'并发数量');
    if (!Number.isInteger(concurrency)||concurrency<1) throw new Error('并发数量必须为正整数。');
    const startAt=date(draft.startAt),finishAt=date(draft.finishAt);
    if (Date.parse(finishAt)<=Date.parse(startAt)) throw new Error('工作窗口结束时间需晚于开始时间。');
    if (resources[key] && resources[key]!.concurrency!==concurrency) throw new Error('同一产能的多个工作窗口需使用相同并发数量。');
    resources[key] ??= {concurrency,workingWindows:[]};
    resources[key]!.workingWindows.push({startAt,finishAt});
  }
  const constraints:Record<string,RecoveryTaskConstraint>=Object.create(null);
  for (const [id,draft] of Object.entries(work)) {
    if (!Object.values(draft).some(value=>value.trim())) continue;
    if (!draft.resourceKey || !resources[draft.resourceKey]) throw new Error('任务需选择已填写的真实产能。');
    constraints[id]={resourceKey:draft.resourceKey,remainingMinutes:number(draft.remainingMinutes,'剩余分钟'),remainingCostCny:number(draft.remainingCostCny,'剩余成本'),bufferMinutes:number(draft.bufferMinutes,'缓冲分钟'),availableAt:date(draft.availableAt)};
  }
  return {remainingBudgetCny:number(budget,'剩余预算'),changedTaskIds:[...changedTaskIds],constraints,resources};
}
const reasonLabels:Record<string,string>={
  human_completion_not_verified:'人工完成尚未核验',dependency_unavailable:'前置任务不可用',remaining_work_evidence_required:'缺少剩余工作估时',resource_capacity_evidence_required:'缺少产能证据',remaining_budget_insufficient:'剩余预算不足',work_window_or_capacity_insufficient:'工作时段或并发不足',publication_deadline_at_risk:'赶不上前置截止',precise_deadline_required:'缺少明确截止',task_requires_explicit_recovery:'需明确恢复失败或取消任务',blocking_state_requires_verification:'阻塞状态需重新核验',
};
const actorLabel:Record<string,string>={business_agent:'经营 Agent',director_agent:'编导 Agent',content_agent:'内容 Agent',quality_agent:'内容 Agent · 质检',publishing_agent:'经营 Agent · 发布',user:'人工处理'};
const statusLabel:Record<string,string>={pending_activation:'待激活',queued:'排队中',leased:'执行中',blocked:'已阻塞',succeeded:'已完成',cancelled:'已取消',dead_letter:'失败待恢复'};
const inputClass='w-full rounded-lg border border-border bg-white px-2 py-2 text-xs text-text-primary';
const blankWork=():WorkDraft=>({resourceKey:'',remainingMinutes:'',remainingCostCny:'',bufferMinutes:'',availableAt:''});
export default function WeeklyRecoveryPanel({tasks,packageVersion,onAssess}:WeeklyRecoveryPanelProps) {
  const [budget,setBudget]=useState('');
  const [changed,setChanged]=useState<string[]>([]);
  const [work,setWork]=useState<Record<string,WorkDraft>>({});
  const [resources,setResources]=useState<ResourceDraft[]>([]);
  const [result,setResult]=useState<WeeklyRecoveryAssessment|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const generation=useRef(0);
  const identity=tasks[0] ? `${tasks[0].tenantId}/${tasks[0].programId}/${tasks[0].packageId}/${packageVersion}` : `empty/${packageVersion}`;
  const evidence=JSON.stringify(tasks);
  useEffect(()=>{generation.current++;setResult(null);setError('');setBusy(false);return ()=>{generation.current++;};},[evidence]);
  useEffect(()=>{setBudget('');setChanged([]);setWork({});setResources([]);},[identity]);
  const invalidate=()=> { generation.current++;setResult(null);setError('');setBusy(false); };
  const assess=async()=> {
    const requestId=++generation.current;
    setError('');setResult(null);
    try {
      const scenario=buildRecoveryScenario(budget,changed,work,resources);
      if (!tasks.length) throw new Error('当前没有真实执行任务可评估。');
      setBusy(true);
      const response=await onAssess(scenario);
      if (generation.current===requestId) setResult(response);
    } catch (cause) { if(generation.current===requestId)setError(cause instanceof Error?cause.message:'评估失败，请重试。'); }
    finally {if(generation.current===requestId)setBusy(false);}
  };
  const remaining=tasks.filter(task=>task.status!=='succeeded');
  return <section className="rounded-xl border border-border bg-white p-5 sm:p-6">
    <h3 className="text-base font-bold text-text-primary">异常影响与补救评估</h3>
    <p className="mt-1 text-xs leading-5 text-text-muted">使用当前版本真实任务和依赖；下方工时、费用与产能由你明确填写。结果是条件预测，修改任务后需重新评估。</p>
    <label className="mt-4 block max-w-xs text-xs font-semibold">剩余预算（元）<input aria-label="剩余预算（元）" type="number" min="0" value={budget} onChange={event=>{invalidate();setBudget(event.target.value);}} className={`${inputClass} mt-1`} /></label>
    <div className="mt-4"><p className="text-xs font-semibold">高级评估：容量假设与工作时段</p><p className="mt-1 text-xs text-text-muted">共用同一供应商或人工时使用相同产能名称；同名可添加多个工作窗口。时间必须包含时区。</p>
      {resources.map((resource,index)=><div key={index} className="mt-2 grid gap-2 sm:grid-cols-4">{(['key','concurrency','startAt','finishAt'] as const).map(field=><label key={field} className="text-[11px] text-text-muted">{{key:'产能名称',concurrency:'实际并发',startAt:'窗口开始（带时区）',finishAt:'窗口结束（带时区）'}[field]}<input value={resource[field]} type={field==='concurrency'?'number':'text'} onChange={event=>{invalidate();setResources(rows=>rows.map((row,i)=>i===index?{...row,[field]:event.target.value}:row));}} className={`${inputClass} mt-1`} /></label>)}</div>)}
      <button type="button" onClick={()=>{invalidate();setResources(rows=>[...rows,{key:'',concurrency:'',startAt:'',finishAt:''}]);}} className="mt-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold">添加工作窗口</button>
    </div>
    <details className="mt-4 rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-semibold">选择变化任务并填写剩余工作 · {remaining.length} 项</summary><p className="mt-2 text-xs text-text-muted">勾选实际发生变化的任务。未填写估时的任务显示证据缺口；输入预计完成时间不会解除现有阻塞或人工验收。</p>
      <div className="mt-3 space-y-3">{remaining.map(task=>{const draft=work[task.taskId]??blankWork();return <div key={task.taskId} className="rounded-lg bg-surface-2 p-3"><label className="flex items-start gap-2 text-xs font-semibold"><input type="checkbox" checked={changed.includes(task.taskId)} onChange={event=>{invalidate();setChanged(ids=>event.target.checked?[...ids,task.taskId]:ids.filter(id=>id!==task.taskId));}} /><span>{STEP_LABEL[task.schedule.stepKind]} · {task.taskId}<span className="mt-1 block font-normal text-text-muted">{actorLabel[task.schedule.responsibleActor]??task.schedule.responsibleActor} · {statusLabel[task.status]??task.status}</span></span></label><div className="mt-2 grid gap-2 sm:grid-cols-5">{(['resourceKey','remainingMinutes','remainingCostCny','bufferMinutes','availableAt'] as const).map(field=><label key={field} className="text-[11px] text-text-muted">{{resourceKey:'使用产能',remainingMinutes:'剩余分钟',remainingCostCny:'剩余成本（元）',bufferMinutes:'缓冲分钟',availableAt:'可开始时间（带时区）'}[field]}<input value={draft[field]} type={field==='resourceKey'||field==='availableAt'?'text':'number'} min="0" onChange={event=>{invalidate();setWork(rows=>({...rows,[task.taskId]:{...draft,[field]:event.target.value}}));}} className={`${inputClass} mt-1`} /></label>)}</div></div>;})}</div>
    </details>
    <button type="button" disabled={busy||!tasks.length} onClick={()=>void assess()} className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy?'正在评估…':'评估影响与可达数量'}</button>
    {error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {result&&<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5"><p className="font-semibold">目标 {result.targetPublicationCount} 条 · 条件可达 {result.conditionallyReachableCount} 条 · 缺口 {result.publicationGap} 条</p><p>预测占用预算：{result.reservedCostCny} 元；受影响发布：{result.affectedPublicationIds.join('、')||'无直接依赖影响'}</p><p className="mt-2 font-semibold">{result.revisionApplied===false?'修订尚未生效；任务、审批和来源配额均未修改。':'请核对修订状态。'}</p><p>人工任务预测可完成，不代表已提交、已验收或已批准。</p><p>{result.confirmationRequired?'需要完成相应人工处理或确认修订后，才能继续按新方案执行。':'该预测仍依赖已填写的产能假设和真实任务完成。'}</p>{result.publications.map(publication=><div key={publication.taskId} className="mt-2 border-t border-amber-200 pt-2"><strong>{publication.publicationId} · {publication.conditionallyReachable?'条件可达':'存在缺口'}</strong><p>{publication.reasons.map(reason=>reasonLabels[reason]??reason).join('；')||'未发现排期缺口，仍需真实执行'}</p></div>)}</div>}
  </section>;
}
