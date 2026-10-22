import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metadataFallbackAnalysis } from './videoCrawlerMetadataFallback.js';

test('metadata-only fallback preserves planning hints without observed-video claims', () => {
  const input = { platform: 'instagram' as const, title: 'Bottle &amp; cap', views: '1.2k',
    tags: ['packaging', 'factory'], duration: 15 };
  const result = metadataFallbackAnalysis(input);
  assert.match(result.theme, /短视频种草/);
  assert.match(result.theme, /Bottle &amp; cap/);
  assert.deepEqual(result.sellingPoints, ['可围绕「packaging」展开卖点或场景', '可围绕「factory」展开卖点或场景']);
  assert.equal(result.scriptDetails15s?.length, 5);
  assert.equal(result.recommendedScriptType, 'voiceover');
  assert.deepEqual(input.tags, ['packaging', 'factory']);
});

test('long video metadata stays a storyboard hint with no synthetic observed evidence', () => {
  const result = metadataFallbackAnalysis({ platform: 'youtube', title: 'Factory tour', views: '', tags: [], duration: 120 });
  assert.match(result.theme, /长视频评测\/教程/);
  assert.equal(result.recommendedScriptType, 'storyboard');
  assert.equal(result.firstTenSeconds?.camera, '建议先按近景展示、快速切换、结果对比三类镜头理解；视频级分析完成后会回填真实运镜细节。');
  assert.equal(result.sellingPoints?.length, 4);
});
