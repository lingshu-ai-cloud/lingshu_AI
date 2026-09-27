import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Starter198Repository, StarterRecord } from '../starter198/repository.js';
import { STARTER_COLLECTIONS } from '../starter198/repository.js';
import { freezeSocialContentPublishSource, verifySocialContentPublishSource } from './socialContentSourceClaim.js';
import { buildSocialContentPublishingPackage } from '../digitalEmployees/publishingExecution.js';
import { socialContentFileView } from '../starter198/socialContentFiles.js';
const previous = process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'social-publish-source-'));
process.chdir(root);
const bytes = Buffer.from('test video bytes; no provider or public platform is invoked');
const fileId = 'socialfile_0123456789abcdef01234567';
const artifact: StarterRecord = { id: 'artifact-row', tenant_id: 'tenant', task_id: 'task', artifact_id: 'artifact',
  artifact_kind: 'short_video', status: 'approved', origin: 'agent', version: '1', resource_ref: `socialfile:${fileId}`, content_hash: 'hash-v1' };
const file: StarterRecord = { id: 'file-row', tenant_id: 'tenant', task_id: 'task', file_id: fileId, usage: 'artifact_media',
  byte_size: bytes.length, content_sha256: createHash('sha256').update(bytes).digest('hex'), mime_type: 'video/mp4', name: 'output.mp4' };
const repository = { async list(collection: string, tenantId: string, query?: { where?: Record<string, unknown> }) {
  const candidate = collection === STARTER_COLLECTIONS.socialContentArtifacts ? artifact : file;
  const items = candidate.tenant_id === tenantId && Object.entries(query?.where || {}).every(([key, value]) => candidate[key] === value) ? [candidate] : [];
  return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 2 };
} } as Starter198Repository;
let opened = 0;
const deps = { repository, openMedia: async () => {
  opened++;
  return { file: socialContentFileView(file), body: (async function* () { yield bytes; })() };
} };
const input = { tenantId: 'tenant', taskId: 'task', artifactId: 'artifact' };
try {
  const claim = await freezeSocialContentPublishSource(input, deps);
  assert.equal(claim.sourceKind, 'social_content_artifact');
  assert.equal(claim.projectId, 'task', 'identity stays the real task, not a fabricated studio project');
  assert.equal(claim.artifactId, 'artifact');
  assert.deepEqual(await fs.readFile(claim.deliveryVideoPath), bytes);
  assert.deepEqual(await freezeSocialContentPublishSource(input, deps), claim);
  assert.equal(opened, 1, 'replay reuses verified bytes');
  assert.deepEqual(await verifySocialContentPublishSource('tenant', claim, repository), claim);
  await assert.rejects(freezeSocialContentPublishSource({ ...input, tenantId: 'other' }, deps));
  artifact.status = 'superseded';
  await assert.rejects(verifySocialContentPublishSource('tenant', claim, repository));
  artifact.status = 'approved';
  artifact.version = '2';
  assert.notDeepEqual(await verifySocialContentPublishSource('tenant', claim, repository), claim, 'outer claim verifier detects changed acceptance version');
  artifact.version = '1';
  await fs.writeFile(claim.deliveryVideoPath, Buffer.alloc(bytes.length));
  await assert.rejects(verifySocialContentPublishSource('tenant', claim, repository));
  await freezeSocialContentPublishSource(input, deps);
  await fs.rm(claim.deliveryVideoPath);
  await assert.rejects(verifySocialContentPublishSource('tenant', claim, repository),
    (error: unknown) => (error as { name?: string; code?: string }).code === 'social_publish_media_unavailable',
    'missing pre-submit media is a source verification failure, never an unknown platform result');
  await freezeSocialContentPublishSource(input, deps);
  const item = { taskId: 'task', artifactId: 'artifact', platform: 'youtube' as const, accountId: 'account', accountLabel: 'Account', title: 'Title', description: 'Copy', scheduledAt: '2026-10-01T12:00:00.000Z' };
  const pack = await buildSocialContentPublishingPackage({ tenantId: 'tenant', allowRealPublishing: false, items: [item, item] }, { freezeSource: value => freezeSocialContentPublishSource(value, deps) });
  assert.equal(pack.items.length, 1, 'same assignment is not duplicated');
  assert.equal(pack.allowRealPublishing, false, 'approved creation does not grant publishing');
  assert.equal(pack.items[0].sourceClaim.sourceKind, 'social_content_artifact');
  console.log('social content publish source and package bridge tests passed');
} finally { process.chdir(previous); await fs.rm(root, { recursive: true, force: true }); }
