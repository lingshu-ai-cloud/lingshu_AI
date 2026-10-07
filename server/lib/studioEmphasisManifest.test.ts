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

test('does not turn unsupported storyboard production metadata into a business sticker', () => {
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
  assert.equal(fact, undefined);
});

test('uses storyboard metadata only when nearby speech independently supports the event', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 12,
    subtitles: { cues: [
      { start: 0, end: 1, text: '下面看产品' },
      { start: 5, end: 6.5, text: '1件也可以起订' },
    ] },
    timeline: [{ targetStart: 5, targetEnd: 8.5, caption: '字幕：起订量只要1件' }],
  });
  assert.equal(plan.events.find(event => event.type === 'key_fact')?.text, '1件起订');
});

test('allows an explicit user business fact to ground a timeline event', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 12,
    businessFacts: { moq: '1件起订' },
    subtitles: { cues: [{ start: 0, end: 2, text: '下面看一下产品' }] },
    timeline: [{ targetStart: 4, targetEnd: 7, caption: '字幕：起订量只要1件' }],
  });
  assert.equal(plan.events.find(event => event.type === 'key_fact')?.text, '1件起订');
});

test('does not add unrelated ordering, fulfillment or contact stickers to skincare speech', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 16,
    script: '先清洁皮肤，再轻轻涂抹面霜，最后按摩吸收。',
    subtitles: { cues: [
      { start: 0, end: 3, text: '先清洁皮肤' },
      { start: 5, end: 8, text: '再轻轻涂抹面霜' },
      { start: 10, end: 13, text: '最后按摩吸收' },
    ] },
    timeline: [
      { targetStart: 3, targetEnd: 5, purpose: '起订量只要1件' },
      { targetStart: 8, targetEnd: 10, purpose: '马上配货' },
      { targetStart: 13, targetEnd: 15, purpose: '联系 Messenger 咨询' },
    ],
  });
  assert.deepEqual(plan.events.map(event => event.type), ['hook']);
});

test('keeps a 21-second skincare draft useful with sparse transcript-grounded facts and CTA', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 21,
    script: '温和清洁之后使用面膜，可以用于日常护肤。面膜采用独立包装。想了解产品，请查看详细介绍。',
    subtitles: { cues: [
      { start: 0, end: 5.5, text: '温和清洁之后使用面膜，可以用于日常护肤' },
      { start: 6.5, end: 12, text: '日常护理时按照说明使用' },
      { start: 13, end: 16.7, text: '面膜采用独立包装' },
      { start: 17.1, end: 20.7, text: '想了解产品，请查看详细介绍' },
    ] },
    timeline: [
      { targetStart: 3, targetEnd: 5, purpose: '起订量只要1件' },
      { targetStart: 8, targetEnd: 10, purpose: '马上配货' },
      { targetStart: 13, targetEnd: 15, purpose: '联系 Messenger 咨询' },
    ],
  });
  assert.deepEqual(plan.events.map(event => [event.type, event.text]), [
    ['hook', '温和清洁之后使用面膜，可以用于日常护肤'],
    ['key_fact', '独立包装'],
    ['cta', '查看详细介绍'],
  ]);
  assert.equal(plan.events.find(event => event.text === '独立包装')?.endMs, 14_800);
  assert.equal(plan.events.find(event => event.type === 'cta')?.endMs, 19_100);
  assert.ok(plan.events.length >= 3 && plan.events.length <= 5);
  assert.doesNotMatch(plan.events.map(event => event.text).join(' '), /起订|配货|Messenger/i);
});

test('passes semantic intents and only trusted subject geometry through the manifest', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 8,
    subtitles: { cues: [] },
    emphasisPlan: {
      profile: 'product_showcase',
      events: [{ id: 'product', type: 'key_fact', startMs: 1_000, endMs: 2_500, text: '面膜独立包装',
        importance: 3, confidence: .95, source: 'editor', targetId: 'mask-pack' }],
      placementWindows: [{ id: 'product-shot', startMs: 1_000, endMs: 3_000, targetIds: ['mask-pack'],
        safe: true, clarity: .92, evidenceSource: 'vision', subjectAnchor: { x: .48, y: .52 },
        subjectBox: { x: .3, y: .25, width: .36, height: .55 } }],
    },
  });
  assert.deepEqual({
    visualIntent: plan.events[0]?.visualIntent,
    assetIntent: plan.events[0]?.assetIntent,
    subjectAnchor: plan.events[0]?.subjectAnchor,
    subjectBox: plan.events[0]?.subjectBox,
  }, {
    visualIntent: 'focus_product', assetIntent: 'product_marker', subjectAnchor: { x: .48, y: .52 },
    subjectBox: { x: .3, y: .25, width: .36, height: .55 },
  });
});

test('accepts optional preanalysis and signs shot-aware presentation into the manifest plan', () => {
  const plan = buildStudioEmphasisPlan({
    durationSeconds: 4,
    subtitles: { cues: [{ start: .4, end: 2.8, text: '我们拥有30年灯具工厂经验' }] },
    emphasisPlan: { profile: 'factory_process', events: [{
      id: 'factory-years', type: 'key_fact', startMs: 400, endMs: 2_800, text: '30年灯具工厂',
      importance: 3, confidence: .95, source: 'editor',
    }] },
    emphasisPreanalysis: {
      shotWindows: [{ id: 'factory-shot', startMs: 0, endMs: 3_000, confidence: .95, source: 'ffmpeg_scene' }],
      visualEvidence: [{ shotId: 'factory-shot', subjectType: 'machine', subjectBox: { x: .2, y: .2, width: .6, height: .6 },
        safeZones: [], captionBoxes: [], confidence: .9 }],
    },
  });
  assert.deepEqual({
    shotId: plan.events[0]?.shotId, startMs: plan.events[0]?.startMs, endMs: plan.events[0]?.endMs,
    presentationMode: plan.events[0]?.presentationMode, targetRelation: plan.events[0]?.targetRelation,
  }, { shotId: 'factory-shot', startMs: 400, endMs: 2_800, presentationMode: 'caption_emphasis', targetRelation: 'none' });
});

test('keeps manifest output backward compatible when no preanalysis is supplied', () => {
  const plan = buildStudioEmphasisPlan({ durationSeconds: 4, subtitles: { cues: [] }, emphasisPlan: { events: [{
    id: 'legacy', type: 'reveal', startMs: 500, endMs: 1_500, text: '成品效果', importance: 2, confidence: .9, source: 'editor',
  }] } });
  assert.equal(plan.events[0]?.shotId, undefined);
  assert.equal(plan.events[0]?.presentationMode, undefined);
});
