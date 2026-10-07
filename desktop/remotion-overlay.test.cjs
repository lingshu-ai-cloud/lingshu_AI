/* eslint-disable */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MOTION_ASSET_REGISTRY, RENDERER_VERSION, advancedEvents, intersects, normalizeMotionRole, planOverlayPresentation, resolveOverlayLayout, resolveOverlayPlacement, semanticAssetKind } = require('./remotion-overlay.cjs');
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
assert.match(RENDERER_VERSION, /^semantic-assets-v\d+-motion-roles-visible-hold$/, 'cache namespace changes with the component registry');
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
assert.equal(semanticAssetKind({ type: 'reveal', assetIntent: 'product_marker' }), 'urgency', 'detached reveal never selects burst rays');
assert.equal(semanticAssetKind({ type: 'key_fact', assetIntent: 'fact', targetRelation: 'adjacent' }), 'warning', 'corner fact never selects rays');
assert.equal(semanticAssetKind({ type: 'reveal', assetIntent: 'product_marker', targetRelation: 'surround',
  assetFamily: 'rays', subjectBox: { x: .3, y: .2, width: .2, height: .3 } }), 'reveal', 'signed precise surround target may select animated burst rays');
assert.equal(semanticAssetKind({ type: 'key_fact', assetIntent: 'fact', targetRelation: 'surround',
  assetFamily: 'rays', subjectAnchor: { x: .4, y: .4 } }), 'key_fact', 'signed precise anchor may select the local static rays accent');
assert.equal(semanticAssetKind({ type: 'key_fact', assetIntent: 'fact', targetRelation: 'surround',
  subjectAnchor: { x: .4, y: .4 } }), 'warning', 'unsanctioned subject coordinates cannot enable rays');
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

const surround = planOverlayPresentation({ id: 'surround', type: 'key_fact', text: '新品', presentationMode: 'label', targetRelation: 'surround', subjectBox });
assert.equal(surround.outcome, 'label');
assert.equal(surround.layout.relation, 'surround');
assert.ok(surround.layout.asset.width <= .16 && surround.layout.asset.height <= .145,
  'surround accent stays compact instead of spanning the subject');
assert.equal(intersects(surround.layout.asset, subjectBox), false, 'surround accent is tangent to, not over, the subject');
assert.equal(intersects(surround.layout.label, subjectBox, .012), false, 'surround label clears the target rectangle');
const surroundAvoidance = planOverlayPresentation({ id: 'surround-occupied', type: 'key_fact', text: '参数', presentationMode: 'label',
  targetRelation: 'surround', subjectBox, occupiedBoxes: [
    { x: .64, y: .24, width: .33, height: .25 },
    { x: .28, y: .08, width: .42, height: .12 },
  ] });
assert.equal(surroundAvoidance.outcome, 'label');
assert.equal(intersects(surroundAvoidance.layout.asset, subjectBox), false);
for (const occupied of [{ x: .64, y: .24, width: .33, height: .25 }, { x: .28, y: .08, width: .42, height: .12 }]) {
  assert.equal(intersects(surroundAvoidance.layout.asset, occupied), false, 'edge direction avoids occupied image regions');
  assert.equal(intersects(surroundAvoidance.layout.label, occupied), false, 'label follows into unoccupied negative space');
}
assert.ok(surroundAvoidance.layout.asset.y + surroundAvoidance.layout.asset.height <= .70,
  'surround accent never enters the subtitle reserve');
const preferredSurround = planOverlayPresentation({ id: 'surround-preferred', type: 'key_fact', text: '局部',
  presentationMode: 'graphic_only', targetRelation: 'surround', preferredSide: 'left', subjectBox });
assert.match(preferredSurround.layout.mode, /surround-left/, 'uses the evidence preferred side when it is collision-free');
const detachedFact = planOverlayPresentation({ id: 'detached-fact', type: 'key_fact', text: '画面已有事实字幕',
  presentationMode: 'graphic_only', targetRelation: 'none', occupiedBoxes: [{ x: .04, y: .60, width: .92, height: .04 }] });
assert.equal(detachedFact.outcome, 'graphic_only');
assert.ok(detachedFact.layout.asset.width <= .13 && detachedFact.layout.asset.x >= .8,
  'an immutable fact caption gets a compact upper-right accent instead of a central burst');
const pointTo = planOverlayPresentation({ id: 'point', type: 'reveal', text: '看这里', targetRelation: 'point_to', subjectBox });
assert.equal(pointTo.outcome, 'label');
assert.match(pointTo.layout.mode, /relation-point/);
const graphicOnly = planOverlayPresentation({ id: 'graphic', type: 'cta', text: '咨询', presentationMode: 'graphic_only' });
assert.equal(graphicOnly.outcome, 'graphic_only');
const captionFallback = planOverlayPresentation({ id: 'blocked', type: 'key_fact', text: '保留字幕强调', subjectBox,
  occupiedBoxes: [{ x: 0, y: 0, width: 1, height: .71 }] });
assert.equal(captionFallback.outcome, 'caption_emphasis');
assert.deepEqual(captionFallback.attempted, ['label', 'graphic_only', 'caption_emphasis']);
assert.equal(planOverlayPresentation({ id: 'off', presentationMode: 'none' }).outcome, 'none');

const timed = advancedEvents({ events: [
  { id: 'shot-event', type: 'key_fact', text: '证据窗口', startMs: 1000, endMs: 5000, evidence: { startMs: 1800, endMs: 3200 }, shotId: 'shot-7', presentationMode: 'graphic_only' },
  { id: 'none-event', type: 'cta', text: '不渲染', startMs: 0, endMs: 1000, presentationMode: 'none' },
] });
assert.equal(timed.length, 1);
assert.deepEqual({ startMs: timed[0].startMs, endMs: timed[0].endMs, shotId: timed[0].shotId, mode: timed[0].presentationMode },
  { startMs: 1800, endMs: 3200, shotId: 'shot-7', mode: 'graphic_only' });
assert.match(timed[0].playbackKey, /^shot-7:1800:3200$/);

const interfaceModes = advancedEvents({ events: [
  { id: 'label-mode', type: 'key_fact', text: '标签', startMs: 0, endMs: 800, presentationMode: 'label' },
  { id: 'graphic-mode', type: 'reveal', text: '只画图', startMs: 900, endMs: 1700, presentationMode: 'graphic_only' },
  { id: 'caption-mode', type: 'key_fact', text: '字幕内强调', startMs: 1800, endMs: 2600, presentationMode: 'caption_emphasis' },
  { id: 'none-mode', type: 'cta', text: '关闭', startMs: 2700, endMs: 3500, presentationMode: 'none' },
  { id: 'legacy-mode', type: 'cta', text: '旧事件', startMs: 3600, endMs: 4400 },
] });
assert.deepEqual(interfaceModes.map(event => [event.id, event.presentationMode]), [
  ['label-mode', 'label'], ['graphic-mode', 'graphic_only'], ['legacy-mode', 'label'],
]);
const captionCollision = planOverlayPresentation({ id: 'caption-box', type: 'key_fact', text: '避让', presentationMode: 'label',
  captionBoxes: [{ x: 0, y: 0, width: 1, height: .71 }] });
assert.equal(captionCollision.outcome, 'caption_emphasis', 'alignment captionBoxes participate in occupancy scoring');

const playback = JSON.parse(fs.readFileSync(path.join(__dirname, 'remotion-overlay/asset-playback.json'), 'utf8'));
assert.equal(playback.assets['megaphone-blue-yellow.gif'].frameCount, 26);
for (const [file, metadata] of Object.entries(playback.assets)) {
  assert.ok(metadata.holdFrame >= Math.floor(metadata.effectiveEndFrame * .55), `${file} hold frame comes from the stable latter portion`);
  assert.ok(metadata.holdFrame <= metadata.effectiveEndFrame, `${file} hold frame stays inside the effective interval`);
  assert.ok(metadata.alphaCoverage[metadata.holdFrame] > .01, `${file} hold frame has visible alpha coverage`);
  assert.ok(fs.statSync(path.join(__dirname, '../assets/reference/emphasis/v1', metadata.holdAsset)).size > 1024,
    `${file} has a rendered, visible hold asset`);
}
assert.match(assetComponent, /loopBehavior="pause-after-finish"/, 'GIF plays once and holds instead of looping transparent phases');
assert.match(assetComponent, /frame < playFrames/, 'runtime switches at the effective playback boundary');
assert.match(assetComponent, /playback\.holdAsset/, 'runtime freezes on the selected visible hold frame');
assert.doesNotMatch(assetComponent, /loopBehavior="loop"/);
console.log('remotion overlay selection regression passed');
