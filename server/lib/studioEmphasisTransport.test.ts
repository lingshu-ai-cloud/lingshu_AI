import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildStudioEmphasisPlan } from './studioEmphasisManifest.js';
import { secureStudioRenderManifest } from './studioRenderSecurity.js';

test('semantic placement evidence survives server manifest signing and reaches the desktop bridge unchanged', () => {
  const emphasisPlan = buildStudioEmphasisPlan({
    durationSeconds: 8,
    script: '精密加工',
    emphasisPlan: {
      profile: 'factory_process',
      maxEvents: 2,
      events: [{
        id: 'cnc-proof', type: 'section_label', startMs: 500, endMs: 1_700, text: '精密加工',
        importance: 3, confidence: .95, source: 'vision', targetId: 'cnc', strength: 'strong',
      }],
      placementWindows: [{
        id: 'cnc-detail', startMs: 3_000, endMs: 5_000, targetIds: ['cnc'], safe: true,
        clarity: .94, anchor: { x: .76, y: .18 },
      }],
    },
  });
  const manifest = {
    jobId: 'emphasis-transport', spec: { duration: 8 },
    timeline: [{ name: 'shot', url: 'https://studio.example.test/media/tenants/tenant_a/shot.mp4', targetStart: 0, targetEnd: 8 }],
    voiceover: { url: null }, cover: { url: null }, bgm: { url: null }, emphasisPlan,
  };
  const secured = secureStudioRenderManifest(manifest, 'tenant_a', 'https://studio.example.test', 'http://127.0.0.1:8790');
  assert.deepEqual(secured.emphasisPlan, emphasisPlan, 'media URL hardening must not project away emphasis evidence');
  assert.deepEqual(secured.emphasisPlan.events[0]?.placementEvidence,
    { windowId: 'cnc-detail', targetId: 'cnc', clarity: .94, safe: true });
  assert.deepEqual(secured.emphasisPlan.events[0]?.anchor, { x: .76, y: .18 });

  const preload = readFileSync(new URL('../../desktop/preload.cjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(preload, /render: manifest => ipcRenderer\.invoke\('render:start', manifest\)/,
    'the renderer process must send the complete signed manifest');
  assert.match(main, /ipcMain\.handle\('render:start', async \(_event, manifest\)[\s\S]*?composite\(manifest,/,
    'the Electron main process must pass the complete manifest to desktop composite');
});
