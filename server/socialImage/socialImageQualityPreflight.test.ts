import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { defaultSocialImageTask } from './socialImageTask.js';
import { runSocialImageVisualPreflight } from './socialImageQualityPreflight.js';

function fixture() {
  const task = defaultSocialImageTask({ title: '预检凭据' });
  task.id = 'image-a';
  task.schemaVersion = 'social-image-creation.v2';
  task.status = 'review_required';
  task.outputs = [{ id: 'candidate-a', role: 'single', label: '成片', state: 'quality_checking',
    version: 1, qualityChecks: [], mediaUrl: '/image.png' }];
  let row = { id: task.id, tenant_id: 'tenant-a', spec: { socialImageTask: task } };
  const store = {
    getById: async (_collection: string, id: string) => id === row.id ? structuredClone(row) : null,
    supportsAtomicCompareAndSwapFor: async () => true,
    compareAndSwap: async (_collection: string, id: string, expected: Record<string, unknown>, update: Record<string, unknown>) => {
      if (id !== row.id || JSON.stringify(expected.spec) !== JSON.stringify(row.spec)) return false;
      row = { ...row, spec: update.spec as typeof row.spec };
      return true;
    },
  } as unknown as DataStore;
  const visualInput = { generated: { bytes: Buffer.from('candidate bytes'), mimeType: 'image/png' },
    products: [], expected: { headline: '已确认标题', facts: [], format: 'single' } };
  return { store, visualInput, read: () => row.spec.socialImageTask };
}

test('identical visual preflight reuses its durable result without another quota claim or Qwen call', async () => {
  const f = fixture();
  let quota = 0, provider = 0;
  const input = { store: f.store, tenantId: 'tenant-a', taskId: 'image-a', outputId: 'candidate-a',
    visualInput: f.visualInput, allowPaidCall: async () => { quota += 1; return true; },
    qualityCheck: async () => { provider += 1; return []; } };
  assert.ok(await runSocialImageVisualPreflight(input));
  assert.ok(await runSocialImageVisualPreflight(input));
  assert.equal(quota, 1);
  assert.equal(provider, 1);
  assert.equal(f.read().outputs[0]?.qualityPreflight?.status, 'completed');
});

test('unknown provider outcome is fenced and never automatically retried', async () => {
  const f = fixture();
  let provider = 0;
  const input = { store: f.store, tenantId: 'tenant-a', taskId: 'image-a', outputId: 'candidate-a',
    visualInput: f.visualInput, allowPaidCall: async () => true,
    qualityCheck: async () => { provider += 1; throw new Error('transport unknown'); } };
  await assert.rejects(runSocialImageVisualPreflight(input), /social_image_quality_provider_outcome_unknown/);
  assert.equal(f.read().outputs[0]?.qualityPreflight?.status, 'outcome_unknown');
  await assert.rejects(runSocialImageVisualPreflight(input), /social_image_quality_outcome_unresolved/);
  assert.equal(provider, 1);
});
