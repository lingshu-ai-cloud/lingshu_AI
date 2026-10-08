import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creationHistoryCoverSources } from './creationHistoryCover';
test('finished video wins while reference images and videos remain fallback candidates', () => {
  const sources = creationHistoryCoverSources({ renderOutputPreviewUrl: '/done.mp4', videoKickoff: { referenceAnalysis: { details: [{ firstFrameRef: '/protected-frame' }] }, video: { thumbnail: '/thumb.jpg', aiAnalysis: { materialUrl: '/api/video/media-url' } } } });
  assert.deepEqual(sources.map(item => item.url), ['/done.mp4', '/protected-frame', '/thumb.jpg', '/api/video/media-url']);
});
test('first creation shot frame precedes inherited reference frame', () => {
  const sources = creationHistoryCoverSources({ analysisResults: { storyboard: { slots: [{ id: 'first' }] } }, storyboardSourcePlans: { first: { firstFrameUrl: '/created.jpg' } }, videoKickoff: { video: { thumbnail: '/reference.jpg' } } });
  assert.equal(sources[0].url, '/created.jpg');
});
test('old reference only draft still has a usable video and duplicate sources collapse', () => {
  assert.deepEqual(creationHistoryCoverSources({ videoKickoff: { video: { videoUrl: '/reference.mp4', aiAnalysis: { materialUrl: '/reference.mp4' } } } }), [{ kind: 'video', url: '/reference.mp4', time: 0 }]);
  assert.deepEqual(creationHistoryCoverSources({}), []);
});
