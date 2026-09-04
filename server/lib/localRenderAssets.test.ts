import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withLocalRenderAssets } from './localRenderAssets.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-render-adapter-'));
const file = path.join(directory, 'fixture.mp4');
const bytes = Buffer.from('authorized technical fixture, not a business video');
fs.writeFileSync(file, bytes);
let exposed = '';
try {
  await withLocalRenderAssets({ timeline: [{ type: 'video', url: file }],
    voiceover: { url: 'data:audio/mpeg;base64,' + bytes.toString('base64') },
    assetHeaders: { authorization: 'must-not-forward' } }, async manifest => {
    assert.deepEqual(manifest.assetHeaders, {});
    assert.deepEqual(manifest.allowedAssetOrigins, []);
    exposed = manifest.timeline[0].url;
    assert.ok(!exposed.includes(directory) && /^http:\/\/127\.0\.0\.1:\d+\/[a-z0-9-]+\.mp4$/.test(exposed));
    const video = await fetch(exposed);
    assert.deepEqual(Buffer.from(await video.arrayBuffer()), bytes);
    const audio = await fetch(manifest.voiceover.url);
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), bytes);
    assert.equal((await fetch(manifest.assetOrigin + '/etc/passwd')).status, 404);
    assert.equal((await fetch(exposed, { method: 'POST' })).status, 404);
  });
  await assert.rejects(fetch(exposed), 'asset server must close after completion');
  await assert.rejects(withLocalRenderAssets({ timeline: [{ url: file }] }, async manifest => {
    exposed = manifest.timeline[0].url;
    throw new Error('render failure');
  }), /render failure/);
  await assert.rejects(fetch(exposed), 'asset server must also close after failure');
  await assert.rejects(withLocalRenderAssets({ timeline: [{ url: 'data:video/mp4;base64,???' }] }, async () => {}), /invalid_or_oversized/);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log('local render asset adapter isolation tests passed');
