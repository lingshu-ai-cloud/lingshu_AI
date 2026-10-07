import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStudioEmphasisPlan, recommendStudioSubtitleProfile } from './studioEmphasisManifest.js';

test('recommends a profile from the full render context', () => {
  assert.equal(recommendStudioSubtitleProfile({ script: '进入车间查看精密加工和质检' }), 'factory_process');
  assert.equal(recommendStudioSubtitleProfile({ script: '这款产品采用岩板台面，尺寸可定制' }), 'product_showcase');
  assert.equal(recommendStudioSubtitleProfile({ script: '69.9 四支正装，限时优惠' }), 'd2c_dialogue');
  assert.equal(recommendStudioSubtitleProfile({ script: '今天给大家讲一下我们的服务' }), 'talking_head');
});

test('builds captions and a sparse plan from existing subtitle cues without UI input', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 12,
    script: '69.9 四支正装，欢迎私信咨询',
    subtitles: { cues: [
      { start: 0, end: 1.8, text: '69.9 四支正装' },
      { start: 5, end: 6.5, text: '核心配方升级' },
      { start: 9, end: 11, text: '欢迎私信咨询' },
    ] },
  });
  assert.equal(plan.profile, 'd2c_dialogue');
  assert.equal(plan.captions.length, 3);
  assert.ok(plan.events.some(event => event.type === 'hook'));
  assert.ok(plan.events.some(event => event.type === 'cta'));
  assert.ok(plan.events.length <= 4, '12-second output uses the whole-film budget');
});

test('honors an authored profile and normalizes authored events', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 20,
    script: '普通口播', subtitles: { cues: [] },
    emphasisPlan: {
      profile: 'product_showcase', maxEvents: 1,
      events: [
        { id: 'one', type: 'reveal', startMs: 2_000, endMs: 3_000, text: '成品效果', importance: 3, confidence: .95, source: 'editor' },
        { id: 'two', type: 'cta', startMs: 10_000, endMs: 11_000, text: '立即咨询', importance: 2, confidence: .9, source: 'editor' },
      ],
    },
  });
  assert.equal(plan.profile, 'product_showcase');
  assert.deepEqual(plan.events.map(event => event.id), ['one']);
});

test('extracts a concise key fact instead of rendering storyboard production metadata', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 12,
    subtitles: { cues: [{ start: 0, end: 2, text: '产品介绍' }] },
    timeline: [{
      targetStart: 3.5,
      targetEnd: 8.5,
      caption: '环境：按实物环境 景别：特写 运镜：固定 镜头功能：展示产品 画面：手持产品 配乐：无 字幕：起订量只要1件',
    }],
  });
  const fact = plan.events.find(event => event.type === 'key_fact');
  assert.equal(fact?.text, '1件起订');
  assert.equal(fact?.text.includes('环境：'), false);
});
