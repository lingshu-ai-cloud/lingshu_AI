import assert from 'node:assert/strict';
import test from 'node:test';
import type { CaptionSegment } from '../../shared/contracts/emphasisTimeline.js';
import { normalizeGeminiMotionCandidates, resolveMotionEventWindows, resolveSemanticAnchorMs } from './studioMotionSemantics.js';

const captions: CaptionSegment[] = [{ id: 'cue-1', startMs: 1_000, endMs: 4_000, text: '看看这个核心卖点', words: [
  { id: 'w-look', startMs: 1_000, endMs: 1_500, text: '看看' },
  { id: 'w-fact', startMs: 2_000, endMs: 3_000, text: '核心卖点' },
] }];

test('resolves word and phrase anchors into compatibility windows on the server', () => {
  assert.equal(resolveSemanticAnchorMs({ cueId: 'cue-1', wordIds: ['w-fact'], boundary: 'center' }, captions), 2_500);
  const [event] = resolveMotionEventWindows([{
    id: 'fact', emphasisType: 'key_fact', anchor: { cueId: 'cue-1', wordIds: ['w-fact'], boundary: 'center' },
    target: { kind: 'caption', confidence: .9 }, visualRole: 'caption_companion',
  }], captions, 800);
  assert.equal(event?.startMs, 2_100);
  assert.equal(event?.endMs, 2_900);
  assert.equal(resolveSemanticAnchorMs({ cueId: 'cue-1', phrase: '核心卖点', boundary: 'start' }, captions), 2_500);
});

test('Gemini candidates cannot select assets, sounds, final coordinates or invalid relations', () => {
  const candidates = normalizeGeminiMotionCandidates([{
    id: 'candidate', emphasisType: 'key_fact', anchor: { cueId: 'cue-1', phrase: '核心卖点', boundary: 'start' },
    target: { kind: 'caption', label: '核心卖点', confidence: .95, box: { x: 0, y: 0, width: 1, height: 1 } },
    visualRole: 'caption_companion', componentId: '../../evil.gif', soundCueId: 'boom', x: .4, y: .5,
  }, {
    id: 'invalid', emphasisType: 'cta', anchor: { cueId: 'cue-1', boundary: 'start' },
    target: { kind: 'caption', confidence: .9 }, visualRole: 'corner_badge',
  }], captions);
  assert.deepEqual(candidates, [{
    id: 'candidate', emphasisType: 'key_fact', anchor: { cueId: 'cue-1', phrase: '核心卖点', boundary: 'start' },
    target: { kind: 'caption', label: '核心卖点', confidence: .95 }, visualRole: 'caption_companion',
  }]);
});
