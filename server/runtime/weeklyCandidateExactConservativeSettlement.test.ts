import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWeeklyCandidateDynamicExactPaidRequests,createWeeklyCandidateDynamicExactPaidRequestsV2,weeklyCandidateDynamicExactInitialHeadV2,type WeeklyCandidateDynamicExactHeadV2,type WeeklyCandidateDynamicExactPlanV2} from './weeklyCandidateExactPaidRequests.js';
import {readWeeklyCandidateExactConservativeSettlement,readWeeklyCandidateExactConservativeSettlementV2} from './weeklyCandidateExactConservativeSettlement.js';
import {createQwenMaaSPublishedTariffReader,verifyQwenMaaSPublishedPricingEvidence} from '../lib/socialContentPublishedTariffs.js';
import {weeklyCandidateExactMeasurementPolicyHash} from './weeklyCandidateExactRequestCeiling.js';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
test('independent audit permits only an explicitly labelled upper-bound occupation after disk restart',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-upper-bound-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const plan={operationId:'op',candidateId:'candidate',mediaSha256:'a'.repeat(64),endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',
  credentialSha256:'b'.repeat(64),model:'qwen3-vl-plus' as const,maximumRequests:1,maximumTotalCny:1.7};
 const authorizationHash='c'.repeat(64),authorizationId='signed-auth',requestBody=JSON.stringify({model:plan.model,max_tokens:100,messages:[]});
 const args={root,authorizationHash,plan,assertCurrent:async()=>{}};
 const guard=createWeeklyCandidateDynamicExactPaidRequests(args);
 await guard.beforeProviderRequest(requestBody);
 const receipt={provider:'qwen' as const,responseId:'chatcmpl-1',providerRequestId:'audit-request-1',requestHash:sha(requestBody),
  model:plan.model,requestModel:plan.model,httpStatus:200,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},receivedAt:new Date().toISOString()};
 const audit={requestId:'audit-request-1',apiKeyId:'key-id-1',model:plan.model,status:200,usage:receipt.usage,sourceEvidenceHash:'d'.repeat(64)};
 const read=async(value= audit)=>readWeeklyCandidateExactConservativeSettlement({...args,authorizationId,auditApiKeyId:'key-id-1',reader:{readOriginalAuditRequest:async()=>value}});
 assert.equal(await read(),null,'unknown claim has no observed request ID and cannot advance');
 await guard.onProviderReceipt(receipt);
 const result=await read();
 assert.equal(result?.settlementBasis,'conservative_upper_bound');
 assert.match(result?.providerReceiptRef??'',/^qwen-audit-upper-bound:/);
 assert.ok((result?.recordedUpperBoundCny??0)>0);
 assert.equal((await createWeeklyCandidateDynamicExactPaidRequests(args).readClaim(sha(requestBody)))?.state,'response_recorded');
 assert.equal(await readWeeklyCandidateExactConservativeSettlement({...args,authorizationId,auditApiKeyId:'key-id-1'}),null);
 await assert.rejects(read({...audit,apiKeyId:'other'}),/audit_original_changed/);
 await assert.rejects(read({...audit,usage:{prompt_tokens:101,completion_tokens:10,total_tokens:111}}),/audit_original_changed/);
 await assert.rejects(read({...audit,status:500}),/audit_original_changed/);
});

test('ambiguous repeated platform Request ID across two paid children fails closed',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-audit-duplicate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const plan={operationId:'op-duplicate',candidateId:'candidate',mediaSha256:'a'.repeat(64),endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',
  credentialSha256:'b'.repeat(64),model:'qwen3-vl-plus' as const,maximumRequests:2,maximumTotalCny:1.7};
 const args={root,authorizationHash:'c'.repeat(64),plan,assertCurrent:async()=>{}},guard=createWeeklyCandidateDynamicExactPaidRequests(args);
 for(const [index,body] of ['first','second'].entries()){
  const requestBody=JSON.stringify({model:plan.model,max_tokens:100,messages:[{role:'user',content:body}]});
  await guard.beforeProviderRequest(requestBody);
  await guard.onProviderReceipt({provider:'qwen',responseId:`chatcmpl-${index}`,providerRequestId:'same-audit-id',requestHash:sha(requestBody),
   model:plan.model,requestModel:plan.model,httpStatus:200,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},receivedAt:new Date().toISOString()});
 }
 await assert.rejects(readWeeklyCandidateExactConservativeSettlement({...args,authorizationId:'auth',auditApiKeyId:'key-id-1',reader:{
  readOriginalAuditRequest:async()=>({requestId:'same-audit-id',apiKeyId:'key-id-1',model:plan.model,status:200,
   usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},sourceEvidenceHash:'d'.repeat(64)})}}),/duplicate_audit_request/);
});

async function v2SettlementFixture(t:test.TestContext){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-v2-settlement-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const endpoint='https://maas.qianwenaiapi.com/compatible-mode/v1',integrityKey='settlement-integrity-key',credentialSha256=sha('provider-key'),authorizationHash='c'.repeat(64),
  accountRef=`qwen:${sha(JSON.stringify({baseUrl:endpoint,credentialSha256}))}`;
 const tariff=await createQwenMaaSPublishedTariffReader({now:()=>new Date('2026-10-19T12:00:00.000Z'),readProviderBinding:async()=>({provider:'qwen',model:'qwen3-vl-plus',baseUrl:endpoint,credentialSha256})}).read({
  provider:'qwen',model:'qwen3-vl-plus',accountRef,stage:'candidate_exact_analysis',shotId:null,operationId:'settlement-tariff',inputContractHash:'f'.repeat(64),maximumUnits:{inputTokens:260096,outputTokens:16384}});assert.ok(tariff);
 const original=Date.now;Date.now=()=>Date.parse('2026-10-19T12:00:00.000Z');const policy=verifyQwenMaaSPublishedPricingEvidence(tariff.publicPricingEvidence,{baseUrl:endpoint,credentialSha256});Date.now=original;assert.ok(policy);
 const plan:WeeklyCandidateDynamicExactPlanV2={schema:'weekly-candidate-dynamic-exact-plan.v2',operationId:'settlement-operation',candidateId:'candidate-v2',mediaSha256:'a'.repeat(64),endpoint,
  credentialSha256,ledgerIntegrityKeySha256:sha(integrityKey),model:'qwen3-vl-plus',pricingEvidence:tariff.publicPricingEvidence,pricingEvidenceHash:sha(JSON.stringify(tariff.publicPricingEvidence)),
  pricingPolicyHash:policy.verificationHash,measurementPolicyHash:weeklyCandidateExactMeasurementPolicyHash(),protocolMaximumRequests:32,candidateMaximumMicros:10_000_000};
 let head:WeeklyCandidateDynamicExactHeadV2|null=weeklyCandidateDynamicExactInitialHeadV2(authorizationHash,plan,integrityKey);const headAnchor={read:async()=>head?structuredClone(head):null,
  compareAndSwap:async(expected:WeeklyCandidateDynamicExactHeadV2,next:WeeklyCandidateDynamicExactHeadV2)=>{if(JSON.stringify(head)!==JSON.stringify(expected))return false;head=structuredClone(next);return true;}};
 const assertAuthorizedPlan=async(value:WeeklyCandidateDynamicExactPlanV2,hashValue:string)=>{assert.deepEqual(value,plan);assert.equal(hashValue,authorizationHash);};
 const assertReservedPlanForSettlement=async(value:WeeklyCandidateDynamicExactPlanV2,hashValue:string)=>{await assertAuthorizedPlan(value,hashValue);return{authorizationId:'e'.repeat(24),authorizationHash,auditApiKeyId:'audit-key'};};
 const args={root,authorizationHash,plan,integrityKey,assertReservedPlanForSettlement,headAnchor};
 return{root,plan,args,headAnchor,getHead:()=>head?structuredClone(head):null,guard:createWeeklyCandidateDynamicExactPaidRequestsV2({root,authorizationHash,plan,integrityKey,assertAuthorizedPlan,headAnchor})};
}
const v2Request=(label:string)=>JSON.stringify({model:'qwen3-vl-plus',messages:[{role:'user',content:label}],response_format:{type:'json_object'},temperature:0,max_tokens:100});
const v2Receipt=(requestHash:string,index:number)=>({provider:'qwen' as const,responseId:`response-${index}`,providerRequestId:`request-${index}`,requestHash,
 model:'qwen3-vl-plus',requestModel:'qwen3-vl-plus',httpStatus:200,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},receivedAt:'2026-10-19T12:00:01.000Z'});

test('v2 settlement is deterministic, read-only and retains only persisted child holds',async t=>{
 const f=await v2SettlementFixture(t),audits=new Map<string,any>();
 for(const [index,label] of ['one','two'].entries()){const request=v2Request(label);await f.guard.beforeProviderRequest(request);const receipt=v2Receipt(sha(request),index);await f.guard.onProviderReceipt(receipt);
  audits.set(receipt.providerRequestId,{requestId:receipt.providerRequestId,apiKeyId:'audit-key',model:'qwen3-vl-plus',status:200,usage:receipt.usage,sourceEvidenceHash:String(index+1).repeat(64)});}
 const ledgerBefore=fs.readFileSync(f.guard.ledgerPath),headBefore=f.getHead(),reader={readOriginalAuditRequest:async({requestId}:{requestId:string})=>audits.get(requestId)??null};
 const first=await readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader});assert.ok(first);assert.equal(first.retainedOccupationMicros,first.reservedUpperBoundMicros);
 assert.ok(first.retainedOccupationMicros<first.candidateMaximumMicros);assert.ok(first.measuredCeilingMicros<first.retainedOccupationMicros);assert.equal(first.supplierBillingBasis,'platform_audit_usage_not_invoice');
 const restarted=await readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader:{readOriginalAuditRequest:async input=>{await new Promise(resolve=>setTimeout(resolve,input.requestId==='request-0'?5:0));return audits.get(input.requestId)??null;}}});
 assert.deepEqual(restarted,first);assert.deepEqual(fs.readFileSync(f.guard.ledgerPath),ledgerBefore);assert.deepEqual(f.getHead(),headBefore);
});

test('v2 rejects one audit source reused for two distinct provider requests',async t=>{
 const f=await v2SettlementFixture(t),audits=new Map<string,any>();
 for(const [index,label] of ['duplicate-a','duplicate-b'].entries()){const request=v2Request(label);await f.guard.beforeProviderRequest(request);const receipt=v2Receipt(sha(request),index);await f.guard.onProviderReceipt(receipt);
  audits.set(receipt.providerRequestId,{requestId:receipt.providerRequestId,apiKeyId:'audit-key',model:'qwen3-vl-plus',status:200,usage:receipt.usage,sourceEvidenceHash:'d'.repeat(64)});}
 await assert.rejects(readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader:{readOriginalAuditRequest:async input=>audits.get(input.requestId)??null}}),/v2_audit_original_changed/);
});

test('v2 pending states and independent audit conflicts fail closed',async t=>{
 const f=await v2SettlementFixture(t),missing={readOriginalAuditRequest:async()=>null};assert.equal(await readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader:missing}),null);
 const request=v2Request('pending');await f.guard.beforeProviderRequest(request);assert.equal(await readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader:missing}),null);
 const receipt=v2Receipt(sha(request),0);await f.guard.onProviderReceipt(receipt);assert.equal(await readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader:missing}),null);
 const audit={requestId:receipt.providerRequestId!,apiKeyId:'audit-key',model:'qwen3-vl-plus',status:200,usage:receipt.usage,sourceEvidenceHash:'d'.repeat(64)};
 await assert.rejects(readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader:{readOriginalAuditRequest:async()=>({...audit,usage:{prompt_tokens:101,completion_tokens:10,total_tokens:111}})}}),/v2_audit_original_changed/);
 await assert.rejects(readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader:null as any}),/v2_audit_reader_required/);
 await assert.rejects(readWeeklyCandidateExactConservativeSettlementV2({...f.args,assertReservedPlanForSettlement:async()=>({authorizationId:'forged',authorizationHash:'0'.repeat(64),auditApiKeyId:'audit-key'}),reader:missing}),/v2_authority_binding_changed/);
 await assert.rejects(readWeeklyCandidateExactConservativeSettlementV2({...f.args,assertReservedPlanForSettlement:async()=>({authorizationId:'not-an-escrow-id',authorizationHash:f.args.authorizationHash,auditApiKeyId:'audit-key'}),reader:missing}),/v2_authority_binding_changed/);
 await assert.rejects(readWeeklyCandidateExactConservativeSettlementV2({...f.args,assertReservedPlanForSettlement:async()=>({authorizationId:'e'.repeat(24),authorizationHash:f.args.authorizationHash,auditApiKeyId:'invalid key'}),reader:missing}),/v2_authority_binding_changed/);
});

test('expired pricing blocks a new claim without writes but recorded children can receive late audit settlement',async t=>{
 const f=await v2SettlementFixture(t),request=v2Request('recorded while live');await f.guard.beforeProviderRequest(request);const receipt=v2Receipt(sha(request),0);await f.guard.onProviderReceipt(receipt);
 const ledgerBefore=fs.readFileSync(f.guard.ledgerPath),headBefore=f.getHead(),original=Date.now;try{Date.now=()=>Date.parse(f.plan.pricingEvidence.validUntil)+1;
  await assert.rejects(f.guard.beforeProviderRequest(v2Request('must not write')),/dynamic_v2_pricing_policy_unverified/);assert.deepEqual(fs.readFileSync(f.guard.ledgerPath),ledgerBefore);assert.deepEqual(f.getHead(),headBefore);
  const settled=await readWeeklyCandidateExactConservativeSettlementV2({...f.args,reader:{readOriginalAuditRequest:async()=>({requestId:receipt.providerRequestId!,apiKeyId:'audit-key',model:'qwen3-vl-plus',status:200,usage:receipt.usage,sourceEvidenceHash:'e'.repeat(64)})}});assert.equal(settled?.status,'completed');
 }finally{Date.now=original;}
});

test('no production module imports dormant v2 settlement',()=>{
 const files=(function walk(directory:string):string[]{return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);})('server');
 const callers=files.filter(file=>file.endsWith('.ts')&&!file.endsWith('.test.ts')&&!file.endsWith('weeklyCandidateExactConservativeSettlement.ts'))
  .filter(file=>fs.readFileSync(file,'utf8').includes('readWeeklyCandidateExactConservativeSettlementV2'));
 assert.deepEqual(callers,[]);
});
