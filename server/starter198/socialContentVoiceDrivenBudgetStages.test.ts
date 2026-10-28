import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeVoiceBudgetPlan,preserveBeforeVoiceOperations,voiceDrivenWholeTrackPlan,VOICE_DRIVEN_BUDGET_STAGES_SCHEMA} from './socialContentVoiceDrivenBudgetStages.js';
import {paidProductionHash,type PaidStageRequirement} from './socialContentPaidOperationPlan.js';
import {createSocialContentTaskBudgetAuthority,type SocialApprovedBudgetPlan,type SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
const scope={tenantId:'tenant',taskId:'film',runId:'run',planHash:'a'.repeat(64)};
function fixture(){
 const requirements=[{key:'voice:0:tts',stage:'tts',shotId:null},{key:'source:video',stage:'video',shotId:'source'},{key:'presenter-group:mother:first-frame',stage:'first_frame',shotId:'mother',presenterGroupId:'mother'},{key:'presenter-group:mother:presenter',stage:'presenter_video',shotId:null,presenterGroupId:'mother'}].map(req=>({...req,sourceRef:null,durationSeconds:null,text:null,frameCount:null,inputContractHash:paidProductionHash(req)})) as PaidStageRequirement[];
 const routeBindings=Object.fromEntries(requirements.map(req=>[req.key,{provider:'fixture',model:'metered',accountRef:'account',routeEvidenceRef:'actual-route',usageBoundRef:req.key,maximumAttempts:1,maximumUnits:{requests:1}}]));
 const intents=requirements.map(req=>({operationId:`paid-plan:${paidProductionHash({scope,key:req.key,attempt:0})}`,provider:'fixture',model:'metered',accountRef:'account',stage:req.stage,shotId:req.shotId,inputContractHash:paidProductionHash(req),maximumUnits:{requests:1}})) as SocialPaidOperationIntent[];
 const plan:SocialApprovedBudgetPlan={scope,authorizationRef:'original-film',maximumCny:15,paidOperations:intents,presenterGroups:[]};
 const shots=[{shotId:'source',sourceStrategy:'owned_exact_local_video'},{shotId:'person',sourceStrategy:'authorized_digital_presenter'}] as never;
 return {requirements,routeBindings,plan,shots};
}
test('before voice preserves source production and voice, measured append preserves funded contracts',()=>{
 const f=fixture(),source=beforeVoiceBudgetPlan(f);
 assert.deepEqual(source.requirements.map(req=>req.stage),['tts','video']);
 assert.deepEqual(source.plan.paidOperations,f.plan.paidOperations.slice(0,2));
 const stages={schemaVersion:VOICE_DRIVEN_BUDGET_STAGES_SCHEMA,phase:'before_voice',sourcePlan:source.plan,sourceRequirements:source.requirements,sourceRoutes:source.routeBindings};
 const mutated={...f,plan:{...f.plan,paidOperations:f.plan.paidOperations.map(intent=>({...intent,inputContractHash:'f'.repeat(64)}))},requirements:f.requirements.map(req=>({...req,inputContractHash:'b'.repeat(64)}))};
 const measured=preserveBeforeVoiceOperations({...mutated,stages});
 assert.deepEqual(measured.plan.paidOperations.slice(0,2),source.plan.paidOperations);
 assert.deepEqual(measured.requirements.slice(0,2),source.requirements);
 assert.deepEqual(measured.plan.paidOperations.slice(2),mutated.plan.paidOperations.slice(2));
 assert.throws(()=>preserveBeforeVoiceOperations({...mutated,stages,plan:{...mutated.plan,scope:{...scope,runId:'new'}}}),/scope_changed/);
});
test('same film ledger appends measured work once and retains unknown spend against fifteen',async()=>{
 const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-driven-stages-'));
 try{
  const before=beforeVoiceBudgetPlan(f);let active=before.plan;
  const authority=createSocialContentTaskBudgetAuthority({ledgerRoot:root,ports:{assertCurrent:async()=>{},readApprovedPlan:async()=>active,verifyRejection:async()=>false,readVerifiedTariff:async intent=>({provider:intent.provider,model:intent.model,accountRef:intent.accountRef,stage:intent.stage,currency:'CNY',verifiedAccountPrice:true,evidenceRef:'fixed-price',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),meters:{requests:{priceCny:intent.stage==='tts'?13:intent.stage==='video'?1:.5,unitsPerPrice:1,minimumUnits:0,increment:1}}})}});
  const initial=await authority.prepareAndReserve(scope);assert.equal(initial.status.retainedCny,14);
  await initial.ledger.markOutcome(scope,initial.intents[0]!.operationId,'unknown','original-submit-unknown');
  active=f.plan;const measured=await authority.prepareAndReserve(scope);assert.equal(measured.status.retainedCny,15);
  assert.equal(measured.status.entries.find(entry=>entry.operationId===initial.intents[0]!.operationId)?.status,'unknown');
  const restarted=await authority.prepareAndReserve(scope);assert.equal(restarted.status.retainedCny,15);
  active={...f.plan,paidOperations:[...f.plan.paidOperations,{...f.plan.paidOperations.at(-1)!,operationId:'repair-additional'}]};
  await assert.rejects(authority.prepareAndReserve(scope),/exceeded/);assert.equal(initial.ledger.status(scope)!.retainedCny,15);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('only v3 aligned one-sentence voice is planned as one continuous track',()=>{
 const voice={mode:'sentences' as const,lines:['Only sentence'],requiresClone:false,allowFallback:false,requiresAsr:false,requiresAlignment:true,reuseReceiptRef:null};
 assert.equal(voiceDrivenWholeTrackPlan(voice,true).mode,'continuous');
 assert.equal(voiceDrivenWholeTrackPlan(voice,false),voice);
 assert.equal(voiceDrivenWholeTrackPlan({...voice,lines:['First','Second']},true).mode,'sentences');
});
