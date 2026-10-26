import {validProductionBudgetMaximum,validOriginalProductionBudget} from '../../shared/contracts/productionBudgetPolicy.js';
import {createSocialContentTaskBudgetAuthority,type SocialApprovedBudgetPlan,type SocialTaskBudgetAuthorityPorts} from '../lib/socialContentTaskBudgetAuthority.js';
import type {SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import type {Starter198Repository} from './repository.js';
import {readSocialProductAssetRevisionPaidGuard} from './socialContentAssetRevisionPaidGuard.js';
import {requireSocialTask} from './socialContentRecords.js';
import {socialText,SocialContentWorkflowError} from './socialContentValidation.js';

type GuardInput=Parameters<typeof readSocialProductAssetRevisionPaidGuard>[0];
type RevisionBudgetPlan=SocialApprovedBudgetPlan&{revisionGuardHash:string;replacementSha256:string};
const fail=(code:string):never=>{throw new SocialContentWorkflowError(`social_content_asset_revision_budget_${code}`,409);};

/** Reserve a complete, server-planned new-run paid envelope in the original
 * task ledger. The returned record cannot submit a provider request: worker
 * admission, rights, first-frame QA and a paid-operation permit remain separate. */
export async function reserveSocialProductAssetRevisionBudget(input:{repository:Starter198Repository;guard:GuardInput;
 ledgerRoot?:string;ports:Pick<SocialTaskBudgetAuthorityPorts,'readVerifiedTariff'|'verifyRejection'>&{
  readApprovedPlan(scope:SocialTaskBudgetScope):Promise<RevisionBudgetPlan>;
  assertCurrent(scope:SocialTaskBudgetScope):Promise<void>;
 }}):Promise<{scope:SocialTaskBudgetScope;operationIds:string[];retainedCny:number;remainingCny:number;
 authorizesProvider:false;authorizesProduction:false}>{
 const {guard,repository}=input;
 if(guard.repository!==repository||guard.prepared.repository!==repository||guard.tenantId!==guard.prepared.tenantId
  ||guard.taskId!==guard.prepared.taskId||!socialText(guard.expectedRecordHash))return fail('scope_invalid');
 const frozen=await readSocialProductAssetRevisionPaidGuard(guard);
 const task=await requireSocialTask({repository,tenantId:guard.tenantId,taskId:guard.taskId});
 if(task.run_id!==guard.revisionRunId)return fail('new_run_not_active');
 const scope:SocialTaskBudgetScope={tenantId:guard.tenantId,taskId:guard.taskId,runId:guard.revisionRunId,
  planHash:frozen.guard.revisedPlanHash};
 const check=async(candidate:SocialTaskBudgetScope)=>{
  if(candidate.tenantId!==scope.tenantId||candidate.taskId!==scope.taskId||candidate.runId!==scope.runId
   ||candidate.planHash!==scope.planHash||candidate.budgetTaskId!==undefined)return fail('scope_changed');
  const now=await readSocialProductAssetRevisionPaidGuard(guard);
  if(now.guard.recordHash!==frozen.guard.recordHash)return fail('guard_changed');
  const currentTask=await requireSocialTask({repository,tenantId:scope.tenantId,taskId:scope.taskId});
  if(currentTask.run_id!==scope.runId)return fail('new_run_changed');
  await input.ports.assertCurrent(scope);
 };
 const readPlan=async(candidate:SocialTaskBudgetScope)=>{
  const plan=await input.ports.readApprovedPlan(candidate);
  if(plan.scope.tenantId!==scope.tenantId||plan.scope.taskId!==scope.taskId
   ||plan.scope.runId!==scope.runId||plan.scope.planHash!==scope.planHash
   ||plan.scope.budgetTaskId!==undefined||!validProductionBudgetMaximum(plan.maximumCny,plan.productionDurationSeconds)
   ||Math.round(plan.maximumCny*1e6)!==Math.round(frozen.maximumCny*1e6)
   ||plan.authorizationRef!==`asset-revision:${frozen.guard.recordHash}`
   ||plan.revisionGuardHash!==frozen.guard.recordHash
   ||plan.replacementSha256!==frozen.guard.replacementSha256)return fail('approved_plan_invalid');
  return plan;
 };
 await check(scope);
 const authority=createSocialContentTaskBudgetAuthority({ledgerRoot:input.ledgerRoot,ports:{
  assertCurrent:check,readApprovedPlan:readPlan,readVerifiedTariff:input.ports.readVerifiedTariff,
  verifyRejection:input.ports.verifyRejection,
 }});
 const reserved=await authority.prepareAndReserve(scope);
 const checked=await readSocialProductAssetRevisionPaidGuard(guard);
 if(checked.guard.recordHash!==frozen.guard.recordHash||!validOriginalProductionBudget(reserved.status)
  ||reserved.status.hasCorrectionAuthorization||reserved.status.retainedCny>reserved.status.limitCny)return fail('reservation_changed');
 return {scope,operationIds:reserved.operations.map(operation=>operation.operationId),
  retainedCny:reserved.status.retainedCny,remainingCny:reserved.status.remainingCny,
  authorizesProvider:false,authorizesProduction:false};
}
