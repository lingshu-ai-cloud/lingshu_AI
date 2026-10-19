import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWeeklyCandidateDynamicExactPaidRequests} from './weeklyCandidateExactPaidRequests.js';
import {readWeeklyCandidateExactOriginalSettlement} from './weeklyCandidateExactOriginalSettlement.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const endpoint='https://maas.qianwenaiapi.com/compatible-mode/v1';
function fixture(t:test.TestContext){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-settlement-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const plan={operationId:'op-1',candidateId:'candidate-1',mediaSha256:'a'.repeat(64),endpoint,credentialSha256:'b'.repeat(64),model:'qwen3-vl-plus' as const,maximumRequests:2,maximumTotalCny:1.7};
 const authorizationHash='c'.repeat(64),authorizationId='signed-authorization';
 const body=JSON.stringify({model:plan.model,max_tokens:100,messages:[{role:'user',content:'first frame'}]});
 const receipt={provider:'qwen' as const,responseId:'supplier-response-1',model:plan.model,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},httpStatus:200,requestModel:plan.model,requestHash:sha(body),receivedAt:new Date().toISOString()};
 const args={root,authorizationHash,plan,assertCurrent:async()=>{}};
 const readers={readOriginalSupplierResponse:async()=>({receipt,sourceEvidenceHash:'d'.repeat(64)}),
  readOriginalBillingOutcome:async()=>({status:'settled' as const,accountCredentialSha256:plan.credentialSha256,responseIds:[receipt.responseId],billedCny:.001,sourceEvidenceHash:'e'.repeat(64)})};
 return {body,receipt,args,readers,authorizationId};
}

test('local SDK response alone is not a settlement; independent supplier and billing originals are both required',async t=>{
 const f=fixture(t),journal=createWeeklyCandidateDynamicExactPaidRequests(f.args);
 assert.equal(await readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId}),null);
 await journal.beforeProviderRequest(f.body);await journal.onProviderReceipt(f.receipt);
 assert.equal((await journal.readDiagnostic()).allResponsesRecorded,true);
 assert.equal(await readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId}),null);
 const original=await readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,
  readOriginalSupplierResponse:async()=>({receipt:{...f.receipt,receivedAt:new Date(Date.now()+1000).toISOString()},sourceEvidenceHash:'d'.repeat(64)})}});
 assert.equal(original?.status,'completed');assert.equal(original?.requestCount,1);
 assert.equal(original?.mediaSha256,f.args.plan.mediaSha256);
});

test('durable unknown claim settles only from independent request-hash supplier and billing originals after restart',async t=>{
 const f=fixture(t),journal=createWeeklyCandidateDynamicExactPaidRequests(f.args);
 await journal.beforeProviderRequest(f.body);
 const observed:Array<{requestHash:string;responseId:string|null}>=[];
 const readers={...f.readers,readOriginalSupplierResponse:async(input:{requestHash:string;responseId:string|null})=>{
  observed.push(input);return {receipt:f.receipt,sourceEvidenceHash:'d'.repeat(64)};
 }};
 const settled=await readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers});
 assert.equal(settled?.status,'completed');
 assert.deepEqual(observed,[{operationId:f.args.plan.operationId,candidateId:f.args.plan.candidateId,requestHash:sha(f.body),responseId:null}]);
 assert.equal((await createWeeklyCandidateDynamicExactPaidRequests(f.args).readClaim(sha(f.body)))?.state,'unknown');
 await assert.rejects(createWeeklyCandidateDynamicExactPaidRequests(f.args).beforeProviderRequest(f.body),/original_request_recovery_required/);
});

test('unknown child needs matching request, usage and independent billing; changed local response stays closed',async t=>{
 const f=fixture(t),journal=createWeeklyCandidateDynamicExactPaidRequests(f.args);
 await journal.beforeProviderRequest(f.body);
 assert.equal(await readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,readOriginalSupplierResponse:async()=>null}}),null);
 assert.equal(await readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,readOriginalBillingOutcome:async()=>null}}),null);
 await assert.rejects(readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,
  readOriginalSupplierResponse:async()=>({receipt:{...f.receipt,requestHash:'f'.repeat(64)},sourceEvidenceHash:'d'.repeat(64)})}}),/original_response_invalid/);
 await assert.rejects(readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,
  readOriginalSupplierResponse:async()=>({receipt:{...f.receipt,usage:{prompt_tokens:300000,completion_tokens:10,total_tokens:300010}},sourceEvidenceHash:'d'.repeat(64)})}}),/usage_invalid/);
 await journal.onProviderReceipt(f.receipt);
 assert.equal(await readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,readOriginalSupplierResponse:async()=>null}}),null);
 await assert.rejects(readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,
  readOriginalSupplierResponse:async()=>({receipt:{...f.receipt,responseId:'other'},sourceEvidenceHash:'d'.repeat(64)})}}),/supplier_original_changed/);
 await assert.rejects(readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,
  readOriginalBillingOutcome:async()=>({status:'settled' as const,accountCredentialSha256:f.args.plan.credentialSha256,responseIds:['other'],billedCny:0,sourceEvidenceHash:'e'.repeat(64)})}}),/billing_original_changed/);
 await assert.rejects(readWeeklyCandidateExactOriginalSettlement({...f.args,authorizationId:f.authorizationId,readers:{...f.readers,
  readOriginalBillingOutcome:async()=>({status:'settled' as const,accountCredentialSha256:f.args.plan.credentialSha256,responseIds:[f.receipt.responseId!],billedCny:2,sourceEvidenceHash:'e'.repeat(64)})}}),/billing_original_changed/);
});
