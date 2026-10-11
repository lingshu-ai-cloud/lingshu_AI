import test from 'node:test';
import assert from 'node:assert/strict';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import type {Record_} from '../storage/datastore.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {prepareWeeklyQualityRecoveryFixture} from '../socialPrograms/weeklyContentQualityRecovery.fixture.js';
import {persistWeeklyCreativeRepairStageEvidence,validateWeeklyCreativeRepairStageEvidence,WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE} from './weeklyCreativeRepairExecutionAdapter.js';

function task(base:WeeklyExecutionTask,id:string,step:'material_preparation'|'script',predecessor?:string):WeeklyExecutionTask{
 const body={schemaVersion:'weekly-creative-repair-execution-lineage.v1',caseId:'repair-case',caseRequestHash:socialRequestHash('case'),configurationHash:socialRequestHash('configuration'),authorityHash:socialRequestHash('authority'),childTaskId:'repair-child',childBindingKey:'repair-child-binding',originalPublicationTaskId:'original-publication'};
 return {...base,taskId:id,subjectId:'repair-child',publicationTaskId:'creative-repair:repair-case',dependsOnTaskIds:predecessor?[predecessor]:[],inputSnapshot:{creativeRepairExecution:{...body,recordHash:socialRequestHash(body)}},schedule:{...base.schedule,stepKind:step}};
}
test('lease-loss retries reuse original persisted creative-stage evidence; changed observations never overwrite it',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);const current=task(f.task,'stage-original','material_preparation');let assertions=0;
 const input={store:f.store,task:current,observationHash:socialRequestHash('verified physical material'),previousEvidenceHash:null,assertAdmission:async()=>{assertions++;}};
 const refs=await persistWeeklyCreativeRepairStageEvidence({...input,now:new Date('2026-10-10T01:00:00Z')});
 const original=structuredClone(f.tables[WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE]![0]!);
 assert.deepEqual(await persistWeeklyCreativeRepairStageEvidence({...input,now:new Date('2026-10-11T05:00:00Z')}),refs);
 assert.equal(assertions,2);assert.equal(f.tables[WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE]!.length,1);assert.deepEqual(f.tables[WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE]![0],original);
 await validateWeeklyCreativeRepairStageEvidence(f.store,current,refs);
 await assert.rejects(persistWeeklyCreativeRepairStageEvidence({...input,observationHash:socialRequestHash('different material'),now:new Date('2026-10-12T00:00:00Z')}),/evidence_changed/);
 assert.deepEqual(f.tables[WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE]![0],original);
});
test('full stored stage identity and predecessor hash are checked even when forged payload is self-consistently hashed',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);const first=task(f.task,'first','material_preparation'),next=task(f.task,'next','script','first');const persist=(stage:WeeklyExecutionTask,previousEvidenceHash:string|null)=>persistWeeklyCreativeRepairStageEvidence({store:f.store,task:stage,previousEvidenceHash,observationHash:socialRequestHash(stage.taskId),now:new Date('2026-10-10T01:00:00Z'),assertAdmission:async()=>{}});
 await persist(first,null);const predecessor=f.tables[WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE]![0]!;const refs=await persist(next,String(predecessor.content_hash));await validateWeeklyCreativeRepairStageEvidence(f.store,next,refs);
 const row=f.tables[WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE]![1]!,original=structuredClone(row);
 for(const change of [{tenantId:'foreign'},{taskId:'other'},{caseId:'other'},{previousEvidenceHash:socialRequestHash('unrelated predecessor')},{createdAt:'invalid'}]){
  const payload:Record<string,unknown>={...(original.payload as Record<string,unknown>),...change};const {recordHash:_prior,...body}=payload;row.payload={...body,recordHash:socialRequestHash(body)};row.content_hash=socialRequestHash(body);
  await assert.rejects(validateWeeklyCreativeRepairStageEvidence(f.store,next,refs),/evidence_(invalid|changed)/);
 }
 Object.assign(row,original);const predecessorOriginal=structuredClone(predecessor);predecessor.content_hash=socialRequestHash('corrupt predecessor');await assert.rejects(validateWeeklyCreativeRepairStageEvidence(f.store,next,refs),/evidence_invalid/);Object.assign(predecessor,predecessorOriginal);
 f.tables[WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE]=[row];await assert.rejects(validateWeeklyCreativeRepairStageEvidence(f.store,next,refs),/predecessor_missing/);
 await assert.rejects(validateWeeklyCreativeRepairStageEvidence(f.store,{...next,tenantId:'foreign'},refs),/evidence_invalid/);
});

test('storage create with an unknown response reuses only the identical persisted winner without retrying create',async t=>{
 const f=await prepareWeeklyQualityRecoveryFixture();t.after(f.cleanup);const current=task(f.task,'raced-original','material_preparation');const actualCreate=f.store.create.bind(f.store);let writes=0;
 f.store.create=async(collection,data)=>{writes++;await actualCreate(collection,data);throw Error('response lost after durable write');};
 const refs=await persistWeeklyCreativeRepairStageEvidence({store:f.store,task:current,observationHash:socialRequestHash('actual material'),previousEvidenceHash:null,now:new Date('2026-10-10T01:00:00Z'),assertAdmission:async()=>{}});
 assert.equal(writes,1);assert.equal(f.tables[WEEKLY_CREATIVE_REPAIR_STAGE_EVIDENCE]!.length,1);await validateWeeklyCreativeRepairStageEvidence(f.store,current,refs);
});
