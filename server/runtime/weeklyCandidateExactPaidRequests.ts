import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withPaidOperationLock} from '../lib/paidOperationLock.js';
import {withExactQwenScope,type ExactQwenProviderReceipt} from '../agents/exactQwenScope.js';
import {inspectWeeklyExactSupplierEnvelopes,type WeeklyExactSupplierEnvelopeInput} from './weeklyCandidateExactProviderEnvelope.js';
import {classifyQwenCompatibleEndpoint} from '../lib/qwenCompatibleEndpoint.js';
import {qwenVisionInputLimit} from '../lib/qwenVisionInputLimit.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const hash=/^[a-f0-9]{64}$/;
const micros=(value:number)=>Math.round(value*1_000_000);
const fail=(code:string):never=>{throw Error(`weekly_candidate_exact_paid_${code}`);};
type Plan=Omit<WeeklyExactSupplierEnvelopeInput,'responses'>;
type Entry={state:'unknown'|'completed';response?:ExactQwenProviderReceipt};
type Ledger={schema:'weekly-candidate-exact-paid-requests.v1';authorizationHash:string;planHash:string;entries:Record<string,Entry>};

function validPlan(plan:Plan,authorizationHash:string){
 if(!hash.test(authorizationHash)||!plan.operationId||!plan.candidateId||!hash.test(plan.mediaSha256)||!hash.test(plan.credentialSha256)||
  !Number.isSafeInteger(micros(plan.maximumTotalCny))||micros(plan.maximumTotalCny)<=0||!plan.requests.length||plan.requests.length>128||
  new Set(plan.requests.map(r=>r.requestHash)).size!==plan.requests.length)fail('plan_invalid');
 // Use the same authoritative model, endpoint, token and tariff validation as
 // final settlement. Empty responses are not a success; only ignore that one
 // count diagnostic while retaining all remaining structural checks below.
 const sample:WeeklyExactSupplierEnvelopeInput={...plan,responses:plan.requests.map((r,i)=>({requestHash:r.requestHash,response:{provider:'qwen',responseId:`plan-${i}`,model:plan.model,usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0},httpStatus:200,requestModel:plan.model,requestHash:r.requestHash,receivedAt:new Date(0).toISOString()}}))};
 inspectWeeklyExactSupplierEnvelopes(sample);
}
function read(file:string,authorizationHash:string,planHash:string):Ledger{
 if(!fs.existsSync(file))return {schema:'weekly-candidate-exact-paid-requests.v1',authorizationHash,planHash,entries:{}};
 let ledger:Ledger;try{ledger=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fail('ledger_corrupt');}
 if(ledger.schema!=='weekly-candidate-exact-paid-requests.v1'||ledger.authorizationHash!==authorizationHash||ledger.planHash!==planHash||!ledger.entries||typeof ledger.entries!=='object'||Array.isArray(ledger.entries))fail('ledger_changed');
 for(const [key,entry] of Object.entries(ledger.entries))if(!hash.test(key)||!entry||!['unknown','completed'].includes(entry.state)||entry.response&&entry.response.requestHash!==key)fail('ledger_corrupt');
 return ledger;
}
function write(file:string,ledger:Ledger|DynamicLedger){
 const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true,mode:0o700});const tmp=`${file}.${randomUUID()}.tmp`,fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(ledger));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,file);const dirfd=fs.openSync(dir,'r');try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
}

/** One immutable, separately human-approved exact-analysis plan. Its entire
 * worst-case charge is checked before the first child POST. Each child claim
 * is fsynced before network transport; restart/timeout can read only, never
 * reissue an unknown request (the compatible chat endpoint has no GET result). */
export function createWeeklyCandidateExactPaidRequests(input:{root:string;authorizationHash:string;plan:Plan;assertCurrent:()=>Promise<void>}){
 const {plan,authorizationHash}=input;validPlan(plan,authorizationHash);
 const planHash=sha(JSON.stringify(plan)),root=path.resolve(input.root),file=path.join(root,sha(JSON.stringify([plan.operationId,authorizationHash]))+'.json');
 const plans=new Map(plan.requests.map(r=>[r.requestHash,r]));
 const exclusive=<T>(body:()=>Promise<T>)=>withPaidOperationLock(path.join(root,'.locks'),`weekly-exact:${plan.operationId}:${authorizationHash}`,body);
 return {
  async beforeProviderRequest(requestBody:string){
   const requestHash=sha(requestBody),child=plans.get(requestHash);
   if(!child)throw Error('weekly_candidate_exact_paid_request_not_frozen');
   let body:Record<string,unknown>;try{body=JSON.parse(requestBody);}catch{return fail('request_unreadable');}
   if(body.model!==plan.model||body.max_tokens!==child.maximumOutputTokens)fail('request_changed');
   await exclusive(async()=>{
    await input.assertCurrent();const ledger=read(file,authorizationHash,planHash);
    if(Object.keys(ledger.entries).some(key=>!plans.has(key)))fail('ledger_corrupt');
    if(ledger.entries[requestHash])fail('original_request_recovery_required');
    if(Object.values(ledger.entries).some(entry=>entry.state!=='completed'))fail('earlier_request_unsettled');
    ledger.entries[requestHash]={state:'unknown'};write(file,ledger);
   });
  },
  async onProviderReceipt(response:ExactQwenProviderReceipt){
   await exclusive(async()=>{
    const ledger=read(file,authorizationHash,planHash),entry=ledger.entries[response.requestHash];
    if(!entry||entry.response)fail('receipt_without_original_claim');
    // Persist even non-200 and malformed usage as unknown, not as an invented
    // zero-cost settlement. Subsequent children are not automatically released.
    entry.response=response;
    if(response.httpStatus===200){
     try{inspectWeeklyExactSupplierEnvelopes({...plan,maximumTotalCny:(plans.get(response.requestHash)!.maximumInputTokens*3+plans.get(response.requestHash)!.maximumOutputTokens*30)/1_000_000,
       requests:[plans.get(response.requestHash)!],responses:[{requestHash:response.requestHash,response}]});entry.state='completed';}catch{/* remain unknown */}
    }
    write(file,ledger);
   });
  },
  async readSettlement(){return exclusive(async()=>{
   const ledger=read(file,authorizationHash,planHash),responses=plan.requests.map(r=>ledger.entries[r.requestHash]);
   if(Object.keys(ledger.entries).some(key=>!plans.has(key))||responses.some(e=>e?.state!=='completed'||!e.response))return null;
   const original=plan.requests.map((r,i)=>({requestHash:r.requestHash,response:responses[i]!.response!}));
   return {...inspectWeeklyExactSupplierEnvelopes({...plan,responses:original}),authorizationHash,planHash,ledgerHash:sha(JSON.stringify(ledger))};
  });},
  async readClaim(requestHash:string){return exclusive(async()=>{if(!plans.has(requestHash))fail('request_not_frozen');return read(file,authorizationHash,planHash).entries[requestHash]??null;});}
 };
}

/** Explicit formal entrypoint. The older human model-revision scope is not
 * altered, while a new weekly exact executor cannot omit its paid guard. */
export async function withWeeklyCandidateExactPaidScope<T>(input:{root:string;authorizationHash:string;plan:Plan;configurationHash:string;assertCurrent:()=>Promise<void>;run:()=>Promise<T>}):Promise<{result:T;settlement:Awaited<ReturnType<ReturnType<typeof createWeeklyCandidateExactPaidRequests>['readSettlement']>>}>{
 const guard=createWeeklyCandidateExactPaidRequests(input);
 const result=await withExactQwenScope({model:input.plan.model,configurationHash:input.configurationHash,endpoint:input.plan.endpoint,credentialDigest:input.plan.credentialSha256,paidGuardRequired:true,
  beforeProviderRequest:guard.beforeProviderRequest,onProviderReceipt:guard.onProviderReceipt},input.run);
 return {result,settlement:await guard.readSettlement()};
}

/** Dynamic visual analysis cannot know later prompts before earlier responses.
 * This journal fixes the operation, tariff, request count and total ceiling
 * up front, then fsyncs each exact request and its full-model worst-case hold
 * before transport. Holds are never released based on caller-reported usage.
 * A completed response permits the next child in the same process, but does
 * not by itself prove independent supplier/paid-ledger settlement. */
export interface WeeklyCandidateDynamicExactPlan {
 operationId:string;candidateId:string;mediaSha256:string;endpoint:string;credentialSha256:string;
 model:'qwen3-vl-plus';maximumRequests:number;maximumTotalCny:number;
}
type DynamicEntry={sequence:number;requestHash:string;maximumInputTokens:number;maximumOutputTokens:number;reservedMicros:number;state:'unknown'|'response_recorded';response?:ExactQwenProviderReceipt};
type DynamicLedger={schema:'weekly-candidate-dynamic-exact-paid.v1';authorizationHash:string;planHash:string;entries:DynamicEntry[]};
function checkedDynamicPlan(plan:WeeklyCandidateDynamicExactPlan,authorizationHash:string){
 if(!hash.test(authorizationHash)||!plan.operationId||!plan.candidateId||!hash.test(plan.mediaSha256)||!hash.test(plan.credentialSha256)
  ||classifyQwenCompatibleEndpoint(plan.endpoint)!=='qianwen-maas'||plan.model!=='qwen3-vl-plus'
  ||!Number.isSafeInteger(plan.maximumRequests)||plan.maximumRequests<1||plan.maximumRequests>128
  ||!Number.isSafeInteger(micros(plan.maximumTotalCny))||micros(plan.maximumTotalCny)<1)fail('dynamic_plan_invalid');
}
function readDynamic(file:string,authorizationHash:string,planHash:string,plan:WeeklyCandidateDynamicExactPlan):DynamicLedger{
 if(!fs.existsSync(file))return {schema:'weekly-candidate-dynamic-exact-paid.v1',authorizationHash,planHash,entries:[]};
 let ledger:DynamicLedger;try{ledger=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fail('dynamic_ledger_corrupt');}
 if(ledger.schema!=='weekly-candidate-dynamic-exact-paid.v1'||ledger.authorizationHash!==authorizationHash||ledger.planHash!==planHash||!Array.isArray(ledger.entries)
  ||ledger.entries.length>plan.maximumRequests)fail('dynamic_ledger_changed');
 const seen=new Set<string>(),responseIds=new Set<string>();
 let heldMicros=0;
 for(const [index,entry] of ledger.entries.entries()){
  if(entry.sequence!==index||!hash.test(entry.requestHash)||seen.has(entry.requestHash)||entry.maximumInputTokens!==qwenVisionInputLimit('qwen3-vl-plus')
   ||!Number.isSafeInteger(entry.maximumOutputTokens)||entry.maximumOutputTokens<1||entry.maximumOutputTokens>16384
   ||entry.reservedMicros!==entry.maximumInputTokens*3+entry.maximumOutputTokens*30
   ||!['unknown','response_recorded'].includes(entry.state)||entry.response!==undefined&&entry.response.requestHash!==entry.requestHash
   ||entry.response?.responseBodySha256!==undefined&&!hash.test(entry.response.responseBodySha256)
   ||entry.response?.providerRequestId!==undefined&&entry.response.providerRequestId!==null&&
    (typeof entry.response.providerRequestId!=='string'||entry.response.providerRequestId.length>256||!/^[A-Za-z0-9._:-]+$/.test(entry.response.providerRequestId))
   ||entry.state==='response_recorded'&&!entry.response)fail('dynamic_ledger_corrupt');
  seen.add(entry.requestHash);
  heldMicros+=entry.reservedMicros;
  if(!Number.isSafeInteger(heldMicros)||heldMicros>micros(plan.maximumTotalCny))fail('dynamic_ledger_corrupt');
  if(entry.state==='response_recorded'){
   const responseId=entry.response?.responseId;
   if(typeof responseId!=='string'||!responseId||responseIds.has(responseId))fail('dynamic_ledger_corrupt');
   responseIds.add(responseId as string);
   try{inspectWeeklyExactSupplierEnvelopes({operationId:plan.operationId,candidateId:plan.candidateId,mediaSha256:plan.mediaSha256,endpoint:plan.endpoint,
    credentialSha256:plan.credentialSha256,model:plan.model,maximumTotalCny:entry.reservedMicros/1_000_000,
    requests:[{requestHash:entry.requestHash,maximumInputTokens:entry.maximumInputTokens,maximumOutputTokens:entry.maximumOutputTokens}],
    responses:[{requestHash:entry.requestHash,response:entry.response!}]});}catch{return fail('dynamic_ledger_corrupt');}
  }
 }
 return ledger;
}
export function createWeeklyCandidateDynamicExactPaidRequests(input:{root:string;authorizationHash:string;plan:WeeklyCandidateDynamicExactPlan;assertCurrent:()=>Promise<void>}){
 const {plan,authorizationHash}=input;checkedDynamicPlan(plan,authorizationHash);
 const planHash=sha(JSON.stringify(plan)),root=path.resolve(input.root),file=path.join(root,sha(JSON.stringify(['dynamic',plan.operationId,authorizationHash]))+'.json');
 const exclusive=<T>(body:()=>Promise<T>)=>withPaidOperationLock(path.join(root,'.locks'),`weekly-exact-dynamic:${plan.operationId}:${authorizationHash}`,body);
 return {
  async beforeProviderRequest(requestBody:string){
   let body:Record<string,unknown>;try{body=JSON.parse(requestBody);}catch{return fail('dynamic_request_unreadable');}
   const output=body.max_tokens;
   if(body.model!==plan.model||!Number.isSafeInteger(output)||Number(output)<1||Number(output)>16384)fail('dynamic_request_changed');
   const requestHash=sha(requestBody),maximumInputTokens=qwenVisionInputLimit(plan.model),reservedMicros=maximumInputTokens*3+Number(output)*30;
   await exclusive(async()=>{
    await input.assertCurrent();const ledger=readDynamic(file,authorizationHash,planHash,plan);
    if(ledger.entries.some(entry=>entry.requestHash===requestHash))fail('original_request_recovery_required');
    if(ledger.entries.length>=plan.maximumRequests)fail('dynamic_request_count_exceeded');
    if(ledger.entries.some(entry=>entry.state!=='response_recorded'))fail('earlier_request_unsettled');
    const sum=ledger.entries.reduce((total,entry)=>total+entry.reservedMicros,0)+reservedMicros;
    if(sum>micros(plan.maximumTotalCny))fail('dynamic_cny_ceiling_exceeded');
    ledger.entries.push({sequence:ledger.entries.length,requestHash,maximumInputTokens,maximumOutputTokens:Number(output),reservedMicros,state:'unknown'});
    write(file,ledger);
   });
  },
  async onProviderReceipt(response:ExactQwenProviderReceipt){
   await exclusive(async()=>{
    const ledger=readDynamic(file,authorizationHash,planHash,plan),entry=ledger.entries.at(-1);
    if(!entry||entry.requestHash!==response.requestHash||entry.response)return fail('dynamic_receipt_without_original_claim');
    entry.response=response;
    if(response.httpStatus===200&&!ledger.entries.slice(0,-1).some(prior=>prior.response?.responseId===response.responseId)){
     try{inspectWeeklyExactSupplierEnvelopes({operationId:plan.operationId,candidateId:plan.candidateId,mediaSha256:plan.mediaSha256,endpoint:plan.endpoint,
      credentialSha256:plan.credentialSha256,model:plan.model,maximumTotalCny:entry.reservedMicros/1_000_000,
      requests:[{requestHash:entry.requestHash,maximumInputTokens:entry.maximumInputTokens,maximumOutputTokens:entry.maximumOutputTokens}],responses:[{requestHash:entry.requestHash,response}]});
      entry.state='response_recorded';
     }catch{/* malformed or ambiguous original response remains unknown */}
    }
    write(file,ledger);
   });
  },
  async readDiagnostic(){return exclusive(async()=>{
   const ledger=readDynamic(file,authorizationHash,planHash,plan);
   return {planHash,authorizationHash,ledgerHash:sha(JSON.stringify(ledger)),requestCount:ledger.entries.length,
    reservedUpperBoundCny:ledger.entries.reduce((sum,entry)=>sum+entry.reservedMicros,0)/1_000_000,
    allResponsesRecorded:ledger.entries.length>0&&ledger.entries.every(entry=>entry.state==='response_recorded')};
  });},
  /** Read-only recovery view. These envelopes came from our transport and are
   * not independently settled supplier or billing evidence. */
  async readRecordedChildren(){return exclusive(async()=>{
   const ledger=readDynamic(file,authorizationHash,planHash,plan);
   return {planHash,authorizationHash,ledgerHash:sha(JSON.stringify(ledger)),entries:structuredClone(ledger.entries)};
  });},
  async readClaim(requestHash:string){return exclusive(async()=>readDynamic(file,authorizationHash,planHash,plan).entries.find(entry=>entry.requestHash===requestHash)??null);}
 };
}

export async function withWeeklyCandidateDynamicExactPaidScope<T>(input:{root:string;authorizationHash:string;plan:WeeklyCandidateDynamicExactPlan;configurationHash:string;assertCurrent:()=>Promise<void>;run:()=>Promise<T>}){
 const guard=createWeeklyCandidateDynamicExactPaidRequests(input);
 const result=await withExactQwenScope({model:input.plan.model,configurationHash:input.configurationHash,endpoint:input.plan.endpoint,
  credentialDigest:input.plan.credentialSha256,paidGuardRequired:true,beforeProviderRequest:guard.beforeProviderRequest,onProviderReceipt:guard.onProviderReceipt},input.run);
 return {result,diagnostic:await guard.readDiagnostic()};
}
