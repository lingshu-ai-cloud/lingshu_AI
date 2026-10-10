import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { advanceInitialPreparation, initialPreparationSources, initialPreparationSourcesFromPersisted, initialPreparationJobKey, persistInitialPreparationState, replaceInitialPreparationPlan, type InitialPreparation } from './initialPreparation';
function fixture(stage='b2b_launch'){let state:InitialPreparation={requestId:'confirmed-request',goalId:'same-goal',revision:2,confirmedBy:'owner',confirmedAt:'2026-10-10T00:00:00Z',status:'collecting',sources:initialPreparationSources({platforms:['youtube','tiktok'],products:['产品'],stage,historyAccounts:['https://www.tiktok.com/@own'],historyCollectionRequestId:'same-history'}),candidateIds:[],reason:''};let ready=false,done=false,started=0,enqueued=0;const jobs=new Map<string,{status:string;candidateIds:string[]}>();const ports={save:async(s:InitialPreparation)=>{state=structuredClone(s);},enqueue:async(source:InitialPreparation['sources'][number])=>{const id=initialPreparationJobKey('tenant',state,source);if(!jobs.has(id)){jobs.set(id,{status:'queued',candidateIds:[]});enqueued++;}return id;},observe:async(id:string)=>{const job=jobs.get(id)!;return done?{status:'done',candidateIds:[`real-${id}`]}:job;},analyzed:async()=>ready,prepare:async()=>({ready:true,revision:2}),activate:async()=>{started++;return 'same-real-run';}};return {ports,get state(){return state;},get enqueued(){return enqueued;},get started(){return started;},done:()=>done=true,ready:()=>ready=true,jobs};}
test('zero foundation persists real external collection and resumes same plan after analysis without duplicate jobs',async()=>{const f=fixture();await advanceInitialPreparation(f.state,f.ports);assert.equal(f.enqueued,2);assert(f.state.sources.every(s=>s.origin==='external'));await advanceInitialPreparation(f.state,f.ports);assert.equal(f.enqueued,2);f.done();await advanceInitialPreparation(f.state,f.ports);assert.equal(f.state.status,'analyzing');assert.equal(f.started,0);f.ready();await advanceInitialPreparation(f.state,f.ports);assert.equal(f.state.status,'running');assert.equal(f.state.goalId,'same-goal');await advanceInitialPreparation(f.state,f.ports);assert.equal(f.started,1);});
test('established accounts add actual account jobs separately from external collection and reuse precollection key',async()=>{const f=fixture('b2b_growth');await advanceInitialPreparation(f.state,f.ports);assert.equal(f.enqueued,3);const own=f.state.sources.find(s=>s.origin==='owned')!;assert.equal(own.mode,'account');assert.equal(own.value,'https://www.tiktok.com/@own');assert.equal(initialPreparationJobKey('tenant',f.state,own),initialPreparationJobKey('tenant',{...f.state,goalId:'history',requestId:'other'},own));});
test('provider failure records explicit blocked state and never invents analysis or activates',async()=>{const f=fixture();await advanceInitialPreparation(f.state,f.ports);f.jobs.set(f.state.sources[0]!.jobId!,{status:'failed',candidateIds:[]});await advanceInitialPreparation(f.state,f.ports);assert.equal(f.state.status,'blocked');assert.match(f.state.reason,/失败/);assert.equal(f.started,0);});
test('foreign platform and local network history URLs are refused before collection',()=>{for(const url of ['http://127.0.0.1/admin','https://evil.example/account'])assert.throws(()=>initialPreparationSources({platforms:['tiktok'],products:['产品'],stage:'b2b_growth',historyAccounts:[url]}));});

test('persisted scope ignores client supplied platforms, products, and stage',()=>{
 const sources=initialPreparationSourcesFromPersisted({
  goalPlatforms:['youtube'],
  businessPackage:{tasks:[{templateId:'production',videoPlans:[{platform:'youtube',productName:'Persisted Widget'}]}]},
  config:{focusProducts:'Persisted Widget',publishingTargets:[{platform:'facebook'}]},
  profile:{strategy:{focusProducts:'Persisted Widget'},products:{items:[{name:'Unselected Product'}]},socialStrategy:{contentStage:'b2b_launch'}},
 },{platforms:['facebook'],products:['Attacker Product'],stage:'b2b_growth',historyAccounts:['https://facebook.com/attacker'],historyCollectionRequestId:'attacker-request'});
 assert.deepEqual(sources,[{key:'external:youtube',platform:'youtube',mode:'keyword',value:'Persisted Widget',origin:'external'}]);
});

test('growth history accounts are the only request scope admitted',()=>{
 const sources=initialPreparationSourcesFromPersisted({
  goalPlatforms:['tiktok'],businessPackage:{tasks:[]},config:{focusProducts:'Persisted Product'},
  profile:{socialStrategy:{contentStage:'b2b_growth'},products:{items:[]}},
 },{platforms:['youtube'],products:['Attacker Product'],stage:'b2b_launch',historyAccounts:['https://www.tiktok.com/@owned'],historyCollectionRequestId:'persisted-history'});
 assert.deepEqual(sources.map(source=>[source.origin,source.platform,source.value]),[
  ['external','tiktok','Persisted Product'],['owned','tiktok','https://www.tiktok.com/@owned'],
 ]);
});

test('initial-preparation route passes only history scope from the request',()=>{
 const source=readFileSync(new URL('../routes/digitalEmployees.ts',import.meta.url),'utf8');
 const start=source.indexOf("digitalEmployeesRouter.post('/goals/:goalId/initial-preparation'");
 const end=source.indexOf("digitalEmployeesRouter.post('/onboarding/complete'",start);
 const route=source.slice(start,end);
 assert.match(route,/initialPreparationSourcesFromPersisted\(\{goalPlatforms:[\s\S]*businessPackage:pack[\s\S]*config:body\.configSnapshot[\s\S]*profile:frozenEnterpriseProfileForPlan\(plan,false\)\},\{historyAccounts:req\.body\?\.historyAccounts,historyCollectionRequestId:req\.body\?\.historyCollectionRequestId\}\)/);
 assert.doesNotMatch(route,/initialPreparationSources\(req\.body\)/);
});

test('progress CAS retries against the latest plan and preserves a concurrent edit',async()=>{
 const state:InitialPreparation={requestId:'request-1',goalId:'goal-1',revision:2,confirmedBy:'owner',confirmedAt:'2026-10-10T00:00:00Z',status:'analyzing',sources:[],candidateIds:['candidate-1'],reason:''};
 let row:any={id:'plan-1',tenant_id:'tenant-1',plan:{businessPackage:{revision:2},concurrentLabel:'before'}};let calls=0;
 const dataStore:any={getById:async()=>structuredClone(row),compareAndSwap:async(_collection:string,_id:string,expected:Record<string,unknown>,patch:Record<string,unknown>)=>{
  calls+=1;if(calls===1){row.plan={...row.plan,concurrentLabel:'after'};return false;}
  if(!isDeepStrictEqual(row.plan,expected.plan))return false;row={...row,...structuredClone(patch)};return true;
 }};
 await persistInitialPreparationState({dataStore,collection:'weekly_plans',planId:row.id,tenantId:'tenant-1',state});
 assert.equal(calls,2);assert.equal(row.plan.concurrentLabel,'after');assert.equal(row.plan.initialPreparation.status,'analyzing');
});

test('prepared plan CAS refuses to overwrite a plan changed during generation',async()=>{
 let row:any={id:'plan-1',tenant_id:'tenant-1',plan:{businessPackage:{revision:2},marker:'source'}};
 const expected=structuredClone(row);
 const dataStore:any={getById:async()=>structuredClone(row),compareAndSwap:async(_collection:string,_id:string,guard:Record<string,unknown>,patch:Record<string,unknown>)=>{
  if(!isDeepStrictEqual(row.plan,guard.plan))return false;row={...row,...structuredClone(patch)};return true;
 }};
 row.plan={businessPackage:{revision:3},marker:'concurrent'};
 await assert.rejects(()=>replaceInitialPreparationPlan({dataStore,collection:'weekly_plans',expected,tenantId:'tenant-1',nextPlan:{businessPackage:{revision:2},marker:'stale'}}),/计划版本已修改/);
 assert.deepEqual(row.plan,{businessPackage:{revision:3},marker:'concurrent'});
});
