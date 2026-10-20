import test from 'node:test';
import assert from 'node:assert/strict';
import {bindReviewedWeeklyVideosToShots} from './weeklyReviewedMaterialShotBinding.js';

const sha='a'.repeat(64),recordId='material0000099';

test('reviewed weekly video is deterministically projected to every current shot and invalidates the old director plan',async t=>{
 const {prepareWeeklyNonPresenterProductionFixture}=await import('./weeklyNonPresenterProduction.fixture.js');
 const {addSocialTaskSource}=await import('../starter198/socialContentTasks.js');
 const {repository,created}=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,productInventory:true,primaryStructure:true});
 const taskId=String(created.task_id),sourceRef=`socialmaterial:${Buffer.from(`pb-${recordId}`).toString('base64url')}`;
 await addSocialTaskSource({repository,tenantId:'t',userId:'owner',taskId,idempotencyKey:'reviewed-video-binding-source',sourceOptions:{resolve:async()=>({optionId:'reviewed-video',kind:'material',sourceRef,sourceVersion:sha,label:'已审核视频',type:'video',thumbnailHref:null}),list:async()=>({items:[],totalItems:0,totalPages:0,page:1,perPage:20,status:'ready'})},value:{kind:'material',sourceRef,sourceVersion:sha,label:'已审核视频',purpose:'weekly-required-material'}});
 const before=await repository.get('starter_social_content_tasks','t',created.id);assert.ok(before);
 const {readSocialTaskDetail}=await import('../starter198/socialContentRecords.js');const beforeDetail=await readSocialTaskDetail({repository,tenantId:'t',taskId});assert.ok(beforeDetail?.assetSupplyPlan);const identityRows=beforeDetail.assetSupplyPlan.shots.map(shot=>({shotId:shot.shotId,customerAssetIds:[],generatedAssetIds:['identity-image'],licensedAssetIds:['licensed-proof'],sourceStrategy:'generated' as const,truthBoundary:shot.truthBoundary,functionalEquivalentReplacement:shot.functionalEquivalentReplacement}));await repository.dataStore!.update('starter_social_content_tasks',created.id,{shot_material_map:identityRows});
 const bound=await bindReviewedWeeklyVideosToShots({repository,tenantId:'t',taskId,bindings:[{recordId,sha256:sha,sourceRef,sourceVersion:sha,type:'video'}]});
 if(!bound)throw Error('reviewed binding must return the current task');
 assert.ok(bound.shotMaterialMap?.length);assert.ok(bound.shotMaterialMap?.every(row=>row.customerAssetIds.length===1&&row.customerAssetIds[0]===recordId&&row.generatedAssetIds.includes('identity-image')&&row.licensedAssetIds.includes('licensed-proof')));
 assert.equal(bound.directorPlan??null,null);assert.equal(bound.taskId,taskId);
 const repeated=await bindReviewedWeeklyVideosToShots({repository,tenantId:'t',taskId,bindings:[{recordId,sha256:sha,sourceRef,sourceVersion:sha,type:'video'}]});if(!repeated)throw Error('idempotent binding must return the current task');assert.equal(repeated.version,bound.version);
});

test('reviewed weekly video binding rejects foreign, non-video, unbound, and changed hashes',async t=>{
 const {prepareWeeklyNonPresenterProductionFixture}=await import('./weeklyNonPresenterProduction.fixture.js');
 const {addSocialTaskSource}=await import('../starter198/socialContentTasks.js');
 const {repository,created}=await prepareWeeklyNonPresenterProductionFixture(t,{ownedReferenceBytes:true,productInventory:true,primaryStructure:true});
 const taskId=String(created.task_id),sourceRef=`socialmaterial:${Buffer.from(`pb-${recordId}`).toString('base64url')}`;
 const sourceOptions={resolve:async()=>({optionId:'reviewed-video',kind:'material' as const,sourceRef,sourceVersion:sha,label:'已审核视频',type:'video' as const,thumbnailHref:null}),list:async()=>({items:[],totalItems:0,totalPages:0,page:1,perPage:20,status:'ready' as const})};
 await addSocialTaskSource({repository,tenantId:'t',userId:'owner',taskId,idempotencyKey:'reviewed-video-negative-source',sourceOptions,value:{kind:'material',sourceRef,sourceVersion:sha,label:'已审核视频',purpose:'weekly-required-material'}});
 const invoke=(patch:Record<string,unknown>={})=>bindReviewedWeeklyVideosToShots({repository,tenantId:'t',taskId,bindings:[{recordId,sha256:sha,sourceRef,sourceVersion:sha,type:'video',...patch} as never]});
 await assert.rejects(()=>invoke({type:'image'}),{code:'weekly_reviewed_material_binding_invalid'});
 await assert.rejects(()=>invoke({sha256:'b'.repeat(64)}),{code:'weekly_reviewed_material_binding_invalid'});
 await assert.rejects(()=>invoke({sha256:'b'.repeat(64),sourceVersion:'b'.repeat(64)}),{code:'weekly_reviewed_material_source_unverified'});
 await assert.rejects(()=>invoke({sourceRef:'socialmaterial:foreign'}),{code:'weekly_reviewed_material_source_unverified'});
 await assert.rejects(()=>invoke({recordId:'material0000088'}),{code:'weekly_reviewed_material_source_unverified'});
 await assert.rejects(()=>bindReviewedWeeklyVideosToShots({repository,tenantId:'foreign',taskId,bindings:[{recordId,sha256:sha,sourceRef,sourceVersion:sha,type:'video'}]}),{code:'weekly_reviewed_material_binding_closed'});
});
