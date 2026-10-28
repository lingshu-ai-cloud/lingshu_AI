import assert from 'node:assert/strict';
import test from 'node:test';
import { bindWeeklyImageReferences } from './weeklyImageReferences.js';
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
  assert.deepEqual(weeklyReferenceCreationGate(bound, library), {
    ready: true, requiredCount: 2, boundCount: 2, missingCount: 0, videoMissingCount: 0, imageMissingCount: 0,
  });
  const shortage = weeklyReferenceCreationGate(pack, library);
  assert.equal(shortage.imageMissingCount, 2);
  assert.equal(shortage.ready, false);
  assert.equal(bindWeeklyImageReferences(pack, [image('only')]).mixedContentSlots?.[1]?.referenceId, undefined);
});

test('single-image production prefers single-image evidence over an earlier carousel', () => {
  const carousel = image('carousel');
  carousel.aiAnalysis = JSON.stringify({ contentFormat: 'image', imageAnalysisStatus: 'analyzed',
    imageUrls: ['/image/1', '/image/2'], imageEvidence: { status: 'analyzed', observedFacts: [{ subjects: ['展会'] }] } });
  const pack = { tasks: [], mixedContentSlots: [slot('one')] } as unknown as WeeklyPackage;
  assert.equal(bindWeeklyImageReferences(pack, [carousel, image('single')]).mixedContentSlots?.[0]?.referenceId, 'single');
});
