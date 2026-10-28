import assert from 'node:assert/strict';
import test from 'node:test';
import { bindWeeklyImageProducts, bindWeeklyImageReferences, weeklyImageProductShortage } from './weeklyImageReferences.js';
import { weeklyReferenceCreationGate } from './weeklyReferenceCreationGate.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';

const slot = (slotId: string) => ({ slotId, accountId: 'planned:facebook', platform: 'facebook' as const,
  kind: 'image' as const, presentation: 'image' as const, productionRole: 'original' as const, originalSlotId: slotId });
const image = (id: string) => ({ id, tenantId: 'tenant-a', contentFormat: 'image', status: 'analyzed',
  title: `图文 ${id}`, sourceUrl: `https://example.com/${id}`,
  aiAnalysis: JSON.stringify({ contentFormat: 'image', imageAnalysisStatus: 'analyzed', imageUrls: [`/image/${id}`],
    imageEvidence: { status: 'analyzed', observedFacts: [{ subjects: ['产品瓶'] }] } }) });

test('weekly image references bind distinct analyzed posts and count missing image slots', () => {
  const pack = { tasks: [], mixedContentSlots: [slot('one'), slot('two')] } as unknown as WeeklyPackage;
  const library = [image('first'), image('second')];
  const bound = bindWeeklyImageReferences(pack, library);
  assert.deepEqual(bound.mixedContentSlots?.map(item => item.referenceId), ['first', 'second']);
  assert.deepEqual(bound.mixedContentSlots?.map(item => item.referenceThumbnailUrl), ['/image/first', '/image/second']);
  assert.equal(bindWeeklyImageReferences(pack, [{ ...image('with-thumbnail'), thumbnailUrl: '/thumbnail/with-thumbnail' }])
    .mixedContentSlots?.[0]?.referenceThumbnailUrl, '/thumbnail/with-thumbnail');
  assert.deepEqual(weeklyReferenceCreationGate(bound, library), {
    ready: true, requiredCount: 2, boundCount: 2, missingCount: 0, videoMissingCount: 0, imageMissingCount: 0,
  });
  const shortage = weeklyReferenceCreationGate(pack, library);
  assert.equal(shortage.imageMissingCount, 2);
  assert.equal(shortage.ready, false);
  assert.equal(bindWeeklyImageReferences(pack, [image('only')]).mixedContentSlots?.[1]?.referenceId, undefined);
  assert.equal(bindWeeklyImageReferences(bound, [image('only')]).mixedContentSlots?.[1]?.referenceThumbnailUrl, undefined);
});

test('four weekly image drafts bind three focus-ordered products and original creative directions', () => {
  const pack = { tasks: [], mixedContentSlots: [slot('one'), slot('two'), slot('three'), slot('four')] } as unknown as WeeklyPackage;
  const products = [{ id: 'p1', name: '主推一' }, { id: 'p2', name: '主推二' },
    { id: 'p3', name: '主推三' }, { id: 'p4', name: '非主推四' }];
  const bound = bindWeeklyImageReferences(bindWeeklyImageProducts(pack, products),
    [image('first'), image('second'), image('third'), image('fourth')]);
  assert.deepEqual(bound.mixedContentSlots?.map(item => item.productId), ['p1', 'p2', 'p3', 'p1']);
  assert.deepEqual(bound.mixedContentSlots?.map(item => item.referenceId), ['first', 'second', 'third', 'fourth']);
  assert.ok(bound.mixedContentSlots?.every(item => item.contentTheme?.includes(item.productName || '')));
  assert.equal(weeklyImageProductShortage(bound), 0);
  assert.equal(weeklyImageProductShortage(bindWeeklyImageProducts(pack, products.slice(0, 2))), 1);
  assert.equal(weeklyImageProductShortage(bindWeeklyImageProducts(pack, [])), 3);
});

test('single-image production rejects carousel and GIF references instead of falling back', () => {
  const carousel = image('carousel');
  carousel.aiAnalysis = JSON.stringify({ contentFormat: 'image', imageAnalysisStatus: 'analyzed',
    imageUrls: ['/image/1', '/image/2'], imageEvidence: { status: 'analyzed', observedFacts: [{ subjects: ['展会'] }] } });
  const pack = { tasks: [], mixedContentSlots: [slot('one')] } as unknown as WeeklyPackage;
  assert.equal(bindWeeklyImageReferences(pack, [carousel, image('single')]).mixedContentSlots?.[0]?.referenceId, 'single');
  assert.equal(bindWeeklyImageReferences(pack, [carousel]).mixedContentSlots?.[0]?.referenceId, undefined);
  assert.equal(weeklyReferenceCreationGate(pack, [carousel]).imageMissingCount, 1);
  const gif = image('gif');
  gif.aiAnalysis = JSON.stringify({ contentFormat: 'image', imageAnalysisStatus: 'analyzed', imageUrls: ['/image/animation.gif'],
    imageEvidence: { status: 'analyzed', observedFacts: [{ subjects: ['产品瓶'] }] } });
  assert.equal(bindWeeklyImageReferences(pack, [gif]).mixedContentSlots?.[0]?.referenceId, undefined);
});
