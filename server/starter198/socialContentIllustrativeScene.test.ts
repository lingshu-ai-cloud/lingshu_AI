import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {normalizeSceneVisualContract} from '../../shared/sceneVisualContract.js';
import {parseUpdateSocialTask} from './socialContentValidation.js';
import {bindCanonicalTypeAwareRouting} from './socialContentExecutionPlan.js';
import {assertIllustrativeSceneSelection} from './socialContentIllustrativeSceneApproval.js';
import {createSocialAiVisualAdapter} from './socialContentAiVisualAdapter.js';
import {paidProductionHash,type PaidStageRequirement} from './socialContentPaidOperationPlan.js';
import type {ProductPaidContext} from './socialContentProductPaidContext.js';
import {runVisualFfmpeg} from '../lib/renderVisualQuality.js';
import {executeSocialAssetSupplyPlan} from './socialContentAssetSupplyExecution.js';
import {buildSocialProductionPlan} from './socialContentProductionPlan.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';

const descriptions=['手在平板上绘制包装设计图','女性顾客在美妆店选购商品','一群人围坐品茶进行商务洽谈'];
function plan(approved=true,index=0){const description=descriptions[index]!;return createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v2',
 shots:[{shotId:'scene',function:'value',requestedDescription:description,plannedDurationSeconds:1,illustrativeVideoApproved:approved,truthSensitiveSubject:'none',
  visualContract:normalizeSceneVisualContract({subjects:['person','environment'],interaction:{kind:'other',description},action:{path:description},environment:{kind:'office'}})}]});}
test('only explicitly selected, non-evidentiary enterprise purposes use conceptual video, with no fallback to images',()=>{
 for(let i=0;i<3;i++){
  const p=plan(true,i),shot=p.shots[0]!;
  assert.equal(shot.materialRouting?.policy,'illustrative_video');assert.equal(shot.sourceStrategy,'non_evidentiary_ai_visual');
  assert.equal(shot.fallbackSourceStrategy,null);assert.equal(shot.truthBoundary.syntheticVisualAllowed,true);
  assert.equal(shot.truthBoundary.customerEvidenceRequired,false);assert.equal(shot.truthBoundary.mustNotImplyCustomerReality,true);
  assert.equal(bindCanonicalTypeAwareRouting(p,p).shots[0]!.sourceStrategy,shot.sourceStrategy);
 }
 assert.equal(plan(false).shots[0]!.materialRouting?.policy,'local_only');
 const invalid=plan();invalid.shots[0]!.truthBoundary.subject='customer_factory';
 assert.throws(()=>assertIllustrativeSceneSelection({assetSupplyPlan:invalid} as never,['scene']),/not_eligible/);
 assert.throws(()=>assertIllustrativeSceneSelection({assetSupplyPlan:plan()} as never,['other']),/not_eligible/);
});
test('scene selection crosses the existing typed task update boundary without accepting loose values',()=>{
 assert.deepEqual(parseUpdateSocialTask({expectedVersion:'7',changes:{illustrativeSceneIds:['scene']}}).changes.illustrativeSceneIds,['scene']);
 for(const value of [true,'all',['scene','scene'],['*'],Array(201).fill('scene')])assert.throws(()=>parseUpdateSocialTask({expectedVersion:'7',changes:{illustrativeSceneIds:value}}),/illustrative_scene_ids_invalid/);
});
test('a selected concept scene cannot reach a supplier without the original whole-film permit',async()=>{
 let calls=0;const adapter=createSocialAiVisualAdapter({enabled:true,requireVideo:true,maxCostCnyPerShot:2,timeoutMs:1000,generators:[{generatorId:'seedance_concept_video',mediaType:'video',estimatedCostCny:1,async generate(){calls++;throw Error('must not call');}}]});
 await assert.rejects(adapter.execute({tenantId:'tenant',taskId:'task',outputDirectory:tmpdir(),availableAssets:[],shot:plan().shots[0]!,baselineScene:{sceneId:'scene'}} as never),/whole_film_budget_required/);
 assert.equal(calls,0);
});
test('concept video consumes the original paid identity, burns disclosure into real MP4 bytes and enters the exact edit slot',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'concept-scene-chain-'));try{
  const source=path.join(root,'source.mp4');const rendered=await runVisualFfmpeg(['-y','-f','lavfi','-i','color=c=gray:s=720x1280:r=24','-t','5','-c:v','libx264','-pix_fmt','yuv420p',source],false,{timeoutMs:30000});assert.equal(rendered.ok,true);
  const original=await readFile(source),p=plan(),claims:unknown[]=[],completed:unknown[]=[];
  const scope={tenantId:'tenant',taskId:'task',runId:'run',planHash:'a'.repeat(64)};
  const requirement:PaidStageRequirement={key:'scene:scene:non_evidentiary_ai_visual:concept_video',stage:'concept_video',shotId:'scene',sourceRef:null,durationSeconds:5,text:null,frameCount:null,inputContractHash:'b'.repeat(64)};
  const route={provider:'seedance',model:'fixture-model',accountRef:'fixture-account',routeEvidenceRef:'fixture-contract',usageBoundRef:'fixture-bound',maximumAttempts:1,maximumUnits:{outputTokens:100000}};
  const operationId='paid-plan:'+paidProductionHash({scope,key:requirement.key,attempt:0});
  const paid={scope,requirements:[requirement],routeBindings:{[requirement.key]:route},intents:[{operationId,provider:route.provider,model:route.model,accountRef:route.accountRef,stage:requirement.stage,shotId:'scene',maximumUnits:route.maximumUnits,inputContractHash:paidProductionHash({requirement,route,attempt:0})}],
   assertProviderBinding:async()=>{},measureVideoOutputTokens:async()=>90000,permit:{beforeSubmit:async(request:unknown)=>{claims.push(request);},markOutcome:async(...args:unknown[])=>{completed.push(args);}}} as unknown as ProductPaidContext;
  const adapter=createSocialAiVisualAdapter({enabled:true,requireVideo:true,paidContext:paid,maxCostCnyPerShot:0,timeoutMs:30000,generators:[{
   generatorId:'seedance_concept_video',mediaType:'video',estimatedCostCny:1,async generate(input){assert.ok(input.beforeSubmit);await input.beforeSubmit!({model:'fixture-model',duration:5,resolution:'720p',ratio:'9:16',generate_audio:false,content:[{type:'text',text:input.prompt}]});return{type:'video',providerId:'seedance',providerTaskId:'fixture-task',model:'fixture-model',bytes:original,duration:5,estimatedCostCny:1};}
  }]});
  const baseline={schemaVersion:'social-content-script-baseline.v1',themeId:'product_value',scenes:[{sceneId:'scene',shotFunction:'设计',subject:'设计工作',action:'绘制包装',narration:''}]} as StoredSocialScriptBaseline;
  const supplied=await executeSocialAssetSupplyPlan({tenantId:'tenant',taskId:'task',outputDirectory:root,plan:p,baseline,availableAssets:[],adapters:[adapter]});
  const asset=supplied.assets[0]!,bytes=await readFile(asset.localPath!);
  assert.equal(claims.length,1);assert.equal(completed.length,1);assert.notDeepEqual(bytes,original,'disclosure is physically burned into exported scene bytes');
  const firstFrame=path.join(root,'disclosure-frame.png');assert.equal((await runVisualFfmpeg(['-y','-i',asset.localPath!,'-frames:v','1',firstFrame],false,{timeoutMs:30000})).ok,true);
  const pixel=await sharp(firstFrame).extract({left:35,top:35,width:1,height:1}).raw().toBuffer();assert.ok(pixel[0]!<100,'visible disclosure backing is present over the original gray pixels');
  assert.equal(asset.contentHash,createHash('sha256').update(bytes).digest('hex'));assert.match(supplied.execution.shots[0]!.provenance.disclosure!,/AI/);
  const changed=structuredClone(p.shots[0]!);changed.materialRouting!.illustrativeVideo!.durationSeconds=6;
  await assert.rejects(adapter.execute({tenantId:'tenant',taskId:'task',outputDirectory:root,availableAssets:[],shot:changed,baselineScene:baseline.scenes[0]!}),/frozen_duration_changed/);
  const edit=buildSocialProductionPlan({baseline,assets:[asset],routedSceneAssets:[{sceneId:'scene',assetId:asset.id,durationSeconds:1}]});assert.equal(edit.ok,true,edit.message);assert.equal(edit.scenes[0]!.clip.sourceDuration,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
