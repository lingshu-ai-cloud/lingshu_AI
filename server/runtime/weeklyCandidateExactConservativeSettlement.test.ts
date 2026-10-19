import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWeeklyCandidateDynamicExactPaidRequests} from './weeklyCandidateExactPaidRequests.js';
import {readWeeklyCandidateExactConservativeSettlement} from './weeklyCandidateExactConservativeSettlement.js';

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
