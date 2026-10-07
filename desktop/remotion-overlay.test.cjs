/* eslint-disable */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MOTION_ASSET_REGISTRY, RENDERER_VERSION, advancedEvents, intersects, normalizeMotionRole, resolveOverlayLayout, resolveOverlayPlacement, semanticAssetKind } = require('./remotion-overlay.cjs');
const { normalizeEmphasisPlan } = require('./emphasis-composition.cjs');

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
const subjectPlacement = resolveOverlayPlacement({ id: 'subject', type: 'key_fact', subjectAnchor: { x: .45, y: .5 } });
assert.equal(subjectPlacement.source, 'subject-anchor');
assert.ok(subjectPlacement.x > .45 && subjectPlacement.y < .5, 'label sits beside and above the subject anchor');
const semantic = advancedEvents({ events: [
  { id: 'warning', type: 'key_fact', semanticRole: 'warning', startMs: 0, endMs: 900, text: '注意参数' },
  { id: 'urgent', type: 'key_fact', tone: 'urgency', startMs: 1000, endMs: 1900, text: '限时' },
  { id: 'cta2', type: 'cta', startMs: 2000, endMs: 2900, text: '立即咨询' },
] });
assert.deepEqual(semantic.map(event => event.assetKind), ['warning', 'urgency', 'cta']);
const crossLayer = advancedEvents(normalizeEmphasisPlan({ profile: 'product_showcase', maxEvents: 5, events: [
  { id: 'warning-intent', type: 'key_fact', assetIntent: 'warning_marker', visualIntent: 'warning', startMs: 0, endMs: 600, text: '注意', importance: 3, confidence: 1, source: 'editor' },
  { id: 'urgent-intent', type: 'key_fact', assetIntent: 'urgency_badge', startMs: 700, endMs: 1300, text: '限时', importance: 3, confidence: 1, source: 'editor' },
  { id: 'product-intent', type: 'key_fact', assetIntent: 'product_marker', visualIntent: 'focus_product', startMs: 1400, endMs: 2000, text: '产品', importance: 3, confidence: 1, source: 'editor' },
  { id: 'attention-intent', type: 'key_fact', assetIntent: 'attention', startMs: 2100, endMs: 2700, text: '重点', importance: 3, confidence: 1, source: 'editor' },
  { id: 'cta-intent', type: 'key_fact', assetIntent: 'cta_marker', startMs: 2800, endMs: 3400, text: '咨询', importance: 3, confidence: 1, source: 'editor' },
] }, 4));
assert.deepEqual(crossLayer.map(event => event.assetKind), ['warning', 'urgency', 'urgency', 'warning', 'cta'], 'detached events select non-rays assets');
assert.match(RENDERER_VERSION, /^semantic-assets-v\d+-motion-roles$/, 'cache namespace changes with the component registry');
assert.deepEqual(Object.keys(MOTION_ASSET_REGISTRY), ['surround_rays', 'pointer_shard', 'adjacent_badge', 'caption_accent', 'corner_badge']);
const target = { subjectBox: { x: .3, y: .2, width: .2, height: .25 } };
assert.equal(normalizeMotionRole({ ...target, visualRole: 'surround', assetFamily: 'rays' }), 'surround');
assert.equal(normalizeMotionRole({ visualRole: 'surround', assetFamily: 'rays' }), 'corner_badge', 'surround fails closed without a target');
assert.equal(normalizeMotionRole({ ...target, visualRole: 'surround', assetFamily: 'corner_marker' }), 'adjacent', 'non-rays family cannot render surround');
assert.equal(normalizeMotionRole({ ...target, visualRole: 'point_to' }), 'point_to');
assert.equal(normalizeMotionRole({ ...target, visualRole: 'adjacent' }), 'adjacent');
assert.equal(normalizeMotionRole({ visualRole: 'caption_companion' }), 'caption_companion');
assert.equal(normalizeMotionRole({ visualRole: 'corner_badge' }), 'corner_badge');
assert.equal(semanticAssetKind({ type: 'reveal', assetIntent: 'product_marker' }), 'urgency', 'detached graphic never selects yellow rays');
assert.equal(semanticAssetKind({ ...target, type: 'reveal', assetIntent: 'product_marker', visualRole: 'surround', assetFamily: 'rays' }), 'reveal');
const serverMotion = advancedEvents({ events: [{ id: 'fact-1', type: 'key_fact', startMs: 1000, endMs: 2400,
  text: '独立包装', importance: 3, confidence: .9, source: 'transcript' }], motionEvents: [{
  id: 'motion-fact-1', emphasisType: 'key_fact', startMs: 1100, endMs: 2100,
  anchor: { cueId: 'cue-1', phrase: '独立包装', boundary: 'center' },
  target: { kind: 'caption', label: '独立包装', confidence: .9 }, visualRole: 'caption_companion',
}] });
assert.equal(serverMotion.filter(event => event.id === 'motion-fact-1').length, 1, 'motion event merges with its base event instead of duplicating it');
assert.deepEqual({ role: serverMotion[0].motionRole, startMs: serverMotion[0].startMs, endMs: serverMotion[0].endMs,
  text: serverMotion[0].text }, { role: 'caption_companion', startMs: 1100, endMs: 2100, text: '独立包装' });
assert.equal('visualRole' in serverMotion[0], false, 'the model role is normalized into renderer-owned motionRole');
const detachedSurround = advancedEvents({ motionEvents: [{
  id: 'detached-surround', emphasisType: 'reveal', startMs: 0, endMs: 900,
  anchor: { cueId: 'cue-rays', phrase: '产品出现', boundary: 'center' },
  target: { kind: 'product', label: '产品', confidence: .9 }, visualRole: 'surround',
}] });
assert.ok(detachedSurround.every(event => event.assetKind !== 'reveal' && event.assetKind !== 'key_fact'),
  'a surround request without target geometry never reaches Remotion as detached rays');
const qaDensity = advancedEvents({ events: [
  { id: 'b', type: 'key_fact', startMs: 1000, endMs: 2000, text: '低优先级', importance: 1, confidence: .9,
    semanticEvidence: { cueId: 'cue-low' }, presentationMode: 'graphic_only', visualRole: 'surround', assetFamily: 'rays', shotId: 'shot', subjectBox: target.subjectBox },
  { id: 'd', type: 'key_fact', startMs: 1200, endMs: 2200, text: '高优先级', importance: 3, confidence: .9,
    semanticEvidence: { cueId: 'cue-high' }, presentationMode: 'graphic_only', visualRole: 'surround', assetFamily: 'rays', shotId: 'shot', subjectBox: target.subjectBox },
  { id: 'f', type: 'key_fact', startMs: 4500, endMs: 5200, text: '冷却中', importance: 2, confidence: .9,
    semanticEvidence: { cueId: 'cue-repeat' }, presentationMode: 'graphic_only', visualRole: 'surround', assetFamily: 'rays', shotId: 'shot', subjectBox: target.subjectBox },
  { id: 'h', type: 'key_fact', startMs: 5400, endMs: 6100, text: '冷却后', importance: 1, confidence: .9,
    semanticEvidence: { cueId: 'cue-later' }, presentationMode: 'graphic_only', visualRole: 'surround', assetFamily: 'rays', shotId: 'shot', subjectBox: target.subjectBox },
] });
assert.deepEqual(qaDensity.map(event => event.id), ['d', 'h'],
  'advancedEvents applies same-screen priority and four-second asset cooldown before rendering');
const assetComponent = fs.readFileSync(path.join(__dirname, 'remotion-overlay/semantic-assets.tsx'), 'utf8');
assert.match(assetComponent, /from '@remotion\/gif'/, 'animated originals use video-frame-synchronized GIF playback');
for (const file of ['burst-rays-yellow-static.png', 'burst-rays-yellow.gif', 'emphasis-rays-yellow.gif', 'lightning-orange.gif', 'megaphone-blue-yellow.gif']) {
  assert.ok(fs.statSync(path.join(__dirname, '../assets/reference/emphasis/v1', file)).size > 1024, `${file} is a real runtime asset`);
  assert.match(assetComponent, new RegExp(file.replace('.', '\\.')), `${file} is mapped by the semantic component`);
}
assert.match(assetComponent, /if \(failed\) return <SvgFallback/, 'SVG artwork is restricted to load failure fallback');
for (const role of ['surround', 'point_to', 'adjacent', 'caption_companion', 'corner_badge']) assert.match(assetComponent, new RegExp(`${role}:`));
assert.match(assetComponent, /useCurrentFrame\(\)/, 'parameterized components are driven by Remotion frames');
assert.doesNotMatch(assetComponent, /animation\s*:/, 'production components do not use CSS animation');
const rootComponent = fs.readFileSync(path.join(__dirname, 'remotion-overlay/root.tsx'), 'utf8');
assert.doesNotMatch(rootComponent, /transform:\s*`/, 'root component uses frame-driven scale and translate properties');

const subjectBox = { x: .38, y: .25, width: .24, height: .30 };
const subjectLayout = resolveOverlayLayout({ id: 'subject-layout', type: 'key_fact', text: '核心事实', subjectBox,
  visualRole: 'surround', assetFamily: 'rays' });
assert.equal(intersects(subjectLayout.asset, subjectBox, .008), false, 'decoration rectangle clears the full subject box');
assert.equal(intersects(subjectLayout.label, subjectBox, .012), false, 'label rectangle clears the full subject box');
assert.equal(intersects(subjectLayout.asset, subjectLayout.label, .006), false, 'asset and label use independent non-overlapping rectangles');
assert.ok(subjectLayout.label.y + subjectLayout.label.height <= .71, 'subject label clears the subtitle reserve');

const cornerLayout = resolveOverlayLayout({ id: 'no-subject', type: 'cta', text: '立即咨询' });
assert.match(cornerLayout.mode, /corner|fallback/);
assert.notEqual(cornerLayout.asset.x + cornerLayout.asset.width / 2, .5, 'missing subject uses a safe corner instead of centre');
assert.equal(intersects(cornerLayout.asset, cornerLayout.label, .006), false, 'corner lockup keeps megaphone clear of text');
assert.ok(cornerLayout.asset.y + cornerLayout.asset.height <= .71 && cornerLayout.label.y + cornerLayout.label.height <= .71);

const cropMetadata = JSON.parse(fs.readFileSync(path.join(__dirname, 'remotion-overlay/asset-crops.json'), 'utf8'));
assert.equal(cropMetadata.assets['megaphone-blue-yellow.gif'].frames, 26);
assert.ok(cropMetadata.assets['burst-rays-yellow-static.png'].height < .5, 'large transparent padding is removed using union alpha bounds');
console.log('remotion overlay selection regression passed');
