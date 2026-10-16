import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import type {DataStore} from '../storage/datastore.js';
import {currentDataAuthority,runWithDataAuthority} from '../storage/dataAuthority.js';
import {CONTENT_CREATION_QUOTA_COLLECTION} from '../socialPrograms/contentCreationQuota.js';
import {createSocialContentOrderOutboxRuntime,runSocialContentOrderOutboxScan,runSocialContentOrderProjectionScan} from './socialContentOrderOutboxRuntime.js';

const pool=(tenant='tenant',content='content')=>({id:`pool-${tenant}`,tenant_id:tenant,program_id:'program',week_start:'2026-10-12',payload:{
 scope:{tenantId:tenant,programId:'program',weekStart:'2026-10-12'},orders:{[content]:{contentId:content,state:'reserved'}},
 outbox:[{commandId:`start-${content}`,contentId:content,kind:'dispatch',state:'pending'}],
}});
function fixture(rows:any[]){let writes=0;const store:DataStore={
 getById:async(_collection,id)=>structuredClone(rows.find(row=>row.id===id)??null),create:async()=>{writes++;return null;},update:async()=>{writes++;return false;},delete:async()=>{writes++;return false;},
 list:async(collection,query={})=>{assert.equal(collection,CONTENT_CREATION_QUOTA_COLLECTION);const perPage=query.perPage??20,page=query.page??1;
 return{items:structuredClone(rows.slice((page-1)*perPage,page*perPage)),totalItems:rows.length,totalPages:Math.ceil(rows.length/perPage),page,perPage};},
 };return{store,writes:()=>writes};}

test('restart recovers only durable pending dispatch and leaves unknown/failing branch pending',async()=>{
 const a=pool(),b=pool('other','blocked'),c=pool('completed','already');
 c.payload.outbox[0]!.state='acknowledged';
 a.payload.outbox.push({commandId:'cancel',contentId:'old',kind:'cancel_planned',state:'pending'});
 const f=fixture([a,b,c]);const seen:string[]=[];
 const runtime=createSocialContentOrderOutboxRuntime({dataStore:f.store,authority:'local',enabled:()=>true,project:async()=>undefined,recover:async item=>{
  assert.equal(currentDataAuthority(),'local');seen.push(item.contentId);
  if(item.contentId==='blocked')throw Error('original_request_unknown_must_reconcile');
  a.payload.outbox[0]!.state='acknowledged'; // stands in for real idempotent recovery's ACK
 }});
 const first=await runtime.tick();assert.deepEqual(first,{pending:2,recovered:1,blocked:1,skipped:0});
 const restarted=createSocialContentOrderOutboxRuntime({dataStore:f.store,authority:'local',enabled:()=>true,project:async()=>undefined,recover:async item=>{
  assert.equal(item.contentId,'blocked');throw Error('still_unknown');
 }});
 assert.deepEqual(await restarted.tick(),{pending:1,recovered:0,blocked:1,skipped:0});
 assert.deepEqual(seen.sort(),['blocked','content']);assert.equal(f.writes(),0,'scanner never acknowledges or fabricates production itself');
});

test('scanner rejects authority mismatch, corrupt cross-tenant rows and unreserved drafts',async()=>{
 const corrupt=pool('foreign');corrupt.payload.scope.tenantId='tenant';
 const planned=pool('planned');planned.payload.orders.content!.state='planned';
 const f=fixture([corrupt,planned]);let calls=0;
 const input={dataStore:f.store,authority:'local' as const,recover:async()=>{calls++;}};
 await assert.rejects(runWithDataAuthority('pocketbase',()=>runSocialContentOrderOutboxScan(input)),/authority_mismatch/);
 const result=await runWithDataAuthority('local',()=>runSocialContentOrderOutboxScan(input));
 assert.equal(calls,0);assert.equal(result.skipped,2);
});

test('resolved recovery without committed outbox ACK remains blocked, not completed',async()=>{
 const f=fixture([pool()]);const result=await runWithDataAuthority('local',()=>runSocialContentOrderOutboxScan({
  dataStore:f.store,authority:'local',recover:async()=>({ok:true,status:200}),
 }));
 assert.deepEqual(result,{pending:1,recovered:0,blocked:1,skipped:0});assert.equal(f.writes(),0);
});

test('released planned cancellation is restored separately and only durable cancellation ACK settles it',async()=>{
 const original=pool('tenant','old');original.payload.orders.old.state='released';
 original.payload.outbox=[{commandId:'replacement',contentId:'old',kind:'cancel_planned',state:'pending'}];
 const f=fixture([original]);let dispatched=0;
 const scan=()=>runWithDataAuthority('local',()=>runSocialContentOrderOutboxScan({dataStore:f.store,authority:'local',recover:async item=>{
  assert.equal(item.kind,'cancel_planned');dispatched++;
 }}));
 assert.deepEqual(await scan(),{pending:1,recovered:0,blocked:1,skipped:0});
 const result=await runWithDataAuthority('local',()=>runSocialContentOrderOutboxScan({dataStore:f.store,authority:'local',recover:async item=>{
  assert.equal(item.contentId,'old');original.payload.outbox[0].state='acknowledged';
 }}));
 assert.equal(result.recovered,1);assert.equal(dispatched,1);assert.equal(f.writes(),0);
});

test('runtime keeps domains isolated, coalesces overlapping ticks and honors disablement',async()=>{
 const f=fixture([pool()]);let enabled=false,calls=0,release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const runtime=createSocialContentOrderOutboxRuntime({dataStore:f.store,authority:'local',enabled:()=>enabled,project:async()=>undefined,
 recover:async()=>{calls++;assert.equal(currentDataAuthority(),'local');await gate;}});
 assert.equal(await runtime.tick(),null);assert.equal(calls,0);enabled=true;
 const one=runWithDataAuthority('pocketbase',()=>runtime.tick()),two=runtime.tick();
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(calls,1);release();await Promise.all([one,two]);
 assert.equal(runtime.read().lastError,null);assert.equal(runtime.read().authority,'local');runtime.stop();
});

test('blocked scan batch cannot starve later independent contents',async()=>{
 const f=fixture(Array.from({length:25},(_,i)=>pool(`tenant-${String(i).padStart(2,'0')}`,`content-${i}`)));
 const seen=new Set<string>();const runtime=createSocialContentOrderOutboxRuntime({dataStore:f.store,authority:'local',enabled:()=>true,project:async()=>undefined,
 recover:async item=>{seen.add(item.contentId);throw Error('missing_authorization');}});
 await runtime.tick();assert.equal(seen.size,20);await runtime.tick();assert.equal(seen.size,25);
});

test('background role lifecycle registers and stops both outbox data domains',()=>{
 const source=readFileSync(new URL('./backgroundJobs.ts',import.meta.url),'utf8');
 assert.match(source,/if \(role === 'web'\) throw[\s\S]*contentOrderOutboxRuntime.start\(\)/);
 assert.match(source,/localContentOrderOutboxRuntime.start\(\)/);
 assert.match(source,/contentOrderOutboxRuntime.stop\(\)/);
 assert.match(source,/localContentOrderOutboxRuntime.stop\(\)/);
});

test('revision dispatch targets actual execution task and ACK belongs to original content',async()=>{
 const row=pool() as any;row.payload.orders.content.state='delivered';
 row.payload.orders.content.revisions=[{executionTaskId:'child',lineageHash:'a'.repeat(64),commandId:'revision-start'}];
 row.payload.outbox=[{commandId:'revision-start',contentId:'content',executionTaskId:'child',kind:'dispatch',state:'pending'}];
 const f=fixture([row]);let target='';
 const result=await runWithDataAuthority('local',()=>runSocialContentOrderOutboxScan({dataStore:f.store,authority:'local',recover:async item=>{
  target=item.executionTaskId??item.contentId;assert.equal(item.contentId,'content');row.payload.outbox[0].state='acknowledged';
 }}));
 assert.equal(target,'child');assert.equal(result.recovered,1);
 row.payload.outbox[0].state='pending';row.payload.orders.content.revisions[0].commandId='wrong-command';
 const bad=await runWithDataAuthority('local',()=>runSocialContentOrderOutboxScan({dataStore:f.store,authority:'local',recover:async()=>{throw Error('must_not_dispatch');}}));
 assert.equal(bad.pending,0);assert.equal(bad.skipped,1);
});

test('projection retries root and registered revision after ACK, skips released/drafts and isolates failures',async()=>{
 const row=pool() as any;row.payload.outbox[0].state='acknowledged';
 row.payload.orders.content.state='delivered';row.payload.orders.content.revisions=[
  {executionTaskId:'child',lineageHash:'a'.repeat(64),commandId:'revision-start'},
  {executionTaskId:'child',lineageHash:'b'.repeat(64),commandId:'second-revision'},
 ];
 const released=pool('released') as any;released.payload.orders.content.state='released';
 const planned=pool('planned') as any;planned.payload.orders.content.state='planned';
 const f=fixture([row,released,planned]),seen:string[]=[];
 const result=await runWithDataAuthority('local',()=>runSocialContentOrderProjectionScan({dataStore:f.store,authority:'local',project:async item=>{
  assert.equal(currentDataAuthority(),'local');seen.push(item.taskId);if(item.taskId==='child')throw Error('unknown_delivery_receipt');
 }}));
 assert.deepEqual(seen.sort(),['child','content']);assert.deepEqual(result,{checked:2,reconciled:1,blocked:1,skipped:0});
 assert.equal(f.writes(),0,'projection scan itself never marks any content delivered');
});
