import type {DataStore, Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask, WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {readWeeklyReviewActor,readWeeklyReviewEvidence} from './weeklyReviewEvidence.js';
import {withWeeklyProductionAdmissionGuard} from './weeklyCancellation.js';
import {runWeeklyReviewForPackage} from '../socialReview/weeklyReviewWorker.js';
import {SocialProgramError} from './service.js';

type Scope={tenantId:string;actorUserId:string;programId:string;packageId:string;packageVersion:number;taskId:string;expectedTaskUpdatedAt:string;now?:Date};
const fail=(code:string,message:string):never=>{throw new SocialProgramError(code,409,message);};
/** Explicit, bounded operation using the existing review producer. Never publishes,
 * sends messages, activates a week, or manufactures execution completion. */
export async function executeWeeklyReviewOperation(store:DataStore,input:Scope){
  const now=input.now??new Date();
  // Reuse the authenticated, synthetic-evidence rejecting read boundary first.
  await readWeeklyReviewEvidence(store,input);
  const actor=await readWeeklyReviewActor(store,input.tenantId,input.actorUserId);
  if(!actor||!['super_admin','admin','social_operator'].includes(String(actor.role)))throw new SocialProgramError('weekly_review_operator_required',403,'当前成员无经营复盘执行权限。');
  return withWeeklyProductionAdmissionGuard({dataStore:store,tenantId:input.tenantId,packageId:input.packageId,packageVersion:input.packageVersion,action:async assertActive=>{
    await assertActive();
    const packs=await store.list<Record_ & {payload:WeeklyOperatingPackage}>('social_weekly_operating_packages',{where:{tenant_id:input.tenantId,program_id:input.programId,package_id:input.packageId},sort:'-version',page:1,perPage:1});
    const row=packs.items[0],pkg=row?.payload;
    if(!pkg||pkg.version!==input.packageVersion||pkg.status!=='active')fail('weekly_review_current_active_required','仅当前已启用周版本可执行复盘；请先核对目标、排期和启用状态。');
    const all:WeeklyExecutionTask[]=[];
    let total:number|undefined;
    for(let page=1;page<=1000;page++){
      const found=await store.list<Record_ & {payload:WeeklyExecutionTask}>('social_weekly_execution_tasks',{where:{tenant_id:input.tenantId,program_id:input.programId,package_id:input.packageId,package_version:input.packageVersion},sort:'id',page,perPage:250});
      if(total!==undefined&&total!==found.totalItems)fail('weekly_review_graph_changed','任务图读取期间已变化，请刷新后重试。');
      total=found.totalItems;
      for(const record of found.items){const task=record.payload;if(!task||record.mock||record.simulated||record.synthetic||task.tenantId!==input.tenantId||task.programId!==input.programId||task.packageId!==input.packageId||task.packageVersion!==input.packageVersion||all.some(t=>t.taskId===task.taskId))fail('weekly_review_graph_invalid','无法核验完整真实任务图。');all.push(task);}
      if(all.length===total)break;
      if(!found.items.length||page===1000)fail('weekly_review_graph_incomplete','真实任务图不完整，未开始复盘。');
    }
    const matches=all.filter(t=>t.taskId===input.taskId&&t.workflowKind==='review'&&t.schedule.stepKind==='weekly_review');
    if(matches.length!==1)fail('weekly_review_task_required','请选择本周唯一真实周复盘任务。');
    const task=matches[0]!;
    if(task.updatedAt!==input.expectedTaskUpdatedAt)fail('weekly_review_task_changed','复盘任务已变化，请刷新真实任务后重试。');
    const evidence=await readWeeklyReviewEvidence(store,input);
    if(!evidence.window.closed)fail('weekly_review_window_open',`本周统计窗口尚未结束，需等到 ${evidence.window.endsAt}，未提前冻结报告。`);
    if(task.lease||!['queued','succeeded'].includes(task.status)||task.ownBlockingReasons.length||task.inheritedBlockingTaskIds.length)fail('weekly_review_task_not_ready','周复盘尚未就绪或正在执行，请先处理当前阻塞，不会绕过任务队列。');
    const dependencies=task.dependsOnTaskIds.map(id=>all.find(t=>t.taskId===id));
    if(dependencies.some(t=>!t||t.status!=='succeeded'||!t.resultRefs.length))fail('weekly_review_dependencies_pending','本周发布或指标回流尚未全部交付，不能将缺失数据作为达标结果。');
    await assertActive();
    const result=await runWeeklyReviewForPackage({dataStore:store,row:row as Parameters<typeof runWeeklyReviewForPackage>[0]['row'],actorId:input.actorUserId,now});
    if(result.status!=='completed'||!result.snapshot)fail(result.reason??'weekly_review_pending','真实复盘尚未生成，请刷新证据后查看实际原因。');
    return readWeeklyReviewEvidence(store,input);
  }});
}
