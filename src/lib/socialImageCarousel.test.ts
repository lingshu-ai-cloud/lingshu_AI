import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import { runPlannedCarousel } from './socialImageCarousel';

function plannedTask(): SocialImageCreationTask {
  return {
    id: 'task-1', imageType: 'carousel',
    renderPlan: { version: 1, sourceHash: 'source', createdAt: 'now', units: [0, 1].map(index => ({
      jobId: `job-${index}`, index, count: 2, label: `轮播第 ${index + 1} 张`, role: 'carousel_page' as const,
      poster: {}, idempotencyKey: `key-${index}`, plannedInputHash: `hash-${index}`,
    })) },
    generationJobs: [0, 1].map(index => ({ id: `job-${index}`, idempotencyKey: `key-${index}`,
      status: 'queued' as const, outputNodeIds: [], attempt: 0, createdAt: 'now', updatedAt: 'now' })),
    outputs: [],
  } as unknown as SocialImageCreationTask;
}

function completed(task: SocialImageCreationTask, index: number): SocialImageCreationTask {
  const unit = task.renderPlan!.units[index]!;
  const outputId = `output-${index}`;
  return { ...task,
    generationJobs: task.generationJobs.map(job => job.id === unit.jobId
      ? { ...job, status: 'quality_checking' as const, outputNodeIds: [outputId] } : job),
    outputs: [...task.outputs, { id: outputId, role: 'carousel_page', label: unit.label,
      state: 'quality_checking' as const, mediaUrl: `/media/${outputId}.png`, materialId: outputId,
      version: 1, qualityChecks: [] }],
  };
}

test('planned carousel submits each frozen unit once and resumes after a durable page', async () => {
  const calls: string[] = [];
  const first = await runPlannedCarousel({ task: plannedTask(), planUnits: async () => { throw new Error('already planned'); },
    renderUnit: async (_taskId, jobId) => {
      calls.push(jobId);
      const index = Number(jobId.slice(-1));
      const prior = index === 0 ? plannedTask() : completed(plannedTask(), 0);
      return { ok: true, task: completed(prior, index), url: `/media/output-${index}.png` };
    } });
  assert.deepEqual(calls, ['job-0', 'job-1']);
  const resumedCalls: string[] = [];
  await runPlannedCarousel({ task: first, planUnits: async () => { throw new Error('must not replan'); },
    renderUnit: async (_taskId, jobId) => { resumedCalls.push(jobId); throw new Error('must not submit'); } });
  assert.deepEqual(resumedCalls, []);
});

test('unknown or unpersisted first-page outcome stops before the next paid unit', async () => {
  const calls: string[] = [];
  await assert.rejects(runPlannedCarousel({ task: plannedTask(), planUnits: async task => task,
    renderUnit: async (_taskId, jobId) => { calls.push(jobId); return { ok: false, error: 'network outcome unknown' }; } }), /network outcome unknown/);
  assert.deepEqual(calls, ['job-0']);
  const unknown = plannedTask();
  unknown.generationJobs[0]!.status = 'outcome_unknown';
  await assert.rejects(runPlannedCarousel({ task: unknown, planUnits: async task => task,
    renderUnit: async () => { throw new Error('must not submit'); } }), /requires_reconciliation/);
  await assert.rejects(runPlannedCarousel({ task: plannedTask(), planUnits: async task => task,
    renderUnit: async () => ({ ok: true, task: plannedTask() }) }), /not_durable/);
});
