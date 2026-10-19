import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {SocialContentTaskBudget,type SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import {socialPaidIntentOperation,type SocialApprovedBudgetPlan} from '../lib/socialContentTaskBudgetAuthority.js';
import {createSocialContentPaidOperationPermit} from '../lib/socialContentPaidOperationPermit.js';
import {STARTER_COLLECTIONS,type Starter198Repository} from './repository.js';
import {readSocialProductAssetRevisionPaidGuard} from './socialContentAssetRevisionPaidGuard.js';
import {requireSocialTask} from './socialContentRecords.js';
import {socialJson,socialObject,socialRequestHash,SocialContentWorkflowError} from './socialContentValidation.js';

type GuardInput=Parameters<typeof readSocialProductAssetRevisionPaidGuard>[0];
type RevisionPlan=SocialApprovedBudgetPlan&{revisionGuardHash:string;replacementSha256:string};
const fail=(code:string):never=>{throw new SocialContentWorkflowError(`social_content_asset_revision_permit_${code}`,409);};

/** Revision-only permit factory. There is intentionally no production caller
 * yet: the isolated scheduler leaves its queue blocked and task paused.
 * readCanonicalPlan must eventually be backed by an independently verified,
 * immutable server-side writer. A caller able to fabricate both that plan and
 * the worker/checkpoint state must never be allowed to invoke this factory.
 * A generic content permit cannot stand in for this admission because its
 * ordinary ceiling is 15 yuan and it does not bind the replacement image. */
export async function createSocialProductAssetRevisionPaidPermit(input:{repository:Starter198Repository;guard:GuardInput;
 ledgerRoot?:string;permitRoot?:string;readCanonicalPlan(scope:SocialTaskBudgetScope):Promise<RevisionPlan>}){
 const {repository,guard}=input,store=repository.dataStore;
 if(!store||guard.repository!==repository||guard.prepared.repository!==repository)return fail('scope_invalid');
 const frozen=await readSocialProductAssetRevisionPaidGuard(guard);
 const scope:SocialTaskBudgetScope={tenantId:guard.tenantId,taskId:guard.taskId,runId:guard.revisionRunId,
  planHash:frozen.guard.revisedPlanHash};
 let canonicalPlanHash:string|null=null;
 const assertCurrent=async(candidate:SocialTaskBudgetScope)=>{
  if(candidate.tenantId!==scope.tenantId||candidate.taskId!==scope.taskId||candidate.runId!==scope.runId
   ||candidate.planHash!==scope.planHash||candidate.budgetTaskId!==undefined)return fail('scope_changed');
  const current=await readSocialProductAssetRevisionPaidGuard(guard);
  if(current.guard.recordHash!==frozen.guard.recordHash)return fail('guard_changed');
  const task=await requireSocialTask({repository,tenantId:scope.tenantId,taskId:scope.taskId});
  const run=await repository.get(STARTER_COLLECTIONS.runs,scope.tenantId,scope.runId);
  const context=socialObject(socialJson(run?.starter_context));
  const queue=await repository.list(STARTER_COLLECTIONS.tasks,scope.tenantId,
   {where:{run_id:scope.runId,task_key:'social_product_asset_revision_admission'},perPage:2});
  const row=queue.items[0],job=await readContentExecutionJob(store,scope.tenantId,scope.taskId,scope.runId);
  const worker=socialObject(job?.checkpoints?.['social.asset_revision_worker_admission']?.payload);
  if(task.run_id!==scope.runId||task.status!=='running'||run?.status!=='running'
   ||socialObject(context?.paidGuard)?.recordHash!==frozen.guard.recordHash
   ||queue.totalItems!==1||queue.items.length!==1||row?.status!=='running'
   ||row.policy_source!=='social-product-asset-revision-schedule.v1'||row.automatic_execution_allowed!==true
   ||job?.status!=='running'||job.taskType!=='social_product_asset_revision'
   ||!job.workerId||!job.leaseExpiresAt||Date.parse(job.leaseExpiresAt)<=Date.now()
   ||worker?.schemaVersion!=='social-product-asset-revision-worker-admission.v1'
   ||worker.guardHash!==frozen.guard.recordHash||worker.planHash!==scope.planHash
   ||worker.replacementSha256!==frozen.guard.replacementSha256)return fail('canonical_worker_admission_missing');
  const ledger=new SocialContentTaskBudget(input.ledgerRoot,{authorization:async()=>fail('read_only'),
   quote:async()=>fail('read_only'),assertCurrent:async()=>fail('read_only'),verifyRejection:async()=>false});
  const status=ledger.status(scope);
  if(!status||status.authorizedLimitCny!==10||status.limitCny!==10||status.hasCorrectionAuthorization
   ||status.retainedCny>10)return fail('ten_yuan_ledger_invalid');
  if(canonicalPlanHash&&socialRequestHash(await input.readCanonicalPlan(scope))!==canonicalPlanHash)
   return fail('canonical_plan_changed');
 };
 // This must fail before a permit exists for today's paused/blocked scheduler.
 await assertCurrent(scope);
 const plan=await input.readCanonicalPlan(scope);
 if(plan.scope.tenantId!==scope.tenantId||plan.scope.taskId!==scope.taskId
  ||plan.scope.runId!==scope.runId||plan.scope.planHash!==scope.planHash||plan.scope.budgetTaskId!==undefined
  ||plan.maximumCny!==10||plan.authorizationRef!==`asset-revision:${frozen.guard.recordHash}`
  ||plan.revisionGuardHash!==frozen.guard.recordHash||plan.replacementSha256!==frozen.guard.replacementSha256
  ||!Array.isArray(plan.paidOperations)||!plan.paidOperations.length)return fail('canonical_plan_invalid');
 canonicalPlanHash=socialRequestHash(plan);
 const operations=plan.paidOperations.map(intent=>socialPaidIntentOperation(scope,intent));
 if(new Set(operations.map(item=>item.operationId)).size!==operations.length)return fail('duplicate_operation');
 const ledger=new SocialContentTaskBudget(input.ledgerRoot,{authorization:async()=>fail('read_only'),
  quote:async()=>fail('read_only'),assertCurrent,verifyRejection:async()=>false});
 const status=ledger.status(scope);
 const entries=status?.entries.filter(entry=>entry.runId===scope.runId&&entry.status!=='rejected')??[];
 if(entries.length!==operations.length||operations.some(operation=>{
  const entry=entries.find(item=>item.operationId===operation.operationId);
  return !entry||entry.planHash!==scope.planHash||(entry.executionTaskId??scope.taskId)!==scope.taskId
   ||(['fingerprint','provider','model','accountRef','stage','shotId'] as const).some(key=>entry[key]!==operation[key]);
 }))return fail('complete_reservation_missing');
 await assertCurrent(scope);
 return createSocialContentPaidOperationPermit({scope,operations,intents:plan.paidOperations,ledger,
  root:input.permitRoot,assertCurrent});
}
