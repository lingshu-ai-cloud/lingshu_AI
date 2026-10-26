import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import type {FirstFrameResult} from '../lib/firstFrameGenerator.js';
import {preparePaidPresenterImage,preparePaidPresenterInspection} from './socialContentPresenterImageArtifact.js';

async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'presenter-image-recovery-'));
 const scope={tenantId:'tenant-a',taskId:'task-a',runId:'run-a',planHash:'a'.repeat(64)};
 const intent:SocialPaidOperationIntent={operationId:'op-image',provider:'seedream',model:'seedream-test',accountRef:'account',stage:'first_frame',shotId:'group-a',inputContractHash:'b'.repeat(64),maximumUnits:{inputImages:2,outputImages:1}};
 let submissions=0,settlements=0,claim=false,status='unknown',receiptRef='',failSettlement=false;
 const permit={isProvenUnsubmitted:async()=>!claim,assertRecovery:async()=>{assert.equal(claim,true);return{status,receiptRef,submission:intent};},markOutcome:async(_id:string,_status:string,receipt:string)=>{settlements++;if(failSettlement){failSettlement=false;throw Error('ledger_write_interrupted');}status='completed';receiptRef=receipt;}} as never;
 const generate=async():Promise<FirstFrameResult>=>{assert.equal(claim,false,'no duplicate supplier POST');claim=true;submissions++;return{bytes:Buffer.from('immutable supplier image'),mimeType:'image/png',provider:'seedream',model:intent.model,providerRequestId:'provider-request-1',estimatedCostCny:.22};};
 const input={scope,intent,requestFingerprint:'c'.repeat(64),root,permit,generate};
 return{root,input,submissions:()=>submissions,settlements:()=>settlements,interruptSettlement:()=>{failSettlement=true;},claimWithoutArtifact:()=>{claim=true;}};
}

test('paid image recovery validates original receipt and bytes without another supplier call',async()=>{
 const f=await fixture();
 try{
  const original=await preparePaidPresenterImage(f.input),recovered=await preparePaidPresenterImage(f.input);
  assert.equal(original.reused,false);assert.equal(recovered.reused,true);assert.deepEqual(recovered.bytes,original.bytes);assert.equal(recovered.receiptRef,original.receiptRef);assert.equal(recovered.estimatedCostCny,.22);assert.equal(f.submissions(),1);assert.equal(f.settlements(),1);
  await assert.rejects(preparePaidPresenterImage({...f.input,requestFingerprint:'d'.repeat(64)}),/artifact_recovery_required/);
  assert.equal(f.submissions(),1,'changed inputs cannot acquire a second use of the original operation');
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('crash after durable image receipt resumes settlement of the same claim',async()=>{
 const f=await fixture();
 try{
  f.interruptSettlement();await assert.rejects(preparePaidPresenterImage(f.input),/ledger_write_interrupted/);
  const recovered=await preparePaidPresenterImage(f.input);assert.equal(recovered.reused,true);assert.equal(f.submissions(),1);assert.equal(f.settlements(),2);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('lost or altered artifact blocks recovery and never clears the supplier claim',async()=>{
 const f=await fixture();
 try{
  await preparePaidPresenterImage(f.input);
  const directory=path.join(f.root,(await fs.readdir(f.root))[0]!);
  const image=path.join(directory,(await fs.readdir(directory)).find(name=>name.endsWith('.image'))!);
  await fs.writeFile(image,'changed');await assert.rejects(preparePaidPresenterImage(f.input),/artifact_bytes_changed/);assert.equal(f.submissions(),1);
  await fs.unlink(image);await assert.rejects(preparePaidPresenterImage(f.input),/artifact_bytes_missing/);assert.equal(f.submissions(),1);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
 const missing=await fixture();
 try{missing.claimWithoutArtifact();await assert.rejects(preparePaidPresenterImage(missing.input),/artifact_recovery_required/);assert.equal(missing.submissions(),0);}
 finally{await fs.rm(missing.root,{recursive:true,force:true});}
});


test('completed or ledger-interrupted visual inspections reuse the original report',async()=>{
 for(const interrupt of [false,true]){
  const f=await fixture();
  try{
   f.input.intent.provider='qwen';f.input.intent.model='qwen-test';
   let calls=0;
   const input={...f.input,inputFingerprint:'d'.repeat(64),evaluate:async()=>{
    calls++;f.claimWithoutArtifact();
    return{evaluation:{firstFrameQualityState:'service_unavailable' as const,firstFrameQuality:null,canProceedToVideo:false as const,retryable:true as const,code:'FIRST_FRAME_QA_SERVICE_UNAVAILABLE' as const,error:'unavailable',contractIssues:[]},providerReceipt:{id:'qwen-request-1'}};
   }};
   if(interrupt){f.interruptSettlement();await assert.rejects(preparePaidPresenterInspection(input),/ledger_write_interrupted/);}
   else await preparePaidPresenterInspection(input);
   const restored=await preparePaidPresenterInspection(input);
   assert.equal(calls,1);assert.equal(restored.evaluation.canProceedToVideo,false,'recovery must retain the original unknown result');assert.match(restored.receiptRef,/^qwen:qwen-request-1:/);
   const directory=path.join(f.root,(await fs.readdir(f.root))[0]!);
   const file=path.join(directory,(await fs.readdir(directory)).find(name=>name.endsWith('.qa.json'))!);
   const report=JSON.parse(await fs.readFile(file,'utf8'));report.evaluation.canProceedToVideo=true;await fs.writeFile(file,JSON.stringify(report));
   await assert.rejects(preparePaidPresenterInspection(input),/inspection_artifact_changed/);assert.equal(calls,1);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
 }
});

test('artifact recovery consumes the existing ledger reservation and permit without a second charge',async()=>{
 const {SocialContentTaskBudget}=await import('../lib/socialContentTaskBudget.js');
 const {createSocialContentPaidOperationPermit}=await import('../lib/socialContentPaidOperationPermit.js');
 const {socialPaidIntentOperation}=await import('../lib/socialContentTaskBudgetAuthority.js');
 const f=await fixture();
 try{
  f.input.intent.executionBindingPolicy={schemaVersion:'paid-execution-binding-policy.v1',parentOperationIds:[]};
  const operation=socialPaidIntentOperation(f.input.scope,f.input.intent);
  const ledger=new SocialContentTaskBudget(path.join(f.root,'ledger'),{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'test-owned-budget'}),quote:async()=>({upperBoundCny:.22,quoteRef:'test-bounded-quote',validUntil:'2099-01-01'}),verifyRejection:async()=>false});
  await ledger.reserveBatch(f.input.scope,[operation]);
  const permitConfig={scope:f.input.scope,operations:[operation],intents:[f.input.intent],ledger,root:path.join(f.root,'permit'),assertCurrent:async()=>{}};
  let calls=0;
  const generate=async(executionBindingHash?:string)=>{const {maximumUnits,...binding}=f.input.intent;await createSocialContentPaidOperationPermit(permitConfig).beforeSubmit({...binding,actualUnits:maximumUnits,executionBindingHash});calls++;return{bytes:Buffer.from('supplier bytes'),provider:'seedream' as const,model:f.input.intent.model,mimeType:'image/png' as const,providerRequestId:'supplier-1',estimatedCostCny:.22};};
  const input={...f.input,permit:createSocialContentPaidOperationPermit(permitConfig),generate};
  const first=await preparePaidPresenterImage(input);
  const resumed=await preparePaidPresenterImage({...input,permit:createSocialContentPaidOperationPermit(permitConfig)});
  assert.equal(calls,1);assert.equal(resumed.receiptRef,first.receiptRef);assert.equal(ledger.status(input.scope)?.retainedCny,.22);
  const reorderedIntent:SocialPaidOperationIntent={...input.intent,maximumUnits:{outputImages:1,inputImages:2},executionBindingPolicy:{parentOperationIds:[],schemaVersion:'paid-execution-binding-policy.v1'}};
  const reordered=await preparePaidPresenterImage({...input,intent:reorderedIntent,permit:createSocialContentPaidOperationPermit({...permitConfig,intents:[reorderedIntent]})});assert.equal(reordered.receiptRef,first.receiptRef);assert.equal(calls,1,'JSON key ordering must not buy another image or lose the original artifact');
  assert.equal((await input.permit.assertRecovery(input.intent.operationId)).status,'completed');
  const {maximumUnits,...binding}=input.intent;
  const executionBindingHash=(await input.permit.assertRecovery(input.intent.operationId)).submission.executionBindingHash;
  await assert.rejects(input.permit.beforeSubmit({...binding,actualUnits:maximumUnits,executionBindingHash}),/receipt_recovery_required/);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
