import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {store} from '../storage/index.js';
import {currentDataAuthority,runWithDataAuthority} from '../storage/dataAuthority.js';
import {localFallbacksEnabled} from '../lib/localFallbackPolicy.js';
import { readWeeklyReviewActor } from '../socialPrograms/weeklyReviewActor.js';
import {SocialProgramError} from '../socialPrograms/service.js';
import {PACKAGES,type PackageRow} from '../socialPrograms/weeklyOperatingPackageSupport.js';
import {executionPackageFrozen} from '../socialPrograms/weeklyExecutionGate.js';
import {runSocialWeeklyExecutionScan,type WeeklyTrustedPreproductionPorts} from './socialWeeklyExecutionRuntime.js';
import type {WeeklyScanScope} from './weeklyScanScope.js';
import type {WeeklyScanCounts} from './weeklyExecutionObservation.js';
import {prepareWeeklyAutomaticProductionPlanning} from '../socialPrograms/weeklyAutomaticProductionPlanning.js';

export const LOCAL_WEEKLY_CONSUMERS='social_local_weekly_consumers';
type Registration=WeeklyScanScope&{actorUserId:string};
export type LocalWeeklyObservation={configuredEnabled:boolean;started:boolean;state:string;dataAuthority:'local';lastScanStartedAt:string|null;lastScanFinishedAt:string|null;lastResult:WeeklyScanCounts|null;lastErrorCode:string|null};
const key=(s:WeeklyScanScope)=>createHash('sha256').update(JSON.stringify([s.tenantId,s.programId,s.packageId,s.packageVersion])).digest('hex');
const enabled=()=>process.env.LINGSHU_LOCAL_PREVIEW==='1'&&localFallbacksEnabled();
function scanErrorCode(error:unknown):string{
 if(error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[a-z0-9_:-]+$/i.test(error.code))return error.code;
 // Only expose known non-sensitive storage diagnostics, never raw errors,
 // paths, credentials or provider response text through health/task details.
 if(error instanceof Error&&/^local_store_atomic_lock_[a-z_]+$/.test(error.message))return error.message;
 return 'local_weekly_scan_failed';
}

/** Separate opt-in consumers. Every tick explicitly re-enters local authority;
 * neither formal/PB jobs nor another package/version can be claimed or recovered.
 * Registration does not activate a draft, approve inputs or authorize outbound work. */
export function createLocalWeeklyExecutionRuntime(dataStore:DataStore,ports:{enabled?:()=>boolean;scan?:(s:WeeklyScanScope,preproductionPorts?:WeeklyTrustedPreproductionPorts)=>Promise<WeeklyScanCounts>;preproductionPorts?:WeeklyTrustedPreproductionPorts}={}){
 const observations=new Map<string,LocalWeeklyObservation>(),inflight=new Map<string,Promise<LocalWeeklyObservation>>();
 let preproductionPorts=ports.preproductionPorts;
 let timer:ReturnType<typeof setInterval>|undefined;
 let starting:Promise<void>|undefined;
 let startupErrorCode:string|null=null;
 const isEnabled=ports.enabled??enabled;
 const empty=():LocalWeeklyObservation=>({configuredEnabled:isEnabled(),started:false,state:isEnabled()?'not_connected':'disabled',dataAuthority:'local',lastScanStartedAt:null,lastScanFinishedAt:null,lastResult:null,lastErrorCode:null});
 async function authorize(a:Registration){
  if(!a||![a.tenantId,a.programId,a.packageId,a.actorUserId].every(v=>typeof v==='string'&&v.trim()===v&&v.length>0)||!Number.isSafeInteger(a.packageVersion)||a.packageVersion<1)throw new SocialProgramError('local_weekly_consumer_scope_invalid',400,'本地消费者范围无效。');
  if(currentDataAuthority()!=='local'||!isEnabled())throw new SocialProgramError('local_weekly_consumer_unavailable',403,'独立消费者仅在显式启用的本地预览数据域可用。');
  const actor=await readWeeklyReviewActor(dataStore,a.tenantId,a.actorUserId);
  if(!actor||actor.tenantId!==a.tenantId||actor.disabled===true||actor.active===false||['disabled','suspended'].includes(String(actor.status))||!['admin','super_admin','social_operator'].includes(String(actor.role)))throw new SocialProgramError('local_weekly_consumer_actor_forbidden',403,'当前成员不能接入此本地周任务消费者。');
  const rows=await dataStore.list<PackageRow>(PACKAGES,{where:{tenant_id:a.tenantId,program_id:a.programId,package_id:a.packageId},sort:'-version',perPage:1});
  const row=rows.items[0],p=row?.payload;
  if(!p||row.tenant_id!==a.tenantId||p.programId!==a.programId||p.packageId!==a.packageId||p.version!==a.packageVersion||!['draft','active'].includes(p.status)||await executionPackageFrozen(dataStore,a))throw new SocialProgramError('local_weekly_consumer_scope_stale',409,'只消费当前未冻结周版本；旧版本不会自动迁移授权。');
 }
 async function scan(a:Registration):Promise<LocalWeeklyObservation>{
  const id=key(a),old=inflight.get(id);if(old)return old;
  const task=runWithDataAuthority('local',async()=>{
   let state=observations.get(id)??empty();
   try{
    await authorize(a);state={...state,configuredEnabled:true,started:true,state:'scanning',lastScanStartedAt:new Date().toISOString(),lastErrorCode:null};observations.set(id,state);
    if(process.env.LINGSHU_WEEKLY_SCAN_TRACE==='1')console.log('[local-weekly-trace] execution-scan-start',{packageId:a.packageId,packageVersion:a.packageVersion});
    const result=ports.scan?await ports.scan(a,preproductionPorts):await (async()=>{const {createDefaultWeeklyExecutionAdapters}=await import('./weeklyExecutionAdapters.js');return runSocialWeeklyExecutionScan({dataStore,scope:a,adapters:createDefaultWeeklyExecutionAdapters(dataStore,{exactAnalysisPortsForRun:preproductionPorts?.candidatePorts?.exactAnalysisPortsForRun}),workerId:`local-weekly-${process.pid}-${id.slice(0,12)}`,maxTasksPerTenant:5,preproductionPorts});})();
    if(process.env.LINGSHU_WEEKLY_SCAN_TRACE==='1')console.log('[local-weekly-trace] execution-scan-finish',{packageId:a.packageId,packageVersion:a.packageVersion});
    // The accepted template is already the user's production opt-in. Once the
    // real outline and director analysis exist, advance through the existing
    // automatic planning proof and dispatch boundary without another prompt.
    // A not-ready result is expected while upstream evidence is still running.
    if(!ports.scan){if(process.env.LINGSHU_WEEKLY_SCAN_TRACE==='1')console.log('[local-weekly-trace] planning-start',{packageId:a.packageId,packageVersion:a.packageVersion});await prepareWeeklyAutomaticProductionPlanning(dataStore,a,new Date().toISOString());if(process.env.LINGSHU_WEEKLY_SCAN_TRACE==='1')console.log('[local-weekly-trace] planning-finish',{packageId:a.packageId,packageVersion:a.packageVersion});}
    const counts={claimed:result.claimed,succeeded:result.succeeded,pending:result.pending,blocked:result.blocked,failed:result.failed,projectionFailed:result.projectionFailed??0};
    if(Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('local_weekly_scan_result_invalid');
    state={...state,state:'idle',lastScanFinishedAt:new Date().toISOString(),lastResult:counts};
   }catch(e){
    const code=scanErrorCode(e);
    if(process.env.LINGSHU_WEEKLY_SCAN_TRACE==='1')console.log('[local-weekly-trace] scan-error',{packageId:a.packageId,packageVersion:a.packageVersion,code,detail:e instanceof Error?e.message:'unknown'});
    // A prior process or an overlapping package transition may still own the
    // short durable gate lease. This is normal restart backoff, not a failed
    // worker; the next scoped tick will retry without changing task state.
    state={...state,state:code==='weekly_execution_package_gate_busy'?'waiting':'failed',lastScanFinishedAt:new Date().toISOString(),lastErrorCode:code==='weekly_execution_package_gate_busy'?null:code};
   }
   observations.set(id,state);return structuredClone(state);
  });
  inflight.set(id,task);try{return await task;}finally{inflight.delete(id);}
 }
 async function tick(){if(!isEnabled())return;await runWithDataAuthority('local',async()=>{
  const rows:Record_[]=[];
  for(let page=1;;page++){
   const r=await dataStore.list<Record_>(LOCAL_WEEKLY_CONSUMERS,{page,perPage:100,sort:'id'});
   rows.push(...r.items);
   if(page>=r.totalPages||!r.items.length)break;
  }
  const scans:Promise<LocalWeeklyObservation>[]=[],valid:Array<{row:Record_;registration:Registration;weekStart:string}>=[];
  for(const row of rows){
   const a=row.payload as Registration;
   if(!a||row.id!==key(a)||row.tenant_id!==a.tenantId||row.program_id!==a.programId||row.package_id!==a.packageId||row.package_version!==a.packageVersion)continue;
   const packages=await dataStore.list<PackageRow>(PACKAGES,{where:{tenant_id:a.tenantId,program_id:a.programId,package_id:a.packageId},sort:'-version',perPage:1});
   const current=packages.items[0]?.payload;
   if(!current||current.version!==a.packageVersion||!['draft','active'].includes(current.status)){
    scans.push(scan(a)); // Preserve explicit stale-scope diagnostics.
    continue;
   }
   valid.push({row,registration:a,weekStart:current.weekStart});
  }
  // One project has one current weekly execution window. Older registered
  // weeks remain durable audit/recovery evidence, but their unfinished graphs
  // must be carried forward explicitly instead of executing beside the newest
  // week forever.
  const selected=new Map<string,{row:Record_;registration:Registration;weekStart:string}>();
  for(const candidate of valid){
   const group=`${candidate.registration.tenantId}\u0000${candidate.registration.programId}`,prior=selected.get(group);
   const candidateCreated=Date.parse(String(candidate.row.created||''))||0,priorCreated=Date.parse(String(prior?.row.created||''))||0;
   if(!prior||candidate.weekStart>prior.weekStart||candidate.weekStart===prior.weekStart&&(candidateCreated>priorCreated||candidateCreated===priorCreated&&candidate.registration.packageVersion>prior.registration.packageVersion))selected.set(group,candidate);
  }
  const selectedIds=new Set([...selected.values()].map(value=>value.row.id));
  for(const candidate of valid){
   if(selectedIds.has(candidate.row.id)){scans.push(scan(candidate.registration));continue;}
   observations.set(key(candidate.registration),{...empty(),configuredEnabled:true,state:'superseded',lastScanFinishedAt:new Date().toISOString()});
  }
  await Promise.allSettled(scans);
 });}
 async function observedTick(){
  try{await tick();startupErrorCode=null;}
  catch(error){startupErrorCode=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[a-z0-9_:-]+$/i.test(error.code)?error.code:'local_weekly_registration_restore_failed';console.error('[local-weekly] registered consumer recovery failed',{code:startupErrorCode});throw error;}
 }
 async function start(){
  if(starting)return starting;
  if(timer||!isEnabled())return;
  // Restore only durable opt-ins; tick authorizes each current scope/member
  // again. This never registers a package or opens a global worker.
  timer=setInterval(()=>{void observedTick().catch(()=>undefined);},15000);timer.unref?.();
  starting=observedTick();try{await starting;}finally{starting=undefined;}
 }
 return {
  /** Server bootstrap may install one trusted composition before any local
   * recovery starts. Registrations and later scans cannot replace it. */
  configureTrustedPreproductionPorts(value:WeeklyTrustedPreproductionPorts){
   if(timer||starting||inflight.size||observations.size||preproductionPorts&&preproductionPorts!==value)throw Error('local_weekly_preproduction_ports_already_started');
   preproductionPorts=value;
  },
  start,stop(){if(timer)clearInterval(timer);timer=undefined;},
  health(){const all=[...observations.values()],stale=all.filter(value=>value.lastErrorCode==='local_weekly_consumer_scope_stale'),failed=all.filter(value=>value.state==='failed'&&value.lastErrorCode!=='local_weekly_consumer_scope_stale');return {configuredEnabled:isEnabled(),started:Boolean(timer),state:!isEnabled()?'disabled':starting||inflight.size>0?'scanning':startupErrorCode||failed.length?'failed':timer?'watching':'not_started',lastErrorCode:startupErrorCode??failed[0]?.lastErrorCode??null,failedScopes:failed.length,staleScopes:stale.length};},
  read(a:WeeklyScanScope){const value=observations.get(key(a))??empty();return structuredClone(startupErrorCode?{...value,state:'failed',lastErrorCode:startupErrorCode}:value);},
  /** Explicit package activation must not first restore/scan every previously
   * registered consumer. This records only the exact scope; no timer or scan
   * is started. Normal start()/connect() background recovery is unchanged. */
  async connectScoped(a:Registration){
   await authorize(a);const id=key(a),prior=await dataStore.getById<Record_>(LOCAL_WEEKLY_CONSUMERS,id);
   if(prior){const p=prior.payload as Registration;if(!p||key(p)!==id||p.actorUserId!==a.actorUserId)throw new SocialProgramError('local_weekly_consumer_registration_conflict',409,'已有消费者归属发生变化，未覆盖原授权。');}
   else if(!await dataStore.create(LOCAL_WEEKLY_CONSUMERS,{id,tenant_id:a.tenantId,program_id:a.programId,package_id:a.packageId,package_version:a.packageVersion,payload:a}))throw new SocialProgramError('local_weekly_consumer_registration_failed',503,'未保存本地消费者范围。');
   const state:LocalWeeklyObservation={...empty(),configuredEnabled:true,started:true,state:'idle'};
   const current=observations.get(id)??state;
   observations.set(id,current);
   return structuredClone(current);
  },
  /** Deliberately side-effecting, but scans only this exact package version. */
  async scanScoped(a:Registration){
   await authorize(a);const row=await dataStore.getById<Record_>(LOCAL_WEEKLY_CONSUMERS,key(a));
   if(!row||row.tenant_id!==a.tenantId||row.program_id!==a.programId||row.package_id!==a.packageId||row.package_version!==a.packageVersion||JSON.stringify(row.payload)!==JSON.stringify(a))throw new SocialProgramError('local_weekly_consumer_registration_missing',409,'当前周版本尚未注册独立消费者。');
   return scan(a);
  },
  async connect(a:Registration){
   await authorize(a);await start();const id=key(a),prior=await dataStore.getById<Record_>(LOCAL_WEEKLY_CONSUMERS,id);
   if(prior){const p=prior.payload as Registration;if(!p||key(p)!==id||p.actorUserId!==a.actorUserId)throw new SocialProgramError('local_weekly_consumer_registration_conflict',409,'已有消费者归属发生变化，未覆盖原授权。');}
   else if(!await dataStore.create(LOCAL_WEEKLY_CONSUMERS,{id,tenant_id:a.tenantId,program_id:a.programId,package_id:a.packageId,package_version:a.packageVersion,payload:a}))throw new SocialProgramError('local_weekly_consumer_registration_failed',503,'未保存本地消费者范围。');
   return scan(a);
  },
  tick,
 };
}
export const localWeeklyExecutionRuntime=createLocalWeeklyExecutionRuntime(store);
