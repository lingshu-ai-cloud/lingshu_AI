import test from 'node:test';
import assert from 'node:assert/strict';
import type { WeeklyContentNavigation } from '../../shared/contracts/weeklyContentNavigation';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import type { SocialSceneReworkAvailability } from '../../shared/contracts/socialSceneRework';
import { loadWeeklyContentProductionView } from './weeklyContentProductionView';

const target: WeeklyContentNavigation = {
  scope: { tenantId: 'tenant', programId: 'program', packageId: 'week', packageVersion: 2, executionTaskId: 'consumer' },
  contentTaskId: 'content', publicationTaskId: 'publication', bindingKey: 'weekly-production:week:2:publication',
  runId: 'original-run', source: 'completed_artifact', artifactRef: { type: 'starter_social_content_artifact', id: 'original-artifact', version: 3 }, gaps: [],
};
const task = { taskId: 'content', brief: { programRef: { objectType: 'social_program', id: 'program', version: 'v1' } }, runId: 'original-run', artifacts: [
  { taskId: 'content', artifactId: 'original-artifact', version: 'v3', kind: 'short_video', origin: 'agent' },
] } as SocialContentTaskDetail;
const scenes = { tenantId: 'tenant', taskId: 'content', sourceRunId: 'original-run', parentArtifactId: 'original-artifact', scenes: [] } as unknown as SocialSceneReworkAvailability;
const ports = { read: async () => structuredClone(target), task: async () => structuredClone(task), scenes: async () => structuredClone(scenes) };

test('fresh binding must retain tenant, package, consumer, run and exact original artifact before content reads', async () => {
  let reads = 0;
  const changes: WeeklyContentNavigation[] = [
    ...[{ tenantId: 'foreign' }, { programId: 'other' }, { packageId: 'other' }, { packageVersion: 3 }, { executionTaskId: 'other-consumer' }].map(change => ({ ...target, scope: { ...target.scope, ...change } })),
    { ...target, contentTaskId: 'other-content' }, { ...target, publicationTaskId: 'other-publication' },
    { ...target, bindingKey: 'other-binding' }, { ...target, runId: 'latest-run' },
    { ...target, artifactRef: { ...target.artifactRef!, id: 'latest-artifact' } },
    { ...target, artifactRef: { ...target.artifactRef!, version: 4 } },
    { ...target, artifactRef: null, source: 'production_binding' },
  ];
  for (const binding of changes) await assert.rejects(loadWeeklyContentProductionView(target, { ...ports, read: async () => binding, task: async () => { reads++; return task; } }));
  assert.equal(reads, 0);
});
test('an unfinished target accepts newly finished evidence only from its original run', async () => {
  const unfinished = { ...target, source: 'production_binding' as const, artifactRef: null };
  const finished = await loadWeeklyContentProductionView(unfinished, ports);
  assert.equal(finished.artifact?.artifactId, 'original-artifact');
  await assert.rejects(loadWeeklyContentProductionView(unfinished, { ...ports, read: async () => ({ ...target, runId: 'later-run' }) }));
  await assert.rejects(loadWeeklyContentProductionView(unfinished, { ...ports, read: async () => unfinished, task: async () => ({ ...task, runId: 'later-run' }) }));
});
test('scene responses must revalidate tenant, content, original run and original artifact even for historical tasks', async () => {
  for (const change of [{ tenantId: 'foreign' }, { taskId: 'foreign-content' }, { sourceRunId: 'latest-run' }, { parentArtifactId: 'latest-artifact' }]) {
    await assert.rejects(loadWeeklyContentProductionView(target, { ...ports, task: async () => ({ ...task, runId: 'latest-run' }), scenes: async () => ({ ...scenes, ...change }) }));
  }
  const historical = await loadWeeklyContentProductionView(target, { ...ports, task: async () => ({ ...task, runId: 'latest-run' }) });
  assert.equal(historical.historical, true);
  assert.equal(historical.artifact?.artifactId, 'original-artifact');
  assert.equal(historical.scenes?.sourceRunId, 'original-run');
});
test('content and artifact identities never fall back to the newest task artifact', async () => {
  for (const changed of [{ ...task, taskId: 'other' }, { ...task, brief: { ...task.brief, programRef: { ...task.brief.programRef!, id: 'foreign' } } },
    { ...task, artifacts: [] }, { ...task, artifacts: [task.artifacts[0]!, task.artifacts[0]!] },
    { ...task, artifacts: [{ ...task.artifacts[0]!, taskId: 'other' }] },
    { ...task, artifacts: [{ ...task.artifacts[0]!, version: 'v4' }] }]) {
    await assert.rejects(loadWeeklyContentProductionView(target, { ...ports, task: async () => changed }));
  }
});
