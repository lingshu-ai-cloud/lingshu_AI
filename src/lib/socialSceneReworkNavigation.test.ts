import {test} from 'node:test';import assert from 'node:assert/strict';import {frozenSceneSlotId} from './socialSceneReworkNavigation';import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentWorkflow';
const task={replicationScript:{shots:[{shotId:'s3',referenceShotId:'r3',startSeconds:4,endSeconds:6,materialPlan:{shotId:'s3'}}]},referenceVideoAnalysis:{shots:[{shotId:'r3',startSeconds:4,endSeconds:6}]}} as unknown as SocialContentTaskDetail;
const scene={sceneId:'s3',shotId:'s3',referenceShotId:'r3',sourceTiming:{startSeconds:4,endSeconds:6,durationSeconds:2},status:'failed' as const,technicalReceiptId:'receipt'};
test('exact actual scene/ref/time maps unique source slot independent of ordinal',()=>{assert.equal(frozenSceneSlotId(task,scene,[{id:'arbitrary-slot',start:4,end:6}]),'arbitrary-slot');assert.equal(frozenSceneSlotId(task,{...scene,referenceShotId:'other'},[{id:'slot-3',start:4,end:6}]),null);assert.equal(frozenSceneSlotId(task,scene,[{id:'slot-3',start:4.1,end:6}]),null);assert.equal(frozenSceneSlotId(task,scene,[{id:'one',start:4,end:6},{id:'two',start:4,end:6}]),null);});
test('ambiguous source/reference identities and duplicate slot ids cannot select another shot',()=>{
 const slots=[{id:'real',start:4,end:6}];
 assert.equal(frozenSceneSlotId({...task,replicationScript:{...task.replicationScript!,shots:[...task.replicationScript!.shots,...task.replicationScript!.shots]}},scene,slots),null);
 assert.equal(frozenSceneSlotId({...task,referenceVideoAnalysis:{...task.referenceVideoAnalysis!,shots:[...task.referenceVideoAnalysis!.shots,...task.referenceVideoAnalysis!.shots]}},scene,slots),null);
 assert.equal(frozenSceneSlotId(task,scene,[...slots,{id:'real',start:8,end:10}]),null);
 assert.equal(frozenSceneSlotId(task,{...scene,sourceTiming:null},slots),null);
});

test('verified production slot identity wins over equal-length ordinal parser slots and rejects drift',async()=>{
 const {workspaceNavigationFixture}=await import('./productionWorkspaceNavigation.fixture');
 const {verifiedProductionSlots,verifyProductionSnapshotHash,productionWorkspaceHash}=await import('./socialSceneReworkNavigation');
 const fixture=workspaceNavigationFixture({tenantId:'tenant',taskId:'task',runId:'run',artifactId:'artifact',projectId:'project',sceneIds:['scene-actual-3','scene-actual-4']});
 const availability:any={tenantId:'tenant',taskId:'task',sourceRunId:'run',parentArtifactId:'artifact',productionWorkspaceBinding:fixture.binding};
 assert.deepEqual(verifiedProductionSlots(availability,fixture.project).map(s=>s.id),['scene-actual-3','scene-actual-4']);
 const {socialProductionWorkspace,...spec}=fixture.project.spec;
 fixture.binding.specHash=await productionWorkspaceHash(spec);
 const {recordHash,...payload}=fixture.binding;fixture.binding.recordHash=await productionWorkspaceHash(payload);
 await verifyProductionSnapshotHash(availability,fixture.project);
 fixture.project.spec.extra='changed after verification';
 await assert.rejects(verifyProductionSnapshotHash(availability,fixture.project),/哈希/);
 delete fixture.project.spec.extra;
 fixture.project.spec.shootingSlots=[{id:'slot-1',slotId:'slot-1'},{id:'slot-2',slotId:'slot-2'}];
 assert.throws(()=>verifiedProductionSlots(availability,fixture.project),/拍摄槽身份/);
 assert.throws(()=>verifiedProductionSlots({...availability,productionWorkspaceBinding:null},fixture.project),/血缘/);
});
