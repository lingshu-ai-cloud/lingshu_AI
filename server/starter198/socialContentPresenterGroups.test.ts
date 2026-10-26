import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialDirectorBriefScene} from '../../shared/contracts/socialContentAgentContract.js';
import type {SocialAssetSupplyPlan,SocialReferenceVideoAnalysis,SocialReferenceShotAnalysis} from '../../shared/contracts/socialContentReplication.js';
import {freezePresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import {freezeSocialPresenterBudgetGroups,presenterVisualCompatibilityHash} from './socialContentPresenterGroups.js';
import type {FrozenPaidProduction} from './socialContentPaidOperationPlan.js';

function reference(shotId:string,background='工厂展示区'):SocialReferenceShotAnalysis{
 return{shotId,startSeconds:0,endSeconds:2,visualDescription:background,shotLanguage:{shotSize:'medium',cameraAngle:'eye-level',movement:'static',composition:'centered'},spokenText:'Line',captionText:null,audioDescription:null,rhythmDescription:'steady',purpose:'value',tags:{sceneTypes:[],subjects:[],subjectRelations:[],cameraLanguage:[],contentFunctions:[],soundTypes:[],onScreenInformation:[],truthRequirements:[],suggestedProductionMethods:[]},fidelityPoints:[],mustDifferPoints:[]} as SocialReferenceShotAnalysis;
}
function fixture(){
 const references=[reference('R1'),reference('R2'),reference('R3','办公室洽谈区')];
 const input={taskId:'task',scenes:references.map((_,index)=>({shotId:`S${index+1}`,durationSeconds:2,spokenText:`Line ${index+1}`,presenterSpeech:'whole_track' as const})) as FrozenPaidProduction['scenes'],directorScenes:references.map((ref,index)=>({sceneId:`S${index+1}`,referenceShotId:ref.shotId,duration:{startSeconds:index*2,endSeconds:(index+1)*2,targetSeconds:2}})) as SocialDirectorBriefScene[],shots:references.map((_,index)=>({shotId:`S${index+1}`,sourceStrategy:'authorized_digital_presenter',sourceRefs:['presenter'],digitalHumanPlan:{presenterAssetIds:['presenter']}})) as SocialAssetSupplyPlan['shots'],reference:{referenceSourceId:'video-1',shots:references} as SocialReferenceVideoAnalysis,aspectRatio:'9:16'};
 return{input,references};
}

test('factory and office require distinct groups, while compatible continuous factory shots share one',()=>{
 const f=fixture(),before=structuredClone(f.input),frozen=freezeSocialPresenterBudgetGroups(f.input);
 assert.deepEqual(frozen.presenterGroups.map(group=>group.shotIds),[['S1','S2'],['S3']]);assert.deepEqual(f.input,before,'grouping must not rewrite canonical input');
 assert.notEqual(frozen.presenterGroups[0]!.visualCompatibilityHash,frozen.presenterGroups[1]!.visualCompatibilityHash);
 const restored=freezePresenterMotherSegments({taskId:f.input.taskId,referenceAnalysisHash:'a'.repeat(64),slots:frozen.scenes.map((scene,index)=>({slotId:scene.shotId,referenceShotId:f.references[index]!.shotId,startSeconds:index*2,endSeconds:(index+1)*2,spokenText:scene.spokenText,materialType:'talking_head',frontFacing:true,lipSyncRequired:true,visualCompatibilityHash:scene.visualCompatibilityHash}))});
 assert.deepEqual(restored.groups.map(group=>group.memberSlotIds),frozen.presenterGroups.map(group=>group.shotIds),'budget groups must be the provider/crop groups');
 assert.equal(restored.schemaVersion,'presenter-mother-segments.v2');
});

test('camera, composition, ratio, presenter and explicit product locks change visual identity',()=>{
 const f=fixture(),base={sceneId:'S1',reference:f.references[0],referenceSourceId:'video-1',presenterAssetId:'presenter',aspectRatio:'9:16'};
 const original=presenterVisualCompatibilityHash(base);
 const changedCamera=structuredClone(base.reference!);changedCamera.shotLanguage!.cameraAngle='high angle';
 const changedComposition=structuredClone(base.reference!);changedComposition.shotLanguage!.composition='left';
 for(const change of [{reference:changedCamera},{reference:changedComposition},{aspectRatio:'16:9'},{presenterAssetId:'another'},{productBinding:{productId:'SKU-1',enterpriseFactRef:'facts:SKU-1',referenceImageIds:['front']}}])assert.notEqual(presenterVisualCompatibilityHash({...base,...change}),original);
 assert.equal(presenterVisualCompatibilityHash({...base,sceneId:'S2'}),original,'known equivalent evidence does not split merely because the scene id differs');
});

test('missing composition isolates a shot without adding a user confirmation or blocking production',()=>{
 const f=fixture();delete f.references[0]!.shotLanguage;delete f.references[1]!.shotLanguage;
 const frozen=freezeSocialPresenterBudgetGroups(f.input);assert.deepEqual(frozen.presenterGroups.map(group=>group.shotIds),[['S1'],['S2'],['S3']]);
});

test('timeline gaps and non-presenter scenes prevent accidental mother merging',()=>{
 const f=fixture();f.references[2]!.visualDescription=f.references[0]!.visualDescription;
 f.input.directorScenes[1]!.duration={startSeconds:3,endSeconds:5,targetSeconds:2};f.input.directorScenes[2]!.duration={startSeconds:5,endSeconds:7,targetSeconds:2};
 assert.deepEqual(freezeSocialPresenterBudgetGroups(f.input).presenterGroups.map(group=>group.shotIds),[['S1'],['S2','S3']]);
 f.input.shots[1]!.sourceStrategy='customer_real_asset';
 assert.deepEqual(freezeSocialPresenterBudgetGroups(f.input).presenterGroups.map(group=>group.shotIds),[['S1'],['S3']]);
});


test('only explicit product locks affect grouping and increase paid image/QA input bounds',()=>{
 const f=fixture(),lock={productId:'SKU-1',enterpriseFactRef:'facts:SKU-1',referenceImageIds:['front']};
 f.input.shots[0]!.enterpriseProductAssetLock=lock;f.input.shots[1]!.enterpriseProductAssetLock={...lock};
 const frozen=freezeSocialPresenterBudgetGroups(f.input);
 assert.deepEqual(frozen.presenterGroups.map(group=>[group.shotIds,group.staticReferenceImageCount]),[[['S1','S2'],3],[['S3'],2]]);
 delete f.input.shots[1]!.enterpriseProductAssetLock;
 assert.deepEqual(freezeSocialPresenterBudgetGroups(f.input).presenterGroups.map(group=>group.shotIds),[['S1'],['S2'],['S3']]);
});

test('structured scene evidence permits reuse across different narration descriptions and separates lighting details',async()=>{
 const {normalizeSceneVisualContract}=await import('../../shared/sceneVisualContract.js');
 const f=fixture(),visual=normalizeSceneVisualContract({environment:{kind:'factory',description:'同一车间展台',details:['左侧柔光']},camera:{shotSize:'medium',angle:'eye-level',movement:'static',composition:'centered'},interaction:{kind:'person_talking'},action:{startState:'站立',path:'口播',endState:'站立'}});
 f.references[0]!.visualContract=visual;f.references[1]!.visualContract=structuredClone(visual);
 f.references[0]!.visualDescription='人物介绍定制业务';f.references[1]!.visualDescription='人物继续介绍产品机会';
 assert.deepEqual(freezeSocialPresenterBudgetGroups(f.input).presenterGroups[0]!.shotIds,['S1','S2'],'narrative wording alone must not force another paid mother segment');
 f.references[1]!.visualContract!.environment.details=['右侧硬光'];
 assert.deepEqual(freezeSocialPresenterBudgetGroups(f.input).presenterGroups.map(group=>group.shotIds),[['S1'],['S2'],['S3']]);
});


test('legacy graph grouping keeps its old contract and does not retroactively add binding policies',()=>{
 const f=fixture(),legacy=freezeSocialPresenterBudgetGroups({...f.input,groupingPolicy:'legacy.v1'});
 assert.deepEqual(legacy.presenterGroups.map(group=>group.shotIds),[['S1','S2','S3']]);
 assert.equal(legacy.presenterGroups[0]!.visualCompatibilityHash,undefined);assert.equal(legacy.presenterGroups[0]!.staticReferenceImageCount,undefined);
 assert.ok(legacy.scenes.every(scene=>scene.visualCompatibilityHash===undefined));
});

test('original presenter scenes freeze authored visual sources without manufacturing reference evidence',async()=>{
 const {normalizeSceneVisualContract}=await import('../../shared/sceneVisualContract.js');
 const f=fixture(),visual=normalizeSceneVisualContract({environment:{kind:'studio',description:'明亮品牌口播间',details:['左侧柔光']},camera:{shotSize:'medium',angle:'eye-level',movement:'static',composition:'centered'},interaction:{kind:'person_talking'},action:{startState:'正对镜头',path:'自然口播',endState:'保持站立'}});
 f.input.reference=null as unknown as SocialReferenceVideoAnalysis;
 f.input.directorScenes=f.input.directorScenes.slice(0,1).map(scene=>({...scene,referenceShotId:null,targetVisual:'企业顾问在明亮品牌口播间讲解',visualContract:visual,action:{startState:'正对镜头',path:'自然口播',endState:'保持站立'},shotLanguage:{shotSize:'medium',cameraAngle:'eye-level',movement:'static',composition:'centered'}})) as SocialDirectorBriefScene[];
 f.input.scenes=f.input.scenes.slice(0,1);f.input.shots=f.input.shots.slice(0,1);
 const first=freezeSocialPresenterBudgetGroups(f.input),second=freezeSocialPresenterBudgetGroups(structuredClone(f.input));
 assert.equal(first.presenterGroups.length,1);assert.equal(first.presenterGroups[0]!.sceneSourceKind,'original_scene');
 assert.match(first.presenterGroups[0]!.sceneSourceContractHash!,/^[a-f0-9]{64}$/);
 assert.equal(first.presenterGroups[0]!.sceneSourceContractHash,second.presenterGroups[0]!.sceneSourceContractHash);
 assert.equal(first.presenterGroups[0]!.firstFramePipeline,'background-first.v2');
 assert.equal('referenceFirstFrameSha256' in first.presenterGroups[0]!,false);
 const changed=structuredClone(f.input);changed.directorScenes[0]!.visualContract!.environment.details=['右侧硬光'];
 assert.notEqual(freezeSocialPresenterBudgetGroups(changed).presenterGroups[0]!.sceneSourceContractHash,first.presenterGroups[0]!.sceneSourceContractHash);
});
