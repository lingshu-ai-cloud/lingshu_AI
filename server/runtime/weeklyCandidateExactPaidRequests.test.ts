import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWeeklyCandidateExactPaidRequests,createWeeklyCandidateDynamicExactPaidRequests,withWeeklyCandidateDynamicExactPaidScope} from './weeklyCandidateExactPaidRequests.js';
import {authorizeExactQwenProviderRequest,recordExactQwenProviderResponse,withExactQwenScope} from '../agents/exactQwenScope.js';
import {analyzeVideoTimelineDetailsWithQwen} from '../agents/qwen.js';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const body=(label:string)=>JSON.stringify({model:'qwen3-vl-plus',max_tokens:100,messages:[{role:'user',content:label}]});
const endpoint='https://maas.qianwenaiapi.com/compatible-mode/v1';
function fixture(t:test.TestContext){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'exact-paid-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const a=body('chunk 1'),b=body('chunk 2');
 const plan={operationId:'original-op',candidateId:'candidate-1',mediaSha256:'a'.repeat(64),endpoint,credentialSha256:'b'.repeat(64),model:'qwen3-vl-plus' as const,maximumTotalCny:.012,
  requests:[{requestHash:sha(a),maximumInputTokens:1000,maximumOutputTokens:100},{requestHash:sha(b),maximumInputTokens:1000,maximumOutputTokens:100}]};
 let checks=0;const args={root,authorizationHash:'c'.repeat(64),plan,assertCurrent:async()=>{checks++;}};
 return {a,b,plan,args,get checks(){return checks;}};
}
const response=(hash:string,id:string,status=200)=>({provider:'qwen' as const,requestHash:hash,requestModel:'qwen3-vl-plus',model:'qwen3-vl-plus',httpStatus:status,responseId:id,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},receivedAt:new Date().toISOString()});

test('formal exact scope without paid permit sends zero POST; legacy manual revision keeps its existing contract',async t=>{
 let posts=0;t.mock.method(globalThis,'fetch',async()=>{posts++;return new Response('{}',{status:400});});
 const scope={model:'qwen3-vl-plus',configurationHash:'x',endpoint,credentialDigest:'b'.repeat(64)};
 await assert.rejects(withExactQwenScope({...scope,paidGuardRequired:true},async()=>{
  await authorizeExactQwenProviderRequest(body('chunk 1'));await fetch(endpoint+'/chat/completions',{method:'POST'});
 }),/weekly_candidate_exact_paid_permit_required/);
 assert.equal(posts,0);
 await withExactQwenScope(scope,async()=>{await authorizeExactQwenProviderRequest(body('chunk 1'));});
});

test('actual Qwen SDK transport sends zero POST when formal exact scope has no permit',async t=>{
 const before={key:process.env.DASHSCOPE_API_KEY,url:process.env.DASHSCOPE_BASE_URL};
 process.env.DASHSCOPE_API_KEY='isolated-test-key';process.env.DASHSCOPE_BASE_URL='https://isolated.invalid/v1';
 t.after(()=>{for(const [key,value] of Object.entries({DASHSCOPE_API_KEY:before.key,DASHSCOPE_BASE_URL:before.url}))if(value===undefined)delete process.env[key];else process.env[key]=value;});
 let posts=0;t.mock.method(globalThis,'fetch',async()=>{posts++;return new Response('{}',{status:400});});
 await assert.rejects(withExactQwenScope({model:'qwen3-vl-plus',configurationHash:'frozen',endpoint:'https://isolated.invalid/v1',credentialDigest:sha('isolated-test-key'),paidGuardRequired:true},()=>
  analyzeVideoTimelineDetailsWithQwen({frames:[{base64:'isolated',mimeType:'image/jpeg',timeLabel:'0s'}],timeline:{boundaries:[{id:'b1',start:0,end:1}]}} as any)),error=>(error as Error&{cause?:Error}).cause?.message==='weekly_candidate_exact_paid_permit_required');
 assert.equal(posts,0);
});

test('two frozen child claims settle only from original provider response and never exceed approved total',async t=>{
 const f=fixture(t),guard=createWeeklyCandidateExactPaidRequests(f.args);
 await assert.rejects(guard.beforeProviderRequest(body('surprise')),/request_not_frozen/);
 await guard.beforeProviderRequest(f.a);assert.equal(f.checks,1);assert.equal((await guard.readClaim(sha(f.a)))?.state,'unknown');
 await assert.rejects(guard.beforeProviderRequest(f.b),/earlier_request_unsettled/);
 await guard.onProviderReceipt(response(sha(f.a),'response-1'));
 assert.equal((await guard.readClaim(sha(f.a)))?.state,'completed');
 await guard.beforeProviderRequest(f.b);
 await guard.onProviderReceipt(response(sha(f.b),'response-2'));
 const settled=await guard.readSettlement();assert.equal(settled?.requestCount,2);assert.equal(settled?.measuredCeilingCny,.0012);
 assert.ok(settled!.reservedUpperBoundCny<=f.plan.maximumTotalCny);
 await assert.rejects(guard.beforeProviderRequest(f.a),/original_request_recovery_required/);
 const restarted=createWeeklyCandidateExactPaidRequests(f.args);assert.equal((await restarted.readSettlement())?.ledgerHash,settled?.ledgerHash);
});

test('unknown second child survives restart; failed/missing usage never settles or permits a duplicate',async t=>{
 const f=fixture(t),guard=createWeeklyCandidateExactPaidRequests(f.args);
 await guard.beforeProviderRequest(f.a);await guard.onProviderReceipt(response(sha(f.a),'response-1'));
 await guard.beforeProviderRequest(f.b);
 const restarted=createWeeklyCandidateExactPaidRequests(f.args);
 assert.equal(await restarted.readSettlement(),null);
 await assert.rejects(restarted.beforeProviderRequest(f.b),/original_request_recovery_required/);
 await restarted.onProviderReceipt({...response(sha(f.b),'failure',404),usage:null});
 assert.equal((await restarted.readClaim(sha(f.b)))?.state,'unknown');assert.equal(await restarted.readSettlement(),null);
 await assert.rejects(restarted.beforeProviderRequest(f.b),/original_request_recovery_required/);
});

test('scoped callbacks claim before transport and persist the original provider envelope',async t=>{
 const f=fixture(t),guard=createWeeklyCandidateExactPaidRequests(f.args),scope={model:f.plan.model,configurationHash:'frozen',endpoint,credentialDigest:f.plan.credentialSha256,paidGuardRequired:true,...guard};
 let posts=0;t.mock.method(globalThis,'fetch',async()=>{posts++;return new Response(JSON.stringify({id:'original-1',model:f.plan.model,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110}}),{status:200});});
 await withExactQwenScope(scope,async()=>{await authorizeExactQwenProviderRequest(f.a);const actual=await fetch(endpoint+'/chat/completions',{method:'POST',body:f.a});await recordExactQwenProviderResponse(actual,f.a);});
 assert.equal(posts,1);assert.equal((await guard.readClaim(sha(f.a)))?.response?.responseId,'original-1');
});

test('transport persists only observed response audit anchors through dynamic journal restart',async t=>{
 const f=fixture(t),plan={operationId:'audit-anchor-operation',candidateId:f.plan.candidateId,mediaSha256:f.plan.mediaSha256,
  endpoint,credentialSha256:f.plan.credentialSha256,model:'qwen3-vl-plus' as const,maximumRequests:1,maximumTotalCny:1.7};
 const args={root:f.args.root,authorizationHash:f.args.authorizationHash,plan,assertCurrent:f.args.assertCurrent};
 const guard=createWeeklyCandidateDynamicExactPaidRequests(args),requestBody=body('audit-anchor');
 const raw=JSON.stringify({id:'chatcmpl-audit-1',model:plan.model,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},choices:[{message:{content:'private response text'}}]});
 await withExactQwenScope({model:plan.model,configurationHash:'frozen',endpoint,credentialDigest:plan.credentialSha256,paidGuardRequired:true,
  beforeProviderRequest:guard.beforeProviderRequest,onProviderReceipt:guard.onProviderReceipt},async()=>{
   await authorizeExactQwenProviderRequest(requestBody);
   await recordExactQwenProviderResponse(new Response(raw,{status:200,headers:{'x-request-id':'observed-provider-123'}}),requestBody);
  });
 const restarted=createWeeklyCandidateDynamicExactPaidRequests(args),claim=await restarted.readClaim(sha(requestBody));
 assert.equal(claim?.response?.responseBodySha256,sha(raw));
 assert.equal(claim?.response?.providerRequestId,'observed-provider-123');
 assert.equal(claim?.state,'response_recorded');
 const files=await restarted.readRecordedChildren();
 assert.equal(JSON.stringify(files).includes('private response text'),false);
});

test('dynamic child requests freeze one at a time with conservative cumulative holds',async t=>{
 const f=fixture(t),plan={operationId:'dynamic-operation',candidateId:f.plan.candidateId,mediaSha256:f.plan.mediaSha256,
  endpoint,credentialSha256:f.plan.credentialSha256,model:'qwen3-vl-plus' as const,maximumRequests:2,maximumTotalCny:1.7};
 const args={root:f.args.root,authorizationHash:f.args.authorizationHash,plan,assertCurrent:f.args.assertCurrent};
 const guard=createWeeklyCandidateDynamicExactPaidRequests(args),first=body('first outcome decides the next prompt'),second=body('next prompt unknown at start');
 await guard.beforeProviderRequest(first);
 assert.equal((await guard.readClaim(sha(first)))?.state,'unknown');
 await assert.rejects(guard.beforeProviderRequest(second),/earlier_request_unsettled/);
 await guard.onProviderReceipt(response(sha(first),'original-first'));
 assert.equal((await guard.readClaim(sha(first)))?.state,'response_recorded');
 await guard.beforeProviderRequest(second);
 await guard.onProviderReceipt(response(sha(second),'original-second'));
 const diagnostic=await guard.readDiagnostic();
 assert.equal(diagnostic.requestCount,2);assert.equal(diagnostic.allResponsesRecorded,true);
 assert.ok(diagnostic.reservedUpperBoundCny<=plan.maximumTotalCny);
 await assert.rejects(guard.beforeProviderRequest(body('third')),/dynamic_request_count_exceeded/);
 const restarted=createWeeklyCandidateDynamicExactPaidRequests(args);
 await assert.rejects(restarted.beforeProviderRequest(second),/original_request_recovery_required/);
 assert.equal((await restarted.readDiagnostic()).ledgerHash,diagnostic.ledgerHash);
});

test('dynamic limit rejects before a paid POST and unknown response cannot be replayed after restart',async t=>{
 const f=fixture(t),plan={operationId:'dynamic-limit',candidateId:f.plan.candidateId,mediaSha256:f.plan.mediaSha256,
  endpoint,credentialSha256:f.plan.credentialSha256,model:'qwen3-vl-plus' as const,maximumRequests:2,maximumTotalCny:.8};
 const args={root:f.args.root,authorizationHash:f.args.authorizationHash,plan,configurationHash:'frozen',assertCurrent:f.args.assertCurrent};
 let posts=0;t.mock.method(globalThis,'fetch',async()=>{posts++;return new Response('{}',{status:500});});
 await withWeeklyCandidateDynamicExactPaidScope({...args,run:async()=>{
  const first=body('first');await authorizeExactQwenProviderRequest(first);
  const actual=await fetch(endpoint+'/chat/completions',{method:'POST',body:first});
  await recordExactQwenProviderResponse(actual,first);
 }});
 assert.equal(posts,1);
 const restarted=createWeeklyCandidateDynamicExactPaidRequests(args);
 assert.equal((await restarted.readClaim(sha(body('first'))))?.state,'unknown');
 await assert.rejects(restarted.beforeProviderRequest(body('first')),/original_request_recovery_required/);
 await assert.rejects(restarted.beforeProviderRequest(body('second')),/earlier_request_unsettled/);
 assert.equal(posts,1);
 const tooSmall=createWeeklyCandidateDynamicExactPaidRequests({...args,plan:{...plan,operationId:'dynamic-too-small',maximumTotalCny:.001}});
 await assert.rejects(tooSmall.beforeProviderRequest(body('first')),/dynamic_cny_ceiling_exceeded/);
 assert.equal(posts,1);
});

test('dynamic operation rejects media, credential, endpoint and output-envelope drift; concurrent children cannot both start',async t=>{
 const f=fixture(t),plan={operationId:'dynamic-locked',candidateId:f.plan.candidateId,mediaSha256:f.plan.mediaSha256,
  endpoint,credentialSha256:f.plan.credentialSha256,model:'qwen3-vl-plus' as const,maximumRequests:2,maximumTotalCny:2};
 const args={root:f.args.root,authorizationHash:f.args.authorizationHash,plan,assertCurrent:f.args.assertCurrent};
 const guard=createWeeklyCandidateDynamicExactPaidRequests(args),a=body('a'),b=body('b');
 const outcomes=await Promise.allSettled([guard.beforeProviderRequest(a),guard.beforeProviderRequest(b)]);
 assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
 const admitted=outcomes[0]?.status==='fulfilled'?a:b;
 assert.equal((await guard.readClaim(sha(admitted)))?.state,'unknown');
 for(const changed of [{mediaSha256:'d'.repeat(64)},{credentialSha256:'e'.repeat(64)},{endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1/'}]){
  const drift=createWeeklyCandidateDynamicExactPaidRequests({...args,plan:{...plan,...changed}});
  await assert.rejects(drift.readDiagnostic(),/dynamic_ledger_changed/);
 }
 await assert.rejects(guard.beforeProviderRequest(JSON.stringify({model:plan.model,max_tokens:16385,messages:[]})),/dynamic_request_changed/);
 await assert.rejects(guard.beforeProviderRequest(JSON.stringify({model:'qwen3.5-plus',max_tokens:100,messages:[]})),/dynamic_request_changed/);
 const receipt=response(sha(admitted),'same-id');await guard.onProviderReceipt(receipt);
 const next=admitted===a?b:a;await guard.beforeProviderRequest(next);
 await guard.onProviderReceipt(response(sha(next),'same-id'));
 assert.equal((await guard.readClaim(sha(next)))?.state,'unknown');
 assert.equal((await guard.readDiagnostic()).allResponsesRecorded,false);
});

test('dynamic journal read rejects tampered cumulative hold, count and recorded response before another claim',async t=>{
 const f=fixture(t),plan={operationId:'dynamic-tamper',candidateId:f.plan.candidateId,mediaSha256:f.plan.mediaSha256,
  endpoint,credentialSha256:f.plan.credentialSha256,model:'qwen3-vl-plus' as const,maximumRequests:1,maximumTotalCny:1};
 const args={root:f.args.root,authorizationHash:f.args.authorizationHash,plan,assertCurrent:f.args.assertCurrent};
 const guard=createWeeklyCandidateDynamicExactPaidRequests(args),a=body('a');
 await guard.beforeProviderRequest(a);await guard.onProviderReceipt(response(sha(a),'original-a'));
 const file=path.join(f.args.root,fs.readdirSync(f.args.root).find(name=>name.endsWith('.json'))!);
 const original=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const mutate of [(value:any)=>{value.entries[0].response.usage.total_tokens=1;},
  (value:any)=>{value.entries[0].reservedMicros=2_000_000;},
  (value:any)=>{value.entries.push({...value.entries[0],sequence:1,requestHash:'f'.repeat(64)});}]){
  const corrupted=structuredClone(original);mutate(corrupted);fs.writeFileSync(file,JSON.stringify(corrupted));
  await assert.rejects(guard.beforeProviderRequest(body('another')),/dynamic_ledger_(corrupt|changed)/);
 }
 fs.writeFileSync(file,JSON.stringify(original));
 assert.equal((await guard.readDiagnostic()).allResponsesRecorded,true);
});
