import test from 'node:test';
import assert from 'node:assert/strict';
import {freezePresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import type {SocialDirectorBriefScene} from '../../shared/contracts/socialContentAgentContract.js';
import type {SocialContentAutoProductionRuntime} from './socialContentProductionExecution.js';
import {createSocialProductionFirstFramePreparation} from './socialContentProductionFirstFramePreparation.js';
import {originalPresenterSceneContract} from './socialContentPresenterSceneSource.js';
import {paidProductionHash,type FrozenPresenterGroup} from './socialContentPaidOperationPlan.js';
import {projectMeasuredDirectorScenes} from './socialContentMeasuredSupplyTimeline.js';

const originalScene={sceneId:'slot',referenceShotId:null,targetVisual:'Presenter in workshop',
 action:{startState:'standing',path:'speaking',endState:'standing'},
 shotLanguage:{shotSize:'medium',cameraAngle:'eye-level',movement:'static',composition:'centered'},
 duration:{startSeconds:0,endSeconds:2,targetSeconds:2}} as SocialDirectorBriefScene;
const measuredScenes=projectMeasuredDirectorScenes({scenes:[originalScene],timeline:[{shotId:'slot',start:0,end:4}] as never});
const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)};
const frozenGroup:FrozenPresenterGroup={groupId:'group',shotIds:['slot'],durationSeconds:4,spokenText:'Hello.',
 presenterAssetId:'person',contractHash:'group-contract',sceneSourceKind:'original_scene',
 sceneSourceContractHash:paidProductionHash(originalPresenterSceneContract(measuredScenes[0]!,'9:16'))};

test('first-frame preparation uses measured quote scenes for grouping and authored scene source',async()=>{
 let called=0,asserted=0;
 const expectedGrouping=freezePresenterMotherSegments({taskId:'task',referenceAnalysisHash:paidProductionHash(null),slots:[{
  slotId:'slot',referenceShotId:'slot',startSeconds:0,endSeconds:4,spokenText:'Hello.',materialType:'talking_head',frontFacing:true,lipSyncRequired:true}]});
 const prepare=createSocialProductionFirstFramePreparation({
  execution:{tenantId:'tenant',taskId:'task',repository:{},runtime:{preparePresenterMotherFirstFrames:async (input:Parameters<NonNullable<SocialContentAutoProductionRuntime['preparePresenterMotherFirstFrames']>>[0])=>{
   called++;assert.equal(input.grouping.groups[0]!.durationSeconds,4);
   assert.deepEqual(input.grouping.groups[0]!.memberSlotIds,['slot']);
   assert.equal(input.grouping.recordHash,expectedGrouping.recordHash);
   assert.equal(input.groups[0]!.presenterGroupContractHash,frozenGroup.contractHash);
   const composition=input.groups[0]!.compositions[0]!;
   assert.ok(composition.source);assert.equal(composition.source.kind,'original_scene');
   if('sceneContract' in composition)assert.equal(composition.sceneContract.duration.targetSeconds,4);
   else assert.fail('authored scene contract missing');
   throw Error('controlled_static_boundary_reached');
  }}} as never,
  detail:{brief:{aspectRatio:'9:16'},referenceVideoAnalysis:null} as never,
  baseline:{scenes:[{sceneId:'slot',voiceover:'Hello.'}]} as never,supplyPlan:null,
  directorScenes:()=>[originalScene],assertNewSubmit:async()=>{asserted++;},
 });
 await assert.rejects(prepare({scope,groups:[frozenGroup],requirements:[],intents:[],paidPermit:{} as never,directorScenes:measuredScenes}),/controlled_static_boundary_reached/);
 assert.equal(called,1);assert.equal(asserted,1);
});

test('old authored source hash cannot reach supplier after timing projection; empty first stage is inert',async()=>{
 let supplier=0,authority=0;
 const prepare=createSocialProductionFirstFramePreparation({execution:{tenantId:'tenant',taskId:'task',repository:{},runtime:{
  preparePresenterMotherFirstFrames:async()=>{supplier++;throw Error('unexpected supplier');}}} as never,
  detail:{brief:{aspectRatio:'9:16'},referenceVideoAnalysis:null} as never,
  baseline:{scenes:[{sceneId:'slot',voiceover:'Hello.'}]} as never,supplyPlan:null,
  directorScenes:()=>[originalScene],assertNewSubmit:async()=>{authority++;},
 });
 const shared={scope,requirements:[],intents:[],paidPermit:{} as never,directorScenes:measuredScenes};
 await prepare({...shared,groups:[]});assert.equal(supplier,0);assert.equal(authority,0);
 await assert.rejects(prepare({...shared,groups:[{...frozenGroup,sceneSourceContractHash:paidProductionHash(originalPresenterSceneContract(originalScene,'9:16'))}]}),/contract_changed/);
 assert.equal(supplier,0);assert.equal(authority,0);
});
