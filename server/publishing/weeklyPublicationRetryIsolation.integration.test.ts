import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyInventoryG6Fixture} from '../runtime/weeklyInventoryG6.fixture.js';
import {executeWeeklyPublication,reconcileWeeklyPublication,type WeeklyPublishingProviderAdapter} from './weeklyLineage.js';

test('transport failure and repeated start requests preserve one attempt through unknown and eventual receipt',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-07T10:00:00Z')});
 const f=await prepareWeeklyInventoryG6Fixture();t.after(f.cleanup);
 t.mock.timers.setTime(new Date('2026-10-07T13:00:00Z').getTime());
 let posts=0,lookups=0;const ids:string[]=[];
 let release!:()=>void,started!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;});
 const entered=new Promise<void>(resolve=>{started=resolve;});
 const adapter:WeeklyPublishingProviderAdapter={provider:'controlled-retry-isolation',platform:'tiktok',capability:'available',
  async publish(input){posts++;ids.push(input.attemptId);started();await held;throw Error('controlled_response_lost_after_effect');},
  async reconcile(input){lookups++;ids.push(input.attempt.attempt_id);return lookups===1?{status:'unknown',failureCode:'controlled_receipt_pending'}:{status:'published',providerReceiptId:'controlled-recovered-receipt',platformPostId:'controlled-recovered-post'};},
 };
 const pkg=(await f.store.list<{payload:typeof f.next}>('social_weekly_operating_packages',{where:{tenant_id:'t',package_id:'week2',version:2},perPage:2})).items[0]!.payload;
 const common={assignment:f.assignment.payload,publicationPackage:f.actualPackage,dataStore:f.store,adapter};
 const input={...common,contentPackage:pkg.socialContentPackage,existingPublishedCount:0};
 const initial=executeWeeklyPublication(input);await entered;
 const inFlight=await Promise.all(Array.from({length:8},()=>executeWeeklyPublication(input)));
 assert.ok(inFlight.every(item=>item.status==='in_flight'));
 assert.equal(new Set(inFlight.map(item=>item.attempt_id)).size,1);assert.equal(posts,1);
 release();const unknown=await initial;assert.equal(unknown.status,'unknown');
 const replay=await Promise.all(Array.from({length:8},()=>executeWeeklyPublication(input)));
 assert.ok(replay.every(item=>item.attempt_id===unknown.attempt_id&&item.status==='unknown'));
 assert.equal(posts,1);assert.equal(lookups,0);
 assert.equal((await reconcileWeeklyPublication(common)).status,'unknown');
 const recovered=await reconcileWeeklyPublication(common);assert.equal(recovered.status,'published');
 assert.equal(recovered.attempt_id,unknown.attempt_id);
 assert.equal((await executeWeeklyPublication(input)).platform_post_id,'controlled-recovered-post');
 assert.equal((await reconcileWeeklyPublication(common)).status,'published');
 assert.equal(posts,1);assert.equal(lookups,2);assert.equal(new Set(ids).size,1);
 assert.equal(f.tables.social_publication_attempts!.length,1);
});
