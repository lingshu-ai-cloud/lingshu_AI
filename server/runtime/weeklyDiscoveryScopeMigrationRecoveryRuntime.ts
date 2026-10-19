import { randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { reconcileWeeklyDiscoveryScopeMigrations } from '../socialPrograms/weeklyDiscoveryScopeMigration.js';
import { acquireDurableOperationLease, releaseDurableOperationLease, type DurableOperationLease } from './durableLease.js';

type Result = { migrated: number; deferred: number };
type State = 'not_started' | 'watching' | 'scanning' | 'waiting' | 'failed' | 'stopped';
export interface WeeklyDiscoveryScopeMigrationRecoveryObservation {state:State;started:boolean;lastScanStartedAt:string|null;lastScanFinishedAt:string|null;lastResult:Result|null;lastErrorCode:string|null}
const safeError=(error:unknown)=>error instanceof Error&&/^[a-z0-9_:-]+$/i.test(error.message)?error.message:'weekly_discovery_scope_migration_recovery_failed';

/** Worker-only receipt scanner. The durable database lease arbitrates processes;
 * the existing reconciler remains authority for version selection and writes. */
export function createWeeklyDiscoveryScopeMigrationRecoveryRuntime(input:{dataStore:DataStore;scan?:()=>Promise<Result>;pollMs?:number;now?:()=>Date;ownerId?:string;acquire?:typeof acquireDurableOperationLease;release?:typeof releaseDurableOperationLease}){
 const ownerId=input.ownerId??`weekly-scope-migration-${process.pid}-${randomUUID()}`,acquire=input.acquire??acquireDurableOperationLease,release=input.release??releaseDurableOperationLease;
 const scan=input.scan??(()=>reconcileWeeklyDiscoveryScopeMigrations(input.dataStore));
 let timer:ReturnType<typeof setInterval>|undefined,inflight:Promise<WeeklyDiscoveryScopeMigrationRecoveryObservation>|undefined,generation=0;
 let observation:WeeklyDiscoveryScopeMigrationRecoveryObservation={state:'not_started',started:false,lastScanStartedAt:null,lastScanFinishedAt:null,lastResult:null,lastErrorCode:null};
 async function tick():Promise<WeeklyDiscoveryScopeMigrationRecoveryObservation>{
  if(!timer)return structuredClone(observation);if(inflight)return inflight;const activeGeneration=generation;
  inflight=(async()=>{const now=input.now?.()??new Date();observation={...observation,state:'scanning',lastScanStartedAt:now.toISOString(),lastErrorCode:null};let lease:DurableOperationLease|null=null;
   try{lease=await acquire({dataStore:input.dataStore,tenantId:'system',scope:'weekly-discovery-scope-migration',subjectId:'all-projects',ownerId,now,leaseDurationMs:120000});
    if(!lease){observation={...observation,state:'waiting',lastScanFinishedAt:(input.now?.()??new Date()).toISOString()};return structuredClone(observation);}
    if(!timer||activeGeneration!==generation){observation={...observation,state:'stopped',started:false};return structuredClone(observation);}
    const result=await scan();observation={...observation,state:timer&&activeGeneration===generation?'watching':'stopped',started:Boolean(timer),lastScanFinishedAt:(input.now?.()??new Date()).toISOString(),lastResult:{...result},lastErrorCode:null};
   }catch(error){observation={...observation,state:timer&&activeGeneration===generation?'failed':'stopped',started:Boolean(timer),lastScanFinishedAt:(input.now?.()??new Date()).toISOString(),lastErrorCode:safeError(error)};}
   finally{if(lease)await release({dataStore:input.dataStore,lease}).catch(()=>undefined);}return structuredClone(observation);})();
  try{return await inflight;}finally{inflight=undefined;}
 }
 return{start(){if(timer)return;generation++;observation={...observation,state:'watching',started:true,lastErrorCode:null};timer=setInterval(()=>{void tick();},Math.max(5000,Math.floor(input.pollMs??30000)));timer.unref?.();void tick();},stop(){generation++;if(timer)clearInterval(timer);timer=undefined;observation={...observation,state:'stopped',started:false};},tick,read(){return structuredClone(observation);}};
}
export const weeklyDiscoveryScopeMigrationRecoveryRuntime=createWeeklyDiscoveryScopeMigrationRecoveryRuntime({dataStore:store});
