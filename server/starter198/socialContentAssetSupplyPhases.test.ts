import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { socialAssetSupplyPhaseInputHash, socialAssetSupplyPhaseShotIds, mergeSocialAssetSupplyPhases } from './socialContentAssetSupplyPhases.js';
import { executeSocialAssetSupplyPlan } from './socialContentAssetSupplyExecution.js';
import { restoreSocialAssetSupplyCheckpointAssets } from './socialContentProductionCheckpoints.js';
import { materialContentAddressedObjectKey } from '../storage/materialAssets.js';
import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentWorkflow.js';
import type { SocialAssetSupplyExecutionResult } from './socialContentAssetSupplyExecution.js';

const truthBoundary = { subject:'none' as const, syntheticVisualAllowed:true, customerEvidenceRequired:false,
  customerEvidenceRefs:[], confirmedFactRefs:[], mustNotImplyCustomerReality:true, prohibitedRepresentations:[] };
const replacement = { required:false, preservesFunction:'value' as const, replacesSubject:null, description:null, reason:null };
const shot = (shotId:string, presenter=false) => ({
  shotId, function:'value' as const, requestedDescription:shotId,
  sourceStrategy:presenter?'authorized_digital_presenter' as const:'motion_graphics' as const,
  fallbackSourceStrategy:null, sourceRefs:[], truthBoundary, functionalEquivalentReplacement:replacement,
  feasibility:'ready' as const, feasibilityReason:null,
  ...(presenter?{digitalHumanPlan:{method:'avatar' as const,presenterAssetIds:['presenter'],referenceRequired:false,
    referenceMaterialIds:[],executionState:'ready_for_capability_check' as const,consistencyRequirements:[],accountPresenterLock:null}}:{}),
});
const plan = {schemaVersion:'social-content.asset-supply-plan.v1',planVersion:'phase-plan',creationMode:'material_processing',
  productionApproach:'ai_enhanced',productionRoute:'product_anchored_generation',managementMode:'one_click_managed',
  rightsConfirmationRequired:false,shots:[shot('source-1'),shot('presenter-1',true)]} as unknown as SocialAssetSupplyPlan;
const result = (sceneId:string,assetId:string):SocialAssetSupplyExecutionResult => ({plan,assets:[{id:assetId,name:assetId,type:'video',sourceId:assetId,url:`/${assetId}.mp4`,duration:2,visualObservations:[],segments:[]}],execution:{schemaVersion:'social-content.asset-supply-execution.v1',planVersion:plan.planVersion,creationMode:plan.creationMode,productionRoute:plan.productionRoute,managementMode:plan.managementMode,executedAt:'2026-10-26T00:00:00.000Z',shots:[{shotId:sceneId,sceneId,function:'value',requestedSourceStrategy:sceneId.startsWith('presenter')?'authorized_digital_presenter':'motion_graphics',sourceStrategy:sceneId.startsWith('presenter')?'authorized_digital_presenter':'motion_graphics',fallbackApplied:false,providerId:'fixture',assetId,sourceRef:null,truthBoundary,functionalEquivalentReplacement:replacement,provenance:{synthetic:true,representation:'non_evidentiary_visual',authorizationRef:null,disclosure:'fixture'},attempts:[]}]}});

test('partitions reviewed shots by voice dependency',()=>{
  assert.deepEqual(socialAssetSupplyPhaseShotIds(plan),{source_assets:['source-1'],presenter_assets:['presenter-1']});
});

test('source phase identity survives a metadata-only script baseline revision',()=>{
  const common={phase:'source_assets' as const,plan,materialAnalysisInputHash:'analysis'};
  assert.equal(socialAssetSupplyPhaseInputHash({...common,baselineVersion:'1'}),
    socialAssetSupplyPhaseInputHash({...common,baselineVersion:'2'}));
});

test('merges independently recovered phases in reviewed plan order',()=>{
  const merged=mergeSocialAssetSupplyPhases({plan,source:result('source-1','source-asset'),presenter:result('presenter-1','presenter-asset')});
  assert.deepEqual(merged.execution.shots.map(value=>value.sceneId),['source-1','presenter-1']);
  assert.deepEqual(merged.assets.map(value=>value.id),['source-asset','presenter-asset']);
});

test('rejects an incomplete phase receipt',()=>{
  const incomplete=result('source-1','source-asset');
  assert.throws(()=>mergeSocialAssetSupplyPhases({plan,source:incomplete,presenter:incomplete}),/asset_supply_phase_incomplete:presenter_assets/);
});

test('subset execution validates the full plan but calls adapters only for frozen shot IDs',async()=>{
  const executable=createSocialAssetSupplyPlan({creationMode:'material_processing',productionApproach:'ai_enhanced',
    shots:[{shotId:'source-a',function:'hook',requestedDescription:'source'},{shotId:'source-b',function:'value',requestedDescription:'source'}]});
  const calls:string[]=[];
  const output=await executeSocialAssetSupplyPlan({selectedShotIds:['source-a'],tenantId:'tenant',taskId:'task',outputDirectory:'/tmp',plan:executable,
    baseline:{schemaVersion:'social-content-script-baseline.v1',version:'baseline',source:'knowledge_fallback',formulaReference:null,themeId:null,language:'zh',lockedAt:'2026-10-26T00:00:00.000Z',createdBeforeMaterialAdaptation:true,
      scenes:executable.shots.map(value=>({sceneId:value.shotId,formulaNodeId:null,shotFunction:value.function,subject:'',action:'',voiceover:'',narration:''}))},availableAssets:[],adapters:[{adapterId:'fixture',sourceStrategies:['motion_graphics'],async execute(context){calls.push(context.shot.shotId);return{asset:{id:`asset-${context.shot.shotId}`,name:'fixture',type:'image',sourceId:'fixture',url:'/fixture.png',duration:1,visualObservations:[],segments:[]},sourceStrategy:'motion_graphics',providerId:'fixture',sourceRef:null,synthetic:true,representation:'non_evidentiary_visual',authorizationRef:null,disclosure:'fixture'};}}]});
  assert.deepEqual(calls,['source-a']);
  assert.deepEqual(output.execution.shots.map(value=>value.sceneId),calls);
});

test('restores archived generated bytes by tenant content-addressed object without a dead temp path',()=>{
  const digest='a'.repeat(64),asset={id:'generated',name:'generated',type:'video' as const,sourceId:'provider-task',url:'',
    localPath:'/deleted/worker-temp.mp4',objectKey:materialContentAddressedObjectKey('tenant',digest,`${digest}.mp4`),
    contentHash:digest,providerTaskId:'provider-task',duration:2,visualObservations:[],segments:[]};
  assert.deepEqual(restoreSocialAssetSupplyCheckpointAssets({tenantId:'tenant',availableAssets:[],selectedAssets:[{
    assetId:asset.id,sourceId:asset.sourceId,contentHash:digest,asset}]}),[asset]);
  assert.equal(restoreSocialAssetSupplyCheckpointAssets({tenantId:'other',availableAssets:[],selectedAssets:[{
    assetId:asset.id,sourceId:asset.sourceId,contentHash:digest,asset}]}),null);
});

test('restores a frozen source window from the same current owned source bytes',()=>{
  const digest='b'.repeat(64),source={id:'owned-source',name:'source',type:'video' as const,sourceId:'library-source',
    url:'/current/source.mp4',localPath:'/current/source.mp4',contentHash:digest,duration:8,visualObservations:['product'],segments:[]};
  const frozen={...source,id:'owned-source:window:abcdef',url:'/old/signed-source.mp4',localPath:'/old/worker/source.mp4',
    selectedSourceWindow:{startSeconds:2,endSeconds:5}};
  const restored=restoreSocialAssetSupplyCheckpointAssets({availableAssets:[source],selectedAssets:[{
    assetId:frozen.id,sourceId:frozen.sourceId,contentHash:digest,asset:frozen}]});
  assert.equal(restored?.[0]?.id,frozen.id);
  assert.equal(restored?.[0]?.localPath,source.localPath);
  assert.equal(restored?.[0]?.url,source.url);
  assert.deepEqual(restored?.[0]?.selectedSourceWindow,frozen.selectedSourceWindow);
});
