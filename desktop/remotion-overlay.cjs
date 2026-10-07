/* eslint-disable */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { filterAdvancedEventsForQa } = require('./emphasis-layout-qa.cjs');

let bundlePromise = null;
const RENDERER_VERSION = 'semantic-assets-v10-motion-roles';
const ASSET_DIRECTORY = path.join(__dirname, '../assets/reference/emphasis/v1');

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const stableSide = value => [...String(value || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 ? .72 : .28;
const ASSET_INTENT_KIND = Object.freeze({
  warning_marker: 'warning', urgency_badge: 'urgency', cta_marker: 'cta',
  product_marker: 'reveal', attention: 'key_fact', fact: 'key_fact',
});
const VISUAL_INTENT_KIND = Object.freeze({
  warning: 'warning', urgency: 'urgency', cta: 'cta', focus_product: 'reveal',
  attention: 'key_fact', fact: 'key_fact',
});
const MOTION_ROLES = new Set(['surround', 'point_to', 'adjacent', 'caption_companion', 'corner_badge']);
const MOTION_ASSET_REGISTRY = Object.freeze({
  surround_rays: { allowedRoles: ['surround'], family: 'rays', runtimeEligible: true },
  pointer_shard: { allowedRoles: ['point_to'], family: 'directional', runtimeEligible: true },
  adjacent_badge: { allowedRoles: ['adjacent'], family: 'badge', runtimeEligible: true },
  caption_accent: { allowedRoles: ['caption_companion'], family: 'directional', runtimeEligible: true },
  corner_badge: { allowedRoles: ['corner_badge'], family: 'badge', runtimeEligible: true },
});

function semanticAssetKind(event) {
  const requested = ASSET_INTENT_KIND[String(event && event.assetIntent)]
    || VISUAL_INTENT_KIND[String(event && event.visualIntent)]
    || (event && event.type === 'cta' ? 'cta' : null)
    || (['warning', 'urgency'].includes(String(event && (event.semanticRole || event.emphasisKind || event.tone)))
      ? String(event.semanticRole || event.emphasisKind || event.tone) : null)
    || (event && event.type === 'reveal' ? 'reveal' : 'key_fact');
  const role = normalizeMotionRole(event);
  if (role !== 'surround' && requested === 'reveal') return 'urgency';
  if (role !== 'surround' && requested === 'key_fact') return 'warning';
  return requested;
}

const intersects = (a, b, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
  && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
const inside = rect => rect.x >= .035 && rect.y >= .035 && rect.x + rect.width <= .965 && rect.y + rect.height <= .70;
const normalizedBox = value => {
  if (!value || typeof value !== 'object') return null;
  const x = finite(value.x ?? value.left), y = finite(value.y ?? value.top);
  const width = finite(value.width), height = finite(value.height);
  return x === null || y === null || width === null || height === null ? null : {
    x: clamp(x, 0, 1), y: clamp(y, 0, 1), width: clamp(width, .03, .8), height: clamp(height, .03, .8),
  };
};
const targetBox = event => normalizedBox(event && event.subjectBox) || (() => {
  const anchor = event && event.subjectAnchor;
  if (!anchor || finite(anchor.x) === null || finite(anchor.y) === null) return null;
  return { x: clamp(Number(anchor.x) - .10, .03, .77), y: clamp(Number(anchor.y) - .10, .04, .50), width: .20, height: .20 };
})();

function normalizeMotionRole(event) {
  const explicit = String(event && (event.visualRole || event.motionRole || event.componentRole) || '');
  const requested = MOTION_ROLES.has(explicit) ? explicit : String(event && event.targetRelation || '');
  const target = targetBox(event);
  if (requested === 'surround') return event && event.assetFamily === 'rays' && target ? 'surround' : target ? 'adjacent' : 'corner_badge';
  if (requested === 'point_to') return target ? 'point_to' : 'caption_companion';
  if (requested === 'adjacent') return target ? 'adjacent' : 'corner_badge';
  if (requested === 'caption_companion' || requested === 'corner_badge') return requested;
  return target ? 'adjacent' : 'corner_badge';
}

function roleLayout(event, base) {
  const role = normalizeMotionRole(event), target = targetBox(event);
  if (role === 'surround' && target) {
    const pad = .025;
    const asset = { x: clamp(target.x - pad, .035, .93), y: clamp(target.y - pad, .035, .665),
      width: Math.min(.42, target.width + pad * 2), height: Math.min(.48, target.height + pad * 2) };
    asset.x = Math.min(asset.x, .965 - asset.width); asset.y = Math.min(asset.y, .70 - asset.height);
    return { ...base, asset, mode: 'role-surround' };
  }
  if (role === 'caption_companion') return { ...base,
    asset: { x: .34, y: .625, width: .32, height: .055 }, mode: 'role-caption-companion' };
  return { ...base, mode: `role-${role}-${base.mode}` };
}

/** Returns independent decoration and label rectangles. Every candidate is
 * checked as a full rectangle against the subject, caption reserve and frame. */
function resolveOverlayLayout(event, index = 0) {
  const subject = normalizedBox(event && event.subjectBox) || (() => {
    const anchor = event && event.subjectAnchor;
    if (!anchor || finite(anchor.x) === null || finite(anchor.y) === null) return null;
    return { x: clamp(Number(anchor.x) - .13, .03, .71), y: clamp(Number(anchor.y) - .17, .04, .48), width: .26, height: .34 };
  })();
  const kind = semanticAssetKind(event);
  const aspect = kind === 'cta' ? 1.08 : kind === 'warning' ? .85 : kind === 'urgency' ? .70 : 1.5;
  const assetWidth = kind === 'cta' ? .23 : kind === 'key_fact' || kind === 'reveal' ? .27 : .18;
  const assetHeight = assetWidth / aspect;
  const chars = Array.from(String(event && event.text || '')).length;
  const labelWidth = clamp(.14 + chars * .022, .20, .40), labelHeight = chars > 12 ? .105 : .075;
  const captionReserve = { x: 0, y: .71, width: 1, height: .29 };
  const gap = .025;
  const side = stableSide(event && event.id || `${event && event.type}-${index}`) > .5 ? 'right' : 'left';
  const candidates = [];
  if (subject) {
    const rightX = subject.x + subject.width + gap;
    const leftX = subject.x - assetWidth - gap;
    const upperY = Math.max(.05, subject.y - assetHeight * .45);
    for (const direction of side === 'right' ? ['right', 'left', 'top'] : ['left', 'right', 'top']) {
      const asset = direction === 'right' ? { x: rightX, y: upperY, width: assetWidth, height: assetHeight }
        : direction === 'left' ? { x: leftX, y: upperY, width: assetWidth, height: assetHeight }
          : { x: subject.x + subject.width / 2 - assetWidth / 2, y: subject.y - assetHeight - gap, width: assetWidth, height: assetHeight };
      const label = direction === 'left'
        ? { x: asset.x - labelWidth - gap, y: Math.max(.05, asset.y), width: labelWidth, height: labelHeight }
        : { x: asset.x + asset.width + gap, y: Math.max(.05, asset.y), width: labelWidth, height: labelHeight };
      candidates.push({ asset, label, mode: `subject-${direction}` });
    }
  } else {
    const left = side === 'left' ? .055 : .945 - assetWidth - gap - labelWidth;
    const y = kind === 'cta' ? .57 : .08 + (index % 3) * .17;
    candidates.push({
      asset: { x: left, y, width: assetWidth, height: assetHeight },
      label: { x: left + assetWidth + gap, y: y + Math.max(0, (assetHeight - labelHeight) / 2), width: labelWidth, height: labelHeight },
      mode: `corner-${side}`,
    });
  }
  const valid = candidates.find(({ asset, label }) => inside(asset) && inside(label)
    && !intersects(asset, label, .006) && !intersects(asset, captionReserve) && !intersects(label, captionReserve)
    && (!subject || (!intersects(asset, subject, .008) && !intersects(label, subject, .012))));
  if (valid) return valid;
  // Fixed upper corner is the final conservative result. It remains a
  // horizontal lockup and never occupies the centre or caption reserve.
  const left = side === 'left' ? .05 : .95 - assetWidth - gap - labelWidth;
  return {
    asset: { x: left, y: .06, width: assetWidth, height: assetHeight },
    label: { x: left + assetWidth + gap, y: .06 + Math.max(0, (assetHeight - labelHeight) / 2), width: labelWidth, height: labelHeight },
    mode: `fallback-${side}`,
  };
}

/** Resolve a sticker position without assuming that the centre of the frame is
 * empty. Coordinates are normalized. The lower 28% stays reserved for speech
 * captions and platform controls. */
function resolveOverlayPlacement(event, index = 0) {
  const placement = event && typeof event.placement === 'object' ? event.placement : {};
  const anchor = event && event.hasExplicitAnchor !== false && typeof event.anchor === 'object' ? event.anchor : {};
  const placementEvidence = event && typeof event.placementEvidence === 'object' ? event.placementEvidence : {};
  const side = stableSide(event && event.id || `${event && event.type}-${index}`);
  const yByType = { key_fact: .22, reveal: .43, cta: .62 };
  const conservative = source => ({ x: side, y: yByType[event && event.type] || .22, source });
  // Explicit negative evidence invalidates every proposed placement, including
  // an anchor supplied by an earlier analysis pass. Fall back deterministically
  // rather than treating coordinates as proof that the area is safe.
  if ((event && event.safeArea === false) || placementEvidence.safe === false || placement.safe === false) {
    return conservative('unsafe-fallback');
  }
  const explicitX = finite(placement.x) ?? finite(anchor.x);
  const explicitY = finite(placement.y) ?? finite(anchor.y);
  if (explicitX !== null && explicitY !== null) {
    return { x: clamp(explicitX, .16, .84), y: clamp(explicitY, .10, .68), source: 'anchor' };
  }
  const subjectAnchor = event && typeof event.subjectAnchor === 'object' ? event.subjectAnchor : {};
  const subjectX = finite(subjectAnchor.x), subjectY = finite(subjectAnchor.y);
  if (subjectX !== null && subjectY !== null) {
    return { x: clamp(subjectX < .5 ? subjectX + .23 : subjectX - .23, .16, .84), y: clamp(subjectY - .13, .10, .68), source: 'subject-anchor' };
  }
  const safeZones = [
    ...(Array.isArray(event && event.safeZones) ? event.safeZones : []),
    ...(event && event.safeZone && typeof event.safeZone === 'object' ? [event.safeZone] : []),
  ].filter(zone => zone && zone.safe !== false);
  if (safeZones.length) {
    const zone = [...safeZones].sort((left, right) => (Number(right.clarity) || 0) - (Number(left.clarity) || 0)
      || (Number(right.width) || 0) * (Number(right.height) || 0) - (Number(left.width) || 0) * (Number(left.height) || 0))[0];
    const x = finite(zone.x) ?? ((finite(zone.left) ?? .16) + (finite(zone.width) ?? .3) / 2);
    const y = finite(zone.y) ?? ((finite(zone.top) ?? .12) + (finite(zone.height) ?? .18) / 2);
    return { x: clamp(x, .16, .84), y: clamp(y, .10, .68), source: 'safe-zone' };
  }
  const namedZone = String(placement.zone || event && event.zone || '');
  const zoneY = { top: .18, upper: .18, middle: .40, center: .40, lower: .62, bottom: .62 }[namedZone];
  if (zoneY) return { x: side, y: zoneY, source: 'zone' };
  return conservative('fallback');
}

function mergeMotionEvents(plan) {
  const baseEvents = plan && Array.isArray(plan.events) ? plan.events : [];
  const motionEvents = plan && Array.isArray(plan.motionEvents) ? plan.motionEvents : [];
  if (!motionEvents.length) return baseEvents;
  const matched = new Set();
  const merged = motionEvents.flatMap((motion, index) => {
    if (!motion || typeof motion !== 'object') return [];
    const motionStart = finite(motion.startMs), motionEnd = finite(motion.endMs);
    const candidates = baseEvents.map((event, eventIndex) => {
      const direct = motion.id === event.id || motion.id === `motion-${event.id}`;
      const target = motion.target && motion.target.targetId && motion.target.targetId === event.targetId;
      const sameType = motion.emphasisType === event.type;
      const overlap = motionStart !== null && motionEnd !== null
        ? Math.max(0, Math.min(motionEnd, Number(event.endMs) || 0) - Math.max(motionStart, Number(event.startMs) || 0)) : 0;
      return { event, eventIndex, score: direct ? 1e9 : target && sameType ? 1e7 + overlap : sameType ? overlap : -1 };
    }).sort((left, right) => right.score - left.score);
    const match = candidates[0] && candidates[0].score > 0 ? candidates[0] : null;
    if (match) matched.add(match.eventIndex);
    const base = match ? match.event : {};
    const rawType = String(motion.emphasisType || base.type || 'key_fact');
    const type = rawType === 'cta' ? 'cta' : rawType === 'reveal' || rawType === 'hook' ? 'reveal' : 'key_fact';
    const visualRole = MOTION_ROLES.has(String(motion.visualRole)) ? String(motion.visualRole) : undefined;
    const trustedRays = visualRole === 'surround' && Number(motion.target && motion.target.confidence) >= .68
      && ['person', 'product', 'machine', 'action'].includes(String(motion.target && motion.target.kind));
    return [{ ...base, id: String(motion.id || base.id || `motion-${index + 1}`), type,
      startMs: motionStart ?? finite(base.startMs) ?? 0, endMs: motionEnd ?? finite(base.endMs) ?? 0,
      text: String(base.text || motion.target && motion.target.label || motion.anchor && motion.anchor.phrase || ''),
      visualRole, ...(trustedRays ? { assetFamily: 'rays' } : {}),
      presentationMode: base.presentationMode || 'graphic_only', motionEventId: motion.id,
      semanticAnchor: motion.anchor, target: motion.target }];
  });
  return [...merged, ...baseEvents.filter((_, index) => !matched.has(index))];
}

const mappedAdvancedEvents = plan => mergeMotionEvents(plan)
  .filter(event => ['key_fact', 'reveal', 'cta'].includes(event.type) && (event.text || event.presentationMode === 'graphic_only'))
  .map((event, index) => ({
    id: event.id, type: event.type, startMs: event.startMs, endMs: event.endMs, text: String(event.text || ''),
    assetKind: semanticAssetKind(event),
    motionRole: normalizeMotionRole(event),
    assetId: Object.entries(MOTION_ASSET_REGISTRY).find(([, definition]) => definition.allowedRoles.includes(normalizeMotionRole(event)))?.[0],
    assetFamily: normalizeMotionRole(event) === 'surround' ? 'rays' : normalizeMotionRole(event) === 'point_to' || normalizeMotionRole(event) === 'caption_companion' ? 'directional' : 'badge',
    runtimeAssetFamily: normalizeMotionRole(event) === 'surround' ? 'rays' : normalizeMotionRole(event) === 'point_to' || normalizeMotionRole(event) === 'caption_companion' ? 'directional' : 'badge',
    allowedRoles: [normalizeMotionRole(event)],
    presentationMode: event.presentationMode === 'graphic_only' ? 'graphic_only' : 'label',
    importance: Number(event.importance) || 1,
    confidence: Number(event.confidence) || 0,
    targetRelation: event.targetRelation || normalizeMotionRole(event),
    semanticEvidence: event.semanticEvidence || event.semanticAnchor || event.placementEvidence,
    semanticAnchor: event.semanticAnchor,
    shotId: String(event.shotId || event.placementEvidence && event.placementEvidence.windowId || ''),
    occupiedBoxes: Array.isArray(event.occupiedBoxes) ? event.occupiedBoxes : [],
    captionBoxes: Array.isArray(event.captionBoxes) ? event.captionBoxes : [],
    protectedBoxes: Array.isArray(event.protectedBoxes) ? event.protectedBoxes : [],
    primaryDecorationCount: 1,
    placement: resolveOverlayPlacement(event, index),
    layout: roleLayout(event, resolveOverlayLayout(event, index)),
    ...(event.subjectAnchor && Number.isFinite(Number(event.subjectAnchor.x)) && Number.isFinite(Number(event.subjectAnchor.y))
      ? { subjectAnchor: { x: clamp(Number(event.subjectAnchor.x), .08, .92), y: clamp(Number(event.subjectAnchor.y), .08, .70) } } : {}),
    ...(normalizedBox(event.subjectBox) ? { subjectBox: normalizedBox(event.subjectBox) } : {}),
  }));

const advancedEvents = plan => {
  const mapped = mappedAdvancedEvents(plan);
  const modern = mapped.filter(event => event.semanticEvidence);
  const acceptedModern = new Set(filterAdvancedEventsForQa(modern, { cooldownMs: 4_000 }).map(event => event.id));
  return mapped.filter(event => !event.semanticEvidence || acceptedModern.has(event.id));
};

async function rendererModules() {
  const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
    import('@remotion/bundler'), import('@remotion/renderer'),
  ]);
  return { bundle, renderMedia, selectComposition };
}

async function bundleOverlay(bundle) {
  if (!bundlePromise) bundlePromise = bundle({
    entryPoint: path.join(__dirname, 'remotion-overlay/index.ts'),
    publicDir: ASSET_DIRECTORY,
    onProgress: () => undefined,
  });
  return bundlePromise;
}

async function renderTransparentOverlay({ plan, width, height, durationSeconds, fps = 15, onProgress = () => {} }) {
  const events = advancedEvents(plan);
  if (!events.length || process.env.LINGSHU_REMOTION_OVERLAY === 'off') return { path: null, cacheHit: false, renderMs: 0 };
  const sourceVersion = crypto.createHash('sha256').update([
    fs.readFileSync(path.join(__dirname, 'remotion-overlay/root.tsx')),
    fs.readFileSync(path.join(__dirname, 'remotion-overlay/semantic-assets.tsx')),
    fs.readFileSync(path.join(__dirname, 'remotion-overlay/asset-crops.json')),
    ...['burst-rays-yellow-static.png', 'burst-rays-yellow.gif', 'emphasis-rays-yellow.gif', 'lightning-orange.gif', 'megaphone-blue-yellow.gif']
      .map(file => fs.readFileSync(path.join(ASSET_DIRECTORY, file))),
  ].map(value => crypto.createHash('sha256').update(value).digest('hex')).join(':')).digest('hex').slice(0, 16);
  const props = { rendererVersion: RENDERER_VERSION, sourceVersion, durationFrames: Math.max(1, Math.ceil(durationSeconds * fps)), fps, width, height, profile: plan.profile, events };
  const key = crypto.createHash('sha256').update(JSON.stringify(props)).digest('hex');
  const cacheDir = path.join(os.homedir(), '.cache', 'lingshu-ai', 'remotion-overlays');
  const output = path.join(cacheDir, `${key}.webm`);
  fs.mkdirSync(cacheDir, { recursive: true });
  if (fs.existsSync(output) && fs.statSync(output).size > 1024) return { path: output, cacheHit: true, renderMs: 0 };
  const started = Date.now();
  const { bundle, renderMedia, selectComposition } = await rendererModules();
  const serveUrl = await bundleOverlay(bundle);
  const composition = await selectComposition({ serveUrl, id: 'EmphasisOverlay', inputProps: props });
  const chromePath = process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined;
  await renderMedia({
    serveUrl, composition, inputProps: props, outputLocation: output, overwrite: true,
    codec: 'vp9', imageFormat: 'png', pixelFormat: 'yuva420p', muted: true,
    browserExecutable: chromePath, chromeMode: 'chrome-for-testing', concurrency: 2, logLevel: 'error',
    onProgress: progress => onProgress(progress.progress),
  });
  return { path: output, cacheHit: false, renderMs: Date.now() - started };
}

module.exports = { MOTION_ASSET_REGISTRY, RENDERER_VERSION, advancedEvents, intersects, mergeMotionEvents, normalizeMotionRole, resolveOverlayLayout, resolveOverlayPlacement, semanticAssetKind, renderTransparentOverlay };
