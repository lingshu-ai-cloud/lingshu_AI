/* eslint-disable */
const assert = require('node:assert/strict');
const { advancedEvents, resolveOverlayPlacement } = require('./remotion-overlay.cjs');

const selected = advancedEvents({ events: [
  { id: 'hook', type: 'hook', startMs: 0, endMs: 800, text: '开场' },
  { id: 'fact', type: 'key_fact', startMs: 1200, endMs: 2200, text: '1件起订' },
  { id: 'section', type: 'section_label', startMs: 2500, endMs: 3200, text: '工厂实力' },
  { id: 'cta', type: 'cta', startMs: 3500, endMs: 4500, text: '立即咨询' },
] });

assert.deepEqual(selected.map(event => event.id), ['fact', 'cta']);
assert.equal(selected[0].placement.y, .22);
assert.notEqual(selected[0].placement.x, .5, 'fallback stickers avoid the likely central subject');
assert.ok(selected[1].placement.y <= .68, 'CTA stays above speech captions and platform controls');

assert.deepEqual(resolveOverlayPlacement({ id: 'explicit', anchor: { x: .8, y: .3 } }), { x: .8, y: .3, source: 'anchor' });
assert.deepEqual(resolveOverlayPlacement({ id: 'unsafe-anchor', anchor: { x: .99, y: .95 } }), { x: .84, y: .68, source: 'anchor' });
const unsafeAreaFallback = resolveOverlayPlacement({ id: 'unsafe-area', type: 'key_fact', anchor: { x: .5, y: .5 }, safeArea: false });
assert.equal(unsafeAreaFallback.source, 'unsafe-fallback');
assert.equal(unsafeAreaFallback.y, .22);
assert.notEqual(unsafeAreaFallback.x, .5, 'unsafe anchor must not cover the central subject');
const unsafeEvidenceFallback = resolveOverlayPlacement({ id: 'unsafe-evidence', type: 'reveal', placement: { x: .5, y: .5 }, placementEvidence: { safe: false } });
assert.equal(unsafeEvidenceFallback.source, 'unsafe-fallback');
assert.equal(unsafeEvidenceFallback.y, .43);
assert.notEqual(unsafeEvidenceFallback.x, .5, 'negative placement evidence invalidates explicit coordinates');
const safePlacement = resolveOverlayPlacement({ id: 'safe', safeZones: [
  { left: .1, top: .1, width: .3, height: .2, clarity: .5 },
  { left: .55, top: .22, width: .3, height: .2, clarity: .9 },
] });
assert.ok(Math.abs(safePlacement.x - .7) < 1e-9 && Math.abs(safePlacement.y - .32) < 1e-9);
assert.equal(safePlacement.source, 'safe-zone');
assert.equal(resolveOverlayPlacement({ id: 'middle', placement: { zone: 'middle' } }).y, .4);
console.log('remotion overlay selection regression passed');
