import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAndDegradeEmphasisLayouts, type EmphasisLayoutQaEvent } from './studioEmphasisLayoutQa.js';

const base = (value: Partial<EmphasisLayoutQaEvent> = {}): EmphasisLayoutQaEvent => ({
  id: 'event', startMs: 1_000, endMs: 2_000, text: '30年工厂', importance: 3, confidence: .9,
  presentationMode: 'label', targetRelation: 'adjacent', assetId: 'marker', assetFamily: 'corner_marker',
  semanticEvidence: { cueId: 'cue' }, shotId: 'shot', subjectBox: { x: .4, y: .25, width: .2, height: .25 },
  captionBoxes: [{ x: .1, y: .62, width: .8, height: .06 }],
  layout: { asset: { x: .63, y: .3, width: .08, height: .08 }, label: { x: .73, y: .3, width: .16, height: .07 } },
  ...value,
});

test('accepts deterministic surround geometry only when visible regions span target outer edges', () => {
  const accepted = validateAndDegradeEmphasisLayouts([base({ presentationMode: 'graphic_only', targetRelation: 'surround', assetFamily: 'rays',
    layout: { asset: { x: .32, y: .17, width: .36, height: .41 }, visibleRegions: [
      { x: .33, y: .20, width: .06, height: .28 }, { x: .61, y: .20, width: .06, height: .28 },
      { x: .43, y: .18, width: .14, height: .06 },
    ] } })])[0]!;
  assert.equal(accepted.presentationMode, 'graphic_only');
  assert.equal(accepted.qa.accepted, true);
  const centerOnly = validateAndDegradeEmphasisLayouts([base({ presentationMode: 'graphic_only', targetRelation: 'surround', assetFamily: 'rays',
    layout: { asset: { x: .43, y: .30, width: .14, height: .12 }, visibleRegions: [{ x: .44, y: .31, width: .12, height: .1 }] } })])[0]!;
  assert.equal(centerOnly.presentationMode, 'caption_emphasis');
  assert.ok(centerOnly.qa.issues.includes('surround_not_distributed_on_outer_edges'));
});

test('checks point-to tip and adjacent distance, then uses the strict degradation chain', () => {
  const point = validateAndDegradeEmphasisLayouts([base({ targetRelation: 'point_to', subjectAnchor: { x: .5, y: .37 },
    layout: { asset: { x: .64, y: .30, width: .08, height: .08 }, label: { x: .73, y: .3, width: .16, height: .07 },
      pointerTip: { x: .51, y: .38 } } })])[0]!;
  assert.equal(point.presentationMode, 'label');
  const blocked = validateAndDegradeEmphasisLayouts([base({ targetRelation: 'point_to', assetFamily: 'rays',
    captionEditable: false, subjectAnchor: { x: .5, y: .37 },
    layout: { asset: { x: .45, y: .3, width: .1, height: .1 }, pointerTip: { x: .8, y: .1 } } })])[0]!;
  assert.equal(blocked.presentationMode, 'none');
  assert.deepEqual(blocked.qa.attempted, ['relation:point_to', 'graphic_only', 'caption_emphasis', 'none']);
});

test('rejects caption, subject, safe-frame and multi-decoration collisions', () => {
  const result = validateAndDegradeEmphasisLayouts([base({
    layout: { asset: { x: .4, y: .64, width: .2, height: .1 }, primaryDecorations: [
      { id: 'one', box: { x: .4, y: .64, width: .1, height: .1 } },
      { id: 'two', box: { x: .5, y: .64, width: .1, height: .1 } },
    ] },
  })])[0]!;
  assert.equal(result.presentationMode, 'caption_emphasis');
  assert.ok(result.qa.issues.includes('outside_safe_frame'));
  assert.ok(result.qa.issues.includes('occupied_collision'));
  assert.ok(result.qa.issues.includes('multiple_primary_decorations'));
});

test('keeps the higher-priority same-screen event and enforces four-second asset cooldown', () => {
  const results = validateAndDegradeEmphasisLayouts([
    base({ id: 'low', importance: 1, startMs: 1_000, endMs: 2_000, assetId: 'low-marker' }),
    base({ id: 'high', importance: 3, startMs: 1_200, endMs: 2_200 }),
    base({ id: 'repeat', importance: 2, startMs: 4_500, endMs: 5_200 }),
  ]);
  assert.equal(results.find(item => item.id === 'high')?.presentationMode, 'label');
  assert.equal(results.find(item => item.id === 'low')?.presentationMode, 'caption_emphasis');
  assert.ok(results.find(item => item.id === 'low')?.qa.issues.some(issue => issue.startsWith('same_screen_conflict:')));
  assert.equal(results.find(item => item.id === 'repeat')?.presentationMode, 'caption_emphasis');
  assert.ok(results.find(item => item.id === 'repeat')?.qa.issues.some(issue => issue.startsWith('asset_cooldown:')));
});

test('corner badge stays in a corner and never collides with target or captions', () => {
  const accepted = validateAndDegradeEmphasisLayouts([base({ targetRelation: 'corner_badge', subjectBox: undefined,
    layout: { asset: { x: .80, y: .06, width: .12, height: .08 }, label: { x: .62, y: .06, width: .15, height: .07 } } })])[0]!;
  assert.equal(accepted.presentationMode, 'label');
  const collision = validateAndDegradeEmphasisLayouts([base({ targetRelation: 'corner_badge',
    subjectBox: { x: .78, y: .05, width: .16, height: .15 },
    layout: { asset: { x: .80, y: .06, width: .12, height: .08 } } })])[0]!;
  assert.equal(collision.presentationMode, 'caption_emphasis');
  assert.ok(collision.qa.issues.includes('corner_badge_target_collision'));
  const rays = validateAndDegradeEmphasisLayouts([base({ targetRelation: 'corner_badge', assetFamily: 'rays',
    layout: { asset: { x: .80, y: .06, width: .12, height: .08 }, label: { x: .62, y: .06, width: .15, height: .07 } } })])[0]!;
  assert.equal(rays.presentationMode, 'caption_emphasis');
  assert.ok(rays.qa.issues.includes('rays_require_surround'));
});

test('requires semantic evidence and a shot window before keeping an advanced decoration', () => {
  const result = validateAndDegradeEmphasisLayouts([base({ semanticEvidence: undefined, shotId: undefined })])[0]!;
  assert.equal(result.presentationMode, 'caption_emphasis');
  assert.ok(result.qa.issues.includes('missing_semantic_evidence'));
  assert.ok(result.qa.issues.includes('missing_shot_window'));
});
