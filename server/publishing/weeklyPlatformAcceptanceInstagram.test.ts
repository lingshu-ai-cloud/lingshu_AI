import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareInstagramDeliveryFixture} from '../starter198/socialInstagramDeliveryService.fixture.js';
import {INSTAGRAM_DELIVERY_TECHNICAL_CHECKS,INSTAGRAM_DELIVERY_CREATIVE_CHECKS} from '../../shared/contracts/socialInstagramDelivery.js';
import {createInstagramDeliveryPublicationProof} from './instagramDeliveryPublicationProof.js';

// This exercises the actual owned-byte archive and review services. It deliberately
// does not replace G6 with a provider mock or claim an unavailable platform pass.
test('Instagram local acceptance verifies exact archived format evidence before formal assignment',async t=>{
  const f=await prepareInstagramDeliveryFixture({fullyConfigured:true});
  t.after(f.cleanup);
  const initial=await f.g6.context(f.scope,'owner');
  const prepared=await f.delivery.prepare(f.scope,'owner',{
    requestId:'platform_acceptance_prepare_0001',expectedContextHash:initial.contextHash,
  });
  assert.ok(prepared.item);
  assert.notEqual(prepared.item.fileSha256,prepared.item.sourceFileSha256);
  for(const kind of ['technical','creative'] as const){
    const codes=kind==='technical'?INSTAGRAM_DELIVERY_TECHNICAL_CHECKS:INSTAGRAM_DELIVERY_CREATIVE_CHECKS;
    await f.delivery.review(f.scope,'owner',{
      requestId:`platform_acceptance_${kind}_0001`,expectedDeliveryHash:prepared.item.recordHash,kind,
      checks:codes.map(code=>({code,outcome:'passed',observation:'受控本地审核输入：归档视频对应项目已观察；不代表平台真实接收'})),
    });
  }
  const reviewed=await f.delivery.read(f.scope,'owner');
  assert.deepEqual(reviewed.gaps,[]);
  assert.equal(reviewed.reviews.length,2);
  assert.ok(reviewed.reviews.every(review=>review.fileSha256===prepared.item!.fileSha256));
  const context=await f.g6.context(f.scope,'owner');
  const format=context.checks.find(check=>check.code==='platform_format');
  assert.ok(format);
  assert.equal(format.status,'passed');
  assert.deepEqual(format.reasons,[]);
  assert.ok(format.evidenceRefs.some(ref=>ref.startsWith('instagram_stream_proof:')));
  const {checkWeeklyMetaFormat}=await import('../starter198/weeklyMetaFormat.js');
  assert.equal(checkWeeklyMetaFormat('instagram',context.metadata,{deliveryProofHash:prepared.item.recordHash}).status,'unknown');

  const checked=await f.g6.check(f.scope,'owner',{
    requestId:'platform_acceptance_preflight_0001',expectedContextHash:context.contextHash,
    programId:f.scope.programId,packageId:f.scope.packageId,
    packageVersion:f.scope.packageVersion,publicationTaskId:f.scope.publicationTaskId,
  });
  assert.equal(checked.item?.status,'passed',JSON.stringify(context.checks));
  assert.ok(checked.item?.receiptId);
  const proof=await createInstagramDeliveryPublicationProof(f.store,f.scope);
  assert.equal(proof.fileSha256,prepared.item.fileSha256);
  assert.equal(proof.deliveryHash,prepared.item.recordHash);
  assert.equal(f.tables.social_publication_assignments?.length??0,0);
  assert.equal(f.tables.social_publication_attempts?.length??0,0);
  assert.equal(f.tables.publish_attempts?.length??0,0);
});
