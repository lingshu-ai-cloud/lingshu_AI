import type { WeeklyExecutionTask, VersionedSocialRef } from '../../shared/contracts/socialProgram.js';
import {resolveWeeklyProductionRow} from '../runtime/weeklyContentProductionIdentity.js';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { SocialProgramError } from './service.js';
import { SocialContentWorkflowError } from '../starter198/socialContentValidation.js';
import { createWeeklyExecutionContinuationService } from './weeklyExecutionContinuations.js';
import {readWeeklyPreproductionExecutionGate} from '../runtime/weeklyPreproductionProducer.js';

const COLLECTION_CREDENTIALS_REQUIRED='weekly_preproduction_collection_credentials_required';
const COLLECTION_PAID_BLOCKERS=new Set(['weekly_preproduction_collection_budget_authorization_required','weekly_preproduction_collection_budget_authorization_unverified','weekly_preproduction_collection_cost_ceiling_unverified','weekly_preproduction_collection_dataset_cost_unverified']);
const COLLECTION_STALE_REASONS=new Set(['business_dispatch_required',COLLECTION_CREDENTIALS_REQUIRED,...COLLECTION_PAID_BLOCKERS]);

async function currentCollectionBlocker(store:DataStore,task:WeeklyExecutionTask):Promise<WeeklyExecutionTask>{
  if(task.schedule.stepKind!=='benchmark_collection'||task.status!=='blocked')return task;
  try{
    // The signed job is the current producer state; this is API presentation
    // only and must not rewrite the original task graph or its durable error.
    const gate=await readWeeklyPreproductionExecutionGate(store,task);
    if(gate.ready||!gate.code||(gate.code!==COLLECTION_CREDENTIALS_REQUIRED&&!COLLECTION_PAID_BLOCKERS.has(gate.code))||gate.producerStatus!=='blocked')return task;
    const code=gate.code;
    return {...task,
      ownBlockingReasons:[...task.ownBlockingReasons.filter(reason=>!COLLECTION_STALE_REASONS.has(reason)),code],
      lastError:{code,message:code===COLLECTION_CREDENTIALS_REQUIRED?'采集受阻／待干预：采集服务凭据未配置，请通过安全配置入口处理；任务卡不会收集密钥。':code==='weekly_preproduction_collection_budget_authorization_required'?'采集受阻／待干预：缺少该周包账号采集的明确人民币费用上限。':code==='weekly_preproduction_collection_budget_authorization_unverified'?'采集受阻／待干预：原预算签发或账号范围无法核验，不会付费采集。':code==='weekly_preproduction_collection_dataset_cost_unverified'?'采集受阻／待干预：数据集读取费用上界未核验，不会继续付费采集。':'采集受阻／待干预：当前 Actor 的最坏费用上界尚未核验；填写额度本身不会触发付费采集。',retryable:false,occurredAt:task.lastError?.occurredAt??task.updatedAt},
    };
  }catch{return task;}
}

/** Expose an original production entry without copying its results into the new task. */
export async function projectWeeklyContinuationCalendar(store: DataStore, tasks: WeeklyExecutionTask[]): Promise<WeeklyExecutionTask[]> {
  const continuation = createWeeklyExecutionContinuationService(store);
  return Promise.all(tasks.map(async storedTask => {
    const { continuationObservation: _storedProjection, ...persistedTask } = storedTask;
    const task=await currentCollectionBlocker(store,persistedTask);
    const ref = task.inputSnapshot?.weeklyContinuationRef as VersionedSocialRef | undefined;
    if (!ref && !task.inputSnapshot?.weeklyContinuationPending) return task;
    if (!ref) return { ...task, continuationObservation: { status: 'blocked' as const, code: 'weekly_execution_continuation_verification_required' } };
    try {
      const observed = await continuation.readValidated({ tenantId: task.tenantId, programId: task.programId, packageId: task.packageId, targetVersion: task.packageVersion, targetTaskId: task.taskId, ref });
      const ids = new Set(observed.resultRefs.filter(item => ['starter_social_content_task', 'starter_social_content_script_baseline', 'starter_social_content_director_plan', 'starter_social_content_material_demand'].includes(item.type)).map(item => item.id));
      if (observed.status === 'ready' && observed.sourceTask.productionProgress?.contentTaskId) ids.add(observed.sourceTask.productionProgress.contentTaskId);
      if (observed.status === 'ready' && observed.sourceTask.workflowKind === 'content' && observed.resultRefs.some(item => item.type === 'starter_social_content_artifact')) {
        // Completion clears progress; resolve the already-validated artifact's original production binding.
        const production=observed.sourceTask.publicationTaskId?await resolveWeeklyProductionRow(store,{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:observed.detail.sourceVersion,publicationTaskId:observed.sourceTask.publicationTaskId}).catch(()=>null):null;
        if (typeof production?.task_id === 'string') ids.add(production.task_id);
      }
      return { ...task, continuationObservation: { status: observed.status, code: observed.code, sourceVersion: observed.detail.sourceVersion, sourceTaskId: observed.sourceTask.taskId, ...(observed.status === 'ready' ? { sourceActualFinishedAt: observed.sourceTask.schedule.actualFinishedAt ?? observed.observedCompletedAt ?? null, sourceLatestFinishAt: observed.sourceTask.schedule.latestFinishAt ?? observed.sourceTask.schedule.estimatedFinishAt ?? null } : {}), ...(observed.status === 'ready' && ids.size === 1 ? { contentTaskId: [...ids][0] } : {}) } };
    } catch (error) {
      if (!(error instanceof SocialProgramError) && !(error instanceof SocialContentWorkflowError)) throw error;
      return { ...task, continuationObservation: { status: 'blocked' as const, code: error.code } };
    }
  }));
}
