import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentWorkflow.js';
import type {Starter198Repository} from './repository.js';
import {socialJson,socialObject,socialRequestHash} from './socialContentValidation.js';
import {readCurrentContentExecutionCheckpoint} from '../contentExecution/context.js';
type Allocation={plan:SocialAssetSupplyPlan;planHash:string};
const routeIdentity=(plan:SocialAssetSupplyPlan)=>{
 const {inventoryAudit:_,...routes}=plan;
 return socialRequestHash({...routes,shots:plan.shots.map(shot=>{
  if(shot.sourceStrategy!=='customer_real_asset')return shot;
  // The budget allocator rewrites explanatory copy for its selected local
  // base. It cannot change the source, window, facts, constraints or route.
  const {productionInstruction:_instruction,feasibilityReason:_reason,...local}=shot;
  const decision=local.materialRouting?.productGenerationDecision;
  if(!decision)return local;
  const {reason:_decisionReason,...boundDecision}=decision;
  return {...local,materialRouting:{...local.materialRouting,productGenerationDecision:boundDecision}};
 })});
};
/** Reuse an already-funded selection instead of quoting the film again after
 * a source-inventory observation changes. Paid preflight still revalidates the
 * original financial scope, voice, baseline, file bytes and every paid claim. */
export async function readSocialBudgetMaterialAllocation(input:{repository:Starter198Repository;tenantId:string;taskId:string;runId:string;allocationHash:string;baselineHash:string;baselineContractHash?:string;plan:SocialAssetSupplyPlan}):Promise<Allocation|null>{
 const exact=readCurrentContentExecutionCheckpoint<Allocation>({stage:'social.budget_material_routing',version:'1',inputHash:input.allocationHash});
 if(exact)return exact;
 const rows=await input.repository.dataStore?.list<Record<string,unknown>>('content_execution_jobs',{where:{tenant_id:input.tenantId,task_id:input.taskId,run_id:input.runId},perPage:2});
 if(!rows?.totalItems)return null;
 if(rows.totalItems!==1||rows.items.length!==1)throw Error('budget_material_recovery_job_ambiguous');
 const checkpoints=socialObject(socialJson(rows.items[0]!.checkpoints)),funded=socialObject(checkpoints?.['social.whole_film_budget']);
 if(!funded)return null;
 const funding=socialObject(funded.payload),executor=socialObject(checkpoints?.['social.executor']);
 const stored=socialObject(checkpoints?.['social.budget_material_routing']),saved=socialObject(stored?.payload) as Allocation|null;
 if(funded.inputHash!==executor?.inputHash||!(funding?.baselineHash===input.baselineHash||input.baselineContractHash&&funding?.paidBaselineContractHash===input.baselineContractHash)||stored?.version!=='1'||!saved?.plan
  ||socialRequestHash(saved.plan)!==saved.planHash||routeIdentity(saved.plan)!==routeIdentity(input.plan))throw Error('budget_material_funded_selection_changed');
 return structuredClone(saved);
}
