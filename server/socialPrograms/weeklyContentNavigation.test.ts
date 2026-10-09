import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyQualityRecoveryFixture} from './weeklyContentQualityRecovery.fixture.js';
import {readWeeklyContentNavigation} from './weeklyContentNavigation.js';

test('completed task navigation reads immutable production binding and actual source artifact without progress',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);
 const content=f.tables.starter_social_content_tasks![0]!;const authority=(content.brief as Record<string,unknown>)._weeklyAuthority;assert.ok(authority);
 const task=f.current();task.resultRefs=[{type:'starter_social_content_artifact',id:'artifact',version:1}];task.productionProgress=null;task.status='succeeded';
 const scope={tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,executionTaskId:task.taskId};
 const before=Object.fromEntries(Object.entries(f.tables).map(([key,rows])=>[key,rows?.length]));
 const binding=await readWeeklyContentNavigation(f.store,scope);
 assert.equal(binding.contentTaskId,'content');assert.equal(binding.runId,'run');assert.equal(binding.artifactRef?.id,'artifact');assert.equal(binding.source,'completed_artifact');
 assert.deepEqual(Object.fromEntries(Object.entries(f.tables).map(([key,rows])=>[key,rows?.length])),before);
 await assert.rejects(readWeeklyContentNavigation(f.store,{...scope,programId:'foreign'}));
 const original=content.create_idempotency_key;content.create_idempotency_key='foreign';await assert.rejects(readWeeklyContentNavigation(f.store,scope));content.create_idempotency_key=original;
 const artifact=f.tables.starter_social_content_artifacts![0]!;const hash=artifact.content_hash;artifact.content_hash='0'.repeat(64);await assert.rejects(readWeeklyContentNavigation(f.store,scope));artifact.content_hash=hash;
 const rows=f.tables.starter_social_content_tasks!;rows.push({...content,id:'duplicate-production-binding'});await assert.rejects(readWeeklyContentNavigation(f.store,scope));rows.pop();
 task.inputSnapshot.inventoryReuseRef={type:'weekly_inventory_reuse',id:'x',version:1};await assert.rejects(readWeeklyContentNavigation(f.store,scope),(error:unknown)=>(error as {code?:string}).code==='inventory_navigation_required');
});
