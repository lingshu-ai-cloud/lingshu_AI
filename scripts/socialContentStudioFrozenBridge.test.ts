import test from 'node:test';import assert from 'node:assert/strict';
import {assertFrozenStudioProjectWrite,bindFrozenSocialStudioProject,frozenStudioProjectSpec} from '../server/starter198/socialContentStudioFrozenBridge.js';
import {socialRequestHash} from '../server/starter198/socialContentValidation.js';
test('server frozen snapshot prevents old hydration/autosave drift while retaining failed provider evidence',async()=>{
 const shots=[{shotId:'S01',startSeconds:0,endSeconds:5.6,spokenText:'Actual hook.',visualInstruction:'Authorized presenter.'},{shotId:'S04',startSeconds:5.6,endSeconds:9.6,spokenText:'',visualInstruction:'Original packaging.'}];
 const immutable={tenantId:'t',taskId:'s',resolved:{replicationScript:{version:3,shots}}},planHash=socialRequestHash(immutable);
 const spec={shootingSlots:shots.map(s=>({id:s.shotId,slotId:s.shotId,duration:s.endSeconds-s.startSeconds,detail:`Visual: ${s.visualInstruction}\nSpoken: ${s.spokenText||'None'}`})),storyboardTimeline:shots.map(s=>({start:s.startSeconds,end:s.endSeconds})),storyboardSourcePlans:{S01:{},S04:{}},callToAction:'DM',allowRealPublishing:false,selectedProductIds:['p'],mode:'free_creation',script:'new script'};
 let project:any={id:'p1',tenant_id:'t',updated_at:'old',spec:{socialContentTaskId:'s',script:'old script',failedProviderReceipt:{canAdopt:false},shotProductions:{S04:{candidates:['failed']}}}};
 const task={tenant_id:'t',task_id:'s',run_id:'r',brief:{productId:'p',callToAction:'DM',_productionRevision:{...immutable,planHash}}};
 const binding={executor:'langgraph',inputHash:'hash',approvedContext:{version:'65',revisionPlanHash:planHash}};
 const job={id:'j',job_key:'key',user_id:'u',account_id:'a',task_type:'social',tenant_id:'t',task_id:'s',run_id:'r',status:'queued',checkpoints:{'social.executor':{version:'1',inputHash:'hash',updatedAt:new Date().toISOString(),payload:binding}}};
 const store:any={getById:async(c:string)=>c==='studio_projects'?project:job,list:async(c:string)=>({totalItems:1,items:c==='starter_social_content_tasks'?[task]:[job]}),compareAndSwap:async(_c:string,_id:string,expected:any,next:any)=>{if(expected.updated_at!==project.updated_at)return false;project={...project,...next};return true;}};
 // durable job reader consumes the schema-qualified checkpoint used by persisted queue rows.

 const result=await bindFrozenSocialStudioProject({dataStore:store,tenantId:'t',taskId:'s',runId:'r',projectId:'p1',expectedUpdatedAt:'old',planSpec:spec});
 assert.equal(result.replayed,false);assert.equal(project.spec.failedProviderReceipt.canAdopt,false);assert.deepEqual(project.spec.shotProductions.S04.candidates,['failed']);
 const canonical=frozenStudioProjectSpec(project.spec);assert.match(canonical.script,/5.6s-9.6s/);assert.equal(canonical.taskVersion,65);
 assert.throws(()=>assertFrozenStudioProjectWrite(project.spec,{...canonical,script:'old script'}),/studio_frozen_plan_changed/);
 const candidateUpdate={...canonical,shotProductions:{S04:{candidates:['failed','new-pending']}}};assert.doesNotThrow(()=>assertFrozenStudioProjectWrite(project.spec,candidateUpdate));
 assert.throws(()=>frozenStudioProjectSpec({...canonical,resolvedStudioContract:{...canonical.resolvedStudioContract,planSnapshot:{script:'tampered'}}}),/contract_corrupt/);
 await assert.rejects(bindFrozenSocialStudioProject({dataStore:store,tenantId:'t',taskId:'s',runId:'r',projectId:'p1',expectedUpdatedAt:'old',planSpec:spec}),/version_conflict/);
});
