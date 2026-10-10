import test from 'node:test';
import assert from 'node:assert/strict';
import type {Record_} from '../storage/datastore.js';
import {executeFiveMotherWeek} from './weeklyFiveMotherExecution.fixture.js';
import {publishFiveMotherWeek} from './weeklyFiveMotherPublishing.fixture.js';
import {finishFiveMotherReview,recordFiveMotherMetrics} from './weeklyFiveMotherReview.fixture.js';
import {executeWeeklyPublication,reconcileWeeklyPublication,revokePublicationAssignments,type StoredPublicationAssignment} from '../publishing/weeklyLineage.js';
import {readStarterPublicationPackage} from '../publishing/starterPublicationPackage.js';
import {validateWeeklyHistoricalPublication} from './weeklyHistoricalPublicationEvidence.js';
import {validateWeeklyExecutionResults} from './socialWeeklyResultValidation.js';
import {buildFrozenWeeklyReview} from '../socialReview/service.js';
import {collectWeeklyReviewInput,runWeeklyReviewForPackage} from '../socialReview/weeklyReviewWorker.js';

/** Local controlled providers, real source/render bytes and formal persisted
 * worker evidence. Narrower quota is a low-level admission pressure contract;
 * the actual weekly factory retains its frozen authorization of five. */
test('actual five-mother publishing competes for the last slot and freezes delayed review evidence',async t=>{
 const f=await executeFiveMotherWeek(t,0),store=f.f.store;
 let pressureChecked=false;
 const publication=await publishFiveMotherWeek(t,{store,repository:f.repository,pkg:f.pkg,now:f.now,beforePublishing:async({published,publicationTaskId,provider,now})=>{
  if(published!==3||pressureChecked)return;pressureChecked=true;
  const rows=await store.list<StoredPublicationAssignment>('social_publication_assignments',{where:{tenant_id:'t',operating_package_id:f.pkg.packageId,operating_package_version:f.pkg.version},perPage:100});
  const prior=await store.list<Record_>('social_publication_attempts',{where:{tenant_id:'t'},perPage:100});
  const remaining=rows.items.filter(row=>!prior.items.some(a=>a.assignment_id===row.assignment_id));assert.equal(remaining.length,2);remaining.sort((a,b)=>Number(b.publication_task_id===publicationTaskId)-Number(a.publication_task_id===publicationTaskId));assert.equal(remaining[0]!.publication_task_id,publicationTaskId);
  const narrowed=structuredClone(f.pkg.socialContentPackage);assert.equal(narrowed.authorization.maxPublishItems,5);narrowed.authorization.maxPublishItems=4;
  const inputs=await Promise.all(remaining.map(async row=>{const manifest=await readStarterPublicationPackage('t',row.package_id,store);assert.ok(manifest);return{assignment:row.payload,publicationPackage:manifest,contentPackage:narrowed,existingPublishedCount:0,now,dataStore:store};}));
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>{enter=r;}),gate=new Promise<void>(r=>{release=r;});let calls=0;
  const delayed={...provider,async publish(input:Parameters<typeof provider.publish>[0]){calls++;enter();await gate;const actual=await provider.publish(input);assert.equal(actual.status,'published');assert.ok(actual.providerReceiptId);return{status:'accepted' as const,providerReceiptId:actual.providerReceiptId};}};
  const first=executeWeeklyPublication({...inputs[0]!,adapter:delayed});await entered;
  try{
   const retry=await executeWeeklyPublication({...inputs[0]!,adapter:delayed});assert.equal(retry.status,'in_flight');assert.equal(calls,1);
   await assert.rejects(executeWeeklyPublication({...inputs[1]!,adapter:provider}),/authorization_limit_exceeded/);
   const durable=await store.list<Record_>('social_publication_attempts',{where:{tenant_id:'t'},perPage:100});assert.equal(durable.totalItems,4);assert.equal(durable.items.filter(a=>a.status==='in_flight').length,1);
  }finally{release();}
  const unknown=await first;assert.equal(unknown.status,'unknown');assert.equal(calls,1);assert.ok(unknown.provider_receipt_id);
  assert.equal((await executeWeeklyPublication({...inputs[0]!,adapter:delayed})).attempt_id,unknown.attempt_id);assert.equal(calls,1);
  await assert.rejects(executeWeeklyPublication({...inputs[1]!,adapter:provider}),/authorization_limit_exceeded/);
  const recovered=await reconcileWeeklyPublication({...inputs[0]!,adapter:provider});assert.equal(recovered.status,'published');assert.equal(recovered.attempt_id,unknown.attempt_id);assert.equal(recovered.provider_receipt_id,unknown.provider_receipt_id);assert.equal(calls,1);
  await assert.rejects(executeWeeklyPublication({...inputs[1]!,adapter:provider}),/authorization_limit_exceeded/);
 }});
 assert.ok(pressureChecked);assert.equal(publication.posts,5);assert.equal(publication.published,5);assert.equal(publication.lookups,1);
 const historyTask=publication.graph.find(task=>task.schedule.stepKind==='publishing');assert.ok(historyTask);const historyRef=historyTask.resultRefs.find(ref=>ref.type==='weekly_publication_attempt');assert.ok(historyRef);
 await validateWeeklyHistoricalPublication(store,historyTask,historyRef,publication.now);
 await revokePublicationAssignments({tenantId:'t',operatingPackageId:f.pkg.packageId,operatingPackageVersion:f.pkg.version,revokedBy:'owner',dataStore:store});
 await validateWeeklyHistoricalPublication(store,historyTask,historyRef,publication.now);
 await assert.rejects(validateWeeklyExecutionResults(store,historyTask,[historyRef],publication.now));
 const actualAttempt=f.f.tables.social_publication_attempts!.find(row=>row.attempt_id===historyRef.id);assert.ok(actualAttempt);
 for(const [key,value] of [['status','unknown'],['provider_receipt_id',''],['tenant_id','foreign']] as const){const original=actualAttempt[key];actualAttempt[key]=value;try{await assert.rejects(validateWeeklyHistoricalPublication(store,historyTask,historyRef,publication.now));}finally{actualAttempt[key]=original;}}
 const actualAssignment=f.f.tables.social_publication_assignments!.find(row=>row.assignment_id===actualAttempt.assignment_id);assert.ok(actualAssignment);const originalHash=actualAssignment.assignment_hash;actualAssignment.assignment_hash='f'.repeat(64);try{await assert.rejects(validateWeeklyHistoricalPublication(store,historyTask,historyRef,publication.now));}finally{actualAssignment.assignment_hash=originalHash;}
 const oldRevocation=actualAssignment.authorization_revoked_at;actualAssignment.authorization_revoked_at=new Date(Date.parse(String(actualAttempt.started_at))-1).toISOString();try{await assert.rejects(validateWeeklyHistoricalPublication(store,historyTask,historyRef,publication.now));}finally{actualAssignment.authorization_revoked_at=oldRevocation;}
 const pkgRows=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:'t',package_id:f.pkg.packageId,version:f.pkg.version},perPage:2});assert.equal(pkgRows.totalItems,1);
 const row=pkgRows.items[0]! as Parameters<typeof collectWeeklyReviewInput>[0]['row'];
 const tailNow=new Date('2026-10-26T19:00:00Z');t.mock.timers.setTime(tailNow.getTime());
 const empty=await collectWeeklyReviewInput({dataStore:store,row,actorId:'owner',now:tailNow});assert.ok(empty.sourceScanComplete);assert.equal(empty.contents.length,5);assert.ok(empty.contents.every(c=>c.attributionStatus==='attributed'));assert.ok(empty.contents.every(c=>!empty.metricSnapshots.some(m=>m.contentId===c.contentId&&m.accountId===c.accountId&&m.platform===c.platform)),'unrelated historical observations do not supply current publication metrics');
 const missingPreview=buildFrozenWeeklyReview(empty);assert.ok(missingPreview.contents.every(c=>c.metrics.views?.value===null));
 for(const c of empty.contents)await store.create('social_metric_snapshots',{tenant_id:'t',account_id:c.accountId,platform:c.platform,content_id:c.contentId,captured_at:empty.startsAt,source:'controlled_provider_contract',value_kind:'cumulative',metrics:{views:0,likes:0,shares:0,comments:0}});
 await recordFiveMotherMetrics({store,pkg:f.pkg,tenantId:'t',actorUserId:'owner',now:tailNow});
 const delayed=await collectWeeklyReviewInput({dataStore:store,row,actorId:'owner',now:tailNow});assert.ok(delayed.contents.every(c=>delayed.metricSnapshots.some(m=>m.contentId===c.contentId&&m.metrics.views)));
 const observedPreview=buildFrozenWeeklyReview(delayed);assert.ok(observedPreview.contents.every(c=>Number(c.metrics.views?.value)>0));
 const reviewed=await finishFiveMotherReview({store,pkg:f.pkg,tenantId:'t',actorUserId:'owner',now:tailNow,seedMetrics:false});assert.ok(reviewed.graph.every(task=>task.status==='succeeded'));
 const frozen=await runWeeklyReviewForPackage({dataStore:store,row,actorId:'owner',now:tailNow});assert.equal(frozen.status,'completed');assert.ok(frozen.snapshot);const snapshot=structuredClone(frozen.snapshot);
 // Arriving after freeze, including an observation timestamp inside the window,
 // cannot rewrite the immutable snapshot or promotion evidence.
 await store.create('social_metric_snapshots',{tenant_id:'t',account_id:'account',platform:'tiktok',content_id:delayed.contents[0]!.contentId,captured_at:`${f.pkg.weekEnd}T23:30:00Z`,source:'controlled_provider_contract',value_kind:'cumulative',metrics:{views:999999,likes:9999,shares:9999,comments:9999}});
 const repeat=await runWeeklyReviewForPackage({dataStore:store,row,actorId:'owner',now:new Date(tailNow.getTime()+86400000)});assert.equal(repeat.repeated,true);assert.deepEqual(repeat.snapshot,snapshot);assert.deepEqual(repeat.quota,frozen.quota);
 const {assertFiveMotherReviewRevision}=await import('./weeklyFiveMotherReviewRevision.fixture.js');
 const revision=await assertFiveMotherReviewRevision({store,pkg:f.pkg,now:tailNow});assert.ok(revision.carriedVersion>revision.appliedVersion);
 console.log('STAGE2_FORMAL_PUBLICATION_PRESSURE',JSON.stringify({actualPublished:publication.published,transportCalls:publication.posts,narrowedAdmissionQuota:4,actualAuthorizationQuota:5,reviewSnapshotId:snapshot.snapshotId,limitations:['Controlled local providers; no external publication.']}));
});
