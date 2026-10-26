import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {SocialContentTaskBudget} from './socialContentTaskBudget.js';
import {socialPaidIntentOperation,type SocialPaidOperationIntent} from './socialContentTaskBudgetAuthority.js';
import {createSocialContentPaidOperationPermit} from './socialContentPaidOperationPermit.js';

async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'paid-execution-binding-'));
 const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)};
 const intents:SocialPaidOperationIntent[]=[
  {operationId:'image',provider:'seedream',model:'seedream-test',accountRef:'ark',stage:'first_frame',shotId:'group',inputContractHash:'b'.repeat(64),maximumUnits:{inputImages:2,outputImages:1},executionBindingPolicy:{schemaVersion:'paid-execution-binding-policy.v1',parentOperationIds:[]}},
  {operationId:'inspection',provider:'qwen',model:'qwen-test',accountRef:'qwen',stage:'first_frame_qa',shotId:'group',inputContractHash:'c'.repeat(64),maximumUnits:{inputTokens:100,outputTokens:100},executionBindingPolicy:{schemaVersion:'paid-execution-binding-policy.v1',parentOperationIds:['image']}},
 ];
 const operations=intents.map(intent=>socialPaidIntentOperation(scope,intent));
 const ledger=new SocialContentTaskBudget(path.join(root,'ledger'),{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'owned-test-budget'}),quote:async()=>({upperBoundCny:.2,quoteRef:'test-bounded-tariff',validUntil:'2099-01-01'}),verifyRejection:async()=>false});
 await ledger.reserveBatch(scope,operations);
 const config={scope,intents,operations,ledger,root:path.join(root,'permit'),assertCurrent:async()=>{}};
 const permit=createSocialContentPaidOperationPermit(config);
 const request=(index:number,bindingHash?:string)=>{const{maximumUnits,...binding}=intents[index]!;return{...binding,actualUnits:maximumUnits,...(bindingHash?{executionBindingHash:bindingHash}:{})};};
 return{root,config,permit,intents,ledger,scope,request};
}

test('parent evidence must complete before one-time child binding; restart preserves both claims',async()=>{
 const f=await fixture();
 try{
  const dependency={operationId:'image',receiptRef:'seedream:request-1',artifactSha256:'d'.repeat(64)};
  await assert.rejects(f.permit.bindExecution({operationId:'inspection',requestFingerprint:'e'.repeat(64),dependencies:[dependency]}),/dependency_not_completed/);
  const image=await f.permit.bindExecution({operationId:'image',requestFingerprint:'f'.repeat(64),dependencies:[]});assert.ok(image);
  await assert.rejects(f.permit.beforeSubmit(f.request(0)),/execution_binding_required/);
  await f.permit.beforeSubmit(f.request(0,image.bindingHash));
  await assert.rejects(f.permit.markOutcome('image','completed',dependency.receiptRef),/artifact_hash_required/);
  await f.permit.markOutcome('image','completed',dependency.receiptRef,{sha256:dependency.artifactSha256});
  await assert.rejects(f.permit.bindExecution({operationId:'inspection',requestFingerprint:'e'.repeat(64),dependencies:[{...dependency,artifactSha256:'0'.repeat(64)}]}),/dependency_artifact_changed/);
  const child=await f.permit.bindExecution({operationId:'inspection',requestFingerprint:'e'.repeat(64),dependencies:[dependency]});assert.ok(child);
  await f.permit.beforeSubmit(f.request(1,child.bindingHash));await f.permit.markOutcome('inspection','completed','qwen:request-2',{sha256:'1'.repeat(64)});
  const restarted=createSocialContentPaidOperationPermit(f.config);
  assert.equal((await restarted.assertRecovery('inspection')).status,'completed');
  assert.equal((await restarted.bindExecution({operationId:'inspection',requestFingerprint:'e'.repeat(64),dependencies:[dependency]}))?.bindingHash,child.bindingHash);
  await assert.rejects(restarted.bindExecution({operationId:'inspection',requestFingerprint:'2'.repeat(64),dependencies:[dependency]}),/execution_binding_conflict/);
  assert.equal(f.ledger.status(f.scope)?.retainedCny,.4);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('concurrent identical bindings are idempotent and conflicting bindings cannot replace the winner',async()=>{
 const f=await fixture();
 try{
  const input={operationId:'image',requestFingerprint:'f'.repeat(64),dependencies:[]};
  const results=await Promise.allSettled([f.permit.bindExecution(input),f.permit.bindExecution(input)]);
  assert.ok(results.some(result=>result.status==='fulfilled'));
  const winner=await f.permit.bindExecution(input);assert.ok(winner);
  await assert.rejects(f.permit.bindExecution({...input,requestFingerprint:'0'.repeat(64)}),/execution_binding_conflict/);
  assert.equal(f.ledger.status(f.scope)?.entries[0]?.status,'reserved','binding itself is not a supplier submission or charge');
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('v2 policy binds exactly one completed allowed parent set and rejects unplanned parents',async()=>{
 const f=await fixture();
 try{
  const alternate:SocialPaidOperationIntent={...f.intents[0]!,operationId:'image-alternate',inputContractHash:'2'.repeat(64)};
  const child:SocialPaidOperationIntent={...f.intents[1]!,operationId:'inspection-v2',inputContractHash:'6'.repeat(64),executionBindingPolicy:{schemaVersion:'paid-execution-binding-policy.v2',allowedParentOperationSets:[['image'],['image-alternate']]}};
  const intents=[f.intents[0]!,alternate,child],operations=intents.map(intent=>socialPaidIntentOperation(f.scope,intent));
  await f.ledger.reserveBatch(f.scope,operations);
  const permit=createSocialContentPaidOperationPermit({...f.config,intents,operations});
  const root=await permit.bindExecution({operationId:'image-alternate',requestFingerprint:'3'.repeat(64),dependencies:[]});
  const{maximumUnits,...binding}=alternate;await permit.beforeSubmit({...binding,actualUnits:maximumUnits,executionBindingHash:root!.bindingHash});
  const dependency={operationId:'image-alternate',receiptRef:'seedream:alternate',artifactSha256:'4'.repeat(64)};
  await permit.markOutcome(alternate.operationId,'completed',dependency.receiptRef,{sha256:dependency.artifactSha256});
  const selected=await permit.bindExecution({operationId:child.operationId,requestFingerprint:'5'.repeat(64),dependencies:[dependency]});
  assert.ok(selected!.bindingHash);
  await assert.rejects(permit.bindExecution({operationId:child.operationId,requestFingerprint:'5'.repeat(64),dependencies:[{...dependency,operationId:'unplanned'}]}),/dependencies_changed|binding_conflict/);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('unknown submissions, missing bindings, and cyclic policies fail closed',async()=>{
 const f=await fixture();
 try{
  const binding=await f.permit.bindExecution({operationId:'image',requestFingerprint:'f'.repeat(64),dependencies:[]});assert.ok(binding);
  await f.permit.beforeSubmit(f.request(0,binding.bindingHash));
  await assert.rejects(f.permit.bindExecution({operationId:'image',requestFingerprint:'e'.repeat(64),dependencies:[]}),/binding_conflict/);
  const file=(await fs.readdir(f.config.root)).find(name=>name.endsWith('.binding.json'))!;await fs.unlink(path.join(f.config.root,file));
  await assert.rejects(createSocialContentPaidOperationPermit(f.config).assertRecovery('image'),/claim_corrupt/);
  const changed=structuredClone(f.config.intents);changed[0]!.executionBindingPolicy={schemaVersion:'paid-execution-binding-policy.v1',parentOperationIds:['inspection']};
  assert.throws(()=>createSocialContentPaidOperationPermit({...f.config,intents:changed,operations:changed.map(intent=>socialPaidIntentOperation(f.scope,intent))}),/execution_dependency_invalid/);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
