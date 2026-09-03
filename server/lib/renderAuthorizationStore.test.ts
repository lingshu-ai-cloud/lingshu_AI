import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signRenderToken } from './renderToken.js';
import {
  clearRenderAuthorizationMemoryForTests,
  clearRenderAuthorizationStoreForTests,
  rememberRenderAuthorization,
  rememberRenderAuthorizationBatch,
  renderManifestSha256,
  resolveRenderAuthorization,
  type StoredRenderManifest,
} from './renderAuthorizationStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-authorization-store-'));
process.env.NODE_ENV = 'test';
process.env.RENDER_AUTHORIZATIONS_FILE = path.join(root, 'authorizations.json');

const manifest: StoredRenderManifest = {
  jobId: 'job-render-auth-test',
  assetOrigin: 'http://127.0.0.1:8788',
  spec: { ratio: '9:16', duration: 15, language: 'zh' },
  timeline: [{ clipId: 'owned-clip', url: 'http://127.0.0.1:8788/render/assets/material/owned-clip' }],
};

clearRenderAuthorizationStoreForTests();
const digest = renderManifestSha256(manifest);
const signed = signRenderToken({
  jti: manifest.jobId,
  tenantId: 'tenant-a',
  ratio: manifest.spec.ratio,
  duration: manifest.spec.duration,
  manifestSha256: digest,
});
assert.equal(rememberRenderAuthorization({ tenantId: 'tenant-a', expiresAt: signed.payload.exp, manifest }).manifestSha256, digest);

// The caller's object is not the stored source of truth.
manifest.spec.duration = 99;
const resolved = resolveRenderAuthorization({ token: signed.token, tenantId: 'tenant-a', jobId: 'job-render-auth-test' });
assert.equal(resolved.ok, true);
if (resolved.ok) {
  assert.equal(resolved.manifest.spec.duration, 15);
  resolved.manifest.spec.duration = 88;
}
const resolvedAgain = resolveRenderAuthorization({ token: signed.token, tenantId: 'tenant-a', jobId: 'job-render-auth-test' });
assert.equal(resolvedAgain.ok && resolvedAgain.manifest.spec.duration, 15, 'returned manifests must also be defensive clones');
clearRenderAuthorizationMemoryForTests();
const resolvedAfterRestart = resolveRenderAuthorization({ token: signed.token, tenantId: 'tenant-a', jobId: 'job-render-auth-test' });
assert.equal(resolvedAfterRestart.ok, true, 'an unexpired authorization must survive a process-memory reset');

const wrongTenant = resolveRenderAuthorization({ token: signed.token, tenantId: 'tenant-b', jobId: 'job-render-auth-test' });
assert.deepEqual(wrongTenant, { ok: false, code: 'render_tenant_mismatch', status: 403 });
const wrongJob = resolveRenderAuthorization({ token: signed.token, tenantId: 'tenant-a', jobId: 'job-other' });
assert.deepEqual(wrongJob, { ok: false, code: 'render_job_mismatch', status: 409 });

const wrongDigest = signRenderToken({
  jti: 'job-render-auth-test',
  tenantId: 'tenant-a',
  ratio: '9:16',
  duration: 15,
  manifestSha256: '0'.repeat(64),
});
const mismatched = resolveRenderAuthorization({ token: wrongDigest.token, tenantId: 'tenant-a', jobId: 'job-render-auth-test' });
assert.deepEqual(mismatched, { ok: false, code: 'render_manifest_mismatch', status: 409 });

const unknown = signRenderToken({
  jti: 'unknown-job',
  tenantId: 'tenant-a',
  ratio: '9:16',
  duration: 15,
  manifestSha256: digest,
});
const missing = resolveRenderAuthorization({ token: unknown.token, tenantId: 'tenant-a', jobId: 'unknown-job' });
assert.deepEqual(missing, { ok: false, code: 'render_authorization_not_found', status: 410 });

const batchManifests = ['zh', 'en', 'es'].map(language => ({
  jobId: `job-${language}`,
  spec: { ratio: '9:16', duration: 15, language },
}));
const batchResults = rememberRenderAuthorizationBatch(batchManifests.map(batchManifest => ({
  tenantId: 'tenant-a', expiresAt: signed.payload.exp, manifest: batchManifest,
})));
assert.equal(batchResults.length, 3);
assert.throws(() => rememberRenderAuthorizationBatch([
  { tenantId: 'tenant-a', expiresAt: signed.payload.exp, manifest: batchManifests[0]! },
  { tenantId: 'tenant-a', expiresAt: signed.payload.exp, manifest: batchManifests[0]! },
]), /duplicate job id/);

clearRenderAuthorizationStoreForTests();
fs.rmSync(root, { recursive: true, force: true });
console.log('render authorization store tests passed');
