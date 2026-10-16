import type {WeeklyOperatingPackage,WeeklyExecutionTask} from '../../../shared/contracts/socialProgram';

/** A checklist of verifiable deliveries, not an inferred verdict on free-text goals. */
export function buildWeeklyGoalAudit(pkg:WeeklyOperatingPackage,tasks:WeeklyExecutionTask[]){
 const scoped=tasks.filter(t=>t.programId===pkg.programId&&t.packageId===pkg.packageId&&t.packageVersion===pkg.version);
 if(new Set(scoped.map(t=>t.tenantId)).size!==1||new Set(scoped.map(t=>t.taskId)).size!==scoped.length)throw Error('周目标核验缺少唯一真实租户任务图。');
 const rows=pkg.socialContentPackage.publicationTasks.filter(p=>p.status!=='cancelled').map(publication=>{
  const source=scoped.filter(t=>t.publicationTaskId===publication.publicationTaskId);
  const delivered=(step:string,type?:string)=>source.some(t=>t.schedule.stepKind===step&&t.status==='succeeded'&&t.resultRefs.some(r=>!type||r.type===type));
  return {publicationTaskId:publication.publicationTaskId,accountId:publication.accountId,publishWindow:publication.publishWindow,video:delivered('video_generation'),accepted:delivered('user_approval','user_content_approval'),published:delivered('publishing','weekly_publication_attempt'),metrics:delivered('performance_monitoring','social_metric_snapshot'),evidence:source.map(t=>({executionTaskId:t.taskId,step:t.schedule.stepKind,status:t.status,updatedAt:t.updatedAt,resultRefs:t.resultRefs})),blockers:[...new Set(source.flatMap(t=>[...t.ownBlockingReasons,...t.inheritedBlockingTaskIds.map(id=>`等待上游 ${id}`),...(t.lastError?[t.lastError.message]:[])]))]};
 });
 return {scope:{tenantId:scoped[0]!.tenantId,programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version},weekStart:pkg.weekStart,weekEnd:pkg.weekEnd,objective:pkg.objective,criteria:pkg.successCriteria.map(text=>({text,verdict:'待按真实证据人工核对' as const})),planned:rows.length,video:rows.filter(r=>r.video).length,accepted:rows.filter(r=>r.accepted).length,published:rows.filter(r=>r.published).length,metrics:rows.filter(r=>r.metrics).length,rows,unfinishedTaskIds:scoped.filter(t=>!['succeeded','cancelled'].includes(t.status)).map(t=>t.taskId),boundary:'按本周版本逐发布项核验；没有真实结果引用不计为交付，未知指标不补零，清单导出不等于目标验收通过'};
}
