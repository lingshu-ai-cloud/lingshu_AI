import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emphasisBudgetForDuration,
  deriveEmphasisIntent,
  captionWordsToText,
  mergeCaptionWordsForDisplay,
  normalizeCaptionCues,
  normalizeCaptionSegments,
  normalizeCaptionOccupancy,
  normalizeEmphasisTimeline,
  normalizeEmphasisPlan,
  normalizeShotWindows,
  normalizeVisualEvidence,
  selectEmphasisTimeline,
} from './emphasisTimeline.js';

test('normalizes the caption layer without promoting keywords to events', () => {
  assert.deepEqual(normalizeCaptionSegments([{
    id: 'line 1', startMs: -20, endMs: 1_800, text: '  支持 免费配送  ',
    speakerId: 'host A', keywords: ['免费配送', '不存在', '免费配送'],
  }], 5_000), [{
    id: 'line1', startMs: 0, endMs: 1_800, text: '支持 免费配送',
    speakerId: 'hostA', keywords: ['免费配送'],
  }]);
});

test('normalizes BCP 47 language and word alignment while retaining legacy cues', () => {
  const [aligned, legacy] = normalizeCaptionCues([{
    id: 'fr', startMs: 1_000, endMs: 3_000, text: "L'amour porte-monnaie.", language: 'fr_fr',
    words: [
      { text: "L'", startMs: 900, endMs: 1_200, alignmentTokenIds: ['a1'], confidence: 1.2 },
      { text: 'amour', startMs: 1_200, endMs: 1_800, alignmentTokenIds: ['a2'], confidence: .92 },
      { text: 'porte', startMs: 1_800, endMs: 2_150 },
      { text: '-', startMs: 2_150, endMs: 2_220 },
      { text: 'monnaie', startMs: 2_220, endMs: 2_700 },
      { text: '.', startMs: 2_700, endMs: 3_100 },
    ],
  }, { id: 'old', startMs: 3_000, endMs: 4_000, text: 'Legacy cue' }], 5_000);
  assert.equal(aligned?.language, 'fr-FR');
  assert.equal(aligned?.words?.[0]?.startMs, 1_000);
  assert.equal(aligned?.words?.at(-1)?.endMs, 3_000);
  assert.equal(aligned?.words?.[0]?.confidence, 1);
  assert.equal(captionWordsToText(aligned?.words || [], aligned?.language), "L'amour porte-monnaie.");
  assert.equal(legacy?.language, undefined);
  assert.equal(legacy?.words, undefined);
});

test('keeps German compounds whole and attaches punctuation without whitespace tokenization', () => {
  const words = normalizeCaptionCues([{
    id: 'de', startMs: 0, endMs: 2_000, text: 'Donaudampfschifffahrt, heute!', language: 'de-DE', words: [
      { text: 'Donaudampfschifffahrt', startMs: 0, endMs: 700, alignmentTokenIds: ['1'] },
      { text: ',', startMs: 700, endMs: 760, alignmentTokenIds: ['2'] },
      { text: 'heute', startMs: 800, endMs: 1_400, alignmentTokenIds: ['3'] },
      { text: '!', startMs: 1_400, endMs: 1_500, alignmentTokenIds: ['4'] },
    ],
  }], 2_000)[0]?.words || [];
  const display = mergeCaptionWordsForDisplay(words, 'de-DE');
  assert.deepEqual(display.map(word => word.text), ['Donaudampfschifffahrt,', 'heute!']);
  assert.deepEqual(display.map(word => word.alignmentTokenIds), [['1', '2'], ['3', '4']]);
  assert.equal(captionWordsToText(words, 'de-DE'), 'Donaudampfschifffahrt, heute!');
});

test('honors explicit separators and joins CJK display text without inventing spaces', () => {
  const [cue] = normalizeCaptionCues([{
    id: 'zh', startMs: 0, endMs: 1_000, text: '你好！', language: 'zh_hans', words: [
      { text: '你', startMs: 0, endMs: 300 },
      { text: '好', startMs: 300, endMs: 600 },
      { text: '！', startMs: 600, endMs: 800 },
    ],
  }], 1_000);
  assert.equal(cue?.language, 'zh-Hans');
  assert.equal(captionWordsToText(cue?.words || [], cue?.language), '你好！');
});

test('uses whole-film soft budgets including doubled long-form density', () => {
  assert.deepEqual(emphasisBudgetForDuration(10_000), { min: 2, max: 4 });
  assert.deepEqual(emphasisBudgetForDuration(25_000), { min: 4, max: 8 });
  assert.deepEqual(emphasisBudgetForDuration(45_000), { min: 6, max: 12 });
  assert.deepEqual(emphasisBudgetForDuration(61_000), { min: 6, max: 16 });
});

test('deduplicates repeated semantics, rejects weak facts and enforces one strong emphasis at a time', () => {
  const events = selectEmphasisTimeline({ durationMs: 30_000, candidates: [
    { id: 'hook', type: 'hook', startMs: 0, endMs: 1_500, text: '工厂直供', importance: 3, confidence: .9, source: 'transcript' },
    { id: 'weak-price', type: 'key_fact', startMs: 2_000, endMs: 3_000, text: '只要 99', importance: 3, confidence: .6, source: 'transcript' },
    { id: 'fact-early', type: 'key_fact', startMs: 5_000, endMs: 6_000, text: '免费配送', targetId: 'delivery', importance: 2, confidence: .9, source: 'transcript' },
    { id: 'fact-proof', type: 'key_fact', startMs: 12_000, endMs: 13_000, text: '免费配送', targetId: 'delivery', importance: 3, confidence: .96, source: 'metadata' },
    { id: 'reveal', type: 'reveal', startMs: 12_200, endMs: 13_100, text: '成品', importance: 2, confidence: .9, source: 'vision' },
  ] });
  assert.deepEqual(events.map(event => event.id), ['hook', 'fact-proof']);
});

test('lands a semantic event on the clearest safe supporting shot regardless of material duration', () => {
  const [event] = selectEmphasisTimeline({
    durationMs: 20_000,
    candidates: [{ id: 'factory', type: 'section_label', startMs: 2_000, endMs: 3_500, text: '精密加工', targetId: 'cnc', importance: 3, confidence: .9, source: 'vision' }],
    placementWindows: [
      { id: 'wide', startMs: 8_000, endMs: 11_000, targetIds: ['cnc'], safe: true, clarity: .6 },
      { id: 'detail', startMs: 14_000, endMs: 17_000, targetIds: ['cnc'], safe: true, clarity: .95,
        evidenceSource: 'vision', anchor: { x: .78, y: .22 }, subjectAnchor: { x: .42, y: .55 }, subjectBox: { x: .2, y: .3, width: .44, height: .5 } },
      { id: 'blocked', startMs: 4_000, endMs: 7_000, targetIds: ['cnc'], safe: false, clarity: 1 },
    ],
  });
  assert.equal(event?.startMs, 14_000);
  assert.equal(event?.endMs, 15_500);
  assert.deepEqual(event?.anchor, { x: .78, y: .22 });
  assert.deepEqual(event?.subjectAnchor, { x: .42, y: .55 });
  assert.deepEqual(event?.subjectBox, { x: .2, y: .3, width: .44, height: .5 });
  assert.deepEqual(event?.placementEvidence, { windowId: 'detail', targetId: 'cnc', clarity: .95, safe: true });
});

test('derives conservative semantic intents without naming concrete assets', () => {
  assert.deepEqual(deriveEmphasisIntent('key_fact', '面膜采用独立包装'), { visualIntent: 'focus_product', assetIntent: 'product_marker' });
  assert.deepEqual(deriveEmphasisIntent('key_fact', '限时优惠'), { visualIntent: 'urgency', assetIntent: 'urgency_badge' });
  assert.deepEqual(deriveEmphasisIntent('key_fact', '请勿接触眼睛'), { visualIntent: 'warning', assetIntent: 'warning_marker' });
  assert.deepEqual(deriveEmphasisIntent('cta', '查看详细介绍'), { visualIntent: 'cta', assetIntent: 'cta_marker' });
});

test('drops untrusted subject coordinates while preserving closed intent values', () => {
  const [event] = selectEmphasisTimeline({ durationMs: 5_000, candidates: [{
    id: 'unsafe', type: 'key_fact', startMs: 0, endMs: 1_000, text: '独立包装', importance: 2,
    confidence: .9, source: 'editor', visualIntent: 'execute_code', assetIntent: '/tmp/badge.svg',
    subjectAnchor: { x: .5, y: .5 }, subjectBox: { x: 0, y: 0, width: 1, height: 1 },
  }] });
  assert.equal(event?.visualIntent, 'focus_product');
  assert.equal(event?.assetIntent, 'product_marker');
  assert.equal(event?.subjectAnchor, undefined);
  assert.equal(event?.subjectBox, undefined);
});

test('preserves safe renderer placement hints and semantic evidence at the manifest boundary', () => {
  const plan = normalizeEmphasisPlan({ profile: 'product_showcase', maxEvents: 2, events: [{
    id: 'product-material', type: 'key_fact', startMs: 1_000, endMs: 2_200, text: '岩板台面',
    importance: 3, confidence: .96, source: 'editor', targetId: 'countertop', strength: 'strong',
    visualIntent: 'cta', assetIntent: 'cta_marker',
    anchor: { x: 1.4, y: -.2 }, safeArea: false,
    placementEvidence: { windowId: 'manual-product-shot', targetId: 'countertop', clarity: 2, safe: false },
  }] }, 5_000);
  assert.deepEqual(plan.events[0], {
    id: 'product-material', type: 'key_fact', startMs: 1_000, endMs: 2_200, text: '岩板台面',
    importance: 3, confidence: .96, source: 'editor', targetId: 'countertop', strength: 'strong',
    visualIntent: 'focus_product', assetIntent: 'product_marker',
    anchor: { x: .95, y: .05 }, safeArea: false,
    placementEvidence: { windowId: 'manual-product-shot', targetId: 'countertop', clarity: 1, safe: false },
  });
});

test('keeps hook and reveal closer only when they do not overlap', () => {
  const events = selectEmphasisTimeline({ durationMs: 10_000, candidates: [
    { id: 'hook', type: 'hook', startMs: 0, endMs: 1_000, importance: 3, confidence: 1, source: 'editor' },
    { id: 'reveal', type: 'reveal', startMs: 1_600, endMs: 2_500, importance: 3, confidence: 1, source: 'editor' },
    { id: 'section', type: 'section_label', startMs: 3_000, endMs: 4_000, importance: 3, confidence: 1, source: 'editor' },
  ] });
  assert.deepEqual(events.map(event => event.id), ['hook', 'reveal']);
});

test('normalizes the complete two-layer timeline with a stable schema version', () => {
  const timeline = normalizeEmphasisTimeline({
    schemaVersion: 999,
    captions: [{ startMs: 0, endMs: 1_000, text: '核心卖点' }],
    emphasisEvents: [{ type: 'hook', startMs: 0, endMs: 900, text: '核心卖点', importance: 3, confidence: 1, source: 'editor' }],
  }, 5_000);
  assert.equal(timeline.schemaVersion, 1);
  assert.equal(timeline.captions.length, 1);
  assert.equal(timeline.emphasisEvents.length, 1);
});

test('emits the canonical renderer manifest shape with a closed profile set', () => {
  const plan = normalizeEmphasisPlan({
    profile: 'arbitrary-css', maxEvents: 1,
    captions: [{ startMs: 0, endMs: 1_000, text: '字幕' }],
    events: [
      { id: 'hook', type: 'hook', startMs: 0, endMs: 900, text: '钩子', importance: 3, confidence: 1, source: 'editor' },
      { id: 'cta', type: 'cta', startMs: 3_000, endMs: 4_000, text: '咨询', importance: 3, confidence: 1, source: 'editor' },
    ],
  }, 5_000);
  assert.equal(plan.profile, 'talking_head');
  assert.equal(plan.maxEvents, 1);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.captions.length, 1);
});

test('normalizes shot, caption occupancy and trusted visual evidence contracts', () => {
  assert.deepEqual(normalizeShotWindows([
    { id: 'shot 1', startMs: -4, endMs: 1_200.4, confidence: 2, source: 'ffmpeg_scene' },
    { id: 'bad', startMs: 1_200, endMs: 900, source: 'storyboard' },
  ], 2_000), [{ id: 'shot1', startMs: 0, endMs: 1_200, confidence: 1, source: 'ffmpeg_scene' }]);
  assert.deepEqual(normalizeCaptionOccupancy([{
    id: 'burned in', startMs: 100, endMs: 900, text: '30 年', confidence: .8, source: 'ocr', editable: true,
    boxes: [{ x: .1, y: .8, width: .8, height: .1 }, { x: -.1, y: 0, width: .2, height: .2 }],
  }], 2_000), [{ id: 'burnedin', startMs: 100, endMs: 900, text: '30 年', boxes: [{ x: .1, y: .8, width: .8, height: .1 }],
    confidence: .8, source: 'ocr', editable: false }]);
  assert.deepEqual(normalizeVisualEvidence([{
    shotId: 'shot-1', subjectType: 'machine', subjectBox: { x: .2, y: .1, width: .6, height: .7 },
    subjectAnchor: { x: .5, y: .45 }, safeZones: [{ x: .05, y: .05, width: .2, height: .2, clarity: .9 }],
    captionBoxes: [], confidence: .9,
  }, { shotId: 'weak', subjectType: 'product', confidence: .4 }]), [{
    shotId: 'shot-1', subjectType: 'machine', subjectBox: { x: .2, y: .1, width: .6, height: .7 },
    subjectAnchor: { x: .5, y: .45 }, safeZones: [{ x: .05, y: .05, width: .2, height: .2, clarity: .9 }],
    captionBoxes: [], confidence: .9,
  }]);
});

test('preserves closed shot-aware presentation fields on normalized events', () => {
  const plan = normalizeEmphasisPlan({ events: [{
    id: 'aligned', type: 'key_fact', startMs: 1_000, endMs: 2_000, text: '30年工厂', importance: 3,
    confidence: 1, source: 'editor', shotId: 'shot-2', evidenceStartMs: 900, evidenceEndMs: 2_100,
    presentationMode: 'graphic_only', targetRelation: 'surround',
    assetFamily: 'rays',
    occupiedBoxes: [{ x: .1, y: .8, width: .8, height: .1 }, { x: .9, y: .9, width: .2, height: .2 }],
  }] }, 3_000);
  assert.deepEqual({
    shotId: plan.events[0]?.shotId, evidenceStartMs: plan.events[0]?.evidenceStartMs,
    evidenceEndMs: plan.events[0]?.evidenceEndMs, presentationMode: plan.events[0]?.presentationMode,
    targetRelation: plan.events[0]?.targetRelation, assetFamily: plan.events[0]?.assetFamily,
    occupiedBoxes: plan.events[0]?.occupiedBoxes,
  }, { shotId: 'shot-2', evidenceStartMs: 900, evidenceEndMs: 2_100, presentationMode: 'graphic_only',
    targetRelation: 'surround', assetFamily: 'corner_marker', occupiedBoxes: [{ x: .1, y: .8, width: .8, height: .1 }] });
});

test('normalizes event-scoped local focus and preferred composition hints', () => {
  assert.deepEqual(normalizeVisualEvidence([{
    shotId: 'shot-wide', eventId: 'fact-local', targetId: 'machine-head', subjectType: 'machine',
    subjectBox: { x: .68, y: .24, width: .2, height: .28 }, subjectAnchor: { x: .78, y: .38 },
    preferredSide: 'left', targetRelation: 'point_to', safeZones: [], captionBoxes: [], confidence: .92,
  }]), [{
    shotId: 'shot-wide', eventId: 'fact-local', targetId: 'machine-head', subjectType: 'machine',
    subjectBox: { x: .68, y: .24, width: .2, height: .28 }, subjectAnchor: { x: .78, y: .38 },
    safeZones: [], captionBoxes: [], confidence: .92, preferredSide: 'left', targetRelation: 'point_to',
  }]);
});

test('drops scene-sized subject boxes while keeping a bindable anchor', () => {
  assert.deepEqual(normalizeVisualEvidence([{
    shotId: 'shot-wide', subjectType: 'product', subjectBox: { x: 0, y: 0, width: 1, height: 1 },
    subjectAnchor: { x: .48, y: .42 }, safeZones: [], captionBoxes: [], confidence: .9,
  }]), [{
    shotId: 'shot-wide', subjectType: 'product', subjectAnchor: { x: .48, y: .42 },
    safeZones: [], captionBoxes: [], confidence: .9,
  }]);
});
