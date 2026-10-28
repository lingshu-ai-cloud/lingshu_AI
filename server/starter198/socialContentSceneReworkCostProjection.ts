import {socialObject} from './socialContentValidation.js';

/** Quote/policy hashes identify server evidence. Browser projections never
 * receive supplier account proof, raw pricing pages or local first-frame paths. */
export function publicSceneReworkCostEvidence(value:unknown):unknown {
 if(Array.isArray(value))return value.map(publicSceneReworkCostEvidence);
 const object=socialObject(value);if(!object)return value;
 return Object.fromEntries(Object.entries(object).map(([key,item])=>{
  if(key!=='presenterPlan')return [key,publicSceneReworkCostEvidence(item)];
  const plan=socialObject(item),scope=socialObject(plan?.scope);
  return [key,plan?{scope:scope?{tenantId:scope.tenantId,taskId:scope.taskId,runId:scope.runId,planHash:scope.planHash}:null,
   operations:Array.isArray(plan.operations)?plan.operations.map(operation=>{
    const row=socialObject(operation),requirement=socialObject(row?.requirement),quote=socialObject(row?.quote);
    return {sceneId:requirement?.shotId,durationSeconds:requirement?.durationSeconds,upperBoundCny:quote?.upperBoundCny};
   }):[],totalUpperBoundCny:plan.totalUpperBoundCny,validUntil:plan.validUntil,recordHash:plan.recordHash}:null];
 }));
}
