import test from 'node:test';
import assert from 'node:assert/strict';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { readCurrentStudioSocialTask } from './studioSocialTaskRead';
import { socialTaskReferenceKickoff } from '../components/socialContent/useStudioSocialTaskHydration';

const task = {
  taskId: 'mvp-task', version: 'v3', runId: 'mvp-run',
  sources: [{ taskId: 'mvp-task', sourceId: 'mvp-reference', status: 'active', kind: 'reference_link', sourceRef: 'local://mvp-reference', label: '本轮参考' }],
  artifacts: [{ taskId: 'mvp-task', artifactId: 'mvp-film', version: 'v3' }],
} as unknown as SocialContentTaskDetail;

test('current authenticated task is applied once with its exact run and version', async () => {
  const writes: SocialContentTaskDetail[] = [];
  await readCurrentStudioSocialTask('mvp-task', async () => task, () => true, value => writes.push(value));
  assert.deepEqual(writes, [task]);
  assert.equal(writes[0]?.runId, 'mvp-run');
  assert.equal(writes[0]?.version, 'v3');
});

test('delayed read after login/task switch or unmount does not hydrate or refresh', async () => {
  let current = true, writes = 0;
  let resolve!: (value: SocialContentTaskDetail) => void;
  const pending = readCurrentStudioSocialTask('mvp-task', () => new Promise(r => { resolve = r; }), () => current, () => writes++);
  current = false;
  resolve(task);
  await pending;
  assert.equal(writes, 0);
  let reads = 0;
  await readCurrentStudioSocialTask('mvp-task', async () => { reads++; return task; }, () => false, () => writes++);
  assert.equal(reads, 0);
});

test('foreign task/source/artifact and missing version fail closed before any editor writes', async () => {
  for (const changed of [
    { ...task, taskId: 'other' }, { ...task, version: '' },
    { ...task, sources: [{ ...task.sources[0]!, taskId: 'other' }] },
    { ...task, artifacts: [{ ...task.artifacts[0]!, taskId: 'other' }] },
  ]) {
    let writes = 0;
    await assert.rejects(readCurrentStudioSocialTask('mvp-task', async () => changed, () => true, () => writes++), /任务身份不一致/);
    assert.equal(writes, 0);
  }
});

test('analysis for an inactive/missing reference never attaches to a different active reference', () => {
  const analyzed = { ...task, brief: { creationMode: 'viral_replication' }, referenceVideoAnalysis: { referenceSourceId: 'old-reference', status: 'ready', shots: [] } } as unknown as SocialContentTaskDetail;
  assert.equal(socialTaskReferenceKickoff(analyzed), null);
  assert.equal(socialTaskReferenceKickoff({ ...analyzed, referenceVideoAnalysis: null })?.video?.sourceUrl, 'local://mvp-reference');
});
