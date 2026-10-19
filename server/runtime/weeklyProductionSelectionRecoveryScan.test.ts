import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {prepareWeeklyEnterpriseFactFixture,reopenWeeklyEnterpriseFactFixtureStore} from './weeklyEnterpriseFactSupplement.fixture.js';
import {readWeeklyPublicationProductSelectionChoices,issueWeeklyPublicationProductSelections,WEEKLY_PUBLICATION_PRODUCT_SELECTIONS} from '../socialPrograms/weeklyPublicationProductSelection.js';
import {getWeeklyExecutionTaskRow} from '../socialPrograms/executionTasks.js';
import {runWeeklyProductionSelectionRecoveryScan} from './weeklyProductionSelectionRecoveryScan.js';

test('original selection-blocked preparation resumes only after authenticated group issuance, survives restart and preserves other blockers',async t=>{
 const file=join(mkdtempSync(join(tmpdir(),'weekly-selection-recovery-')),'store.json');
 const f=await prepareWeeklyEnterpriseFactFixture(t,{persistentFile:file});
 const pkgRow=(await f.store.list<any>('social_weekly_operating_packages')).items[0]!;
 const base=pkgRow.payload.socialContentPackage.publicationTasks[0];
 const publications=[{...base,publicationTaskId:'pub-1',motherContentId:'mother-1',status:'planned'},{...base,publicationTaskId:'pub-2',motherContentId:'mother-1',status:'planned'}];
 await f.store.update('social_weekly_operating_packages',pkgRow.id,{payload:{...pkgRow.payload,socialContentPackage:{...pkgRow.payload.socialContentPackage,publicationTasks:publications}}});
 const blocked={...f.task,taskId:'preparation-1',publicationTaskId:'pub-1',status:'blocked' as const,ownBlockingReasons:['weekly_production_product_selection_required','independent_hold'],lastError:{code:'weekly_production_product_selection_required',message:'missing selection',retryable:false,occurredAt:new Date().toISOString()},schedule:{...f.task.schedule,stepKind:'material_preparation' as const}} as WeeklyExecutionTask;
 await f.store.create('social_weekly_execution_tasks',{tenant_id:blocked.tenantId,program_id:blocked.programId,package_id:blocked.packageId,package_version:blocked.packageVersion,task_id:blocked.taskId,status:blocked.status,idempotency_key:blocked.idempotencyKey,payload:blocked});
 const scope={tenantId:blocked.tenantId,programId:blocked.programId,packageId:blocked.packageId,packageVersion:blocked.packageVersion};
 const scan=(store= f.store)=>runWeeklyProductionSelectionRecoveryScan({store,scope});
 assert.equal((await scan()).resumed,0);
 const choices=await readWeeklyPublicationProductSelectionChoices(f.store,scope);
 const product=(await f.store.list<any>('tenant_profiles')).items[0]!.profile.products.items[0];
 await issueWeeklyPublicationProductSelections(f.store,scope,'owner',{expectedContextHash:choices.contextHash,productId:product.id,publicationTaskIds:['pub-1','pub-2']});
 const reopened=reopenWeeklyEnterpriseFactFixtureStore(file);
 const recovered=await scan(reopened);
 assert.equal(recovered.resumed,1,JSON.stringify(recovered));
 const original=(await getWeeklyExecutionTaskRow(reopened,blocked.tenantId,blocked.taskId)).payload;
 assert.equal(original.taskId,blocked.taskId);
 assert.equal(original.status,'blocked');
 assert.deepEqual(original.ownBlockingReasons,['independent_hold']);
 assert.equal((await scan(reopened)).resumed,0);
 assert.equal((await reopened.list(WEEKLY_PUBLICATION_PRODUCT_SELECTIONS)).totalItems,2);
});

test('wrong package version and forged selection never reopen original task',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t);
 const task={...f.task,taskId:'preparation-negative',status:'blocked' as const,ownBlockingReasons:['weekly_production_product_selection_required'],schedule:{...f.task.schedule,stepKind:'material_preparation' as const}} as WeeklyExecutionTask;
 await f.store.create('social_weekly_execution_tasks',{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,task_id:task.taskId,status:task.status,idempotency_key:task.idempotencyKey,payload:task});
 await f.store.create(WEEKLY_PUBLICATION_PRODUCT_SELECTIONS,{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion,publication_task_id:task.publicationTaskId,payload:{productId:'forged'},content_hash:'forged'});
 assert.equal((await runWeeklyProductionSelectionRecoveryScan({store:f.store})).resumed,0);
 assert.equal((await runWeeklyProductionSelectionRecoveryScan({store:f.store,scope:{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:2}})).resumed,0);
 assert.equal((await getWeeklyExecutionTaskRow(f.store,task.tenantId,task.taskId)).payload.status,'blocked');
});
