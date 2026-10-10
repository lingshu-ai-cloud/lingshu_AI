/* eslint-disable */
const assert = require('node:assert/strict');
const test = require('node:test');
const { qaAdvancedEvents } = require('./emphasis-layout-qa.cjs');

const event = value => ({ id: 'event', type: 'key_fact', startMs: 0, endMs: 900, text: '事实',
  importance: 2, confidence: .9, presentationMode: 'graphic_only', semanticEvidence: { cueId: 'cue' }, shotId: 'shot',
  assetKind: 'warning', motionRole: 'corner_badge', layout: { asset: { x: .82, y: .06, width: .1, height: .08 } }, ...value });

test('fails closed when surround rays are detached or do not enclose target outer edges', () => {
  const detached = qaAdvancedEvents([event({ assetKind: 'reveal', motionRole: 'corner_badge' })]);
  assert.equal(detached.events.length, 0);
  assert.ok(detached.decisions[0].issues.includes('detached_rays'));
  const target = { x: .4, y: .25, width: .2, height: .2 };
  const misplaced = qaAdvancedEvents([event({ assetKind: 'reveal', motionRole: 'surround', subjectBox: target,
    layout: { asset: { x: .64, y: .25, width: .12, height: .12 } } })]);
  assert.equal(misplaced.events.length, 0);
  assert.ok(misplaced.decisions[0].issues.includes('surround_not_on_outer_edges'));
  const valid = qaAdvancedEvents([event({ assetKind: 'reveal', motionRole: 'surround', subjectBox: target,
    layout: { asset: { x: .38, y: .23, width: .24, height: .24 } } })]);
  assert.equal(valid.events.length, 1);
});

test('same-screen priority and four-second asset cooldown remove actual advanced events', () => {
  const result = qaAdvancedEvents([
    event({ id: 'low', importance: 1, assetId: 'badge-a', startMs: 1_000, endMs: 2_000 }),
    event({ id: 'high', importance: 3, assetId: 'badge-a', startMs: 1_200, endMs: 2_200 }),
    event({ id: 'repeat', importance: 2, assetId: 'badge-a', startMs: 4_500, endMs: 5_200 }),
    event({ id: 'later', importance: 1, assetId: 'badge-a', startMs: 5_300, endMs: 6_000 }),
  ]);
  assert.deepEqual(result.events.map(item => item.id), ['high', 'later']);
  assert.ok(result.decisions.find(item => item.eventId === 'low').issues.some(issue => issue.startsWith('same_screen_conflict:')));
  assert.ok(result.decisions.find(item => item.eventId === 'repeat').issues.some(issue => issue.startsWith('asset_cooldown:')));
});

test('occupied rectangles and single-decoration rule degrade to caption emphasis', () => {
  const result = qaAdvancedEvents([event({ primaryDecorationCount: 2,
    captionBoxes: [{ x: .8, y: .04, width: .15, height: .12 }] })]);
  assert.equal(result.events.length, 0);
  assert.equal(result.decisions[0].outcome, 'caption_emphasis');
  assert.ok(result.decisions[0].issues.includes('multiple_primary_decorations'));
  assert.ok(result.decisions[0].issues.includes('occupied_collision'));
});

test('caption companion and frame corner badge accept cue evidence without a shot id', () => {
  const result = qaAdvancedEvents([
    event({ id: 'corner', shotId: undefined, semanticEvidence: undefined, semanticAnchor: { cueId: 'cue' } }),
    event({ id: 'caption', shotId: undefined, semanticEvidence: undefined, semanticAnchor: { cueId: 'cue' },
      motionRole: 'caption_companion', startMs: 1_000, endMs: 1_900,
      assetId: 'caption-accent',
      layout: { asset: { x: .35, y: .61, width: .2, height: .05 } } }),
  ]);
  assert.deepEqual(result.events.map(item => item.id), ['corner', 'caption']);
});
