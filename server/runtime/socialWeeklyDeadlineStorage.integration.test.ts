import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';

// Exercise the application's file-backed store, isolated from existing tenants.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-deadline-acceptance-'));
process.env.LOCAL_STORE_DIR = directory;
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.NODE_ENV = 'test';
const [{ pbStore: store }, { runWithDataAuthority }, { runSocialWeeklyExecutionScan }, { getWeeklyExecutionTaskRow }, { projectExecutionCalendar }, { runWeeklyDeadlineRecoveryScan, WEEKLY_DEADLINE_ASSESSMENTS }] = await Promise.all([
  import('../storage/pbStore.js'), import('../storage/dataAuthority.js'),
  import('./socialWeeklyExecutionRuntime.js'), import('../socialPrograms/executionTasks.js'),
  import('../../src/components/socialProgram/weeklyExecutionCalendar.js'),
  import('./socialWeeklyDeadlineRecovery.js'),
]);
const now = Date.now();
const time = (offset: number) => new Date(now + offset).toISOString();
function task(id: string, tenantId = 'deadline-tenant'): WeeklyExecutionTask {
  return { taskId: id, tenantId, programId: 'deadline-program', packageId: 'deadline-package', packageVersion: 1,
    workflowKind: 'readiness', scope: 'package', subjectId: 'deadline-package', accountId: null, publicationTaskId: null,
    dependsOnTaskIds: [], upstreamVersionRefs: [], inputSnapshot: {}, idempotencyKey: `${tenantId}:${id}`,
    budget: { category: 'none', limitCny: null }, schedule: { stepKind: 'business_outline', responsibleActor: 'business_agent',
      estimatedDurationMinutes: 15, estimatedStartAt: time(-3600000), estimatedFinishAt: time(-60000),
      latestStartAt: time(-3600000), latestFinishAt: time(-60000), actualStartedAt: null, actualFinishedAt: null },
    status: 'queued', ownBlockingReasons: [], inheritedBlockingTaskIds: [], attempt: 0, maxAttempts: 3,
    nextAttemptAt: null, lease: null, resultRefs: [], lastError: null, recoveredFromDeadLetterAt: null,
    cancelReason: null, createdAt: time(-7200000), updatedAt: time(-7200000) };
}
async function save(value: WeeklyExecutionTask) {
  return store.create('social_weekly_execution_tasks', { tenant_id: value.tenantId, task_id: value.taskId,
    program_id: value.programId, package_id: value.packageId, package_version: value.packageVersion,
    status: value.status, idempotency_key: value.idempotencyKey, created_at: value.createdAt, payload: value });
}
try {
  await runWithDataAuthority('local', async () => {
    await store.create('social_weekly_operating_packages', { tenant_id: 'deadline-tenant', program_id: 'deadline-program', package_id: 'deadline-package', version: 1,
      payload: { programId: 'deadline-program', packageId: 'deadline-package', version: 1, status: 'draft' } });
    await store.create('social_weekly_agent_planning', { tenant_id: 'deadline-tenant', program_id: 'deadline-program', package_id: 'deadline-package', package_version: 1, planning_version: 1,
      payload: { planningId: 'deadline-plan', version: 1, packageId: 'deadline-package', packageVersion: 1, status: 'dispatched',
        skeleton: { slots: [{ slotId: 'slot', motherContentId: 'mother', accountIds: ['account'], publicationTaskIds: ['publication'] }] },
        directorAnalyses: [], userConfirmation: { confirmedBy: 'actual-user', confirmedAt: time(-7200000) },
        detailedSchedule: { ref: { id: 'actual-schedule', version: 1 }, items: [{ publicationTaskId: 'publication' }] },
        dispatch: { packageVersion: 1, detailedScheduleRef: { id: 'actual-schedule', version: 1 }, scheduleItems: [{ publicationTaskId: 'publication' }] } } });
    await save(task('ready'));
    const future = task('future'); future.schedule.estimatedStartAt = time(3600000); future.schedule.latestStartAt = time(3600000);
    future.schedule.estimatedFinishAt = time(7200000); future.schedule.latestFinishAt = time(7200000);
    future.nextAttemptAt = time(3600000); await save(future);
    const human = task('human'); human.schedule.responsibleActor = 'user'; await save(human);
    const dependent = task('dependent'); dependent.status = 'blocked'; dependent.dependsOnTaskIds = ['human']; dependent.inheritedBlockingTaskIds = ['human']; dependent.publicationTaskId = 'affected-publication'; dependent.workflowKind = 'publishing'; dependent.schedule.stepKind = 'publishing'; await save(dependent);
    const staleQueued = task('stale-queued-child'); staleQueued.dependsOnTaskIds = ['human']; await save(staleQueued);
    await save(task('unauthorized', 'other-tenant'));
    const executions: string[] = [];
    const adapters = { business_outline: { async execute(value: WeeklyExecutionTask) {
      executions.push(value.taskId); return { status: 'succeeded' as const, resultRefs: [{ type: 'weekly_agent_planning', id: 'deadline-plan', version: 1 }] };
    } } };
    await runSocialWeeklyExecutionScan({ dataStore: store, adapters });
    assert.deepEqual(executions, ['ready'], 'future, human, dependency and unauthorized tenant do not enter executor');
    const completed = (await getWeeklyExecutionTaskRow(store, 'deadline-tenant', 'ready')).payload;
    assert.equal(completed.status, 'succeeded'); assert.ok(completed.schedule.actualFinishedAt);
    assert.equal(completed.schedule.latestFinishAt, time(-60000));
    assert.deepEqual(completed.resultRefs, [{ type: 'weekly_agent_planning', id: 'deadline-plan', version: 1 }]);
    assert.equal((await getWeeklyExecutionTaskRow(store, 'deadline-tenant', 'future')).payload.attempt, 0);
    assert.equal((await getWeeklyExecutionTaskRow(store, 'deadline-tenant', 'human')).payload.status, 'queued');
    assert.equal((await getWeeklyExecutionTaskRow(store, 'deadline-tenant', 'dependent')).payload.status, 'blocked');
    assert.equal((await getWeeklyExecutionTaskRow(store, 'deadline-tenant', 'stale-queued-child')).payload.attempt, 0, 'fresh dependency check fences a stale queued row');
    assert.equal((await getWeeklyExecutionTaskRow(store, 'other-tenant', 'unauthorized')).payload.status, 'blocked');
    await runSocialWeeklyExecutionScan({ dataStore: store, adapters });
    assert.deepEqual(executions, ['ready'], 'repeated real scan does not execute completed work twice');
    const recovery = (await getWeeklyExecutionTaskRow(store, 'deadline-tenant', 'human')).payload.deadlineRecovery!;
    assert.equal(recovery.status, 'blocked');
    assert.deepEqual(recovery.affectedPublicationIds, ['affected-publication']);
    assert.deepEqual(recovery.blockingReasons, ['fresh_remaining_budget_capacity_work_windows_required']);
    const history = await store.list<any>(WEEKLY_DEADLINE_ASSESSMENTS, { where: { tenant_id: 'deadline-tenant' } });
    assert.ok(history.totalItems > 0);
    const unchanged = await runWeeklyDeadlineRecoveryScan({ dataStore: store });
    assert.equal(unchanged.created, 0, 'unchanged evidence does not duplicate the durable assessment');
    await runWeeklyDeadlineRecoveryScan({ dataStore: store, readEvidence: async (_scope, tasks, at) => ({
      remainingBudgetCny: 0,
      constraints: Object.fromEntries(tasks.map(value => [value.taskId, { resourceKey: 'actual-reviewer', remainingMinutes: 15, remainingCostCny: 0, bufferMinutes: 5, availableAt: at.toISOString() }])),
      resources: { 'actual-reviewer': { concurrency: 1, workingWindows: [{ startAt: time(-3600000), finishAt: time(10800000) }] } },
    }) });
    const evaluated = (await getWeeklyExecutionTaskRow(store, 'deadline-tenant', 'human')).payload.deadlineRecovery!;
    assert.equal(evaluated.status, 'evaluated');
    assert.notEqual(evaluated.assessmentId, recovery.assessmentId, 'fresh evidence creates a new immutable assessment');
    const evaluatedRows = await store.list<any>(WEEKLY_DEADLINE_ASSESSMENTS, { where: { assessment_id: evaluated.assessmentId } });
    assert.equal(evaluatedRows.items[0].payload.revisionApplied, false);
    assert.equal(evaluatedRows.items[0].payload.assessment.publicationGap, 1);
    assert.equal((await getWeeklyExecutionTaskRow(store, 'deadline-tenant', 'human')).payload.status, 'queued', 'forecast never approves human work');
    const card = projectExecutionCalendar([completed], { business_outline: '经营初排' } as any)[0]!;
    assert.equal(card.status, 'completed');
    assert.equal(card.deliveryTiming, 'late');
    const disk = JSON.parse(fs.readFileSync(path.join(directory, 'social_weekly_execution_tasks.json'), 'utf8'));
    assert.equal(disk.find((row: any) => row.task_id === 'ready').payload.schedule.actualFinishedAt, completed.schedule.actualFinishedAt);
    console.log('Deadline storage acceptance: real scan → dispatch → lease → executor → evidence validation → disk → late calendar; future/human/dependency/tenant isolation and repeat scan verified.');
  });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
