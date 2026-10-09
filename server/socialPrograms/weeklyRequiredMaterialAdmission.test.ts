import assert from 'node:assert/strict';
import test from 'node:test';
import { assessWeeklyRequiredMaterialAdmission, type WeeklyRequiredMaterialAdmissionPort } from './weeklyRequiredMaterialAdmission.js';
const scope={tenantId:'tenant',programId:'program',consumerTaskId:'material-step'};
function evidence(requestId:string,consumerTaskId='material-step',hash='a'.repeat(64)) {
 return {requestId,submissionVersion:1,consumer:{taskId:consumerTaskId,packageId:'week1',packageVersion:1,requirement:'产品正面'},materials:[{recordId:'material0000001',sha256:hash,type:'image' as const,byteSize:100}],verification:{reviewedAt:'2026-10-09T09:00:00+08:00',reviewedBy:'reviewer',decision:'accepted' as const,consumerDecisions:[{taskId:consumerTaskId,accepted:true,factCheck:'产品一致',rightsCheck:'权利已核验',visualCheck:'镜头清晰'}]}};
}
test('legacy missing contracts remain unhandled and explicit required-empty contracts block',async()=> {
 let calls=0;const port:WeeklyRequiredMaterialAdmissionPort={acceptedForConsumer:async()=>{calls++;return null;}};
 assert.equal((await assessWeeklyRequiredMaterialAdmission(scope,port)).status,'legacy_unhandled');
 assert.equal((await assessWeeklyRequiredMaterialAdmission({...scope,requirement:{required:true,requestIds:[]}},port)).status,'blocked');
 assert.equal((await assessWeeklyRequiredMaterialAdmission({...scope,requirement:{required:false,requestIds:[]}},port)).status,'ready');
 assert.equal(calls,0);
});
test('every frozen shared request is live-verified for this exact consumer and canonical revisions deduplicate',async()=> {
 const calls:string[]=[];const port:WeeklyRequiredMaterialAdmissionPort={acceptedForConsumer:async input=>{assert.deepEqual([input.tenantId,input.programId,input.consumerTaskId],['tenant','program','material-step']);calls.push(input.requestId);return evidence(input.requestId);}};
 const result=await assessWeeklyRequiredMaterialAdmission({...scope,requirement:{required:true,requestIds:['one','two']}},port);
 assert.equal(result.status,'ready');assert.deepEqual(calls,['one','two']);assert.equal(result.materials.length,1);assert.equal(result.verifiedRequestRefs.length,2);
});
test('missing or cancelled required request blocks without returning partial assets; consumer-specific rejection is preserved',async()=> {
 const port:WeeklyRequiredMaterialAdmissionPort={acceptedForConsumer:async input=>input.requestId==='accepted'?evidence(input.requestId):null};
 const result=await assessWeeklyRequiredMaterialAdmission({...scope,requirement:{required:true,requestIds:['accepted','cancelled-or-rejected']}},port);
 assert.equal(result.status,'blocked');assert.deepEqual(result.materials,[]);assert.equal(result.gaps[0]!.requestId,'cancelled-or-rejected');
 const other=await assessWeeklyRequiredMaterialAdmission({...scope,requirement:{required:true,requestIds:['wrong-consumer']}},{acceptedForConsumer:async()=>evidence('wrong-consumer','other-task')});
 assert.equal(other.status,'blocked');
});
test('same canonical material identity cannot be approved with conflicting frozen bytes',async()=> {
 const port:WeeklyRequiredMaterialAdmissionPort={acceptedForConsumer:async input=>evidence(input.requestId,'material-step',input.requestId==='one'?'a'.repeat(64):'b'.repeat(64))};
 const result=await assessWeeklyRequiredMaterialAdmission({...scope,requirement:{required:true,requestIds:['one','two']}},port);
 assert.equal(result.status,'blocked');assert(result.gaps.some(gap=>gap.code==='weekly_required_material_revision_conflict'));assert.deepEqual(result.materials,[]);
});
test('actual verification failure or absent human check evidence cannot become ready',async()=> {
 const fail=await assessWeeklyRequiredMaterialAdmission({...scope,requirement:{required:true,requestIds:['one']}},{acceptedForConsumer:async()=>{throw Object.assign(new Error('changed bytes'),{code:'weekly_material_revision_changed'});}});
 assert.equal(fail.status,'blocked');assert.equal(fail.gaps[0]!.code,'weekly_material_revision_changed');
 const missing=await assessWeeklyRequiredMaterialAdmission({...scope,requirement:{required:true,requestIds:['one']}},{acceptedForConsumer:async()=>({...evidence('one'),verification:null})});
 assert.equal(missing.status,'blocked');
});
