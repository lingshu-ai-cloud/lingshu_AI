import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWeeklyControlledOriginalRunFixture} from '../runtime/weeklyControlledOriginalRun.fixture.js';
import {assertWeeklyProductionMaterialAdmission} from './socialWeeklyProductionMaterialGate.js';
import {runSocialContentAutoProduction} from './socialContentProductionExecution.js';
import {enqueueSocialContentAutoProduction} from './socialContentProductionQueue.js';

test('controlled preexisting owned run with missing real reference-person evidence cannot admit queue or suppliers',async t=>{
 const {f,created}=await prepareWeeklyControlledOriginalRunFixture(t);let suppliers=0;
 const input={repository:f.repository,tenantId:'t',userId:'owner',taskId:String(created.task_id),runId:String(created.run_id)};
 const pkgRow=f.tables.social_weekly_operating_packages!.find(row=>row.package_id==='week1')!;const originalProgram=pkgRow.program_id;pkgRow.program_id='foreign-program';await assert.rejects(runSocialContentAutoProduction({...input,runtime:{synthesizeVoice:async()=>{suppliers++;throw Error('supplier forbidden');}}}),{code:'weekly_production_material_scope_changed'});pkgRow.program_id=originalProgram;
 const missingPerson=(error:unknown)=>error instanceof Error&&error.message==='reference_person_automatic_analysis_required:replication-reference-shot-1';
 await assert.rejects(assertWeeklyProductionMaterialAdmission(input),missingPerson);
 await assert.rejects(runSocialContentAutoProduction({...input,runtime:{synthesizeVoice:async()=>{suppliers++;throw Error('supplier forbidden');},renderComposite:async()=>{suppliers++;throw Error('render forbidden');}}}),missingPerson);
 await assert.rejects(enqueueSocialContentAutoProduction(input),missingPerson);
 assert.equal(suppliers,0);assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);assert.equal(f.tables.starter_social_content_tasks!.length,1);assert.equal(created.run_id,input.runId);
});
