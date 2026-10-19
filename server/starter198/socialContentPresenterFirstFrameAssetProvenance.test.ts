import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertPresenterFirstFrameAssetProvenance,createPresenterFirstFrameAssetProvenance,isPresenterFirstFrameAssetProvenance} from './socialContentPresenterFirstFrameAssetProvenance.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const input=()=>({presenter:{assetId:'presenter-sales-01',assetVersion:7,referenceAssetIds:['person-front'],referenceSha256s:[sha('person-front-v7')]},products:[{productId:'GUIANFA-RS-001',enterpriseFactRef:'enterprise-product:GUIANFA-RS-001',enterpriseFactVersion:'facts-v12',referenceImageIds:['product-front','product-side'],referenceImageSha256s:[sha('product-front-v12'),sha('product-side-v12')]}],background:{referenceSourceId:'benchmark-video-3',referenceShotId:'reference-shot-8',startSeconds:4.2,endSeconds:6.8,referenceFirstFrameRef:'/api/overseas/videos/benchmark-video-3/shot/8/first-frame',referenceFirstFrameSha256:sha('reference-shot-8-frame')}});

test('freezes person, enterprise product and benchmark background into one deterministic manifest',()=>{
 const manifest=createPresenterFirstFrameAssetProvenance(input());
 assert.ok(isPresenterFirstFrameAssetProvenance(manifest));
 assert.deepEqual(assertPresenterFirstFrameAssetProvenance(input(),manifest),manifest);
 assert.equal(createPresenterFirstFrameAssetProvenance({...input(),products:[{...input().products[0]!,referenceImageIds:['product-side','product-front'],referenceImageSha256s:[sha('product-side-v12'),sha('product-front-v12')]}]}).manifestHash,manifest.manifestHash);
});

test('any upstream person, product fact/image or benchmark shot/time/frame change invalidates approval provenance',()=>{
 const approved=createPresenterFirstFrameAssetProvenance(input());
 const changes=[
  {...input(),presenter:{...input().presenter,assetVersion:8}},
  {...input(),presenter:{...input().presenter,referenceSha256s:[sha('person-retouched')]}},
  {...input(),products:[{...input().products[0]!,productId:'OTHER-SKU'}]},
  {...input(),products:[{...input().products[0]!,enterpriseFactVersion:'facts-v13'}]},
  {...input(),products:[{...input().products[0]!,referenceImageSha256s:[sha('new-front'),sha('product-side-v12')]}]},
  {...input(),background:{...input().background,referenceShotId:'reference-shot-9'}},
  {...input(),background:{...input().background,startSeconds:4.3}},
  {...input(),background:{...input().background,referenceFirstFrameSha256:sha('new-background-frame')}},
 ];
 for(const changed of changes)assert.throws(()=>assertPresenterFirstFrameAssetProvenance(changed,approved),/asset_provenance_changed/);
});

test('rejects incomplete product image binding and background time range',()=>{
 assert.throws(()=>createPresenterFirstFrameAssetProvenance({...input(),products:[{...input().products[0]!,referenceImageSha256s:[]}]}),/provenance_(reference_pair_)?invalid/);
 assert.throws(()=>createPresenterFirstFrameAssetProvenance({...input(),background:{...input().background,endSeconds:4.2}}),/provenance_invalid/);
});
