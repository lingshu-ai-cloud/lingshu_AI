import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {normalizeSceneVisualContract} from '../../shared/sceneVisualContract.js';
import {bindTaskContactCards} from './socialContentContactCard.js';
import {bindCanonicalTypeAwareRouting} from './socialContentExecutionPlan.js';
import {executeSocialAssetSupplyPlan} from './socialContentAssetSupplyExecution.js';
import {existingAssetSupplyAdapters} from './socialContentProductionSupport.js';
import {buildSocialProductionPlan} from './socialContentProductionPlan.js';
import type {StoredSocialScriptBaseline} from './socialContentScriptBaseline.js';

test('a contact-card scene keeps confirmed CTA through canonical routing, actual graphics execution and final edit', async () => {
 const root=await mkdtemp(path.join(tmpdir(),'contact-card-chain-'));
 try {
  const description='黑色背景，圆形头像、CONTACT ME 与电话图标';
  const original=createSocialAssetSupplyPlan({creationMode:'viral_replication',productionApproach:'ai_enhanced',materialRoutingPolicyVersion:'type-aware.v2',
   shots:[{shotId:'contact',function:'value',requestedDescription:description,plannedDurationSeconds:1,
    visualContract:normalizeSceneVisualContract({subjects:['environment'],interaction:{kind:'other',description}})}]});
  const confirmed=bindTaskContactCards(original,{callToAction:'联系获取产品目录与报价'});
  assert.equal(original.shots[0]!.functionalEquivalentReplacement.description,null);
  assert.equal(confirmed.shots[0]!.functionalEquivalentReplacement.description,'联系获取产品目录与报价');
  const plan=bindCanonicalTypeAwareRouting(confirmed,confirmed);
  assert.equal(plan.shots[0]!.sourceStrategy,'motion_graphics');
  const baseline={schemaVersion:'social-content-script-baseline.v1',themeId:'product_value',scenes:[{
   sceneId:'contact',shotFunction:'收尾',subject:'联系入口',action:'显示联系卡片',narration:'联系获取目录',
  }]} as StoredSocialScriptBaseline;
  const result=await executeSocialAssetSupplyPlan({tenantId:'tenant',taskId:'task',outputDirectory:root,plan,baseline,
   availableAssets:[],adapters:existingAssetSupplyAdapters()});
  const asset=result.assets[0]!;
  assert.equal(asset.type,'video');assert.ok(asset.localPath);
  assert.equal(createHash('sha256').update(await readFile(asset.localPath)).digest('hex'),asset.contentHash);
  assert.equal(result.execution.shots[0]!.provenance.synthetic,true);
  const edit=buildSocialProductionPlan({baseline,assets:result.assets,routedSceneAssets:[{sceneId:'contact',assetId:asset.id,durationSeconds:1}]});
  assert.equal(edit.ok,true,edit.message);assert.equal(edit.scenes[0]!.clip.end-edit.scenes[0]!.clip.start,1);
 } finally {await rm(root,{recursive:true,force:true});}
});
