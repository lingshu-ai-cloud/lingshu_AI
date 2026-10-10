import {planningSubset,assertPlanningSubsetReceipt} from './weeklyPlanningSubset';
import {weeklyPlanningPanelId,weeklyPlanningTaskId,isPlanningCalendarStep,PLANNING_CALENDAR_LABELS} from './planningCalendarNavigation';
import { useEffect,useRef, useState } from 'react';
import type { WeeklyOperatingPackage, WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
import { socialProgramApi } from '../../lib/socialProgramApi';

export default function WeeklyAgentPlanningPanel({ pkg, tasks, onChanged }: { pkg: WeeklyOperatingPackage; tasks: WeeklyExecutionTask[]; onChanged(next: WeeklyOperatingPackage): void | Promise<void> }) {
  const identity = JSON.stringify([pkg.programId, pkg.packageId, pkg.version, pkg.agentPlanning?.version]);
  const current = useRef(identity); current.current = identity;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedSlotIds,setSelectedSlotIds]=useState<string[]>(pkg.agentPlanning?.userConfirmation?.selectedSlotIds??pkg.agentPlanning?.detailedSchedule?.coverage?.selectedSlotIds??[]);const [uncertain,setUncertain]=useState(false);
  useEffect(()=>{setBusy(false);setError('');setUncertain(false);setSelectedSlotIds(pkg.agentPlanning?.userConfirmation?.selectedSlotIds??pkg.agentPlanning?.detailedSchedule?.coverage?.selectedSlotIds??[]);},[identity]);
  const plan = pkg.agentPlanning;
  const scopedTasks=tasks.filter(t=>t.programId===pkg.programId&&t.packageId===pkg.packageId&&t.packageVersion===pkg.version);
  const planningTasks=scopedTasks.filter(t=>isPlanningCalendarStep(t.schedule.stepKind));
  const valid = plan?.programId === pkg.programId && plan.packageId === pkg.packageId && plan.packageVersion === pkg.version && plan.skeleton.packageId===pkg.packageId && plan.skeleton.packageVersion===pkg.version;
  const action = !valid ? null : plan.status === 'outline_ready' ? 'analyze' : plan.status === 'director_analyzing' ? 'merge' : plan.status === 'awaiting_confirmation' ? 'confirm' : plan.status === 'confirmed' ? 'dispatch' : null;
  const labels = { analyze: '编导分析参考', merge: '仅合并明确所选槽位', confirm: '仅确认同一所选槽位排期', dispatch: '仅派单已确认的同一槽位' };
  async function advance(requested:typeof action=action) {
    const action=requested;
    if (!plan || !action || busy||uncertain) return;
    const scope = identity;
    setBusy(true); setError('');
    try {
      const subset=action==='analyze'?(selectedSlotIds.length?planningSubset(plan,selectedSlotIds,'merge'):null):planningSubset(plan,selectedSlotIds,action);
      const versions = {...(subset?{selectedSlotIds:subset}:{}), expectedPackageVersion: pkg.version, expectedPlanningVersion: plan.version };
      const next = action === 'analyze' ? await socialProgramApi.runDirectorPlanning(pkg.programId, pkg.packageId, versions)
        : action === 'merge' ? await socialProgramApi.mergeAgentSchedule(pkg.programId, pkg.packageId, versions)
        : action === 'confirm' ? await socialProgramApi.confirmAgentSchedule(pkg.programId, pkg.packageId, versions)
        : await socialProgramApi.dispatchAgentSchedule(pkg.programId, pkg.packageId, versions);
      if (current.current !== scope) return;
      if(subset&&action!=='analyze')assertPlanningSubsetReceipt(next,subset,action);
      const actual = await socialProgramApi.getOperatingPackage(pkg.programId, pkg.packageId);
      if (current.current !== scope) return;
      if (actual.programId !== pkg.programId || actual.packageId !== pkg.packageId || actual.version !== pkg.version || actual.agentPlanning?.planningId !== next.planningId || actual.agentPlanning.version !== next.version) throw Error('周包已变化，请刷新读取真实规划结果。');
      await onChanged(actual);
    } catch (cause) { if (current.current === scope){setUncertain(true);setError(cause instanceof Error ? cause.message : '规划操作结果未知，请只读恢复真实状态。');} }
    finally { if (current.current === scope) setBusy(false); }
  }
  async function recover(){const scope=identity;setBusy(true);try{const actual=await socialProgramApi.getOperatingPackage(pkg.programId,pkg.packageId);if(current.current!==scope)return;if(actual.programId!==pkg.programId||actual.packageId!==pkg.packageId||actual.version!==pkg.version)throw Error('周包版本已改变，请刷新经营项目。');await onChanged(actual);if(current.current===scope){setUncertain(false);setError('');setSelectedSlotIds(actual.agentPlanning?.userConfirmation?.selectedSlotIds??actual.agentPlanning?.detailedSchedule?.coverage?.selectedSlotIds??[]);}}catch(e){if(current.current===scope)setError(e instanceof Error?e.message:String(e));}finally{if(current.current===scope)setBusy(false);}}
  return <section id={weeklyPlanningPanelId(pkg)} data-planning-program={pkg.programId} data-planning-package={pkg.packageId} data-planning-version={String(pkg.version)} tabIndex={-1} className="scroll-mt-6 space-y-3 text-xs">
    <p className="text-stone-600">编导分析、经营合并、用户确认和正式派单分别操作。确认前请核对每条参考、账号、制作交付与发布时间；派单后的内容制作使用现有生产执行器。</p>
    {!valid && <p className="text-amber-800">缺少当前周版本的真实规划，请刷新经营项目。</p>}
    {valid && <p>规划版本 {plan.version} · {{ outline_ready: '待编导分析', director_analyzing: '待合并排期', awaiting_confirmation: '待用户确认', confirmed: '已确认待派单', dispatched: '冻结所选槽位已派单' }[plan.status]} · {plan.directorAnalyses.length} 项参考分析</p>}
    <p className="font-semibold">当前经营周：{pkg.weekStart} — {pkg.weekEnd} · 周包 v{pkg.version}</p>
    {planningTasks.length>0&&<details><summary className="cursor-pointer font-semibold">真实规划执行卡与来源交付 · {planningTasks.length} 项</summary><div className="mt-2 space-y-2">{planningTasks.map(t=><article key={t.taskId} id={weeklyPlanningTaskId(pkg,t.taskId)} tabIndex={-1} className="scroll-mt-6 rounded border border-stone-200 p-2"><strong>{isPlanningCalendarStep(t.schedule.stepKind)?PLANNING_CALENDAR_LABELS[t.schedule.stepKind]:t.schedule.stepKind} · {t.status}</strong><p>执行任务 {t.taskId}</p><p>已保存交付：{t.resultRefs.map(r=>`${r.type} · ${r.id} · v${r.version}`).join('；')||'尚无真实交付'}</p>{t.ownBlockingReasons.length>0&&<p className="text-amber-800">{t.ownBlockingReasons.join('；')}</p>}</article>)}</div></details>}
    {valid&&<div className="space-y-2"><h5 className="font-semibold">冻结的经营初排与参考来源</h5><p>参考配额：{plan.referenceSourcePolicy?`自有 ${plan.referenceSourcePolicy.ownedPercent}% / 外部 ${plan.referenceSourcePolicy.externalPercent}%`:'来源配额尚未冻结'}</p>{plan.skeleton.slots.map(slot=><article key={slot.slotId} className="rounded border border-stone-200 p-2"><p><input type="checkbox" aria-label={`选择槽位 ${slot.slotId}`} checked={selectedSlotIds.includes(slot.slotId)} disabled={busy||uncertain||(action!=="merge"&&action!=="analyze")} onChange={e=>setSelectedSlotIds(ids=>e.target.checked?[...ids,slot.slotId]:ids.filter(id=>id!==slot.slotId))}/> {slot.objective} · 母内容 {slot.motherContentId} · {slot.referenceSource==='owned'?'自有历史':slot.referenceSource==='external'?'外部参考':'来源待明确'}</p><p>关联发布：{slot.publicationTaskIds.join('、')||'缺失'} · 账号：{slot.accountIds.join('、')||'缺失'}</p><p>计划发布：{slot.plannedPublishWindows.join('、')||'时间待明确'}</p></article>)}</div>}
    {valid&&<div className="space-y-2"><h5 className="font-semibold">真实编导分析与冻结参考</h5>{!plan.directorAnalyses.length&&<p className="text-stone-500">尚未生成编导分析。</p>}{plan.directorAnalyses.filter(a=>a.packageId===pkg.packageId&&a.packageVersion===pkg.version).map(a=><article key={a.analysisId} className="rounded border border-stone-200 p-2"><p className="font-semibold">{a.contentDirection}</p><p>分析 {a.analysisId} · 槽位 {a.slotId}</p><p>视频参考：{a.benchmarkVideoRefs.map(r=>`${r.id} · v${r.version}`).join('；')||'缺失'}；账号参考：{a.benchmarkAccountRefs.map(r=>`${r.id} · v${r.version}`).join('；')||'缺失'}</p><p>冻结编导来源：{a.frozenHandoffRefs?.map(r=>`${r.inspirationId} · ${r.version} · ${r.recordHash}`).join('；')||'尚未冻结'}</p><p>调性：{a.styleRules.join('；')} · 节奏：{a.updateRhythm}</p><p>素材需求：{a.materialRequirements.join('；')||'未提供'}</p></article>)}</div>}
    {valid && plan.detailedSchedule && <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">任务与参考</th><th className="p-2">发布账号</th><th className="p-2">制作交付</th><th className="p-2">发布</th></tr></thead><tbody>{plan.detailedSchedule.items.map(item => <tr key={item.publicationTaskId} className="border-t"><td className="p-2">{item.topic}<br />{item.publicationTaskId}<br />参考 {item.benchmarkVideoRefs.map(ref => ref.id).join('、') || '缺失'}<br />分析 {item.directorAnalysisRef?.id ?? '缺失'}</td><td className="p-2">{item.accountId}</td><td className="p-2">{scopedTasks.find(task => task.publicationTaskId === item.publicationTaskId && task.schedule.stepKind === 'user_approval')?.schedule.latestFinishAt ?? scopedTasks.find(task => task.publicationTaskId === item.publicationTaskId && task.schedule.stepKind === 'quality_check')?.schedule.latestFinishAt ?? '待明确制作截止'}</td><td className="p-2">{pkg.socialContentPackage.publicationTasks.find(p => p.publicationTaskId === item.publicationTaskId)?.publishWindow ?? '待明确'}</td></tr>)}</tbody></table></div>}
    {valid&&<div><p>明确所选 {selectedSlotIds.length} / {plan.skeleton.slots.length} 槽位；未结 {plan.skeleton.slots.length-selectedSlotIds.length} 槽位。来源配额保持冻结，不将缺口转为外部参考。</p>{plan.directorGaps?.map(g=><p className="text-amber-800" key={`${g.slotId}:${g.code}`}>缺口 {g.slotId} · {g.referenceSource} · {g.code} · {g.message}</p>)}{(plan.dispatch?.coverage??plan.detailedSchedule?.coverage)&&<p>真实冻结覆盖：{(plan.dispatch?.coverage??plan.detailedSchedule?.coverage)?.selectedSlotIds.join("、")}；未结：{(plan.dispatch?.coverage??plan.detailedSchedule?.coverage)?.pendingSlotIds.join("、")||"无"}</p>}</div>}
    <button disabled={busy} onClick={()=>void recover()}>只读恢复真实规划状态</button>
    {valid&&(plan.status==="outline_ready"||plan.status==="director_analyzing")&&<button disabled={busy||uncertain||!selectedSlotIds.length} onClick={()=>void advance("analyze")}>仅重新分析明确所选槽位</button>}
    {action && <button type="button" disabled={busy||uncertain||(action!=="analyze"&&!selectedSlotIds.length) || (action === 'confirm' && !plan?.detailedSchedule?.items.length)} onClick={() => void advance()} className="btn-primary disabled:opacity-50">{busy ? '正在处理…' : action==='analyze'?(selectedSlotIds.length?`编导分析所选 ${selectedSlotIds.length} 槽位`:'编导分析全部冻结槽位'):labels[action]}</button>}
    {valid && plan.status === 'dispatched' && <p className="text-emerald-800">已为冻结的所选槽位派单；未结槽位仍需补证据，任务进度读取真实执行结果。</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </section>;
}
