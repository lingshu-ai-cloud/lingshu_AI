import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWeeklyExactSupplierEnvelopes,type WeeklyExactSupplierEnvelopeInput} from './weeklyCandidateExactProviderEnvelope.js';

const hash='a'.repeat(64),hash2='b'.repeat(64);
const fixture=():WeeklyExactSupplierEnvelopeInput=>({operationId:'original-op',candidateId:'candidate',mediaSha256:hash,
 endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:hash2,model:'qwen3-vl-plus',maximumTotalCny:0.02,
 requests:[{requestHash:hash,maximumInputTokens:1000,maximumOutputTokens:100},{requestHash:hash2,maximumInputTokens:1000,maximumOutputTokens:100}],
 responses:[{requestHash:hash,response:{provider:'qwen',requestHash:hash,requestModel:'qwen3-vl-plus',model:'qwen3-vl-plus',httpStatus:200,responseId:'resp-1',usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},receivedAt:'2026-10-19T00:00:00.000Z'}},
 {requestHash:hash2,response:{provider:'qwen',requestHash:hash2,requestModel:'qwen3-vl-plus',model:'qwen3-vl-plus',httpStatus:200,responseId:'resp-2',usage:{prompt_tokens:200,completion_tokens:20,total_tokens:220},receivedAt:'2026-10-19T00:00:01.000Z'}}]});

test('all separately planned child responses must have exact model, identity, usage and CNY envelope',()=>{
 const good=inspectWeeklyExactSupplierEnvelopes(fixture());
 assert.equal(good.requestCount,2);assert.equal(good.inputTokens,300);assert.equal(good.outputTokens,30);assert.equal(good.measuredCeilingCny,.0018);assert.equal(good.reservedUpperBoundCny,.012);
 const mutate=(change:(value:WeeklyExactSupplierEnvelopeInput)=>void,code:string)=>{const value=fixture();change(value);assert.throws(()=>inspectWeeklyExactSupplierEnvelopes(value),new RegExp(`weekly_candidate_exact_provider_${code}`));};
 mutate(v=>{v.responses.pop();},'request_count_invalid');
 mutate(v=>{v.responses[1]!.requestHash=hash;},'original_response_invalid');
 mutate(v=>{v.responses[1]!.response.responseId='resp-1';},'original_response_invalid');
 mutate(v=>{v.responses[0]!.response.model='qwen3-vl-flash';},'original_response_invalid');
 mutate(v=>{v.responses[0]!.response.httpStatus=404;},'original_response_invalid');
 mutate(v=>{v.responses[0]!.response.usage=null;},'usage_missing');
 mutate(v=>{v.responses[0]!.response.usage={prompt_tokens:100,completion_tokens:10,total_tokens:109};},'usage_invalid');
 mutate(v=>{v.responses[0]!.response.usage={prompt_tokens:1001,completion_tokens:10,total_tokens:1011};},'usage_invalid');
 mutate(v=>{v.maximumTotalCny=.011;},'cny_plan_ceiling_exceeded');
 mutate(v=>{v.endpoint='https://dashscope.aliyuncs.com/compatible-mode/v1';},'binding_invalid');
});
