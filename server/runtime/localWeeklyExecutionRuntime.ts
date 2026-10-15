import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {store} from '../storage/index.js';
import {currentDataAuthority,runWithDataAuthority} from '../storage/dataAuthority.js';
import {localFallbacksEnabled} from '../lib/localFallbackPolicy.js';
import {readWeeklyReviewActor} from '../socialPrograms/weeklyReviewEvidence.js';
import {SocialProgramError} from '../socialPrograms/service.js';
import {PACKAGES,type PackageRow} from '../socialPrograms/weeklyOperatingPackageSupport.js';
import {executionPackageFrozen} from '../socialPrograms/weeklyExecutionGate.js';
import {runSocialWeeklyExecutionScan} from './socialWeeklyExecutionRuntime.js';
import type {WeeklyScanScope} from './weeklyScanScope.js';
import type {WeeklyScanCounts} from './weeklyExecutionObservation.js';

export const LOCAL_WEEKLY_CONSUMERS='social_local_weekly_consumers';
type Registration=WeeklyScanScope&{actorUserId:string};
export type LocalWeeklyObservation={configuredEnabled:boolean;started:boolean;state:string;dataAuthority:'local';lastScanStartedAt:string|null;lastScanFinishedAt:string|null;lastResult:WeeklyScanCounts|null;lastErrorCode:string|null};
const key=(s:WeeklyScanScope)=>createHash('sha256').update(JSON.stringify([s.tenantId,s.programId,s.packageId,s.packageVersion])).digest('hex');
const enabled=()=>process.env.LINGSHU_LOCAL_PREVIEW==='1'&&localFallbacksEnabled();

/** Separate opt-in consumers. Every tick explicitly re-enters local authority;
 * neither formal/PB jobs nor another package/version can be claimed or recovered.
 * Registration does not activate a draft, approve inputs or authorize outbound work. */
export function createLocalWeeklyExecutionRuntime(dataStore:DataStore,ports:{enabled?:()=>boolean;scan?:(s:WeeklyScanScope)=>Promise<WeeklyScanCounts>}={}){
 const observations=new Map<string,LocalWeeklyObservation>(),inflight=new Map<string,Promise<LocalWeeklyObservation>>();
 let timer:ReturnType<typeof setInterval>|undefined;
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
    const result=ports.scan?await ports.scan(a):await (async()=>{const {createDefaultWeeklyExecutionAdapters}=await import('./weeklyExecutionAdapters.js');return runSocialWeeklyExecutionScan({dataStore,scope:a,adapters:createDefaultWeeklyExecutionAdapters(dataStore),workerId:`local-weekly-${process.pid}-${id.slice(0,12)}`,maxTasksPerTenant:5});})();
    const counts={claimed:result.claimed,succeeded:result.succeeded,pending:result.pending,blocked:result.blocked,failed:result.failed,projectionFailed:result.projectionFailed??0};
    if(Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('local_weekly_scan_result_invalid');
    state={...state,state:'idle',lastScanFinishedAt:new Date().toISOString(),lastResult:counts};
   }catch(e){const code=e&&typeof e==='object'&&'code' in e&&typeof e.code==='string'?e.code:'local_weekly_scan_failed';state={...state,state:'failed',lastScanFinishedAt:new Date().toISOString(),lastErrorCode:code};}
   observations.set(id,state);return structuredClone(state);
  });
  inflight.set(id,task);try{return await task;}finally{inflight.delete(id);}
 }
 async function tick(){if(!isEnabled())return;await runWithDataAuthority('local',async()=>{
  const scans:Promise<LocalWeeklyObservation>[]=[];
  for(let page=1;;page++){
   const r=await dataStore.list<Record_>(LOCAL_WEEKLY_CONSUMERS,{page,perPage:100,sort:'id'});
   for(const row of r.items){const a=row.payload as Registration;if(!a||row.id!==key(a)||row.tenant_id!==a.tenantId||row.program_id!==a.programId||row.package_id!==a.packageId||row.package_version!==a.packageVersion)continue;scans.push(scan(a));}
   if(page>=r.totalPages||!r.items.length)break;
  }
  await Promise.allSettled(scans);
 });}
 function start(){if(timer||!isEnabled())return;timer=setInterval(()=>{void tick().catch(()=>undefined);},15000);timer.unref?.();void tick().catch(()=>undefined);}
 return {
  start,stop(){if(timer)clearInterval(timer);timer=undefined;},
  read(a:WeeklyScanScope){return structuredClone(observations.get(key(a))??empty());},
  async connect(a:Registration){
   await authorize(a);start();const id=key(a),prior=await dataStore.getById<Record_>(LOCAL_WEEKLY_CONSUMERS,id);
   if(prior){const p=prior.payload as Registration;if(!p||key(p)!==id||p.actorUserId!==a.actorUserId)throw new SocialProgramError('local_weekly_consumer_registration_conflict',409,'已有消费者归属发生变化，未覆盖原授权。');}
   else if(!await dataStore.create(LOCAL_WEEKLY_CONSUMERS,{id,tenant_id:a.tenantId,program_id:a.programId,package_id:a.packageId,package_version:a.packageVersion,payload:a}))throw new SocialProgramError('local_weekly_consumer_registration_failed',503,'未保存本地消费者范围。');
   return scan(a);
  },
  tick,
 };
}
export const localWeeklyExecutionRuntime=createLocalWeeklyExecutionRuntime(store);
