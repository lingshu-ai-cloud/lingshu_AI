import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { createSocialProgramService } from '../socialPrograms/service.js';
import { advanceWeeklyPlanning } from '../../src/lib/weeklyPlanningActions.js';
import { socialProgramApi, SocialProgramRequestError } from '../../src/lib/socialProgramApi.js';
import type { WeeklyAgentPlanningState } from '../../shared/contracts/socialProgram.js';
import { createSocialProgramsRouter } from './socialPrograms.js';

function memoryStore(): DataStore {
  const rows = new Map<string, Record_[]>();
  let counter = 0;
  return {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      const index = list.findIndex(row => row.id === id);
      if (index < 0) return false;
      list[index] = { ...list[index], ...structuredClone(data) };
      return true;
    },
    async delete(collection: string, id: string) {
      const list = rows.get(collection) ?? [];
      const next = list.filter(row => row.id !== id);
      rows.set(collection, next);
      return next.length !== list.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let items = (rows.get(collection) ?? []).filter(row => (
        Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value)
      ));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const field = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((left, right) => {
          const a = left[field];
          const b = right[field];
          const comparison = typeof a === 'number' && typeof b === 'number'
            ? a - b : String(a ?? '').localeCompare(String(b ?? ''));
          return comparison * (descending ? -1 : 1);
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      const start = (page - 1) * perPage;
      return {
        items: structuredClone(items.slice(start, start + perPage)) as T[],
        totalItems: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / perPage)),
        page,
        perPage,
      };
    },
  };
}

test('social program routes expose the weekly operating package lifecycle', async t => {
  const dataStore = memoryStore();
  const service = createSocialProgramService(dataStore);
  const program = await service.createProgram('tenant-a', 'owner', {
    brandName: 'Route Factory', market: '北美', targetAudience: '品牌采购',
    candidatePlatforms: ['tiktok', 'facebook', 'instagram', 'youtube'], route: 'cold_start',
  });
  for (const [platform, count] of [['tiktok', 2], ['facebook', 2], ['instagram', 1], ['youtube', 1]] as const) {
    for (let index = 0; index < count; index += 1) {
      await service.createAccount('tenant-a', 'owner', program.programId, {
        platform, displayName: `${platform}-${index}`, businessRole: index ? '协同账号' : '核心账号',
        audiencePromise: '服务目标采购', contentPromise: '可验证内容',
      });
    }
  }

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.tenantId = req.header('x-isolated-test-tenant') || 'tenant-a';
    res.locals.userId = 'owner';
    next();
  });
  app.use('/api/overseas/social-programs', createSocialProgramsRouter(dataStore, false));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/social-programs/${program.programId}`;

  const emptyConstraints = await fetch(`${base}/operating-constraints`);
  assert.equal(emptyConstraints.status, 200);
  assert.equal((await emptyConstraints.json()).item, null);
  const savedConstraints = await fetch(`${base}/operating-constraints`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      expectedVersion: 0, weeklyBudgetCny: 1000, costPerOriginalCny: 50, costPerAdaptationCny: 20,
      materialUnitsPerOriginal: 1, productionItemsPerDay: 5, interactionItemsPerWeek: 100,
      salesLeadsPerWeek: 20, expectedInteractionsPerPublication: 5, expectedLeadsPerPublication: 1,
      accountWeeklyPublicationCapacity: {}, ready: true, policy: { automaticExecutionAllowed: true },
    }),
  });
  assert.equal(savedConstraints.status, 201);
  const resolvedResponse = await fetch(`${base}/operating-plan/resolve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ weekStart: '2026-10-05', ready: true, capacityPlan: { publicationQuota: 999 }, automationPolicy: { automaticExecutionAllowed: true } }),
  });
  assert.equal(resolvedResponse.status, 201);
  const resolved = await resolvedResponse.json();
  assert.equal(resolved.item.snapshot.status, 'blocked', 'missing server authorities must fail closed despite forged client readiness');
  assert.deepEqual(Object.keys(resolved.weeklyAuthority), ['operatingDecisionSnapshotRef']);

  const createdResponse = await fetch(`${base}/operating-packages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ weekStart: '2026-10-05', objective: '路由闭环', successCriteria: ['接口可用'] }),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).item;
  assert.equal(created.socialContentPackage.publicationTaskTarget, 26);
  assert.ok(created.executionSummary.total > 0);
  assert.equal(created.agentPlanning.status, 'outline_ready');
  assert.equal(created.agentPlanning.skeleton.generatedBy, 'business_agent');
  assert.equal(created.agentPlanning.skeleton.tokenCost, 0);

  const cancellationPath = `${base}/operating-packages/${created.packageId}/cancellation`;
  const noCancellation = await fetch(`${cancellationPath}?version=1`);
  assert.equal(noCancellation.status, 200);
  assert.deepEqual(await noCancellation.json(), { item: null }, 'no cancellation receipt remains unknown rather than invented success');
  for (const version of ['0', '-1', '1.5', 'invalid']) {
    const invalid = await fetch(`${cancellationPath}?version=${version}`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'package_version_invalid');
  }
  const otherTenant = await fetch(cancellationPath, { headers: { 'x-isolated-test-tenant': 'tenant-other' } });
  assert.equal(otherTenant.status, 404, 'cancellation route requires tenant ownership of the package');
  const otherProgram = await fetch(cancellationPath.replace(program.programId, 'program-not-owned'));
  assert.equal(otherProgram.status, 404, 'cancellation route requires matching program ownership');

  const executionResponse = await fetch(`${base}/operating-packages/${created.packageId}/execution-tasks?version=1`);
  assert.equal(executionResponse.status, 200);
  const executionItems = (await executionResponse.json()).items;
  assert.equal(executionItems.length, created.executionSummary.total, 'summary matches the actual persisted task graph');
  for (const publication of created.socialContentPackage.publicationTasks) {
    const selected = (kind: string) => executionItems.filter((task: any) => task.publicationTaskId === publication.publicationTaskId && task.schedule.stepKind === kind);
    const generation = selected('video_generation'); const extraction = selected('template_extraction'); const validation = selected('template_performance_validation');
    assert.equal(generation.length, 1); assert.equal(extraction.length, 1); assert.equal(validation.length, 1);
    assert.ok(extraction[0].dependsOnTaskIds.includes(generation[0].taskId));
    assert.ok(extraction[0].dependsOnTaskIds.some((id: string) => executionItems.some((task: any) => task.taskId === id && task.schedule.stepKind === 'weekly_review')));
    assert.deepEqual(validation[0].dependsOnTaskIds, [extraction[0].taskId]);
  }
  assert.ok(executionItems.every((item: { schedule?: { responsibleActor?: string; estimatedDurationMinutes?: number } }) => item.schedule?.responsibleActor && Number(item.schedule.estimatedDurationMinutes) > 0));

  const recoveryPath = `${base}/operating-packages/${created.packageId}/recovery-assessment`;
  const recoveryBody = { packageVersion: 1, changedTaskIds: [], constraints: {}, resources: {}, remainingBudgetCny: 0,
    tasks: [{ taskId: 'forged-completed-publication', status: 'succeeded', publicationTaskId: 'fake' }] };
  const assessedResponse = await fetch(recoveryPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(recoveryBody) });
  assert.equal(assessedResponse.status, 200);
  const assessed = await assessedResponse.json();
  assert.equal(assessed.inputAuthority, 'stored_tasks_with_user_supplied_capacity_assumptions');
  assert.equal(assessed.item.forecast.length, executionItems.length);
  assert.ok(assessed.item.forecast.every((item: { taskId: string }) => item.taskId !== 'forged-completed-publication'));
  assert.equal(assessed.item.revisionApplied, false);
  const afterAssessment = await fetch(`${base}/operating-packages/${created.packageId}/execution-tasks?version=1`);
  assert.deepEqual((await afterAssessment.json()).items, executionItems, 'recovery forecast must not mutate persisted execution evidence');
  const missingVersion = await fetch(recoveryPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...recoveryBody, packageVersion: undefined }) });
  assert.equal(missingVersion.status, 400);
  assert.equal((await missingVersion.json()).error, 'package_version_invalid');
  const isolatedRecovery = await fetch(recoveryPath, { method: 'POST', headers: { 'content-type': 'application/json', 'x-isolated-test-tenant': 'tenant-other' }, body: JSON.stringify(recoveryBody) });
  assert.equal(isolatedRecovery.status, 404, 'recovery must not expose another tenant task graph');
  const backwardPath = `${base}/operating-packages/${created.packageId}/backward-schedule`;
  const backwardBody = { packageVersion: 1, constraints: {}, resources: {}, remainingBudgetCny: 0 };
  const backwardResponse = await fetch(backwardPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(backwardBody) });
  assert.equal(backwardResponse.status, 200);
  const backward = await backwardResponse.json();
  assert.equal(backward.inputAuthority, 'stored_tasks_with_user_supplied_capacity_assumptions');
  assert.equal(backward.item.assignments.length, executionItems.length);
  assert.equal(backward.item.revisionApplied, false);
  assert.equal(backward.item.conditionallyReachableCount, 0, 'missing capacity cannot imply publish targets are feasible');
  const forgedBackward = await fetch(backwardPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...backwardBody, tasks: recoveryBody.tasks }) });
  assert.equal(forgedBackward.status, 400);
  const foreignBackward = await fetch(backwardPath, { method: 'POST', headers: { 'content-type': 'application/json', 'x-isolated-test-tenant': 'tenant-other' }, body: JSON.stringify(backwardBody) });
  assert.equal(foreignBackward.status, 404);
  assert.deepEqual((await (await fetch(`${base}/operating-packages/${created.packageId}/execution-tasks?version=1`)).json()).items, executionItems);

  const listResponse = await fetch(`${base}/operating-packages?weekStart=2026-10-05`);
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).items.length, 1);

  await dataStore.create('social_discovery_scopes', {
    tenant_id: 'tenant-a', program_id: program.programId, status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await dataStore.create('social_candidate_evidence', {
    tenant_id: 'tenant-a', evidenceId: 'evidence-video-1', version: 1, tenantId: 'tenant-a', candidateId: 'video-1', inputFingerprint: 'fp',
    evidence: {
      inspirationId: 'video-1', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl: 'https://www.tiktok.com/video-1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await dataStore.create('trend_videos', { id: 'video-1', tenantId: 'tenant-a', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/video-1' });
  await dataStore.create('social_tracked_accounts', {
    tenant_id: 'tenant-a', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: ['video-1', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });

  // Drive the exact action used by the React workbench through its API and real router.
  const originalFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  const origin = new URL(base).origin;
  globalThis.fetch = (input, init) => originalFetch(new URL(String(input), origin), init);
  try {
    let state: WeeklyAgentPlanningState = created.agentPlanning;
    const outline = state;
    const path = `${base}/operating-packages/${created.packageId}/agent-planning`;
    for (const body of [{ expectedVersion: 1 }, { expectedPackageVersion: 1 }, { expectedPackageVersion: 1, expectedPlanningVersion: 0 }]) {
      const invalid = await fetch(`${path}/director-analysis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(invalid.status, 400, 'both explicit versions are mandatory');
    }
    // A merge failure must preserve completed analysis and resume without re-analysis.
    globalThis.fetch = (input, init) => String(input).endsWith('/agent-planning/merge')
      ? Promise.resolve(Response.json({ error: 'temporary_unavailable', message: '临时不可用' }, { status: 503 }))
      : originalFetch(new URL(String(input), origin), init);
    await assert.rejects(advanceWeeklyPlanning(program.programId, created.packageId, created.version, state, next => { state = next; }),
      (error: unknown) => error instanceof SocialProgramRequestError && error.status === 503);
    assert.equal(state.status, 'director_analyzing');
    assert.equal(state.version, 2);
    globalThis.fetch = (input, init) => originalFetch(new URL(String(input), origin), init);
    state = await advanceWeeklyPlanning(program.programId, created.packageId, created.version, state, next => { state = next; });
    assert.equal(state.status, 'awaiting_confirmation');
    assert.equal(state.version, 3);
    assert.equal(state.packageVersion, 1, 'package version must not advance with Agent analysis');
    const merged = state;
    for (const action of ['director-analysis', 'merge', 'confirm', 'dispatch']) {
      const stale = await fetch(`${path}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedPackageVersion: 1, expectedPlanningVersion: outline.version }) });
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).error, 'weekly_agent_planning_version_conflict');
    }
    await assert.rejects(socialProgramApi.confirmAgentSchedule(program.programId, created.packageId, { expectedPackageVersion: 2, expectedPlanningVersion: state.version }),
      (error: unknown) => error instanceof SocialProgramRequestError && error.status === 409 && error.code === 'weekly_package_version_conflict');
    assert.deepEqual(await socialProgramApi.getAgentPlanning(program.programId, created.packageId, 1), merged, 'rejected mutations preserve the plan');
    state = await advanceWeeklyPlanning(program.programId, created.packageId, 1, state, () => {});
    assert.equal(state.status, 'confirmed');
    assert.equal(state.userConfirmation?.confirmedBy, 'owner');
    const assertFrozenOverHttp = async (frozen: WeeklyAgentPlanningState) => {
      const before = await dataStore.list('social_weekly_agent_planning', { where: { tenant_id: 'tenant-a', package_id: created.packageId } });
      for (const action of ['director-analysis', 'merge']) {
        const response = await fetch(`${path}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedPackageVersion: 1, expectedPlanningVersion: frozen.version }) });
        assert.equal(response.status, 409);
        const error = await response.json();
        assert.equal(error.error, 'weekly_agent_plan_already_confirmed');
        assert.match(error.message, /修订.*重新确认/);
      }
      const repeated = await socialProgramApi.confirmAgentSchedule(program.programId, created.packageId, { expectedPackageVersion: 1, expectedPlanningVersion: frozen.version });
      assert.deepEqual(repeated, frozen);
      assert.deepEqual(await socialProgramApi.getAgentPlanning(program.programId, created.packageId, 1), frozen);
      const after = await dataStore.list('social_weekly_agent_planning', { where: { tenant_id: 'tenant-a', package_id: created.packageId } });
      assert.equal(after.totalItems, before.totalItems, 'frozen reentry does not append history');
    };
    await assertFrozenOverHttp(state);
    state = await advanceWeeklyPlanning(program.programId, created.packageId, 1, state, () => {});
    assert.equal(state.status, 'dispatched');
    assert.equal(state.version, 5);
    assert.equal(state.dispatch?.scheduleItems.length, 26);
    assert.equal(state.dispatch?.assignedTo, 'content_agent');
    const tasks = await socialProgramApi.listExecutionTasks(program.programId, created.packageId, 1);
    assert.ok(tasks.some(item => (item.inputSnapshot.dispatchRef as { id?: string } | undefined)?.id === state.dispatch?.dispatchId));
    assert.ok(tasks.every(item => item.status !== 'succeeded'), 'dispatch is not completed production');
    await assertFrozenOverHttp(state);
    assert.deepEqual(await socialProgramApi.listExecutionTasks(program.programId, created.packageId, 1), tasks, 'frozen reentry preserves dispatch task snapshots');

    // A real package revision gets its own planning identity and fresh confirmation.
    const oldPlanning = state;
    const revised = await socialProgramApi.reviseOperatingPackage(program.programId, created.packageId, {
      expectedVersion: 1, objective: '修订后的周经营目标', changeReason: '用户修改已确认排期',
    });
    assert.equal(revised.version, 2);
    assert.equal(revised.previousVersion, 1);
    assert.equal(revised.agentPlanning?.status, 'outline_ready');
    assert.equal(revised.agentPlanning?.version, 1);
    assert.equal(revised.agentPlanning?.userConfirmation, null);
    assert.equal(revised.agentPlanning?.dispatch, null);
    assert.notEqual(revised.agentPlanning?.planningId, oldPlanning.planningId);
    let revisionPlanning = await advanceWeeklyPlanning(program.programId, created.packageId, revised.version, revised.agentPlanning!, () => {});
    await assert.rejects(socialProgramApi.dispatchAgentSchedule(program.programId, created.packageId, { expectedPackageVersion: 2, expectedPlanningVersion: revisionPlanning.version }),
      (error: unknown) => error instanceof SocialProgramRequestError && error.code === 'confirmed_detailed_schedule_required');
    revisionPlanning = await advanceWeeklyPlanning(program.programId, created.packageId, 2, revisionPlanning, () => {});
    assert.equal(revisionPlanning.status, 'confirmed');
    revisionPlanning = await advanceWeeklyPlanning(program.programId, created.packageId, 2, revisionPlanning, () => {});
    assert.equal(revisionPlanning.status, 'dispatched');
    assert.notEqual(revisionPlanning.dispatch?.dispatchId, oldPlanning.dispatch?.dispatchId);
    assert.deepEqual(await socialProgramApi.getAgentPlanning(program.programId, created.packageId, 1), oldPlanning);
    assert.deepEqual(await socialProgramApi.listExecutionTasks(program.programId, created.packageId, 1), tasks, 'new revision preserves old dispatched task history');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }

  const activatedResponse = await fetch(`${base}/operating-packages/${created.packageId}/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 2, expectedProgramVersion: 1, authorizePublishing: true }),
  });
  assert.equal(activatedResponse.status, 409);
  assert.equal((await activatedResponse.json()).error, 'weekly_operating_package_activation_blocked');

  const retiredResponse = await fetch(`${base}/operating-packages/${created.packageId}/retire`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 2, expectedProgramVersion: 1 }),
  });
  assert.equal(retiredResponse.status, 200);
  const retired = (await retiredResponse.json()).item;
  assert.equal(retired.status, 'retired');
  assert.equal(retired.socialContentPackage.authorization.allowRealPublishing, false);
  const actualCancellation = await fetch(`${cancellationPath}?version=2`);
  assert.equal(actualCancellation.status, 200);
  const summary = (await actualCancellation.json()).item;
  assert.ok(summary, 'actual retirement records a durable cancellation summary');
  assert.equal(summary.boundary, 'stop_future_work_preserve_external_effects');
  assert.equal(summary.status, 'completed');
  const otherVersion = await fetch(`${cancellationPath}?version=3`);
  assert.deepEqual(await otherVersion.json(), { item: null }, 'a receipt for another package version must not leak');
  const receipt = (await dataStore.list<any>('social_weekly_cancellations', { where: { tenant_id: 'tenant-a', package_id: created.packageId, package_version: 2 } })).items[0];
  assert.ok(receipt);
  await dataStore.update('social_weekly_cancellations', receipt.id, {
    status: 'completed_with_external_effects', reason: 'secret-provider-reason', last_error: 'secret-provider-token',
    effects: [{ resourceType: 'production_job', resourceId: 'job-trace', outcome: 'unknown_requires_reconciliation', receiptRefs: ['secret-provider-receipt-token'] }],
  });
  const sanitizedResponse = await fetch(`${cancellationPath}?version=2`);
  const sanitized = await sanitizedResponse.json();
  assert.deepEqual(sanitized.item.effects, [{ resourceType: 'production_job', resourceId: 'job-trace', outcome: 'unknown_requires_reconciliation', receiptCount: 1 }]);
  assert.equal(sanitized.item.lastError, '部分清理未完成，请重试撤回以继续补偿。');
  assert.ok(!JSON.stringify(sanitized).includes('secret-provider'), 'summary excludes raw receipts, reasons and provider error secrets');
  assert.deepEqual(Object.keys(sanitized.item).sort(), ['boundary', 'currentSettlements', 'effects', 'lastError', 'status', 'updatedAt']);

});
