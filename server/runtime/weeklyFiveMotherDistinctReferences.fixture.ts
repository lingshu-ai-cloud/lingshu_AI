import {createExactShotMaterializationService} from '../lib/referenceExactShotMaterialization.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import {prepareWeeklyNonPresenterPlanningFixture} from './weeklyNonPresenterProduction.fixture.js';

/** Five separately generated local source audio/video files and verified frames.
 * These are controlled provider contracts, not live model observations. The
 * caller builds its five-mother package and invokes normal planning afterwards. */
export async function prepareFiveMotherDistinctReferenceSeeds(t:TestContext,options:{ownedPercent?:0|20|40;productInventory?:boolean;weeklyBudgetCny?:number}={}){
 const speeches=['The box is blue.','The package turns slowly.','The label faces the camera.','The lid opens carefully.','The product sits on a table.'];
 const seeds=[];
 for(const [index,sourceSpeech] of speeches.entries())seeds.push(await prepareWeeklyNonPresenterPlanningFixture(t,{controlledSourceTone:index<(options.ownedPercent??0)/20,sourceUrl:`https://www.tiktok.com/@distinct_fixture/video/${randomUUID()}-${index}`,ownedReferenceBytes:true,primaryStructure:true,weeklyBudgetCny:options.weeklyBudgetCny??100,productInventory:options.productInventory,sourceSpeech,targetCta:'Contact sales',metricTargets:['播放目标1000','点赞目标20','评论目标5','分享目标5']}));
 const setup=seeds[0]!;const {f}=setup;
 for(const [index,seed] of seeds.entries()){
  const reference=seed.f.tables.trend_videos!.find(row=>row.id===seed.referenceId)!;assert.ok(reference);
  const candidate=seed.f.tables.social_candidate_evidence!.find(row=>row.candidateId===seed.referenceId)!;
  const handoff=seed.f.tables.starter_social_inspiration_handoff_versions!.find(row=>(row.payload as Record<string,unknown>).inspirationId===seed.referenceId)!;
  if(index>0){
   f.tables.trend_videos!.push(structuredClone(reference));
   const copied=structuredClone(candidate);copied.id=`distinct-candidate-${randomUUID()}`;copied.evidenceId=`distinct-evidence-${seed.referenceId}`;f.tables.social_candidate_evidence!.push(copied);
   const frozen=structuredClone(handoff);frozen.id=`distinct-handoff-${randomUUID()}`;f.tables.starter_social_inspiration_handoff_versions!.push(frozen);
  }
 }
 const referenceIds=seeds.map(seed=>seed.referenceId);
 const materializer=createExactShotMaterializationService(f.store);
 for(const referenceId of referenceIds){
  const reference=f.tables.trend_videos!.find(row=>row.id===referenceId)!;
  const analysis=JSON.parse(String(reference.aiAnalysis));
  const scope={tenantId:'t',recordId:referenceId,expectedSourceSha256:analysis.contentSha256,expectedAnalysisRunId:analysis.analysisRunId,expectedAnalysisHash:socialRequestHash(analysis)};
  await materializer.materialize(scope);
  const verified=await materializer.readVerifiedAnalysis(scope);assert.ok(verified,'every source must have verified materialization in the merged store');
 }

 for(const account of f.tables.social_tracked_accounts??[])if(account.accountId==='https://www.tiktok.com/@oem_factory')account.evidenceVideoIds=referenceIds;
 const ownCount=(options.ownedPercent??0)/20;
 for(const [index,referenceId] of referenceIds.slice(0,ownCount).entries()){
  const reference=f.tables.trend_videos!.find(row=>row.id===referenceId)!;
  await f.store.create('social_external_contents',{tenant_id:'t',account_id:'account',channel_id:'tiktok',external_content_id:referenceId,content:{tenantId:'t',accountId:'account',channelId:'tiktok',externalContentId:referenceId,status:'published',publicUrl:reference.sourceUrl}});
  const snapshotId=`metric-${referenceId}`;
  await f.store.create('social_channel_metric_snapshots',{tenant_id:'t',account_id:'account',channel_id:'tiktok',external_content_id:referenceId,snapshot_id:snapshotId,snapshot:{snapshotId,tenantId:'t',accountId:'account',channelId:'tiktok',externalContentId:referenceId,capturedAt:'2026-10-01T00:00:00Z',source:'official_api',metrics:{views:1200-index*100,likes:20-index,shares:5-index,comments:4-index}}});
 }
 assert.equal(new Set(referenceIds).size,5);
 return {...setup,referenceIds,ownedReferenceIds:referenceIds.slice(0,ownCount),sourceSpeeches:speeches};
}
