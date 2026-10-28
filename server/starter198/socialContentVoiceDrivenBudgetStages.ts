import type {SocialDirectorBriefScene} from '../../shared/contracts/socialContentAgentContract.js';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import type {SocialApprovedBudgetPlan,SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import {paidProductionHash,type BoundPaidRoute,type FrozenPaidProduction,type PaidStageRequirement} from './socialContentPaidOperationPlan.js';

export const VOICE_DRIVEN_BUDGET_STAGES_SCHEMA='voice-driven-budget-stages.v1';
export type VoiceDrivenBudgetStage='before_voice'|'after_voice';
export interface VoiceDrivenBudgetStages {
 schemaVersion:typeof VOICE_DRIVEN_BUDGET_STAGES_SCHEMA;
 phase:VoiceDrivenBudgetStage;
 originalSnapshot:FrozenPaidProduction;
 originalDirectorScenes:SocialDirectorBriefScene[];
 sourcePlan:SocialApprovedBudgetPlan;
 sourceRequirements:PaidStageRequirement[];
 sourceRoutes:Record<string,BoundPaidRoute>;
 measuredBindingHash?:string;
 measuredDirectorScenes?:SocialDirectorBriefScene[];
}
export function isDeferredPresenterRequirement(requirement:PaidStageRequirement,shots:SocialAssetSupplyPlan['shots']):boolean{
 return Boolean(requirement.presenterGroupId||requirement.stage==='presenter_video'
  ||(requirement.shotId&&shots.some(shot=>shot.shotId===requirement.shotId&&shot.sourceStrategy==='authorized_digital_presenter')));
}
/** Filter only the reservation, never the complete readonly pre-payment quote.
 * Source supply and narration remain executable before the measured track. */
export function beforeVoiceBudgetPlan(input:{plan:SocialApprovedBudgetPlan;requirements:PaidStageRequirement[];routeBindings:Record<string,BoundPaidRoute>;shots:SocialAssetSupplyPlan['shots']}){
 const deferred=input.requirements.filter(req=>isDeferredPresenterRequirement(req,input.shots));
 const deferredIds=new Set(deferred.flatMap(req=>input.plan.paidOperations.filter(intent=>intent.stage===req.stage&&intent.shotId===req.shotId
  &&intent.operationId.startsWith('paid-plan:')&&[0,1,2].some(attempt=>intent.operationId===`paid-plan:${paidProductionHash({scope:input.plan.scope,key:req.key,attempt})}`)).map(intent=>intent.operationId)));
 const requirements=input.requirements.filter(req=>!deferred.includes(req));
 const plan:SocialApprovedBudgetPlan={...structuredClone(input.plan),presenterGroups:[],paidOperations:input.plan.paidOperations.filter(intent=>!deferredIds.has(intent.operationId))};
 const routeBindings=Object.fromEntries(requirements.flatMap(req=>input.routeBindings[req.key]?[[req.key,input.routeBindings[req.key]]]:[]));
 return {plan,requirements,routeBindings};
}
/** Global approval hashes change with the measured timeline. Previously funded
 * source and voice requests keep their original complete contracts and quotes. */
export function preserveBeforeVoiceOperations(input:{stages:Pick<VoiceDrivenBudgetStages,'sourcePlan'|'sourceRequirements'|'sourceRoutes'>;plan:SocialApprovedBudgetPlan;requirements:PaidStageRequirement[];routeBindings:Record<string,BoundPaidRoute>;shots:SocialAssetSupplyPlan['shots']}){
 const stages=input.stages;
 if(paidProductionHash(stages.sourcePlan.scope)!==paidProductionHash(input.plan.scope))throw Error('voice_driven_budget_scope_changed');
 const newRequirements=input.requirements.filter(req=>isDeferredPresenterRequirement(req,input.shots));
 const oldKeys=new Set(stages.sourceRequirements.map(req=>req.key));
 if(newRequirements.some(req=>oldKeys.has(req.key)))throw Error('voice_driven_budget_source_key_conflict');
 const oldIds=new Set(stages.sourcePlan.paidOperations.map(intent=>intent.operationId));
 const fresh=beforeVoiceBudgetPlan(input),nonPresenterIds=new Set(fresh.plan.paidOperations.map(intent=>intent.operationId));
 const additions:SocialPaidOperationIntent[]=input.plan.paidOperations.filter(intent=>!nonPresenterIds.has(intent.operationId));
 if(additions.some(intent=>oldIds.has(intent.operationId)))throw Error('voice_driven_budget_source_operation_conflict');
 return {plan:{...input.plan,paidOperations:[...structuredClone(stages.sourcePlan.paidOperations),...additions]},
  requirements:[...structuredClone(stages.sourceRequirements),...newRequirements],
  routeBindings:{...stages.sourceRoutes,...Object.fromEntries(newRequirements.flatMap(req=>input.routeBindings[req.key]?[[req.key,input.routeBindings[req.key]]]:[]))}};
}

export function voiceDrivenWholeTrackPlan(voice:FrozenPaidProduction['voice'],voiceDriven:boolean):FrozenPaidProduction['voice']{
 return voiceDriven&&voice.mode==='sentences'&&voice.lines.length===1&&voice.requiresAlignment?{...voice,mode:'continuous'}:voice;
}
