import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasSupportedVideoContainerSignature, normalizeApprovedPublicVideoUrl, publishingUploadDir, publishingVideoReference, resolveTenantPublishingVideo } from './localVideoSecurity.js';

const originalCwd = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-publish-path-'));
const priorR2 = process.env.R2_PUBLIC_URL;
const priorOrigins = process.env.PUBLISH_VIDEO_URL_ALLOWED_ORIGINS;
try {
  process.chdir(root);
  const tenantRoot = publishingUploadDir('tenant-a');
  const otherRoot = publishingUploadDir('tenant-b');
  assert.notEqual(publishingUploadDir('tenant/a'), publishingUploadDir('tenant-a'),
    'unsafe tenant ids must be hashed rather than normalized into colliding folders');
  assert.equal(publishingUploadDir('tenant/a').includes(`${path.sep}tenant${path.sep}a`), false);
  fs.mkdirSync(tenantRoot, { recursive: true });
  fs.mkdirSync(otherRoot, { recursive: true });
  const owned = path.join(tenantRoot, 'owned.mp4');
  const other = path.join(otherRoot, 'other.mp4');
  fs.writeFileSync(owned, 'owned');
  fs.writeFileSync(other, 'other');
  assert.equal(resolveTenantPublishingVideo('tenant-a', owned), owned);
  const ownedReference = publishingVideoReference('tenant-a', owned);
  assert.match(ownedReference, /^lingshu-video:v1:[A-Za-z0-9_-]+$/);
  assert.equal(ownedReference.includes(root), false, 'public video references must not disclose the host path');
  assert.equal(resolveTenantPublishingVideo('tenant-a', ownedReference), owned);
  assert.equal(resolveTenantPublishingVideo('tenant-b', ownedReference), null, 'opaque references remain tenant-scoped');
  assert.equal(resolveTenantPublishingVideo('tenant-a', 'lingshu-video:v1:Li4'), null, 'encoded traversal names must be rejected');
  assert.equal(resolveTenantPublishingVideo('tenant-a', other), null, 'cross-tenant files must be rejected');
  assert.equal(resolveTenantPublishingVideo('tenant-a', '/etc/passwd.mp4'), null);
  assert.equal(hasSupportedVideoContainerSignature(owned), false, 'an extension alone must not make arbitrary bytes publishable');
  const mp4 = path.join(tenantRoot, 'valid.mp4');
  fs.writeFileSync(mp4, Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(8)]));
  assert.equal(hasSupportedVideoContainerSignature(mp4), true);
  const link = path.join(tenantRoot, 'linked.mp4');
  try {
    fs.symlinkSync(other, link);
    assert.equal(resolveTenantPublishingVideo('tenant-a', link), null, 'symlinks may not escape tenant storage');
  } catch { /* Symlink creation can be unavailable on constrained runners. */ }

  process.env.R2_PUBLIC_URL = 'https://media.example.com/assets';
  process.env.PUBLISH_VIDEO_URL_ALLOWED_ORIGINS = 'https://cdn.example.com';
  assert.equal(normalizeApprovedPublicVideoUrl('https://media.example.com/video.mp4'), 'https://media.example.com/video.mp4');
  assert.equal(normalizeApprovedPublicVideoUrl('https://cdn.example.com/video.mp4'), 'https://cdn.example.com/video.mp4');
  assert.equal(normalizeApprovedPublicVideoUrl('http://media.example.com/video.mp4'), null);
  assert.equal(normalizeApprovedPublicVideoUrl('https://attacker.example/video.mp4'), null);
} finally {
  process.chdir(originalCwd);
  if (priorR2 === undefined) delete process.env.R2_PUBLIC_URL; else process.env.R2_PUBLIC_URL = priorR2;
  if (priorOrigins === undefined) delete process.env.PUBLISH_VIDEO_URL_ALLOWED_ORIGINS; else process.env.PUBLISH_VIDEO_URL_ALLOWED_ORIGINS = priorOrigins;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('tenant publishing video path and URL security tests passed');
