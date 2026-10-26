import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialDirectorBriefScene} from '../../shared/contracts/socialContentAgentContract.js';
import type {SocialReferenceVideoAnalysis} from '../../shared/contracts/socialContentReplication.js';
import {paidProductionHash,type FrozenPresenterGroup} from './socialContentPaidOperationPlan.js';
import {buildSocialPresenterSceneSources,buildSocialPresenterMotherSceneSources,originalPresenterSceneContract} from './socialContentPresenterSceneSource.js';
import {socialRequestHash} from './socialContentValidation.js';
const scene={sceneId:'scene',referenceShotId:null,targetVisual:'A presenter in a bright workshop',action:{startState:'standing',path:'gestures',endState:'standing'},shotLanguage:{shotSize:'medium',cameraAngle:'eye-level',movement:'static',composition:'centered'},duration:{startSeconds:0,endSeconds:4,targetSeconds:4}} as SocialDirectorBriefScene;
const group:FrozenPresenterGroup={groupId:'group',shotIds:['scene'],durationSeconds:4,spokenText:'Hello',presenterAssetId:'presenter',contractHash:'frozen',sceneSourceKind:'original_scene',sceneSourceContractHash:paidProductionHash(originalPresenterSceneContract(scene,'9:16'))};
const build=(director=scene,frozen=group,reference?:SocialReferenceVideoAnalysis)=>buildSocialPresenterSceneSources({groups:[frozen],directorScenes:[director],reference,aspectRatio:'9:16'})[0]!.compositions[0]!;
test('original authored direction freezes source and prompt without synthetic reference facts',()=>{
 const result=build();assert.equal(result.source.kind,'original_scene');
 assert.equal(result.source.kind==='original_scene'&&result.source.sceneContractHash,group.sceneSourceContractHash);
 if(result.source.kind==='original_scene'&&'prompt' in result){assert.equal(result.source.promptHash,socialRequestHash(result.prompt));assert.deepEqual(result.sceneContract.action,scene.action);}
 assert.equal('referenceFirstFrameUrl' in result,false);assert.equal('referenceShotId' in result,false);
 assert.equal(JSON.stringify(result).includes('spokenText'),false);
 assert.deepEqual(build(),result);
});
test('original visual, action, duration, or aspect drift cannot reuse frozen source',()=>{
 for(const update of [{targetVisual:'different'}, {action:{...scene.action,path:'walk'}},{duration:{...scene.duration,targetSeconds:5}}])assert.throws(()=>build({...scene,...update}),/contract_changed/);
 assert.throws(()=>buildSocialPresenterSceneSources({groups:[group],directorScenes:[scene],reference:null,aspectRatio:'16:9'}),/contract_changed/);
 assert.throws(()=>build(scene,{...group,sceneSourceKind:undefined}),/contract_changed/);
});
test('reference branch preserves existing composition fields and never falls back to original on missing evidence',()=>{
 const director={...scene,referenceShotId:'ref'},frozen={...group,sceneSourceKind:undefined,sceneSourceContractHash:undefined,visualCompatibilityHash:'visual'};
 const reference={shots:[{shotId:'ref',startSeconds:5,endSeconds:9,visualDescription:'reference background',materialEvidence:{firstFrameRef:'/videos/source/frames/1.jpg'},shotLanguage:scene.shotLanguage}]} as SocialReferenceVideoAnalysis;
 assert.deepEqual(build(director,frozen,reference),{source:{kind:'reference_scene'},referenceSourceId:'source',referenceShotId:'ref',startSeconds:5,endSeconds:9,referenceFirstFrameUrl:'/videos/source/frames/1.jpg',background:'reference background',framing:'medium',camera:'eye-level；static',composition:'centered'});
 assert.throws(()=>build(director,frozen),/reference_composition_missing/);
 assert.throws(()=>build(director,group,reference),/reference_composition_missing/);
});

test('original approval source reaches mother handoff through frozen budget group without reference media',()=>{
 const requirement={stage:'presenter_video',presenterGroupId:group.groupId,presenterGroupShotIds:group.shotIds,presenterAssetId:group.presenterAssetId,presenterGroupContractHash:group.contractHash,durationSeconds:4,text:'Hello'} as import('./socialContentPaidOperationPlan.js').PaidStageRequirement;
 const input={groups:[{segmentId:group.groupId,members:[{slotId:'scene'}]}],requirements:[requirement],frozenGroups:[group],directorScenes:[scene],reference:null,aspectRatio:'9:16'};
 const handoff=buildSocialPresenterMotherSceneSources(input)[0]!;
 assert.equal(handoff.presenterGroupContractHash,group.contractHash);
 assert.deepEqual(handoff.compositions,[build()]);
 assert.equal(handoff.compositions[0]!.source.kind,'original_scene');
 assert.equal('referenceFirstFrameUrl' in handoff.compositions[0]!,false);
 assert.throws(()=>buildSocialPresenterMotherSceneSources({...input,frozenGroups:undefined}),/original_scene_contract_changed/);
 assert.throws(()=>buildSocialPresenterMotherSceneSources({...input,frozenGroups:[{...group,contractHash:'different'}]}),/budget_group_changed/);
 assert.throws(()=>buildSocialPresenterMotherSceneSources({...input,groups:[{segmentId:group.groupId,members:[{slotId:'other'}]}]}),/group_requirement_missing/);
});

test('authored source is confirmed as a v3 approval and recovered for the same mother handoff',async()=>{
 const {LangGraphTestStore}=await import('../../scripts/langgraphTestStore.js');
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createOriginalScenePresenterFirstFrameApproval,automaticallyConfirmPresenterFirstFrameApproval,readConfirmedPresenterFirstFrameApproval}=await import('./socialContentPresenterFirstFrameApproval.js');
 const {createOriginalScenePresenterAssetProvenance}=await import('./socialContentPresenterFirstFrameAssetProvenance.js');
 const root=mkdtempSync(join(tmpdir(),'authored-mother-')),store=new LangGraphTestStore(join(root,'db.json'));
 try{
  const composition=build();assert.equal(composition.source.kind,'original_scene');
  if(composition.source.kind!=='original_scene')throw Error('unexpected reference');
  const source={kind:'original_scene' as const,sceneContractHash:composition.source.sceneContractHash,promptHash:composition.source.promptHash};
  const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:socialRequestHash('plan')},time='2026-10-26T00:00:00Z';
  const qa=(id:string)=>({operationId:id,passed:true,receiptRef:id,reportHash:socialRequestHash(id)});
  const background={artifactRef:'/media/tenants/tenant/bg.png',sha256:socialRequestHash('bg'),width:720,height:1280,createdAt:time,operationId:'bg',receiptRef:'bg',qa:qa('bg-qa')};
  const composite={...background,artifactRef:'/media/tenants/tenant/composite.png',sha256:socialRequestHash('composite'),plateSha256:background.sha256,operationId:'composite',receiptRef:'composite',qa:qa('composite-qa'),presenterAssetId:group.presenterAssetId,presenterAssetVersion:1};
  const originalScene={schemaVersion:'presenter-background-first.v3' as const,aspectRatio:'9:16' as const,source,background,composite};
  const approval=await createOriginalScenePresenterFirstFrameApproval(store,{...scope,groupId:group.groupId,presenterGroupContractHash:socialRequestHash(group),sourceMode:'original_scene',targetAspectRatio:'9:16',referenceCompositionHashes:[],backgroundPlateSha256:background.sha256,originalScene,
   originalSceneProvenance:createOriginalScenePresenterAssetProvenance({source,presenter:{assetId:group.presenterAssetId,assetVersion:1,referenceAssetIds:['portrait'],referenceSha256s:[socialRequestHash('portrait')]},products:[]}),
   presenter:{assetId:group.presenterAssetId,assetVersion:1,authorizationRef:'rights',consentRef:'consent',providerId:'heygen',providerPresenterId:'avatar',providerVoiceId:'voice'},compositeFirstFrameSha256:composite.sha256,compositeFirstFrameUrl:composite.artifactRef,qa:{passed:true,receiptRef:composite.qa.receiptRef,reportHash:composite.qa.reportHash},createdAt:time});
  await automaticallyConfirmPresenterFirstFrameApproval(store,{scope,groupId:group.groupId,expectedRecordHash:approval.recordHash});
  const recovered=await readConfirmedPresenterFirstFrameApproval(store,{scope,groupId:group.groupId,presenterGroupContractHash:approval.presenterGroupContractHash,presenterAssetId:group.presenterAssetId});
  assert.equal(recovered?.approval.schemaVersion,'social-presenter-first-frame-approval.v3');assert.equal(recovered?.approval.personRemovalEvidence,undefined);
  assert.equal(JSON.stringify(recovered?.approval).includes('referenceFirstFrameUrl'),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
