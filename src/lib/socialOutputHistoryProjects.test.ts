import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudioProject } from './studioApi';
import { dedupeSocialOutputHistoryProjects, socialOutputOwnedReviewMedia } from './socialOutputHistoryProjects';

const sha = 'a'.repeat(64);
const project = (id: string, updatedAt: string, spec: Record<string, unknown>): StudioProject => ({
  id, title: id, status: 'ready_for_approval', createdAt: updatedAt, updatedAt, spec,
});
const trustedSpec = { automation: { managedBy: 'social_content_output' }, socialProductionOutput: { type: 'social_production_artifact', version: 1, taskId: 'task', artifactId: 'artifact', fileSha256: sha }, socialContentTaskId: 'task', renderOutputSha256: sha, renderOutputPreviewUrl: '/film' };

test('same task and media revision keeps only the newest trusted social output workspace', () => {
  const parent = project('parent', '2026-10-11T22:00:00Z', trustedSpec);
  const child = project('child', '2026-10-11T23:00:00Z', trustedSpec);
  assert.deepEqual(dedupeSocialOutputHistoryProjects([parent, child]).map(item => item.id), ['child']);
});

test('ordinary Studio projects and different task or media outputs are never collapsed', () => {
  const ordinaryA = project('ordinary-a', '2026-10-11T20:00:00Z', { renderOutputSha256: sha, renderOutputPreviewUrl: '/film' });
  const ordinaryB = project('ordinary-b', '2026-10-11T21:00:00Z', { renderOutputSha256: sha, renderOutputPreviewUrl: '/film' });
  const otherTask = project('other-task', '2026-10-11T22:00:00Z', { ...trustedSpec, socialContentTaskId: 'other' });
  const otherFilm = project('other-film', '2026-10-11T23:00:00Z', { ...trustedSpec, renderOutputSha256: 'b'.repeat(64) });
  assert.deepEqual(dedupeSocialOutputHistoryProjects([ordinaryA, ordinaryB, otherTask, otherFilm]).map(item => item.id), ['ordinary-a', 'ordinary-b', 'other-task', 'other-film']);
});

test('trusted lineage resolves to the authenticated artifact endpoint and rejects drift', () => {
  const item = project('child', '2026-10-11T23:00:00Z', { ...trustedSpec, socialProductionOutput: { ...trustedSpec.socialProductionOutput, taskId: 'task', artifactId: 'child-artifact', fileSha256: sha } });
  assert.deepEqual(socialOutputOwnedReviewMedia(item), { taskId: 'task', artifactId: 'child-artifact', fileSha256: sha, previewUrl: '/api/overseas/starter-198/social-content/tasks/task/artifacts/child-artifact/media' });
  assert.equal(socialOutputOwnedReviewMedia(project('drift', item.updatedAt, { ...item.spec, renderOutputSha256: 'b'.repeat(64) })), null);
  assert.equal(socialOutputOwnedReviewMedia(project('ordinary', item.updatedAt, { ...item.spec, automation: undefined })), null);
});
