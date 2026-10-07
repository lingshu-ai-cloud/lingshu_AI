/* eslint-disable */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let bundlePromise = null;

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const stableSide = value => [...String(value || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 ? .72 : .28;

/** Resolve a sticker position without assuming that the centre of the frame is
 * empty. Coordinates are normalized. The lower 28% stays reserved for speech
 * captions and platform controls. */
function resolveOverlayPlacement(event, index = 0) {
  const placement = event && typeof event.placement === 'object' ? event.placement : {};
  const anchor = event && typeof event.anchor === 'object' ? event.anchor : {};
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

const advancedEvents = plan => (plan && Array.isArray(plan.events) ? plan.events : [])
  .filter(event => ['key_fact', 'reveal', 'cta'].includes(event.type) && event.text)
  .map((event, index) => ({
    id: event.id, type: event.type, startMs: event.startMs, endMs: event.endMs, text: event.text,
    placement: resolveOverlayPlacement(event, index),
  }));

async function rendererModules() {
  const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
    import('@remotion/bundler'), import('@remotion/renderer'),
  ]);
  return { bundle, renderMedia, selectComposition };
}

async function bundleOverlay(bundle) {
  if (!bundlePromise) bundlePromise = bundle({
    entryPoint: path.join(__dirname, 'remotion-overlay/index.ts'),
    onProgress: () => undefined,
  });
  return bundlePromise;
}

async function renderTransparentOverlay({ plan, width, height, durationSeconds, fps = 15, onProgress = () => {} }) {
  const events = advancedEvents(plan);
  if (!events.length || process.env.LINGSHU_REMOTION_OVERLAY === 'off') return { path: null, cacheHit: false, renderMs: 0 };
  const props = { durationFrames: Math.max(1, Math.ceil(durationSeconds * fps)), fps, width, height, profile: plan.profile, events };
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

module.exports = { advancedEvents, resolveOverlayPlacement, renderTransparentOverlay };
