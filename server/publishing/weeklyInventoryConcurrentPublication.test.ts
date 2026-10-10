import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyInventoryG6Fixture} from '../runtime/weeklyInventoryG6.fixture.js';
import {executeWeeklyPublication,type WeeklyPublishingProviderAdapter} from './weeklyLineage.js';

test('cross-week inventory assignments reserve the same source/account before effect, including unknown outcomes',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-07T10:00:00Z')});
 const f=await prepareWeeklyInventoryG6Fixture();t.after(f.cleanup);
 t.mock.timers.setTime(new Date('2026-10-07T13:00:00Z').getTime());
 const actual=(await f.store.list<{payload:typeof f.next}>('social_weekly_operating_packages',{where:{tenant_id:'t',package_id:'week2',version:2},perPage:2})).items[0]!.payload;
 const content=structuredClone(actual.socialContentPackage);content.authorization.maxPublishItems=10;
 const second=structuredClone(f.assignment.payload);second.assignmentId+='-other-week';second.packageId+='-other';second.lineage.operatingPackageRef.id+='-other-week';
 const package2=structuredClone(f.actualPackage);package2.packageId=second.packageId;
 package2.operatingLineage={...second.lineage,assignmentId:second.assignmentId,assignmentHash:second.assignmentHash};
 f.tables.social_publication_assignments!.push({...structuredClone(f.assignment),id:'other-week-assignment',assignment_id:second.assignmentId,package_id:second.packageId,operating_package_id:second.lineage.operatingPackageRef.id,payload:second});
 let posts=0;let release!:()=>void;let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});const pending=new Promise<void>(resolve=>{release=resolve;});
 const adapter:WeeklyPublishingProviderAdapter={provider:'controlled',platform:'tiktok',capability:'available',async publish(){posts++;entered();await pending;return {status:'unknown'};},async reconcile(){return {status:'unknown'};}};
 const firstInput={assignment:f.assignment.payload,publicationPackage:f.actualPackage,contentPackage:content,adapter,dataStore:f.store,existingPublishedCount:0};
 const secondInput={...firstInput,assignment:second,publicationPackage:package2};
 const first=executeWeeklyPublication(firstInput);await started;
 await assert.rejects(executeWeeklyPublication(secondInput),/inventory_same_account_publication_exists/);
 assert.equal(posts,1);release();assert.equal((await first).status,'unknown');
 await assert.rejects(executeWeeklyPublication(secondInput),/inventory_same_account_publication_exists/);
 assert.equal(posts,1);assert.equal(f.tables.social_publication_attempts!.length,1);
 assert.equal((await executeWeeklyPublication(firstInput)).status,'unknown');assert.equal(posts,1);
 const crossWeek=second.lineage.operatingPackageRef.id;second.lineage.operatingPackageRef.id=f.assignment.payload.lineage.operatingPackageRef.id;
 await assert.rejects(executeWeeklyPublication(secondInput),/inventory_same_account_publication_exists/);assert.equal(posts,1);
 second.lineage.operatingPackageRef.id=crossWeek;
 // A distinct production version is not the previously reserved inventory.
 second.lineage.productionResultRef.version++;
 package2.operatingLineage!.productionResultRef.version=second.lineage.productionResultRef.version;
 f.tables.social_publication_assignments!.find(row=>row.assignment_id===second.assignmentId)!.payload=structuredClone(second);
 assert.equal((await executeWeeklyPublication(secondInput)).status,'unknown');assert.equal(posts,2);
 // A different account has its own source reservation and is not deduplicated away.
 const other=structuredClone(second);other.assignmentId+='-account';other.packageId+='-account';other.accountId='other-account';
 const otherPackage=structuredClone(package2);otherPackage.packageId=other.packageId;otherPackage.operatingLineage!.assignmentId=other.assignmentId;
 const otherContent=structuredClone(content);otherContent.authorization.accountIds.push(other.accountId);otherContent.publicationTasks.find(task=>task.publicationTaskId===other.publicationTaskId)!.accountId=other.accountId;
 f.tables.social_publication_assignments!.push({...structuredClone(f.assignment),id:'other-account',assignment_id:other.assignmentId,package_id:other.packageId,account_id:other.accountId,operating_package_id:other.lineage.operatingPackageRef.id,payload:other});
 assert.equal((await executeWeeklyPublication({...firstInput,assignment:other,publicationPackage:otherPackage,contentPackage:otherContent})).status,'unknown');assert.equal(posts,3);
});
