import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {submitDirectorG5PaidRequest} from './socialDirectorG5PaidRequest.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const body={model:'qwen3-vl-plus',messages:[{role:'user',content:'actual rendered evidence'}],max_tokens:2400};
const intent={operationId:'g5-frozen-request-0001',provider:'qwen',model:body.model,accountRef:'qwen:bound-account',stage:'director_review',shotId:null,inputContractHash:hash(body),maximumUnits:{inputTokens:1000,outputTokens:2400}};
function paid(){const calls:string[]=[];return {calls,call:{requirementKey:intent.operationId,intent,measureInputTokens:async()=>128,
  persistProviderReceipt:async (input:{requestSha256:string})=>{assert.equal(input.requestSha256,hash(body));calls.push('receipt');return 'provider-receipt-original';},
  permit:{beforeSubmit:async (request:{actualUnits:Record<string,number>})=>{assert.deepEqual(request.actualUnits,{inputTokens:128,outputTokens:2400});calls.push('claim');return {operationId:intent.operationId,fingerprint:'frozen'};},markOutcome:async()=>{calls.push('completed');},assertRecovery:async()=>{throw Error('not-used');}}} as any};}
test('G5 requires request-bound canonical permit before transport',async()=>{let posts=0;const send=async()=>{posts++;return {id:'provider'};};
 await assert.rejects(submitDirectorG5PaidRequest({requestId:intent.operationId,body,call:null,accountRef:intent.accountRef,send}),/canonical_paid_permit_required/);
 const f=paid();await assert.rejects(submitDirectorG5PaidRequest({requestId:intent.operationId,body:{...body,max_tokens:2500},call:f.call,accountRef:intent.accountRef,send}),/paid_request_binding_invalid/);
 await assert.rejects(submitDirectorG5PaidRequest({requestId:intent.operationId,body,call:f.call,accountRef:'qwen:other',send}),/paid_request_binding_invalid/);
 assert.equal(posts,0);assert.deepEqual(f.calls,[]);
});
const validResponse={id:'provider',model:body.model,choices:[{finish_reason:'stop'}],usage:{prompt_tokens:128,completion_tokens:40,total_tokens:168,prompt_tokens_details:{cached_tokens:0}}};
test('G5 makes one paid claim before POST, retains unknown on lost receipt',async()=>{const f=paid();const response=await submitDirectorG5PaidRequest({requestId:intent.operationId,body,call:f.call,accountRef:intent.accountRef,send:async()=>{f.calls.push('post');return validResponse;}});assert.deepEqual(response,validResponse);assert.deepEqual(f.calls,['claim','post','receipt','completed']);
 const lost=paid();lost.call.persistProviderReceipt=async()=>{throw Error('receipt-write-failed');};await assert.rejects(submitDirectorG5PaidRequest({requestId:intent.operationId,body,call:lost.call,accountRef:intent.accountRef,send:async()=>{lost.calls.push('post');return validResponse;}}),/receipt-write-failed/);assert.deepEqual(lost.calls,['claim','post']);});
test('G5 incomplete or over-envelope provider usage never completes original-film charge',async()=>{
 for(const response of [
  {id:'provider',model:body.model},
  {...validResponse,model:'other-model'},
  {...validResponse,choices:[{finish_reason:'length'}]},
  {...validResponse,usage:{prompt_tokens:1001,completion_tokens:40}},
  {...validResponse,usage:{prompt_tokens:128,completion_tokens:2401}},
  {...validResponse,usage:{prompt_tokens:128.5,completion_tokens:40}},
  {...validResponse,usage:{prompt_tokens:128,completion_tokens:40}},
  {...validResponse,usage:{prompt_tokens:128,completion_tokens:40,prompt_tokens_details:{cached_tokens:4}}},
  {...validResponse,usage:{prompt_tokens:128,completion_tokens:40,total_tokens:100,prompt_tokens_details:{cached_tokens:0}}},
 ]){
  const f=paid();await assert.rejects(submitDirectorG5PaidRequest({requestId:intent.operationId,body,call:f.call,accountRef:intent.accountRef,send:async()=>{f.calls.push('post');return response;}}),/provider_usage_unverified/);
  assert.deepEqual(f.calls,['claim','post']);
 }
});
