import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../shared/contracts/socialImageExecution';
import { recoverImageReferenceAnalysis } from './imageReferenceAnalysisRecovery';
const error = (code: string) => Object.assign(new Error(code), { payload: { code } });
const task = { id: 'image-original', version: 2, creationPath: 'viral_replication', referenceSnapshot: { sourceRecordId: 'post', imageUrls: ['/post/selected-image'] }, productionRuntime: { binding: { contentTaskId: 'content-original' } } } as SocialImageCreationTask;
function fixture(code = 'social_image_reference_analysis_required') {
  const calls: string[] = [];
  let reads = 0, confirms = 0;
  const ports = {
    async read(id: string) { calls.push(`read:${id}`); return { task: { ...task, version: ++reads + 1 }, execution: null as SocialImageExecutionReceipt | null }; },
    async confirm(current: SocialImageCreationTask) { calls.push(`confirm:${current.version}`); if (++confirms === 1 && code) throw error(code); return { task: { ...current, referenceProductCheck: { decision: 'present' as const } } as SocialImageCreationTask }; },
    async analyze(id: string) { calls.push(`analyze:${id}`); },
    async enqueue(current: SocialImageCreationTask) { calls.push(`enqueue:${current.id}:${current.version}`); return { task: current, execution: { jobId: 'same-job', status: 'queued' } as SocialImageExecutionReceipt }; },
    isCurrent: () => true, onProgress: (_message: string) => {},
  };
  return { ports, calls };
}
test('analysis saves the source result before rechecking and queuing the same latest task', async () => {
  const f = fixture(); const result = await recoverImageReferenceAnalysis('content-original', f.ports);
  assert.deepEqual(f.calls, ['read:content-original','confirm:2','analyze:post','read:content-original','confirm:3','enqueue:image-original:3']);
  assert.equal(result.analyzed, true); assert.equal(result.task.id, task.id);
});
test('valid existing analysis is reused without another model call', async () => {
  const f = fixture(''); await recoverImageReferenceAnalysis('content-original', f.ports);
  assert.deepEqual(f.calls, ['read:content-original','confirm:2','enqueue:image-original:2']);
});
test('active or unknown analysis never triggers a second analysis', async () => {
  for (const code of ['social_image_reference_analysis_in_progress','social_image_reference_analysis_reconciliation_required']) {
    const f = fixture(code); await assert.rejects(recoverImageReferenceAnalysis('content-original', f.ports), new RegExp(code));
    assert.ok(!f.calls.some(call => call.startsWith('analyze:') || call.startsWith('enqueue:')));
  }
});
test('a failed analysis or write receipt prevents production and is not automatically retried', async () => {
  const f = fixture();f.ports.analyze = async id => { f.calls.push(`analyze:${id}`);throw error('image_post_analysis_result_persistence_failed'); };
  await assert.rejects(recoverImageReferenceAnalysis('content-original', f.ports), /persistence_failed/);
  assert.equal(f.calls.filter(call => call.startsWith('analyze:')).length, 1);
  assert.ok(!f.calls.some(call => call.startsWith('enqueue:')));
});
test('changing the selected image during analysis cannot resume the old selection', async () => {
  const f = fixture();const read = f.ports.read;let reads = 0;
  f.ports.read = async id => { const result = await read(id);if (++reads === 2) result.task = { ...result.task, referenceSnapshot: { ...result.task.referenceSnapshot!, imageUrls: ['/changed-image'] } }; return result; };
  await assert.rejects(recoverImageReferenceAnalysis('content-original', f.ports), /scope_changed/);
  assert.ok(!f.calls.some(call => call.startsWith('enqueue:')));
});
test('an existing execution is read without reanalysis or another enqueue', async () => {
  const f = fixture();const read = f.ports.read;
  f.ports.read = async id => ({ ...await read(id), execution: { jobId: 'existing', status: 'running' } as SocialImageExecutionReceipt });
  const result = await recoverImageReferenceAnalysis('content-original', f.ports);
  assert.equal(result.execution?.jobId, 'existing');assert.deepEqual(f.calls,['read:content-original']);
});
test('leaving the conversation after analysis stops task mutation', async () => {
  const f = fixture();let current = true;
  f.ports.isCurrent = () => current;f.ports.analyze = async () => {current = false;};
  await assert.rejects(recoverImageReferenceAnalysis('content-original', f.ports), /scope_changed/);
  assert.ok(!f.calls.some(call => call.startsWith('enqueue:')));
});
