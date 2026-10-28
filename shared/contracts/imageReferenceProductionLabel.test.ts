import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeImageReferenceProductionLabels } from './imageReferenceProductionLabel';

test('production tags bind to each exact image and leave missing, ambiguous or weak output unknown', () => {
  const hash = 'a'.repeat(64);
  const tags = normalizeImageReferenceProductionLabels([
    { imageIndex: 1, kind: 'product_only', evidence: '产品正面及纯色背景', confidence: .91 },
    { imageIndex: 2, kind: 'shoot_required', evidence: '可见工厂人物', confidence: .88 },
    { imageIndex: 3, kind: 'product_only', evidence: '不确定的画面', confidence: .3 },
    { imageIndex: 4, kind: 'product_only', evidence: '产品', confidence: .95 },
    { imageIndex: 4, kind: 'shoot_required', evidence: '人物', confidence: .95 },
  ], [1, 2, 3, 4, 5].map(imageIndex => ({ imageIndex, sourceSha256: imageIndex === 5 ? null : hash })));
  assert.deepEqual(tags.map(tag => tag.kind), ['product_only', 'shoot_required', 'unknown', 'unknown', 'unknown']);
  assert.ok(tags.every(tag => tag.verification === 'unverified'));
  assert.equal(tags[0]!.sourceSha256, hash);
  assert.equal(tags[4]!.sourceSha256, null);
});

test('style observations fail closed independently of product production labels', () => {
 const [tag] = normalizeImageReferenceProductionLabels([{imageIndex:1,kind:'unknown',style:{kind:'imitable',confidence:.95,evidence:'柔和光线',elements:['soft_light','untrusted']}}],[{imageIndex:1,sourceSha256:'a'.repeat(64)}]);
 assert.equal(tag?.kind,'unknown');assert.deepEqual(tag?.style?.elements,['soft_light']);assert.equal(tag?.style?.kind,'imitable');
 const [unknown] = normalizeImageReferenceProductionLabels([{imageIndex:1,style:{kind:'imitable',confidence:.95,evidence:'test',elements:['untrusted']}}],[{imageIndex:1,sourceSha256:'a'.repeat(64)}]);
 assert.equal(unknown?.style?.kind,'unknown');
});

test('product visibility stays independent of the production-method label', () => {
 const [present, absent, weak] = normalizeImageReferenceProductionLabels([
   {imageIndex:1,kind:'shoot_required',productPresence:'present',evidence:'模特手持可见产品',confidence:.92},
   {imageIndex:2,kind:'unknown',productPresence:'absent',evidence:'仅可见人物与背景',confidence:.91},
   {imageIndex:3,kind:'unknown',productPresence:'present',evidence:'画面模糊',confidence:.4},
 ],[1,2,3].map(imageIndex=>({imageIndex,sourceSha256:'a'.repeat(64)})));
 assert.equal(present?.productPresence,'present');
 assert.equal(absent?.productPresence,'absent');
 assert.equal(absent?.kind,'unknown');
 assert.equal(weak?.productPresence,'unknown');
});
