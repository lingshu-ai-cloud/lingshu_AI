import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmphasisEvent } from '../../shared/contracts/emphasisTimeline.js';
import { alignStudioEmphasisEvents, emphasisTextRepeats } from './studioEmphasisAlignment.js';

const event = (value: Partial<EmphasisEvent> = {}): EmphasisEvent => ({
  id: 'fact', type: 'key_fact', startMs: 800, endMs: 1_900, text: '30年灯具工厂',
  importance: 3, confidence: .9, source: 'editor', visualIntent: 'attention', assetIntent: 'fact_label', ...value,
});

test('aligns evidence to its strongest shot and never crosses a shot boundary', () => {
  const [aligned] = alignStudioEmphasisEvents({ durationMs: 2_000, events: [event()], captions: [
    { id: 'caption', startMs: 900, endMs: 1_700, text: '拥有30年灯具工厂经验' },
  ], preanalysis: { shotWindows: [
    { id: 'shot-a', startMs: 0, endMs: 1_000, confidence: .9, source: 'ffmpeg_scene' },
    { id: 'shot-b', startMs: 1_000, endMs: 2_000, confidence: .9, source: 'ffmpeg_scene' },
  ] } });
  assert.deepEqual({ startMs: aligned?.startMs, endMs: aligned?.endMs, shotId: aligned?.shotId,
    evidenceStartMs: aligned?.evidenceStartMs, evidenceEndMs: aligned?.evidenceEndMs },
  { startMs: 1_100, endMs: 1_900, shotId: 'shot-b', evidenceStartMs: 900, evidenceEndMs: 1_700 });
  assert.equal(aligned?.presentationMode, 'caption_emphasis');
});

test('uses numeric-unit and bidirectional containment to suppress duplicate labels', () => {
  assert.equal(emphasisTextRepeats('30年灯具工厂', '我们拥有30年灯具生产经验'), true);
  assert.equal(emphasisTextRepeats('低至 69.9 元', '今日价格69.9元起'), true);
  assert.equal(emphasisTextRepeats('独立包装', '精密加工'), false);
});

test('uses graphic-only for immutable OCR duplicates when trusted subject evidence exists', () => {
  const [aligned] = alignStudioEmphasisEvents({ durationMs: 3_000, events: [event({
    startMs: 500, endMs: 2_500, evidenceStartMs: 400, evidenceEndMs: 2_600,
  })], captions: [], preanalysis: {
    shotWindows: [{ id: 'machine-shot', startMs: 0, endMs: 3_000, confidence: .95, source: 'ffmpeg_scene' }],
    captionOccupancy: [{ id: 'ocr', startMs: 300, endMs: 2_700, text: '30年灯具工厂',
      boxes: [{ x: .1, y: .8, width: .8, height: .1 }], confidence: .9, source: 'ocr' }],
    visualEvidence: [{ shotId: 'machine-shot', subjectType: 'machine', subjectBox: { x: .2, y: .2, width: .6, height: .6 },
      subjectAnchor: { x: .5, y: .5 }, safeZones: [], captionBoxes: [{ x: .08, y: .68, width: .84, height: .08 }], confidence: .9 }],
  } });
  assert.equal(aligned?.presentationMode, 'graphic_only');
  assert.equal(aligned?.targetRelation, 'adjacent');
  assert.equal(aligned?.assetFamily, 'corner_marker');
  assert.deepEqual(aligned?.subjectBox, { x: .2, y: .2, width: .6, height: .6 });
  assert.deepEqual(aligned?.occupiedBoxes, [
    { x: .1, y: .8, width: .8, height: .1 },
    { x: .08, y: .68, width: .84, height: .08 },
  ]);
});

test('selects event-scoped local focus and preserves its preferred side over a wide-shot subject', () => {
  const [aligned] = alignStudioEmphasisEvents({ durationMs: 3_000, events: [event({
    id: 'local-fact', targetId: 'machine-head', startMs: 400, endMs: 2_400, evidenceStartMs: 400, evidenceEndMs: 2_400,
  })], captions: [], preanalysis: {
    shotWindows: [{ id: 'wide-shot', startMs: 0, endMs: 3_000, confidence: .95, source: 'ffmpeg_scene' }],
    visualEvidence: [
      { shotId: 'wide-shot', subjectType: 'machine', subjectBox: { x: .05, y: .1, width: .9, height: .75 },
        safeZones: [], captionBoxes: [{ x: .05, y: .78, width: .9, height: .12 }], confidence: .9 },
      { shotId: 'wide-shot', eventId: 'local-fact', targetId: 'machine-head', subjectType: 'machine',
        subjectBox: { x: .7, y: .2, width: .18, height: .25 }, subjectAnchor: { x: .79, y: .32 },
        preferredSide: 'left', targetRelation: 'point_to', safeZones: [], captionBoxes: [], confidence: .88 },
    ],
  } });
  assert.equal(aligned?.presentationMode, 'graphic_only');
  assert.deepEqual(aligned?.subjectBox, { x: .7, y: .2, width: .18, height: .25 });
  assert.deepEqual(aligned?.subjectAnchor, { x: .79, y: .32 });
  assert.equal(aligned?.targetRelation, 'point_to');
  assert.equal(aligned?.preferredSide, 'left');
  assert.equal(aligned?.assetFamily, 'corner_marker');
  assert.deepEqual(aligned?.occupiedBoxes, [{ x: .05, y: .78, width: .9, height: .12 }]);
});

test('authorizes surround rays only for trusted event-scoped local targets', () => {
  const [local, detached] = alignStudioEmphasisEvents({ durationMs: 5_000, events: [
    event({ id: 'local', targetId: 'detail', startMs: 400, endMs: 1_700, evidenceStartMs: 400, evidenceEndMs: 1_700 }),
    event({ id: 'detached', startMs: 2_200, endMs: 3_500, text: '支持定制', evidenceStartMs: 2_200, evidenceEndMs: 3_500 }),
  ], captions: [], preanalysis: {
    shotWindows: [
      { id: 'shot-local', startMs: 0, endMs: 2_000, confidence: .95, source: 'ffmpeg_scene' },
      { id: 'shot-detached', startMs: 2_000, endMs: 4_000, confidence: .95, source: 'ffmpeg_scene' },
    ],
    visualEvidence: [{ shotId: 'shot-local', eventId: 'local', targetId: 'detail', subjectType: 'product',
      subjectBox: { x: .62, y: .2, width: .2, height: .25 }, targetRelation: 'surround',
      safeZones: [], captionBoxes: [], confidence: .9 }],
  } });
  assert.deepEqual({ relation: local?.targetRelation, family: local?.assetFamily }, { relation: 'surround', family: 'rays' });
  assert.deepEqual({ relation: detached?.targetRelation, family: detached?.assetFamily }, { relation: 'none', family: 'corner_marker' });
});

test('allows a new fact label without a subject and degrades sub-500ms windows', () => {
  const preanalysis = { shotWindows: [{ id: 'shot', startMs: 0, endMs: 2_000, confidence: .9, source: 'storyboard' }] };
  const [label] = alignStudioEmphasisEvents({ durationMs: 2_000, events: [event({ startMs: 500, endMs: 1_500, text: '独立包装' })],
    captions: [], preanalysis: { ...preanalysis, captionOccupancy: [{ id: 'ocr-other', startMs: 400, endMs: 1_600,
      text: '使用方法', boxes: [{ x: .05, y: .75, width: .9, height: .12 }], confidence: .9, source: 'ocr' }] } });
  assert.equal(label?.presentationMode, 'label');
  assert.deepEqual(label?.occupiedBoxes, [{ x: .05, y: .75, width: .9, height: .12 }],
    'label events expose occupied caption rectangles so renderer layout cannot cover them');
  const [editableShort] = alignStudioEmphasisEvents({ durationMs: 2_000, events: [event({ startMs: 800, endMs: 1_150 })],
    captions: [{ id: 'line', startMs: 800, endMs: 1_150, text: '30年灯具工厂' }], preanalysis });
  assert.equal(editableShort?.presentationMode, 'caption_emphasis');
  const [immutableShort] = alignStudioEmphasisEvents({ durationMs: 2_000, events: [event({ startMs: 800, endMs: 1_150,
    evidenceStartMs: 800, evidenceEndMs: 1_150 })], captions: [], preanalysis: { ...preanalysis,
      captionOccupancy: [{ id: 'ocr', startMs: 800, endMs: 1_150, text: '30年灯具工厂', boxes: [], confidence: .9, source: 'ocr' }] } });
  assert.equal(immutableShort?.presentationMode, 'none');
});

test('keeps at most one main decoration per shot', () => {
  const events = alignStudioEmphasisEvents({ durationMs: 4_000, events: [
    event({ id: 'primary', startMs: 500, endMs: 1_500, text: '独立包装', importance: 3 }),
    event({ id: 'secondary', startMs: 2_000, endMs: 3_000, text: '支持定制', importance: 1 }),
  ], captions: [], preanalysis: { shotWindows: [{ id: 'one-shot', startMs: 0, endMs: 4_000, confidence: .9, source: 'fallback' }] } });
  assert.deepEqual(events.map(item => [item.id, item.presentationMode]), [['primary', 'label'], ['secondary', 'none']]);
});

test('keeps legacy events unchanged when preanalysis has no usable shot windows', () => {
  const original = event();
  assert.deepEqual(alignStudioEmphasisEvents({ durationMs: 2_000, events: [original], captions: [], preanalysis: {} }), [original]);
});
