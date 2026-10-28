import assert from 'node:assert/strict';
import test from 'node:test';
import { weeklyMaterialGaps } from './weeklyMaterialGaps.js';

test('projects exact unmatched requirement to a friendly weekly video and shot', () => {
  const plans = [{ theme: '新品展会', productName: '卸妆蜜', productId: 'sku-1', referenceId: 'ref-1', benchmarkAnalysis: { shots: [
    { shotId: 's-1', visual: '展会展位实拍' }, { shotId: 's-2', visual: '灌装设备特写', firstFrameRef: '/api/frame/s-2', start: 3 },
  ] } }] as never;
  const gaps = weeklyMaterialGaps(plans, [{ requirementId: '1:ref:s-2', planIndex: 0, shotIndex: 1,
    archetypeId: 'P3B_MACHINE_CLOSEUP', materialType: 'factory', requiredDurationSeconds: 2.2, requestedProductRef: 'sku-1' }]);
  assert.deepEqual(gaps, [{ requirementId: '1:ref:s-2', video: '视频 1：新品展会', product: '卸妆蜜', shot: 2,
    footage: '设备特写实拍（参考画面：灌装设备特写）', minimumSeconds: 3, productId: 'sku-1',
    materialType: 'factory', referenceThumbnailUrl: '/api/overseas/videos/ref-1/thumbnail',
    referenceVideoUrl: '/api/overseas/videos/ref-1/media-url', shotFirstFrameRef: '/api/frame/s-2', shotStartSeconds: 3 }]);
});
