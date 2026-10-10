import {assertWeeklyScheduleActor} from './weeklyScheduleActor.js';
import type {WeeklyInitialSchedulePreview} from '../../shared/contracts/weeklyInitialSchedule.js';
import type {DataStore} from '../storage/datastore.js';
import type {WeeklyScheduleCapacityInput} from '../../shared/contracts/socialWeeklyScheduleRevision.js';
import {latestPackageRow} from './weeklyOperatingPackageSupport.js';
import {listWeeklyExecutionTasks} from './executionTasks.js';
import {createWeeklyScheduleRevisionService} from './socialWeeklyScheduleRevisions.js';
import {SocialProgramError} from './service.js';
interface Scope {tenantId:string;programId:string;packageId:string;packageVersion:number;actorUserId:string;}
/** First-week planning uses the same durable capacity proof as later revisions.
 * Suggestions are estimates; no resource calendar or cost is invented here. */
export function createWeeklyInitialScheduleService(store:DataStore,ports:{now?:()=>string}={}){
 const scheduling=createWeeklyScheduleRevisionService(store,{initialOnly:true,now:ports.now});
 async function initial(a:Scope){
  await assertWeeklyScheduleActor(store,a);
  const row=await latestPackageRow(store,a.tenantId,a.programId,a.packageId);
  if(!row||row.payload.version!==a.packageVersion)throw new SocialProgramError('weekly_initial_schedule_version_conflict',409,'请重新读取当前周草稿。');
  const pkg=row.payload;
  if(pkg.status!=='draft'||'scheduleRevisionRef' in pkg||pkg.socialContentPackage.authorization.allowRealPublishing)throw new SocialProgramError('weekly_initial_schedule_not_pristine',409,'已开始执行或已确认排期，请使用计划修订入口。');
  const tasks=await listWeeklyExecutionTasks(store,a.tenantId,a.programId,a.packageId,a.packageVersion);
  if(tasks.some(t=>t.lease||t.attempt>0||t.resultRefs.length||t.schedule.actualStartedAt||t.schedule.actualFinishedAt||t.productionProgress||!['pending_activation','blocked','queued'].includes(t.status)))throw new SocialProgramError('weekly_initial_schedule_already_executed',409,'已有任务执行记录，不能作为首次排期重排。');
 }
 return {
  async preview(a:Scope):Promise<WeeklyInitialSchedulePreview>{await initial(a);const graph=await scheduling.preview(a);return {graph,authority:'estimated_task_durations_only' as const,requiredInputs:graph.tasks.map(t=>({taskId:t.taskId,estimatedMinutes:t.schedule.estimatedDurationMinutes,suggestedStartAt:t.schedule.latestStartAt??null,suggestedFinishAt:t.schedule.latestFinishAt??null,missing:['remainingMinutes','remainingCostCny','bufferMinutes','resourceKey','availableAt','resourceWorkingWindows'] as const}))};},
  async propose(a:Scope,capacity:WeeklyScheduleCapacityInput){await initial(a);return scheduling.propose(a,capacity);},
  async confirm(a:Scope,request:{proposalId:string;expectedVersion:number;inputEvidenceHash:string;confirmedTemplateCarryoverPlanHashes?:string[]}){
   // A retry after a committed next revision is handled by the existing durable
   // proposal/snapshot receipt, rather than creating a second schedule.
   await assertWeeklyScheduleActor(store,a);
   const row=await latestPackageRow(store,a.tenantId,a.programId,a.packageId);
   if(row?.payload.version===a.packageVersion)await initial(a);
   return scheduling.confirm(a,request);
  },
  read:scheduling.read,
  readConfirmation:scheduling.readConfirmation,
 };
}
