import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEffectPlan } from '../../shared/contracts/effectPlan.js';
import { socialDirectorRenderTimeline } from './socialContentDirectorHandoff.js';
import type { SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';

test('high-confidence beat evidence may nudge an internal cut without moving the audio timeline materially', () => {
  const effectPlan = normalizeEffectPlan({
    schemaVersion: 1, presetId: 'natural', intensity: 1, beatSync: true, seed: 1,
    beatEvidence: {
      schemaVersion: 'beat-grid.v1', source: 'local_onset_grid', bpm: 120,
      beats: [.5, 1, 1.5, 2], confidence: .9, analyzedSeconds: 2, sourceHash: 'abc123',
    },
    scenes: [
      { sceneId: 'scene-1', enabled: true, motion: 'none', color: 'original', transitionOut: { type: 'cut', duration: 0 }, overlays: [] },
      { sceneId: 'scene-2', enabled: true, motion: 'none', color: 'original', transitionOut: { type: 'cut', duration: 0 }, overlays: [] },
    ],
  }, [{ sceneId: 'scene-1', targetDuration: 1 }, { sceneId: 'scene-2', targetDuration: 1 }]);
  const handoff = {
    effectPlan,
    scenes: [
      { sceneId: 'scene-1', source: { type: 'video', assetName: 'a', renderUrl: 'a', sourceStart: 0, sourceEnd: 2 } },
      { sceneId: 'scene-2', source: { type: 'video', assetName: 'b', renderUrl: 'b', sourceStart: 0, sourceEnd: 2 } },
    ],
  } as unknown as SocialDirectorContentHandoff;
  const timeline = socialDirectorRenderTimeline(handoff, 2, [{ start: 0, end: 1.1 }, { start: 1.1, end: 2 }]);
  assert.equal(timeline[0]?.targetEnd, 1);
  assert.equal(timeline[1]?.targetStart, 1);
});

test('beat evidence outside the 120ms safety window cannot move a cut', () => {
  const effectPlan = normalizeEffectPlan({
    schemaVersion: 1, presetId: 'natural', intensity: 1, beatSync: true, seed: 1,
    beatEvidence: {
      schemaVersion: 'beat-grid.v1', source: 'local_onset_grid', bpm: 120,
      beats: [.5, 1, 1.5, 2], confidence: .9, analyzedSeconds: 2, sourceHash: 'abc123',
    },
    scenes: [{ sceneId: 'scene-1' }, { sceneId: 'scene-2' }],
  }, [{ sceneId: 'scene-1', targetDuration: 1 }, { sceneId: 'scene-2', targetDuration: 1 }]);
  const handoff = { effectPlan, scenes: [
    { sceneId: 'scene-1', source: { type: 'video', assetName: 'a', renderUrl: 'a', sourceStart: 0, sourceEnd: 2 } },
    { sceneId: 'scene-2', source: { type: 'video', assetName: 'b', renderUrl: 'b', sourceStart: 0, sourceEnd: 2 } },
  ] } as unknown as SocialDirectorContentHandoff;
  const timeline = socialDirectorRenderTimeline(handoff, 2.4, [{ start: 0, end: 1.2 }, { start: 1.2, end: 2.4 }]);
  assert.equal(timeline[0]?.targetEnd, 1.2);
});
