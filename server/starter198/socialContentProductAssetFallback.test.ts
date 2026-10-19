import assert from 'node:assert/strict';
import test from 'node:test';
import {createProductAssetFallbackRevision,createVerifiedProductAssetFallbackRevision} from './socialContentProductAssetFallback.js';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createPresenterFirstFrameAssetProvenance,assertPresenterFirstFrameAssetProvenance} from './socialContentPresenterFirstFrameAssetProvenance.js';

const hash=(char:string)=>char.repeat(64);
const shot:any={shotId:'S1',sourceRefs:['primary'],materialRouting:{generation:{productImageRefs:['primary']}},productSceneReplication:{productIdentity:{groups:[{productRef:'product:SKU-1',referenceImageIds:['primary']}]}}};
const plan:any={planVersion:'7',shots:[shot]};
const material=(id:string,overrides:any={})=>({id,tenantId:'tenant',type:'image',scope:'own',productId:'SKU-1',contentSha256:hash(id==='backup'?'b':'c'),rightsStatus:'authorized',rightsEvidenceRef:`rights:${id}`,commercialUseApproved:true,sourceType:'enterprise_product_table',...overrides});

test('unreadable product image switches only to an authorized readable image of the same product and creates a revision',()=>{
 const result=createProductAssetFallbackRevision({tenantId:'tenant',productId:'SKU-1',failedAssetId:'primary',plan,materials:[
  material('other-product',{productId:'SKU-2'}),material('unauthorized',{commercialUseApproved:false}),material('unreadable'),material('backup'),
 ],isReadable:record=>record.id!=='unreadable',createdAt:'2026-10-17T00:00:00.000Z'});
 assert.ok(result);assert.equal(result.revision.replacementAssetId,'backup');assert.equal(result.revision.productId,'SKU-1');
 assert.match(result.plan.planVersion,/^7:asset-fallback:/);assert.deepEqual(result.plan.shots[0]!.sourceRefs,['backup']);
 assert.deepEqual(result.plan.shots[0]!.materialRouting!.generation!.productImageRefs,['backup']);
 assert.deepEqual(result.plan.shots[0]!.productSceneReplication!.productIdentity.groups[0]!.referenceImageIds,['backup']);
});

test('fallback refuses cross-product, shared, synthetic and unauthorized images',()=>{
 const result=createProductAssetFallbackRevision({tenantId:'tenant',productId:'SKU-1',failedAssetId:'primary',plan,materials:[
  material('cross',{productId:'SKU-2'}),material('shared',{scope:'shared'}),material('synthetic',{synthetic:true}),material('no-rights',{rightsEvidenceRef:''}),
 ],isReadable:()=>true});
 assert.equal(result,null);
});

test('asset revision changes provenance and invalidates the old first-frame approval without changing presenter identity',()=>{
 const common={presenter:{assetId:'person-1',assetVersion:3,referenceAssetIds:['person-image'],referenceSha256s:[hash('a')]},
  background:{referenceSourceId:'video',referenceShotId:'shot',startSeconds:0,endSeconds:3,referenceFirstFrameRef:'frame',referenceFirstFrameSha256:hash('d')}};
 const approved=createPresenterFirstFrameAssetProvenance({...common,products:[{productId:'SKU-1',enterpriseFactRef:'fact',enterpriseFactVersion:'v1',referenceImageIds:['primary'],referenceImageSha256s:[hash('c')]}]});
 const current={...common,products:[{productId:'SKU-1',enterpriseFactRef:'fact',enterpriseFactVersion:'v1',referenceImageIds:['backup'],referenceImageSha256s:[hash('b')]}]};
 assert.throws(()=>assertPresenterFirstFrameAssetProvenance(current,approved),/asset_provenance_changed/);
 assert.equal(current.presenter.assetId,approved.presenter.assetId);assert.equal(current.presenter.assetVersion,approved.presenter.assetVersion);
});

test('backup selection verifies real image bytes and declared SHA; source must actually be unreadable',async()=>{
 const bytes=await sharp({create:{width:80,height:80,channels:3,background:'#ffffff'}}).png().toBuffer();
 const digest=createHash('sha256').update(bytes).digest('hex');
 const primary=material('primary',{contentSha256:digest});
 const backup=material('backup',{contentSha256:digest});
 const wrongHash=material('wrong-hash',{contentSha256:hash('d')});
 const loadBytes=async(record:any)=>{if(record.id==='primary')throw Error('missing');return bytes;};
 const result=await createVerifiedProductAssetFallbackRevision({tenantId:'tenant',productId:'SKU-1',failedAssetId:'primary',plan,
  materials:[primary,wrongHash,backup],loadBytes,createdAt:'2026-10-17T00:00:00.000Z'});
 assert.equal(result?.revision.replacementAssetId,'backup');
 assert.equal(result?.revision.replacementSha256,digest);
 await assert.rejects(createVerifiedProductAssetFallbackRevision({tenantId:'tenant',productId:'SKU-1',failedAssetId:'primary',plan,
  materials:[primary,backup],loadBytes:async()=>bytes}),/product_fallback_primary_still_readable/);
 await assert.rejects(createVerifiedProductAssetFallbackRevision({tenantId:'tenant',productId:'SKU-1',failedAssetId:'primary',plan,
  materials:[material('primary',{productId:'other'}),backup],loadBytes}),/product_fallback_source_identity_invalid/);
 const noValid=await createVerifiedProductAssetFallbackRevision({tenantId:'tenant',productId:'SKU-1',failedAssetId:'primary',plan,
  materials:[primary,wrongHash,material('cross-product',{productId:'other',contentSha256:digest})],loadBytes});
 assert.equal(noValid,null,'all unreadable or unverified same-product images must stay unavailable');
 const sourceGone=await createVerifiedProductAssetFallbackRevision({tenantId:'tenant',productId:'SKU-1',failedAssetId:'primary',
  failedAsset:primary,plan,materials:[backup],loadBytes,createdAt:'2026-10-17T00:00:00.000Z'});
 assert.equal(sourceGone?.revision.replacementAssetId,'backup','a frozen source can be absent from the current live inventory');
});
