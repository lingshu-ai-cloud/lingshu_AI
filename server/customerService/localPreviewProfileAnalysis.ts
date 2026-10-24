import type {LocalCustomerProfileAnalysis} from '../../shared/contracts/localCustomerProfile.js';
import type {BantAssessment,ProgressionGoal} from '../sales/qualification.js';
import {AsyncResource} from 'node:async_hooks';
import {classifyContextTags, type ContextTagEvidence} from '../messenger/contextTags.js';
import {buyerConversationFingerprint, projectCustomerBusinessProfile} from './businessProfile.js';
import {withDigitalEmployeeRunLock} from '../digitalEmployees/runControl.js';
import {withCustomerPreviewAi, type PreviewAiAudit} from '../../scripts/customer-preview-ai-scope.mjs';
import {applyTagCorrections, protectedCustomerTag, readTagCorrections} from '../../shared/contracts/customerTags.js';
import {pendingLocalCustomerProfile} from '../../shared/contracts/localCustomerProfile.js';
import type {PreviewSession} from './localPreviewSimulation.js';

const detachedProfileTasks=new AsyncResource('local-preview-profile-analysis');
type State = {status:'pending'|'analyzing'|'succeeded'|'failed'|'disabled';fingerprint:string;updatedAt:string;attempts:number;retryAt:number;errorCode?:string};
export type LocalPreviewBusinessProfile = Omit<ReturnType<typeof pendingLocalCustomerProfile>,'bant'|'progressionGoal'|'profileAnalysisStatus'|'profileAnalysisHasResult'> & {
 bant?:BantAssessment; progressionGoal?:ProgressionGoal;
};
export type LocalPreviewProfilePatch = Partial<LocalPreviewBusinessProfile> & LocalCustomerProfileAnalysis;
type Result = {fingerprint:string;updatedAt:string;profile:LocalPreviewBusinessProfile};
export interface LocalPreviewProfilePorts {
 enabled:()=>boolean;
 classify:typeof classifyContextTags;
 run:typeof withCustomerPreviewAi;
 now:()=>number;
 schedule:(run:()=>void,delay:number)=>void;
}
export const defaultLocalPreviewProfilePorts:LocalPreviewProfilePorts={
 enabled:()=>process.env.NODE_ENV==='development'&&process.env.LINGSHU_LOCAL_PREVIEW==='1'&&process.env.CUSTOMER_SIMULATION_REAL_AI==='1',
 classify:classifyContextTags,run:withCustomerPreviewAi,now:Date.now,
 schedule:(run,delay)=>{setTimeout(run,delay).unref();},
};
function readAudit(value:unknown):PreviewAiAudit[]{
 if(!Array.isArray(value))return [];
 return value.slice(0,16).flatMap(item=>{
  if(!item||typeof item!=='object')return [];
  const row=item as Record<string,unknown>;
  try{
   const endpoint=new URL(String(row.endpoint));
   if(endpoint.protocol!=='https:'||!['maas.qianwenaiapi.com','dashscope.aliyuncs.com'].includes(endpoint.hostname)||endpoint.pathname!=='/compatible-mode/v1/chat/completions'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.port)return [];
   if(typeof row.startedAt!=='string'||!Number.isFinite(Date.parse(row.startedAt)))return [];
   const identifier=(v:unknown)=>typeof v==='string'?v.slice(0,200):null;
   const usage=row.usage&&typeof row.usage==='object'?Object.fromEntries(Object.entries(row.usage).filter(([key,n])=>/^(?:prompt|completion|total|input|output)_tokens$/.test(key)&&typeof n==='number'&&Number.isFinite(n)&&n>=0)):null;
   return [{startedAt:row.startedAt,endpoint:endpoint.href,status:typeof row.status==='number'?row.status:null,requestId:identifier(row.requestId),completionId:identifier(row.completionId),model:identifier(row.model),usage}] as PreviewAiAudit[];
  }catch{return [];}
 });
}
type Hooks={read:(tenant:string,user:string,id:string)=>Promise<PreviewSession>;update:(id:string,patch:Record<string,unknown>)=>Promise<void>};
export function createLocalPreviewProfileAnalysis(hooks:Hooks,ports:LocalPreviewProfilePorts=defaultLocalPreviewProfilePorts){
 const running=new Map<string,Promise<void>>();
 const lock=<T>(tenant:string,id:string,fn:()=>Promise<T>)=>withDigitalEmployeeRunLock(tenant,`preview-${id}`,fn);
 const stamp=(prior?:State)=>new Date(Math.max(ports.now(),Date.parse(prior?.updatedAt||'')+1||0)).toISOString();
 async function inbound(s:PreviewSession){
  if(!s.customer)return;
  const fingerprint=buyerConversationFingerprint(s.customer.timeline);
  if(s.profileAnalysis?.fingerprint===fingerprint){
   if(['pending','analyzing','succeeded'].includes(s.profileAnalysis.status))return;
   if(s.profileAnalysis.status==='failed'){
    if(ports.enabled()&&s.profileAnalysis.retryAt<=ports.now())enqueue(s.tenant_id,s.owner_id,s.id);
    return;
   }
  }
  await hooks.update(s.id,{profileAnalysis:{status:ports.enabled()?'pending':'disabled',fingerprint,updatedAt:stamp(s.profileAnalysis),attempts:0,retryAt:0,...(!ports.enabled()?{errorCode:'preview_profile_analysis_disabled'}:{})}});
  if(ports.enabled())enqueue(s.tenant_id,s.owner_id,s.id);
 }
 function enqueue(tenant:string,user:string,id:string){
  if(running.has(id))return;
  let mayFollow=true;
  const task=detachedProfileTasks.runInAsyncScope(()=>Promise.resolve().then(async()=>{
   for(;;){
    const snapshot=await lock(tenant,id,async()=>{
     const s=await hooks.read(tenant,user,id),state=s.profileAnalysis;
     if(!s.customer||!state||!ports.enabled()||state.status==='succeeded'||state.status==='disabled'||state.retryAt>ports.now())return null;
     const stateNext:State={...state,status:'analyzing',updatedAt:stamp(state)};
     await hooks.update(id,{profileAnalysis:stateNext});return {turns:structuredClone(s.customer.timeline),fingerprint:buyerConversationFingerprint(s.customer.timeline)};
    });
    if(!snapshot)return;
    let result:{value:ContextTagEvidence[];audit:PreviewAiAudit[]}|undefined,failed=false,audit:PreviewAiAudit[]=[];
    try{result=await ports.run(()=>ports.classify(snapshot.turns));audit=readAudit(result.audit);}catch(error){failed=true;audit=readAudit(error&&typeof error==='object'?'previewAiAudit' in error?error.previewAiAudit:undefined:undefined);}
    const next=await lock(tenant,id,async()=>{
     const latest=await hooks.read(tenant,user,id);
     if(!latest.customer)return 'done';
     if(buyerConversationFingerprint(latest.customer.timeline)!==snapshot.fingerprint){if(audit.length)await hooks.update(id,{ai_audit:[...(latest.ai_audit||[]),...audit]});return 'newer';}
     const state=latest.profileAnalysis!;
     if(failed){
      const attempts=state.attempts+1,retryAt=ports.now()+Math.min(15*60_000,60_000*2**Math.min(attempts-1,4));
      await hooks.update(id,{ai_audit:[...(latest.ai_audit||[]),...audit],profileAnalysis:{...state,status:'failed',attempts,retryAt,updatedAt:stamp(state),errorCode:'preview_profile_analysis_failed'}});
      // Retry uses the same admitted action scope. GET/read never starts a model.
      ports.schedule(()=>enqueue(tenant,user,id),retryAt-ports.now());return 'done';
     }
     const updatedAt=stamp(state);
     await hooks.update(id,{profileResult:buildProfileResult(latest,snapshot.fingerprint,result!.value,updatedAt),profileAnalysis:{status:'succeeded',fingerprint:snapshot.fingerprint,updatedAt,attempts:0,retryAt:0},ai_audit:[...(latest.ai_audit||[]),...audit]});
     return 'done';
    });
    if(next!=='newer')return;
   }
  }).catch(async()=>{
   mayFollow=false;
   // Storage/lock failures remain visible and do not become synthetic success.
   try{await lock(tenant,id,async()=>{const s=await hooks.read(tenant,user,id);if(s.profileAnalysis)await hooks.update(id,{profileAnalysis:{...s.profileAnalysis,status:'failed',updatedAt:stamp(s.profileAnalysis),errorCode:'preview_profile_analysis_state_failed'}});});}catch{/* Original durable pending state remains available for diagnosis. */}
  }).finally(async()=>{
   running.delete(id);
   // An inbound can arrive after the final write but before this task settles.
   try{const s=await hooks.read(tenant,user,id);if(mayFollow&&ports.enabled()&&s.profileAnalysis&&['pending','analyzing'].includes(s.profileAnalysis.status))enqueue(tenant,user,id);}catch{/* No authority/session: never start another analysis. */}
  }));
  running.set(id,task);
 }
 return {inbound,enqueue,
  async recover(tenant:string,user:string,ids:string[]){
   if(!ports.enabled())return;
   for(const id of [...new Set(ids)]){
    const s=await hooks.read(tenant,user,id),state=s.profileAnalysis;
    if(!state||!['pending','analyzing','failed'].includes(state.status))continue;
    if(state.retryAt>ports.now())ports.schedule(()=>enqueue(tenant,user,id),state.retryAt-ports.now());else enqueue(tenant,user,id);
   }
  },
  async idle(){while(running.size)await Promise.all([...running.values()]);}
 };
}
/** Persist only admitted business fields, never draft or transport state. */
function buildProfileResult(s:PreviewSession,fingerprint:string,evidence:ContextTagEvidence[],updatedAt:string):Result{
 const customer=s.customer!;
 const projected=projectCustomerBusinessProfile(customer,{contextTagEvidence:evidence,contextTagsBuyerFingerprint:fingerprint,contextTagsAnalysisVersion:5});
 const excerpt=[...customer.timeline].reverse().find(turn=>turn.actor==='buyer')?.body.slice(0,300)||'';
 const profile:LocalPreviewBusinessProfile={
  ...pendingLocalCustomerProfile({...customer,timeline:customer.timeline}),
  bant:projected.bant,intentScore:projected.intentScore,progressionGoal:projected.progressionGoal,
  tags:projected.tags,contextTagEvidence:projected.contextTagEvidence,contextTagsUpdatedAt:updatedAt,
  product:excerpt?`客户原文：${excerpt.slice(0,80)}${excerpt.length>80?'…':''}`:'需求待确认',outboundProduct:'',
  summary:excerpt?`客户原文：${excerpt}`:'客户需求待确认',nextStep:projected.progressionGoal?.question||'人工核实客户需求并回复',
  handlingReason:'已根据会话更新采购画像；交易事实仍需人工核实。',
 };
 return {fingerprint,updatedAt,profile};
}
/** Read-only: keep the last good snapshot during pending/failed analysis. */
export function localPreviewProfilePatch(s:PreviewSession):LocalPreviewProfilePatch{
 if(!s.customer)return {};
 const state=s.profileAnalysis,result=s.profileResult;
 const corrections=readTagCorrections(s.tagProfile?.contextTagCorrections);
 const base=result?.profile||pendingLocalCustomerProfile({...s.customer,...s.tagProfile,timeline:s.customer.timeline});
 const inputTags=s.tagProfile?.tags||s.customer.tags;
 const protectedTags=(Array.isArray(inputTags)?inputTags.filter((tag):tag is string=>typeof tag==='string'):[]).filter(protectedCustomerTag);
 return {...base,
  tags:applyTagCorrections([...(base.tags||[]),...protectedTags],corrections),contextTagCorrections:corrections,
  profileAnalysisStatus:state?.status||'disabled',profileAnalysisBuyerFingerprint:state?.fingerprint||buyerConversationFingerprint(s.customer.timeline),
  profileAnalysisUpdatedAt:state?.updatedAt||'',profileAnalysisErrorCode:state?.errorCode||'',profileAnalysisHasResult:!!result,profileAnalysisResultFingerprint:result?.fingerprint,
 };
}
export type {State as LocalPreviewProfileState,Result as LocalPreviewProfileResult};
