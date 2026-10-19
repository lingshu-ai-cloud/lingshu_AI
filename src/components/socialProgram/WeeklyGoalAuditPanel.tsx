import {Button,Descriptions,Table,Alert} from 'antd';
import type {WeeklyOperatingPackage,WeeklyExecutionTask} from '../../../shared/contracts/socialProgram';
import {buildWeeklyGoalAudit} from './weeklyGoalAudit';
import {useOptionalSocialProgram} from '../../contexts/SocialProgramContext';

export default function WeeklyGoalAuditPanel({pkg,tasks,mode}:{pkg:WeeklyOperatingPackage;tasks:WeeklyExecutionTask[];mode:'planning'|'acceptance'}){
 const context=useOptionalSocialProgram();
 let audit:ReturnType<typeof buildWeeklyGoalAudit>;
 try{audit=buildWeeklyGoalAudit(pkg,tasks);}catch(error){return <Alert type="warning" showIcon title={error instanceof Error?error.message:'真实目标核验不可用'}/>;}
 const goal=mode==='planning';
 const exportChecklist=()=>{
  const blob=new Blob([JSON.stringify({...audit,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`weekly-goal-checklist-${pkg.weekStart}-v${pkg.version}.json`;link.click();URL.revokeObjectURL(url);
 };
 return <section id={goal?`weekly-goal:${pkg.programId}:${pkg.packageId}:${pkg.version}`:undefined} tabIndex={-1} aria-label={goal?'本周经营目标与确认范围':'周目标交付核验'} className="space-y-4">
  <h3 className="text-base font-semibold">{goal?'本周经营目标与确认范围':'周目标交付核验'}</h3>
  <Descriptions column={1} size="small" items={[
   {key:'week',label:'经营周',children:`${pkg.weekStart} — ${pkg.weekEnd} · v${pkg.version}`},
   {key:'objective',label:'本周目标',children:pkg.objective},
   {key:'criteria',label:'验收标准',children:pkg.successCriteria.length?<ul className="list-disc pl-4">{pkg.successCriteria.map((criterion,index)=><li key={index}>{criterion}{!goal?' · 待按真实证据核对':''}</li>)}</ul>:'当前周包未定义验收标准'},
   {key:'budget',label:'费用规则',children:'产品侧预估并在周计划确认时冻结费用边界；采集、语义分析、生产和返工按既有颗粒化额度与费用证据执行，不另设总授权卡，也不自动提额。'},
   {key:'delivery',label:'本周交付',children:`计划 ${audit.planned} 条 · 成片 ${audit.video} · 已验收 ${audit.accepted} · 发布 ${audit.published} · 指标回流 ${audit.metrics}`},
  ]}/>
  <details><summary className="cursor-pointer text-sm font-medium">逐发布项交付核验 · {audit.planned} 条</summary><Table size="small" pagination={false} rowKey="publicationTaskId" scroll={{x:650}} dataSource={audit.rows} columns={[
   {title:'账号 / 发布项',key:'account',render:(_,row)=><span className="break-words">{context?.accounts.find(account=>account.programId===pkg.programId&&account.accountId===row.accountId)?.displayName??row.accountId}<details className="text-xs text-text-secondary"><summary>真实发布项身份</summary>{row.publicationTaskId}</details></span>},
   {title:'计划发布',dataIndex:'publishWindow',key:'window'},
   ...(['video','accepted','published','metrics'] as const).map((key,index)=>({title:['成片','验收','发布','指标'][index],key,render:(_:unknown,row:typeof audit.rows[number])=>row[key]?'有交付凭据':'未交付'})),
  ]}/></details>
  {!goal&&<><details><summary className="cursor-pointer text-sm font-medium">未完成项与受阻原因 · {audit.unfinishedTaskIds.length} 项</summary><ul className="mt-3 space-y-2 text-sm">{audit.rows.filter(row=>!row.accepted||!row.published||!row.metrics).map(row=><li key={row.publicationTaskId} className="break-words">{row.publicationTaskId}：{row.blockers.length?row.blockers.join('；'):'等待真实成片、验收、发布与指标回执，暂不能核定目标达成'}</li>)}</ul></details><Alert type="info" showIcon title="目标达成必须有证据，不能由任务数量推断" description={`${audit.unfinishedTaskIds.length} 项底层任务尚未完成。清单导出不等于验收通过；周报仍需统计窗口结束及真实数据。`}/><Button onClick={exportChecklist}>导出本周目标交付核验清单</Button></>}
  {goal&&<p className="text-sm text-text-secondary">下方按真实规划状态完成参考分析、整周排期合并、所选范围确认与正式派单。只读查看不会启用执行或批准发布。</p>}
 </section>;
}
