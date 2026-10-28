import {initialMaterialPlanHash} from './socialContentInitialMaterialPlanIdentity.js';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentTaskContract.js';
import type {Starter198Repository} from './repository.js';
import {applyInitialMaterialRecovery} from './socialContentMaterialRecovery.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {socialRequestHash,socialText} from './socialContentValidation.js';

/** Explicitly recovered materials are runtime inputs, never a rewrite of the
 * admitted graph inventory. Existing recovery owns identity, rights, version
 * and original-slot checks before a new inventory row can be exposed. */
export async function readInitialMaterialRuntimeDetail(input:{repository:Starter198Repository;tenantId:string;taskId:string;
 originalDetail:SocialContentTaskDetail;
 readFrozenInventory:NonNullable<Starter198Repository['materialLibrary']>;
 missingLabelOverlay?:Parameters<typeof readSocialTaskDetail>[0]['missingLabelOverlay']}){
 const detail=input.originalDetail;
 if(!detail.runId||detail.assetSupplyPlan?.materialRoutingPolicyVersion!=='type-aware.v3')return detail;
 const recovered=await applyInitialMaterialRecovery({...input,runId:detail.runId,taskVersion:detail.version,plan:detail.assetSupplyPlan});
 if(initialMaterialPlanHash(recovered.plan)===recovered.originalPlanHash)return detail;
 const refs=new Set(recovered.plan.shots.flatMap((shot,index)=>
  socialRequestHash(shot)!==socialRequestHash(detail.assetSupplyPlan!.shots[index])?shot.sourceRefs:[]));
 const originalLibrary=input.repository.materialLibrary;
 if(!originalLibrary)throw Error('material_recovery_inventory_reader_missing');
 const repository={...input.repository,materialLibrary:async(...args:Parameters<NonNullable<Starter198Repository['materialLibrary']>>)=>{
  const frozen=await input.readFrozenInventory(...args),current=await originalLibrary(...args);
  if(current.status==='unavailable')throw Error('material_inventory_unavailable');
  const admitted=new Set(frozen.items.map(item=>socialText(item.id)));
  return {...frozen,items:[...frozen.items,...current.items.filter(item=>refs.has(socialText(item.id))
   &&!admitted.has(socialText(item.id))&&socialText(item.tenantId??item.tenant_id)===input.tenantId)]};
 }};
 const result=await readSocialTaskDetail({...input,repository,runtimeSupplyPlan:recovered.plan});
 if(!result)throw Error('material_recovery_runtime_detail_missing');
 return result;
}
