import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataStore } from '../storage/datastore.js';
import type { DurableOperationLease } from './durableLease.js';
import { createWeeklyDiscoveryScopeMigrationRecoveryRuntime } from './weeklyDiscoveryScopeMigrationRecoveryRuntime.js';

const store={} as DataStore;
const lease=(ownerId:string):DurableOperationLease=>({id:`lease-${ownerId}`,tenantId:'system',scope:'weekly-discovery-scope-migration',subjectId:'all-projects',token:`token-${ownerId}`,ownerId,acquiredAt:'2026-10-18T00:00:00.000Z',expiresAt:'2026-10-18T00:02:00.000Z'});
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('start is non-blocking and observable; stop prevents later scans',async()=>{
 let scans=0;const runtime=createWeeklyDiscoveryScopeMigrationRecoveryRuntime({dataStore:store,ownerId:'worker-one',acquire:async input=>lease(input.ownerId),release:async()=>undefined,scan:async()=>{scans++;return{migrated:1,deferred:0};}});
 runtime.start();assert.equal(runtime.read().started,true);await settle();assert.equal(scans,1);assert.deepEqual(runtime.read().lastResult,{migrated:1,deferred:0});runtime.stop();await runtime.tick();assert.equal(scans,1);assert.equal(runtime.read().state,'stopped');
});

test('restart resumes the same durable receipt and repeated scans are idempotent',async()=>{
 const receipt={state:'revised' as 'revised'|'completed',bindings:0};const scan=async()=>{if(receipt.state==='completed')return{migrated:0,deferred:0};receipt.bindings++;receipt.state='completed';return{migrated:1,deferred:0};};
 const create=(ownerId:string)=>createWeeklyDiscoveryScopeMigrationRecoveryRuntime({dataStore:store,ownerId,acquire:async input=>lease(input.ownerId),release:async()=>undefined,scan});
 const first=create('before-restart');first.start();await settle();first.stop();const restarted=create('after-restart');restarted.start();await settle();await restarted.tick();assert.equal(receipt.state,'completed');assert.equal(receipt.bindings,1);restarted.stop();
});

test('durable lease permits one writer and exposes competing worker as waiting',async()=>{
 let held=false,scans=0;const acquire:NonNullable<Parameters<typeof createWeeklyDiscoveryScopeMigrationRecoveryRuntime>[0]['acquire']>=async input=>{if(held)return null;held=true;return lease(input.ownerId);};let unblock!:()=>void;const barrier=new Promise<void>(resolve=>{unblock=resolve;});
 const first=createWeeklyDiscoveryScopeMigrationRecoveryRuntime({dataStore:store,ownerId:'worker-a',acquire,release:async()=>{held=false;},scan:async()=>{scans++;await barrier;return{migrated:0,deferred:1};}}),second=createWeeklyDiscoveryScopeMigrationRecoveryRuntime({dataStore:store,ownerId:'worker-b',acquire,release:async()=>{held=false;},scan:async()=>{scans++;return{migrated:0,deferred:0};}});
 first.start();await settle();second.start();await settle();assert.equal(second.read().state,'waiting');assert.equal(scans,1);unblock();await settle();first.stop();second.stop();
});

test('stop fences a lease waiter; version conflict remains observable',async()=>{
 let grant!:(value:DurableOperationLease)=>void,scans=0;const waiting=new Promise<DurableOperationLease>(resolve=>{grant=resolve;});const stopped=createWeeklyDiscoveryScopeMigrationRecoveryRuntime({dataStore:store,ownerId:'worker-stop',acquire:async()=>waiting,release:async()=>undefined,scan:async()=>{scans++;return{migrated:0,deferred:0};}});
 stopped.start();stopped.stop();grant(lease('worker-stop'));await settle();assert.equal(scans,0);
 const failed=createWeeklyDiscoveryScopeMigrationRecoveryRuntime({dataStore:store,ownerId:'worker-fail',acquire:async input=>lease(input.ownerId),release:async()=>undefined,scan:async()=>{throw Error('weekly_discovery_scope_version_conflict');}});failed.start();await settle();assert.equal(failed.read().state,'failed');assert.equal(failed.read().lastErrorCode,'weekly_discovery_scope_version_conflict');failed.stop();
});
