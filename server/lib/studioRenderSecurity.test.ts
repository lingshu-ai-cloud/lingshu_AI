import assert from 'node:assert/strict';
import { signAssetUrl } from './assetAccess.js';
import { secureStudioRenderManifest, studioRenderManifestHash, MAX_STUDIO_RENDER_SHOTS } from './studioRenderSecurity.js';
import { signRenderToken, verifyRenderToken } from './renderToken.js';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { studioBgmMediaPath, studioBgmObjectKey } from './studioBgmAccess.js';
import { objectStorageDelete, objectStorageGetObject, objectStorageUpload } from '../storage/objectStorage.js';
import { tenantPrivateObjectKey } from '../storage/materialAssets.js';

const tenant = 'tenant_a';
const origin = 'https://studio.example.test';
const internal = 'http://127.0.0.1:8790';
const signed = signAssetUrl('/media/tenants/tenant_a/shot.mp4', tenant);
const manifest = {
  jobId: 'job-a', spec: { duration: 12 }, timeline: [{ name: 'one', url: `${origin}${signed}`, targetStart: 0, targetEnd: 12 }],
  voiceover: { url: `${origin}/tts/tenants/tenant_a/voice.wav` }, cover: { url: null }, bgm: { url: null },
};
const safe = secureStudioRenderManifest(manifest, tenant, origin, internal);
assert.equal(safe.timeline[0].url, `${internal}${signed}`);
const nestedOwned = '/media/tenants/tenant_a/owned-inspiration-imports/owned-material.mp4';
assert.equal(secureStudioRenderManifest({ ...manifest, timeline: [{ ...manifest.timeline[0], url: `${origin}${nestedOwned}` }] }, tenant, origin, internal).timeline[0].url,
  `${internal}${nestedOwned}`);
assert.throws(() => secureStudioRenderManifest({ ...manifest, timeline: [{ ...manifest.timeline[0],
  url: `${origin}/media/tenants/tenant_b/owned-inspiration-imports/owned-material.mp4` }] }, tenant, origin, internal));
assert.throws(() => secureStudioRenderManifest({ ...manifest, timeline: [{ ...manifest.timeline[0],
  url: `${origin}/media/tenants/tenant_a/owned-inspiration-imports/%2e%2e/owned-material.mp4` }] }, tenant, origin, internal));
assert.equal(safe.voiceover.url, `${internal}/tts/tenants/tenant_a/voice.wav`);
assert.equal((safe as Record<string, unknown>).requireVisualAssets, true);
const claim = signRenderToken({ jti: manifest.jobId, tenantId: tenant, origin, manifestSha256: studioRenderManifestHash(manifest) });
assert.equal(verifyRenderToken(claim.token)?.tenantId, tenant);
assert.notEqual(studioRenderManifestHash({ ...manifest, timeline: [] }), verifyRenderToken(claim.token)?.manifestSha256);

for (const url of [
  'file:///etc/passwd', '/etc/passwd', 'data:video/mp4;base64,AAAA', 'http://127.0.0.1:8790/media/shared/x.mp4',
  'https://169.254.169.254/media/shared/x.mp4', 'https://studio.example.test/api/overseas/ready',
  '//169.254.169.254/media/shared/x.mp4',
  'https://studio.example.test/media/tenants/tenant_b/shot.mp4',
  `https://studio.example.test${signAssetUrl('/media/tenants/tenant_b/shot.mp4', 'tenant_b')}`,
  'https://studio.example.test/media/%2e%2e/private.mp4',
]) {
  assert.throws(() => secureStudioRenderManifest({ ...manifest, timeline: [{ ...manifest.timeline[0], url }] }, tenant, origin, internal), Error, url);
}
assert.throws(() => secureStudioRenderManifest({ ...manifest, timeline: Array.from({ length: MAX_STUDIO_RENDER_SHOTS + 1 }, () => manifest.timeline[0]) }, tenant, origin, internal));
assert.throws(() => secureStudioRenderManifest({ ...manifest, spec: { duration: 601 } }, tenant, origin, internal));
const signedCloud = signAssetUrl('/studio-media/material-1/media.mp4', tenant).split('assetToken=')[1];
const cloudPath = `/studio-media/material-1/signed/${signedCloud}/media.mp4`;
assert.equal(secureStudioRenderManifest({ ...manifest, timeline: [{ ...manifest.timeline[0], url: cloudPath }] }, tenant, origin, internal).timeline[0].url,
  `${internal}/studio-media/material-1/media.mp4`);
const bgmKey = tenantPrivateObjectKey('bgm', tenant, `regression-${randomUUID()}.mp3`);
const bgmTrack = { id: 'regression', tenantId: tenant, scope: 'tenant', objectKey: bgmKey };
assert.equal(studioBgmMediaPath(bgmTrack, tenant), '/api/overseas/studio/bgm/media/regression');
assert.equal(studioBgmObjectKey(bgmTrack, tenant), bgmKey);
assert.equal(studioBgmObjectKey(bgmTrack, 'tenant_b'), null);
assert.equal(studioBgmObjectKey({ ...bgmTrack, objectKey: tenantPrivateObjectKey('bgm', 'tenant_b', 'regression.mp3') }, tenant), null);
assert.equal(secureStudioRenderManifest({ ...manifest, bgm: { url: `${origin}${studioBgmMediaPath(bgmTrack, tenant)}` } }, tenant, origin, internal).bgm.url,
  `${internal}/api/overseas/studio/bgm/media/regression`);
await objectStorageUpload({ key: bgmKey, body: Buffer.from('bgm-stream-fixture'), contentType: 'audio/mpeg' });
try {
  const stored = await objectStorageGetObject(studioBgmObjectKey(bgmTrack, tenant)!);
  assert.ok(stored);
  const chunks: Buffer[] = [];
  for await (const chunk of stored.body) chunks.push(Buffer.from(chunk));
  assert.equal(Buffer.concat(chunks).toString('utf8'), 'bgm-stream-fixture');
} finally { await objectStorageDelete(bgmKey); }

const require = createRequire(import.meta.url);
const { downloadTo, composite } = require('../../desktop/render.cjs') as {
  downloadTo: (url: string, dest: string, options: Record<string, unknown>) => Promise<string>;
  composite: (manifest: Record<string, unknown>, progress: undefined, outputDir: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};
const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#2266aa' } }).png().toBuffer();
const server = http.createServer((req, res) => {
  if (req.url === '/media/shared/redirect.mp4') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
  if (req.url === '/media/shared/json.mp4') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ url: 'http://169.254.169.254/' })); return; }
  if (req.url === '/media/tenants/tenant_a/pixel.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); return; }
  res.writeHead(200, { 'Content-Type': 'video/mp4' }); res.end(Buffer.alloc(req.url?.includes('large') ? 64 : 16));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const local = `http://127.0.0.1:${address.port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'render-security-'));
  const options = { serverStrictAssets: true, assetOrigin: local, assetHeaders: {}, maxAssetBytes: 32, maxTotalAssetBytes: 128, totalBytes: { value: 0 } };
  try {
    for (const valid of ['/media/tenants/tenant_a/shot.mp4', '/api/overseas/studio/private-assets/materials/shot.mp4', '/studio-media/material-1/media.mp4']) {
      await downloadTo(`${local}${valid}`, path.join(temp, 'asset'), options);
      assert.equal((await fs.stat(path.join(temp, 'asset'))).size, 16);
    }
    for (const bad of ['file:///etc/passwd', `${local}/media/shared/redirect.mp4`, `${local}/media/shared/json.mp4`, `${local}/media/shared/large.mp4`]) {
      await assert.rejects(downloadTo(bad, path.join(temp, 'asset'), options), Error, bad);
    }
    await assert.rejects(fs.stat(path.join(temp, 'asset')), 'an over-limit download must remove its partial file');
    const rendered = await composite({
      jobId: 'security-test', requireVisualAssets: true,
      spec: { ratio: '1:1', resolution: '720p', duration: 1, bgmVol: 0, voiceVol: 0 },
      timeline: [{ name: 'pixel', url: `${local}/media/tenants/tenant_a/pixel.png`, type: 'image', targetStart: 0, targetEnd: 1, targetDuration: 1 }],
      voiceover: { url: null }, bgm: { url: null }, cover: { url: null },
      assetOrigin: local, assetHeaders: {}, serverStrictAssets: true,
      maxAssetBytes: 1024 * 1024, maxTotalAssetBytes: 1024 * 1024,
    }, undefined, temp);
    assert.equal(rendered.ok, true, rendered.error);
    assert.ok((await fs.stat(rendered.outputPath!)).size > 0);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
} finally { server.close(); }
console.log('studio render security checks passed');
