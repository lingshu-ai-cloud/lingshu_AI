/* eslint-disable */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let bundlePromise = null;

const advancedEvents = plan => (plan && Array.isArray(plan.events) ? plan.events : [])
  .filter(event => ['key_fact', 'reveal', 'cta'].includes(event.type) && event.text)
  .map(event => ({ id: event.id, type: event.type, startMs: event.startMs, endMs: event.endMs, text: event.text }));

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

module.exports = { advancedEvents, renderTransparentOverlay };
