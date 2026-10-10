import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyInventoryG6Fixture} from '../runtime/weeklyInventoryG6.fixture.js';
import {executeWeeklyPublication,reconcileWeeklyPublication,type WeeklyPublishingProviderAdapter} from './weeklyLineage.js';
function signal(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
function response<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const published={status:'published' as const,providerReceiptId:'actual-controlled-race-receipt',platformPostId:'actual-controlled-race-post'};

test('late unknown lookup cannot overwrite the original provider callback confirmed publication',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-07T10:00:00Z')});
 const f=await prepareWeeklyInventoryG6Fixture();t.after(f.cleanup);t.mock.timers.setTime(new Date('2026-10-07T13:00:00Z').getTime());let posts=0,lookups=0;
 const publishingStarted=signal(),lookupStarted=signal(),callback=response<Awaited<ReturnType<WeeklyPublishingProviderAdapter['publish']>>>(),lookup=response<Awaited<ReturnType<WeeklyPublishingProviderAdapter['reconcile']>>>();
 const adapter:WeeklyPublishingProviderAdapter={provider:'controlled-race-provider',platform:'tiktok',capability:'available',async publish(){posts++;publishingStarted.resolve();return callback.promise;},async reconcile(){lookups++;lookupStarted.resolve();return lookup.promise;}};
 const input={assignment:f.assignment.payload,publicationPackage:f.actualPackage,dataStore:f.store,adapter};
 const publish=executeWeeklyPublication({...input,contentPackage:(await f.store.list<{payload:typeof f.next}>('social_weekly_operating_packages',{where:{tenant_id:'t',package_id:'week2',version:2},perPage:2})).items[0]!.payload.socialContentPackage,existingPublishedCount:0});
 await publishingStarted.promise;const reconcile=reconcileWeeklyPublication(input);await lookupStarted.promise;
 callback.resolve(published);const success=await publish;assert.equal(success.status,'published');
 lookup.resolve({status:'unknown',providerReceiptId:'older-uncertain-receipt'});const stale=await reconcile;assert.equal(stale.status,'published');assert.equal(stale.provider_receipt_id,published.providerReceiptId);assert.equal(stale.platform_post_id,published.platformPostId);
 const stored=await f.store.list<{status:string;provider_receipt_id:string}>('social_publication_attempts',{where:{tenant_id:'t',assignment_id:f.assignment.assignment_id},perPage:2});assert.equal(stored.totalItems,1);assert.equal(stored.items[0]!.status,'published');assert.equal(stored.items[0]!.provider_receipt_id,published.providerReceiptId);
 assert.equal(posts,1);assert.equal(lookups,1);const replay=await reconcileWeeklyPublication(input);assert.equal(replay.status,'published');assert.equal(posts,1);assert.equal(lookups,1);
});

test('parallel status-only reconciliation keeps published terminal against a later unknown result with zero additional submissions',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-07T10:00:00Z')});
 const f=await prepareWeeklyInventoryG6Fixture();t.after(f.cleanup);t.mock.timers.setTime(new Date('2026-10-07T13:00:00Z').getTime());let posts=0,lookups=0;
 const firstStarted=signal(),secondStarted=signal(),first=response<Awaited<ReturnType<WeeklyPublishingProviderAdapter['reconcile']>>>(),second=response<Awaited<ReturnType<WeeklyPublishingProviderAdapter['reconcile']>>>();
 const adapter:WeeklyPublishingProviderAdapter={provider:'controlled-parallel-provider',platform:'tiktok',capability:'available',async publish(){posts++;return {status:'unknown',providerReceiptId:'actual-original-uncertain-receipt'};},async reconcile(){lookups++;if(lookups===1){firstStarted.resolve();return first.promise;}secondStarted.resolve();return second.promise;}};
 const input={assignment:f.assignment.payload,publicationPackage:f.actualPackage,dataStore:f.store,adapter};
 const actual=(await f.store.list<{payload:typeof f.next}>('social_weekly_operating_packages',{where:{tenant_id:'t',package_id:'week2',version:2},perPage:2})).items[0]!.payload;
 assert.equal((await executeWeeklyPublication({...input,contentPackage:actual.socialContentPackage,existingPublishedCount:0})).status,'unknown');
 const a=reconcileWeeklyPublication(input);await firstStarted.promise;const b=reconcileWeeklyPublication(input);await secondStarted.promise;
 first.resolve(published);assert.equal((await a).status,'published');second.resolve({status:'unknown',failureCode:'provider_status_not_yet_available'});const late=await b;assert.equal(late.status,'published');assert.equal(late.platform_post_id,published.platformPostId);
 assert.equal(posts,1);assert.equal(lookups,2);assert.equal(f.tables.social_publication_attempts!.length,1);assert.equal(f.tables.social_publication_attempts![0]!.status,'published');
 assert.equal((await executeWeeklyPublication({...input,contentPackage:actual.socialContentPackage,existingPublishedCount:0})).status,'published');assert.equal(posts,1);
});
