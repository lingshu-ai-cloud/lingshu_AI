import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tenantPrivateObjectKey } from '../storage/materialAssets.js';
import type { DigitalHumanExecutionAdapter } from './digitalHumanProviderRegistry.js';
import { RunwayFastHeadAdapter } from './runwayFastHeadAdapter.js';

test('fast head orchestration is durable, idempotent and attributes cost to its Runway task', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-head-adapter-')); let submits = 0; let processes = 0; let state: 'pending' | 'completed' = 'pending'; let cancelled = '';
  const upstream: DigitalHumanExecutionAdapter = { id: 'runway_act_two', methods: ['reenact'],
    async submit() { submits++; return { externalTaskId: 'runway-1' }; },
    async status() { return state === 'pending' ? { state } : { state, outputUrl: 'https://output.example/candidate.mp4', actualCostCny: 1.6, costSourceRef: 'runway-task:runway-1:credits:20' }; },
    async cost(id) { assert.equal(id, 'runway-1'); return { actualCostCny: 1.6, costSourceRef: 'runway-task:runway-1:credits:20' }; },
    async cancel(id) { cancelled = id; return { cancelled: true }; } };
  const sourceObjectKey = tenantPrivateObjectKey('runway-reference', 'tenant-a', 'clip.mp4'); const outputObjectKey = tenantPrivateObjectKey('runway-fast-head', 'tenant-a', 'output.mp4');
  const make = () => new RunwayFastHeadAdapter({ root, upstream, estimatedCostCnyPerSecond: 1.2, process: async input => { processes++; assert.equal(input.sourceObjectKey, sourceObjectKey); return { outputObjectKey }; } });
  try {
    const adapter = make(); const input = { tenantId: 'tenant-a', referenceClipKey: sourceObjectKey, referenceClipObjectEtag: 'clip-v1' };
    const first = await adapter.submit(input, 'tenant-a:req-1'); const duplicate = await adapter.submit(input, 'tenant-a:req-1');
    assert.equal(first.externalTaskId, duplicate.externalTaskId); assert.equal(submits, 1); assert.equal(adapter.executionProfile.maxDurationSeconds, 15);
    assert.deepEqual(await adapter.status(first.externalTaskId), { state: 'pending' });
    assert.deepEqual(await adapter.cost!(first.externalTaskId), { actualCostCny: 1.6, costSourceRef: 'runway-task:runway-1:credits:20' });
    assert.deepEqual(await adapter.cancel!(first.externalTaskId), { cancelled: true }); assert.equal(cancelled, 'runway-1');
    state = 'completed';
    assert.deepEqual(await make().status(first.externalTaskId), { state: 'completed', outputObjectKey, actualCostCny: 1.6, costSourceRef: 'runway-task:runway-1:credits:20' });
    assert.deepEqual(await make().status(first.externalTaskId), { state: 'completed', outputObjectKey }); assert.equal(processes, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fast head orchestration never retries an uncertain paid submission', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-head-uncertain-')); let submits = 0;
  const upstream: DigitalHumanExecutionAdapter = { id: 'runway_act_two', methods: ['reenact'], async submit() { submits++; throw new Error('response lost'); }, async status() { return { state: 'pending' }; } };
  const adapter = new RunwayFastHeadAdapter({ root, upstream, process: async () => ({ outputObjectKey: '' }) });
  const input = { tenantId: 'tenant-a', referenceClipKey: tenantPrivateObjectKey('runway-reference', 'tenant-a', 'clip.mp4'), referenceClipObjectEtag: 'v1' };
  try {
    await assert.rejects(adapter.submit(input, 'tenant-a:req-2'), /response lost/);
    await assert.rejects(adapter.submit(input, 'tenant-a:req-2'), /不要重复提交/);
    assert.equal(submits, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fast head orchestration retries only its local idempotent step after processing failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-head-retry-')); let submits = 0; let processes = 0;
  const upstream: DigitalHumanExecutionAdapter = { id: 'runway_act_two', methods: ['reenact'], async submit() { submits++; return { externalTaskId: 'runway-retry' }; },
    async status() { return { state: 'completed', outputUrl: 'https://output.example/candidate.mp4', actualCostCny: 2, costSourceRef: 'runway-task:runway-retry:credits:25' }; } };
  const outputObjectKey = tenantPrivateObjectKey('runway-fast-head', 'tenant-a', 'retry.mp4');
  const adapter = new RunwayFastHeadAdapter({ root, upstream, process: async () => { processes++; if (processes === 1) throw new Error('temporary local worker error'); return { outputObjectKey }; } });
  const input = { tenantId: 'tenant-a', referenceClipKey: tenantPrivateObjectKey('runway-reference', 'tenant-a', 'clip.mp4'), referenceClipObjectEtag: 'v1' };
  try {
    const submitted = await adapter.submit(input, 'tenant-a:req-retry');
    const failedLocal = await adapter.status(submitted.externalTaskId); assert.equal(failedLocal.state, 'pending'); assert.ok('error' in failedLocal); assert.match(String(failedLocal.error), /本地处理待重试/);
    assert.deepEqual(await adapter.status(submitted.externalTaskId), { state: 'completed', outputObjectKey, actualCostCny: 2, costSourceRef: 'runway-task:runway-retry:credits:25' });
    assert.equal(submits, 1); assert.equal(processes, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
