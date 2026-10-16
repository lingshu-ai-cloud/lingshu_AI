import type {DataStore} from '../storage/datastore.js';
import {store} from '../storage/index.js';
import {currentDataAuthority,runWithDataAuthority,type DataAuthority} from '../storage/dataAuthority.js';
import {localFallbacksEnabled} from '../lib/localFallbackPolicy.js';
import {CONTENT_CREATION_QUOTA_COLLECTION,shanghaiNaturalWeek,type QuotaScope} from '../socialPrograms/contentCreationQuota.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {createStarter198OrchestratorQueue} from '../starter198/orchestratorQueue.js';
import {starterWorkerRuntimeIssue} from '../starter198/workerRuntime.js';

export type ContentOrderDispatchRecovery={scope:QuotaScope;contentId:string;executionTaskId?:string;commandId:string;kind?:'cancel_planned'};
export type ContentOrderOutboxCounts={pending:number;recovered:number;blocked:number;skipped:number};
export type ContentOrderProjectionCounts={checked:number;reconciled:number;blocked:number;skipped:number};
type PoolRow={id:string;tenant_id:string;program_id:string;week_start:string;payload:{scope:QuotaScope;
 orders:Record<string,{contentId:string;state:string;revisions?:Array<{executionTaskId:string;lineageHash:string;commandId:string}>}>;
 outbox:Array<{kind:string;state:string;commandId:string;contentId:string;executionTaskId?:string}>}};
const identity=(value:unknown):value is string=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<300;
const dispatchKey=(item:ContentOrderDispatchRecovery)=>JSON.stringify([item.scope.tenantId,item.scope.programId,item.scope.weekStart,item.contentId,item.executionTaskId??item.contentId,item.commandId,item.kind??'dispatch']);

/** A scanner, not a second producer: only committed execution reservations
 * are replayed. The original frozen command and idempotent enqueue remain the
 * authority. Unknown supplier results are never submitted by this consumer. */
export async function runSocialContentOrderOutboxScan(input:{dataStore:DataStore;authority:DataAuthority;
 recover:(item:ContentOrderDispatchRecovery)=>Promise<unknown>;maximumDispatches?:number;
 afterDispatchKey?:string;onAttempt?:(key:string)=>void}):Promise<ContentOrderOutboxCounts>{
 if(currentDataAuthority()!==input.authority)throw Error('social_content_order_outbox_authority_mismatch');
 const result:ContentOrderOutboxCounts={pending:0,recovered:0,blocked:0,skipped:0};
 const maximum=Math.max(1,Math.min(100,Math.floor(input.maximumDispatches??20)));
 // Snapshot before dispatch mutates quota rows; this cap is scan work, never
 // the production concurrency or permission to create fresh orders.
 const pending:ContentOrderDispatchRecovery[]=[],poolIds=new Map<string,string>();
 for(let page=1;page<=100;page++){
  const rows=await input.dataStore.list<PoolRow>(CONTENT_CREATION_QUOTA_COLLECTION,{page,perPage:100,sort:'id'});
  for(const row of rows.items){
   const payload=row.payload,scope=payload?.scope;
   if(!scope||!identity(scope.tenantId)||!identity(scope.programId)||!identity(scope.weekStart)
     ||scope.tenantId!==row.tenant_id||scope.programId!==row.program_id||scope.weekStart!==row.week_start
     ||!/^\d{4}-\d{2}-\d{2}$/.test(scope.weekStart)
     ||!Number.isFinite(Date.parse(`${scope.weekStart}T12:00:00+08:00`))
     ||shanghaiNaturalWeek(new Date(`${scope.weekStart}T12:00:00+08:00`))!==scope.weekStart
     ||!payload.orders||!Array.isArray(payload.outbox)){result.skipped++;continue;}
   for(const item of payload.outbox){
    if(!item||typeof item!=='object'){result.skipped++;continue;}
    if(!['dispatch','cancel_planned'].includes(item.kind)||item.state!=='pending')continue;
    const order=payload.orders[item.contentId];
    if(item.kind==='cancel_planned'&&(!order||order.state!=='released'))continue;
    if(!identity(item.commandId)||!identity(item.contentId)||!order||order.contentId!==item.contentId
      ||!(item.kind==='cancel_planned'?order.state==='released':['reserved','running','delivered'].includes(order.state))){result.skipped++;continue;}
    if(item.executionTaskId!==undefined&&(!identity(item.executionTaskId)
      ||!Array.isArray(order.revisions)||!order.revisions.some(r=>r&&r.executionTaskId===item.executionTaskId&&r.commandId===item.commandId&&/^[a-f0-9]{64}$/.test(r.lineageHash)))){
      result.skipped++;continue;
    }
    const recovery={scope:{...scope},contentId:item.contentId,commandId:item.commandId,
      ...(item.executionTaskId?{executionTaskId:item.executionTaskId}:{}),...(item.kind==='cancel_planned'?{kind:'cancel_planned' as const}:{})};
    pending.push(recovery);poolIds.set(dispatchKey(recovery),row.id);
   }
  }
  if(!rows.items.length||page>=rows.totalPages)break;
  if(page===100)throw Error('social_content_order_outbox_scan_limit');
 }
 pending.sort((a,b)=>dispatchKey(a).localeCompare(dispatchKey(b)));
 const split=input.afterDispatchKey?pending.findIndex(item=>dispatchKey(item).localeCompare(input.afterDispatchKey!)>0):0;
 const rotation=split<0?0:split;
 for(const item of [...pending.slice(rotation),...pending.slice(0,rotation)].slice(0,maximum)){
  result.pending++;
  input.onAttempt?.(dispatchKey(item));
  try{
   await input.recover(item);
   // A resolved promise/HTTP 200 is not an outbox receipt. Read the committed
   // acknowledgement; a partially completed enqueue remains retryable.
   const settled=await input.dataStore.getById<PoolRow>(CONTENT_CREATION_QUOTA_COLLECTION,poolIds.get(dispatchKey(item))!);
   const receipt=settled?.payload?.outbox?.find(out=>out.commandId===item.commandId&&out.contentId===item.contentId&&out.kind===(item.kind??'dispatch')
     &&(out.executionTaskId??out.contentId)===(item.executionTaskId??item.contentId));
   if(settled?.tenant_id!==item.scope.tenantId||settled.program_id!==item.scope.programId
     ||settled.week_start!==item.scope.weekStart||receipt?.state!=='acknowledged')throw Error('social_content_order_outbox_ack_pending');
   result.recovered++;
  }
  catch{result.blocked++;} // No ACK, release or forged result on failure.
 }
 return result;
}

/** Reconcile business projections from actual worker/delivery evidence even
 * when dispatch ACK is already committed. No queue submission occurs here. */
export async function runSocialContentOrderProjectionScan(input:{dataStore:DataStore;authority:DataAuthority;
 project:(item:{scope:QuotaScope;contentId:string;taskId:string})=>Promise<unknown>;
 maximumTasks?:number;afterTaskKey?:string;onAttempt?:(key:string)=>void}):Promise<ContentOrderProjectionCounts>{
 if(currentDataAuthority()!==input.authority)throw Error('social_content_order_projection_authority_mismatch');
 const result:ContentOrderProjectionCounts={checked:0,reconciled:0,blocked:0,skipped:0};
 const tasks=new Map<string,{scope:QuotaScope;contentId:string;taskId:string}>();
 for(let page=1;page<=100;page++){
  const rows=await input.dataStore.list<PoolRow>(CONTENT_CREATION_QUOTA_COLLECTION,{page,perPage:100,sort:'id'});
  for(const row of rows.items){
   const p=row.payload,s=p?.scope;
   if(!s||!identity(s.tenantId)||!identity(s.programId)||!identity(s.weekStart)
     ||s.tenantId!==row.tenant_id||s.programId!==row.program_id||s.weekStart!==row.week_start
     ||!/^\d{4}-\d{2}-\d{2}$/.test(s.weekStart)||!Number.isFinite(Date.parse(`${s.weekStart}T12:00:00+08:00`))
     ||shanghaiNaturalWeek(new Date(`${s.weekStart}T12:00:00+08:00`))!==s.weekStart||!p.orders){result.skipped++;continue;}
   for(const [contentId,order] of Object.entries(p.orders)){
    if(!identity(contentId)||!order||order.contentId!==contentId||!['reserved','running','delivered'].includes(order.state))continue;
    const ids=[contentId,...(Array.isArray(order.revisions)?order.revisions:[]).filter(r=>r&&identity(r.executionTaskId)&&identity(r.commandId)&&/^[a-f0-9]{64}$/.test(r.lineageHash)).map(r=>r.executionTaskId)];
    for(const taskId of ids){const key=JSON.stringify([s.tenantId,s.programId,s.weekStart,contentId,taskId]);
      tasks.set(key,{scope:{...s},contentId,taskId});}
   }
  }
  if(!rows.items.length||page>=rows.totalPages)break;
  if(page===100)throw Error('social_content_order_projection_scan_limit');
 }
 const keys=[...tasks.keys()].sort((a,b)=>a.localeCompare(b));
 const split=input.afterTaskKey?keys.findIndex(key=>key.localeCompare(input.afterTaskKey!)>0):0,start=split<0?0:split;
 for(const key of [...keys.slice(start),...keys.slice(0,start)].slice(0,Math.max(1,Math.min(100,Math.floor(input.maximumTasks??20))))){
  result.checked++;input.onAttempt?.(key);
  try{await input.project(tasks.get(key)!);result.reconciled++;}catch{result.blocked++;}
 }
 return result;
}

export function createSocialContentOrderOutboxRuntime(input:{dataStore:DataStore;authority:DataAuthority;
 enabled:()=>boolean;recover?:(item:ContentOrderDispatchRecovery)=>Promise<unknown>;
 project?:(item:{scope:QuotaScope;contentId:string;taskId:string})=>Promise<unknown>;pollMs?:number}){
 let timer:ReturnType<typeof setInterval>|undefined,inflight:Promise<ContentOrderOutboxCounts>|undefined;
 let lastResult:ContentOrderOutboxCounts|null=null,lastProjection:ContentOrderProjectionCounts|null=null,
  lastCancellation:{recovered:number;failed:number}|null=null,
  lastError:string|null=null,afterDispatchKey:string|undefined,afterTaskKey:string|undefined,afterCancellationKey:string|undefined;
 async function tick(){
  if(!input.enabled())return null;
  if(inflight)return inflight;
  inflight=runWithDataAuthority(input.authority,async()=>{
   const repository=createStarter198Repository(input.dataStore);
   try{
    const {recoverPendingSocialContentOrderCancellations}=await import('../starter198/socialContentOrderCancellation.js');
    lastCancellation=await recoverPendingSocialContentOrderCancellations({repository,afterTaskKey:afterCancellationKey,onAttempt:key=>{afterCancellationKey=key;}});
   }catch{lastCancellation={recovered:0,failed:1};} // Separate branch; never starve dispatch/projection.
   const recover=input.recover??(async(item:ContentOrderDispatchRecovery)=>{
    if(item.kind==='cancel_planned'){
     const {reconcileSocialContentPlannedCancellation}=await import('../starter198/socialContentOrderPlanning.js');
     return reconcileSocialContentPlannedCancellation({repository,tenantId:item.scope.tenantId,programId:item.scope.programId,
      weekStart:item.scope.weekStart,contentId:item.contentId,commandId:item.commandId});
    }
    const {recoverSocialContentOrderDispatch}=await import('../starter198/socialContentTasks.js');
    return recoverSocialContentOrderDispatch({repository,orchestratorQueue:createStarter198OrchestratorQueue({repository,dataStore:input.dataStore}),
      tenantId:item.scope.tenantId,taskId:item.executionTaskId??item.contentId,commandId:item.commandId});
   });
   const result=await runSocialContentOrderOutboxScan({dataStore:input.dataStore,authority:input.authority,recover,
    afterDispatchKey,onAttempt:key=>{afterDispatchKey=key;}});
   lastProjection=await runSocialContentOrderProjectionScan({dataStore:input.dataStore,authority:input.authority,
    afterTaskKey,onAttempt:key=>{afterTaskKey=key;},project:input.project??(async item=>{
     const {reconcileSocialContentOrderProjection}=await import('../starter198/socialContentOrderProjection.js');
     return reconcileSocialContentOrderProjection({repository,tenantId:item.scope.tenantId,taskId:item.taskId});
    })});
   return result;
  });
  try{lastResult=await inflight;lastError=null;return structuredClone(lastResult);}
  catch{lastError='social_content_order_outbox_scan_failed';throw Error(lastError);}
  finally{inflight=undefined;}
 }
 return{tick,start(){if(timer||!input.enabled())return;void tick().catch(()=>undefined);
   timer=setInterval(()=>{void tick().catch(()=>undefined);},Math.max(1000,input.pollMs??15000));timer.unref?.();},
  stop(){if(timer)clearInterval(timer);timer=undefined;},
  read(){return{authority:input.authority,enabled:input.enabled(),started:Boolean(timer),lastResult:structuredClone(lastResult),
   lastProjection:structuredClone(lastProjection),lastCancellation:structuredClone(lastCancellation),lastError};}};
}

export const localContentOrderOutboxRuntime=createSocialContentOrderOutboxRuntime({dataStore:store,authority:'local',
 enabled:()=>process.env.LINGSHU_LOCAL_PREVIEW==='1'&&localFallbacksEnabled()});
export const contentOrderOutboxRuntime=createSocialContentOrderOutboxRuntime({dataStore:store,authority:'pocketbase',
 enabled:()=>process.env.LINGSHU_LOCAL_PREVIEW!=='1'&&!starterWorkerRuntimeIssue('STARTER_198_ORCHESTRATOR_WORKER_ENABLED')});
