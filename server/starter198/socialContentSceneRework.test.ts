import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { alignSocialAssetSupplyPlanToBaseline, type SocialAssetSupplyAdapterResult } from './socialContentAssetSupplyExecution.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { sceneReworkHash, sealSocialSceneMediaCache, createSocialSceneReworkIntent, executeSocialSceneReworkSupply } from './socialContentSceneRework.js';

test('real supply executor only retries failed scene; passed bytes and frozen audio are verified before calls', async () => {
 const dir=await mkdtemp(join(tmpdir(),'scene-rework-'));
 try {
  const path=join(dir,'original.mp4'); await writeFile(path,'original-scene-bytes');
  const digest=createHash('sha256').update('original-scene-bytes').digest('hex');
  const baseline:StoredSocialScriptBaseline={schemaVersion:'social-content-script-baseline.v1',version:'baseline-1',source:'knowledge_fallback',formulaReference:null,themeId:null,language:'zh',lockedAt:'2026-10-01T00:00:00Z',createdBeforeMaterialAdaptation:true,scenes:['scene-a','scene-b'].map(sceneId=>({sceneId,formulaNodeId:null,shotFunction:'hook',subject:'产品',action:'展示',voiceover:'产品展示',narration:'产品展示'}))};
  const plan=alignSocialAssetSupplyPlanToBaseline({baseline,plan:createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'material_cut',planVersion:'plan-1',inventory:{customerVideoIds:['original']},shots:baseline.scenes.map(s=>({shotId:s.sceneId,function:'hook',requestedDescription:'产品展示'}))})});
  const result:SocialAssetSupplyAdapterResult={asset:{id:'original',name:'original',type:'video',sourceId:'original',url:path,localPath:path,duration:3,visualObservations:['产品'],segments:[]},sourceStrategy:'customer_real_asset',providerId:'original-provider',sourceRef:'original',synthetic:false,representation:'non_evidentiary_visual',authorizationRef:null,disclosure:null};
  const cache=sealSocialSceneMediaCache({schemaVersion:'social-scene-media-cache.v1',tenantId:'tenant',taskId:'task',runId:'run',parentArtifactId:'artifact',parentArtifactHash:'artifact-hash',planVersion:plan.planVersion,planHash:sceneReworkHash(plan),scenes:baseline.scenes.map((s,index)=>({sceneId:s.sceneId,productionSceneId:s.sceneId,shotHash:sceneReworkHash(plan.shots[index]),sha256:digest,result,technicalReceiptId:`receipt-${s.sceneId}`,status:index===0?'passed':'failed'})),renderInput:{sourceManifest:{timeline:['frozen']},mediaRemap:[],manifest:{timeline:['frozen']},voice:{localPath:path,sha256:digest},bgm:null}});
  const intent=createSocialSceneReworkIntent(cache,'actor',['scene-b'],'rework-run');
  const calls:string[]=[]; const verified:string[]=[];
  const input={intent,cache,actorUserId:'actor',parentArtifactHash:'artifact-hash',plan,baseline,outputDirectory:dir,verifyReceipt:async(id:string)=>{verified.push(id);},adapters:[{adapterId:'actual-provider',sourceStrategies:['customer_real_asset' as const],execute:async(context:{baselineScene:{sceneId:string}})=>{calls.push(context.baselineScene.sceneId);return {...result,asset:{...result.asset,id:'replacement'}};}}]};
  const output=await executeSocialSceneReworkSupply(input);
  assert.deepEqual(calls,['scene-b']); assert.equal(output.assets[0]?.id,'original'); assert.equal(output.assets[1]?.id,'replacement'); assert.equal(verified.length,2);
  await assert.rejects(()=>executeSocialSceneReworkSupply({...input,actorUserId:'other'}),/scope_invalid/);
  assert.deepEqual(calls,['scene-b']);
  await assert.rejects(()=>executeSocialSceneReworkSupply({...input,verifyReceipt:async()=>{throw new Error('actual_receipt_rejected');}}),/actual_receipt_rejected/);
  await assert.rejects(()=>executeSocialSceneReworkSupply({...input,cache:{...cache,parentArtifactHash:'forged'}}),/cache_integrity_invalid/);
  await assert.rejects(()=>executeSocialSceneReworkSupply({...input,plan:{...plan,planVersion:'changed'}}),/plan_changed/);
  assert.deepEqual(calls,['scene-b']);
  // A user's requested change is not a fabricated detector failure. The exact
  // original receipt status is still verified, and only that slot is supplied.
  const voicePlan=alignSocialAssetSupplyPlanToBaseline({baseline,plan:{...plan,materialRoutingPolicyVersion:'type-aware.v3' as const}});
  const {recordHash:_oldHash,...oldCache}=cache;
  const voiceCache=sealSocialSceneMediaCache({...oldCache,planHash:sceneReworkHash(voicePlan),scenes:cache.scenes.map((scene,index)=>({...scene,status:index===0?'review_required' as const:'passed' as const,shotHash:sceneReworkHash(voicePlan.shots[index])}))});
  const requested=createSocialSceneReworkIntent(voiceCache,'actor',['scene-a'],'rework-run','user_selected');
  assert.deepEqual(requested.failedReceiptIds,[]);
  assert.deepEqual(requested.selectedReceiptIds,['receipt-scene-a']);
  calls.length=0; const observed:Array<[string,string]>=[];
  const revised=await executeSocialSceneReworkSupply({...input,plan:voicePlan,cache:voiceCache,intent:requested,verifyReceipt:async(id, _scene, status)=>{observed.push([id,status]);}});
  assert.deepEqual(calls,['scene-a']); assert.equal(revised.assets[1]?.id,'original');
  assert.deepEqual(observed,[['receipt-scene-a','review_required'],['receipt-scene-b','passed']]);
  const projected=structuredClone(voicePlan);
  projected.shots[0]!.sourceRefs=['replacement-source'];
  const projectedSupply=await executeSocialSceneReworkSupply({...input,plan:voicePlan,cache:voiceCache,intent:requested,
    localProjection:{plan:projected,assets:[{...result.asset,id:'replacement-source',sourceId:'replacement-source'}]},
    adapters:[{adapterId:'new-real-source',sourceStrategies:['customer_real_asset' as const],execute:async()=>({...result,
      sourceRef:'replacement-source',asset:{...result.asset,id:'replacement-source',sourceId:'replacement-source'}})}]});
  assert.equal(projectedSupply.execution.shots.find(shot=>shot.sceneId==='scene-a')!.sourceRef,'replacement-source');
  assert.deepEqual(projectedSupply.plan.shots[1],voicePlan.shots[1]);
  const forged=structuredClone(projected);forged.shots[1]!.sourceRefs=['unselected-tamper'];
  await assert.rejects(()=>executeSocialSceneReworkSupply({...input,plan:voicePlan,cache:voiceCache,intent:requested,
    localProjection:{plan:forged,assets:[]}}),/projection_invalid/);
  await assert.rejects(()=>executeSocialSceneReworkSupply({...input,cache:voiceCache,intent:requested}),/selection_mode_invalid/);
  calls.length=0;
  await writeFile(path,'tampered');
  await assert.rejects(()=>executeSocialSceneReworkSupply(input),/media_hash_changed/); assert.deepEqual(calls,[]);
  assert.throws(()=>createSocialSceneReworkIntent(cache,'actor',['scene-a'],'rework-run'),/failed_receipt_required/);
  assert.throws(()=>createSocialSceneReworkIntent(cache,'actor',['scene-b','scene-b'],'rework-run'),/selection_invalid/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
