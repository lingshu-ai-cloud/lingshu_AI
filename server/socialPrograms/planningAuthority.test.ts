import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { DURABLE_OPERATION_LEASE_COLLECTION } from '../runtime/durableLease.js';
import { createWeeklyPlanningAuthority } from './planningAuthority.js';
import { SocialProgramError } from './service.js';

function memoryStore(): DataStore {
  const rows = new Map<string, Record_[]>();
  let counter = 0;
  return {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const existing = rows.get(collection) ?? [];
      if (data.id && existing.some(row => row.id === data.id)) return null;
      if (collection === DURABLE_OPERATION_LEASE_COLLECTION && existing.some(row => row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_; rows.set(collection, [...(rows.get(collection) ?? []), row]); return structuredClone(row) as T; },
    async update(collection: string, id: string, data: Record<string, unknown>) { const list = rows.get(collection) ?? []; const index = list.findIndex(row => row.id === id); if (index < 0) return false; list[index] = { ...list[index], ...structuredClone(data) }; return true; },
    async delete(collection: string, id: string) { const list = rows.get(collection) ?? []; rows.set(collection, list.filter(row => row.id !== id)); return true; },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let list = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      if (query.sort) { const desc = query.sort.startsWith('-'); const field = desc ? query.sort.slice(1) : query.sort; list = [...list].sort((a, b) => (Number(a[field]) - Number(b[field])) * (desc ? -1 : 1)); }
      const page = query.page ?? 1; const perPage = query.perPage ?? 100;
      return { items: structuredClone(list.slice((page - 1) * perPage, page * perPage)) as T[], totalItems: list.length, totalPages: Math.max(1, Math.ceil(list.length / perPage)), page, perPage };
    },
  };
}

function pkg(): WeeklyOperatingPackage {
  const publication = {
    publicationTaskId: 'publication-1', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null,
    platform: 'tiktok' as const, accountId: 'owned-account-1', accountPositioning: 'B2B factory', businessProposition: 'OEM proof', cta: 'Contact sales',
    factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 1 }], metricTargets: ['qualified_inquiry'], publishWindow: '2026-10-08T10:00:00Z', status: 'planned' as const,
  };
  return {
    packageId: 'package-1', programId: 'program-1', version: 1, status: 'draft', weekStart: '2026-10-05', weekEnd: '2026-10-11', objective: '获得 B2B 询盘',
    enterpriseProfileRef: null, monthlyPlanRef: null, workflows: [], workflowTasks: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [],
    capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: 10,
    socialContentPackage: {
      contentPackageId: 'content-package-1', operatingPackageId: 'package-1', version: 1, status: 'draft', originalContentTarget: 1, adaptationVersionTarget: 0,
      publicationTaskTarget: 1, publicationTasks: [publication], weeklyBudgetCny: 100, perItemBudgetCny: 100, capacityNotes: [],
      authorization: { mode: 'bounded', accountIds: ['owned-account-1'], maxPublishItems: 1, weekStart: '2026-10-05', weekEnd: '2026-10-11', allowRealPublishing: false, authorizedBy: null, authorizedAt: null, revokedBy: null, revokedAt: null },
    },
    successCriteria: ['1 条完成'], changeReason: null, previousVersion: null, createdBy: 'owner', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
}

test('business outline → director evidence → business schedule → user confirmation → business dispatch keeps authority boundaries', async () => {
  const dataStore = memoryStore();
  const service = createWeeklyPlanningAuthority(dataStore);
  await dataStore.create('social_discovery_scopes', {
    tenant_id: 'tenant-1', program_id: 'program-1', status: 'active', keyword_set_id: 'set-1', version: 1,
    payload: { approval: { status: 'approved', scopeVersion: 1 }, keywordSet: { scope: { audienceRole: 'brand_buyer' }, graph: { sceneClusters: [] } } },
  });
  await dataStore.create('social_candidate_evidence', {
    tenant_id: 'tenant-1', evidenceId: 'evidence-video-1', version: 1, tenantId: 'tenant-1', candidateId: 'video-1', inputFingerprint: 'fp',
    evidence: {
      inspirationId: 'video-1', discoveryPath: ['keyword'], sceneIds: [], relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: ['demo'], limitations: [] }, evidenceRefs: ['source'],
      qualityScore: { ruleVersion: 'discovery-score-v1', overall: 90, dimensions: { relevance: 90, transferability: 90, momentum: 75, evidence: 80, platformPriority: 100, businessModelFit: 100 }, decision: 'accepted', reasons: ['B2B'], blockers: [], scoredAt: '2026-10-01T00:00:00Z' },
      classification: { businessModel: 'b2b', platform: 'tiktok', keywordTier: 'medium' },
    },
    g1: { sourceUrl: 'https://www.tiktok.com/video-1' }, completeness: 'complete', createdAt: '2026-10-01T00:00:00Z', supersedesEvidenceId: null,
  });
  await dataStore.create('trend_videos', { id: 'video-1', tenantId: 'tenant-1', platform: 'tiktok', title: 'OEM factory capability proof', sourceUrl: 'https://www.tiktok.com/video-1' });
  await dataStore.create('social_tracked_accounts', {
    tenant_id: 'tenant-1', accountId: 'https://www.tiktok.com/@oem_factory', decision: 'track', status: 'tracked', accountRole: 'brand_factory', reasons: ['OEM factory wholesale supplier'],
    evidenceVideoIds: ['video-1', 'video-2', 'video-3'], relatedSceneIds: [], missingEvidence: [], confidence: 0.95,
    businessConfirmation: { status: 'confirmed', confirmedBy: 'business_agent', decisionRef: 'decision-1', reason: null, confirmedAt: '2026-10-01T00:00:00Z' },
  });
  const outline = await service.initialize('tenant-1', pkg());
  assert.equal(outline.skeleton.generatedBy, 'business_agent');
  assert.equal(outline.skeleton.tokenCost, 0);
  const analyzed = await service.runDirectorAnalysis({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: outline.version, actor: 'director_agent' });
  assert.equal(analyzed.directorAnalyses[0]?.analyzedBy, 'director_agent');
  assert.equal(analyzed.directorAnalyses[0]?.benchmarkVideoRefs[0]?.id, 'video-1');
  const merged = await service.mergeDetailedSchedule({ tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: analyzed.version, actor: 'business_agent' });
  assert.equal(merged.detailedSchedule?.mergedBy, 'business_agent');
  assert.equal(merged.detailedSchedule?.items[0]?.qualityTier, 'premium');
  await assert.rejects(
    service.dispatch({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: merged.version, actor: 'business_agent' }),
    (error: unknown) => error instanceof SocialProgramError && error.code === 'confirmed_detailed_schedule_required',
  );
  const confirmed = await service.confirm({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: merged.version, userId: 'owner' });
  const assertFrozen = async (state: typeof confirmed) => {
    await assert.rejects(service.mergeDetailedSchedule({ tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: state.version, actor: 'business_agent' }),
      (error: unknown) => error instanceof SocialProgramError && error.status === 409 && error.code === 'weekly_agent_plan_already_confirmed');
    await assert.rejects(service.runDirectorAnalysis({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: state.version, actor: 'director_agent' }),
      (error: unknown) => error instanceof SocialProgramError && error.code === 'weekly_agent_plan_already_confirmed');
    const repeated = await service.confirm({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: state.version, userId: 'other-user' });
    assert.deepEqual(repeated, state, 'reconfirmation preserves the original approval and history');
    assert.deepEqual(await service.get('tenant-1', 'program-1', 'package-1', 1), state);
  };
  await assertFrozen(confirmed);
  const dispatched = await service.dispatch({ tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: confirmed.version, actor: 'business_agent' });
  assert.equal(dispatched.dispatch?.issuedBy, 'business_agent');
  assert.equal(dispatched.dispatch?.assignedTo, 'content_agent');
  assert.ok(dispatched.dispatch?.detailedScheduleRef.id);
  await assertFrozen(dispatched);
});

async function preparedPlanning(dataStore: DataStore) {
  const authority = createWeeklyPlanningAuthority(dataStore);
  const outline = await authority.initialize('tenant-1', pkg());
  const slot = outline.skeleton.slots[0]!;
  const state = { ...outline, version: 2, status: 'director_analyzing', directorAnalyses: [{ analysisId: 'analysis-concurrent', slotId: slot.slotId, packageId: outline.packageId, packageVersion: 1, analyzedBy: 'director_agent', benchmarkAccountRefs: [], benchmarkVideoRefs: [], benchmarkEvidenceRefs: [], contentDirection: 'verified direction', styleRules: [], updateRhythm: 'weekly', materialRequirements: [], estimatedProductionMinutes: 30, createdAt: outline.createdAt }] };
  await dataStore.create('social_weekly_agent_planning', { tenant_id: 'tenant-1', program_id: outline.programId, package_id: outline.packageId, package_version: 1, planning_version: 2, payload: state, created_at: outline.createdAt });
  return state;
}
function assertSingleWinner(results: PromiseSettledResult<unknown>[]) {
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failed.reason instanceof SocialProgramError);
  assert.equal(failed.reason.code, 'weekly_agent_planning_version_conflict');
}
test('independent authorities serialize merge, confirmation and dispatch without duplicate or lost history', async () => {
  const dataStore = memoryStore(); await preparedPlanning(dataStore);
  const first = createWeeklyPlanningAuthority(dataStore), second = createWeeklyPlanningAuthority(dataStore);
  const merge = { tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: 2, actor: 'business_agent' as const };
  assertSingleWinner(await Promise.allSettled([first.mergeDetailedSchedule(merge), second.mergeDetailedSchedule(merge)]));
  const confirm = { tenantId: 'tenant-1', programId: 'program-1', packageId: 'package-1', packageVersion: 1, expectedPlanningVersion: 3, userId: 'owner' };
  assertSingleWinner(await Promise.allSettled([first.confirm(confirm), second.confirm(confirm)]));
  const dispatch = { ...confirm, expectedPlanningVersion: 4, actor: 'business_agent' as const };
  assertSingleWinner(await Promise.allSettled([first.dispatch(dispatch), second.dispatch(dispatch)]));
  const history = await dataStore.list<any>('social_weekly_agent_planning', { where: { tenant_id: 'tenant-1' }, sort: 'planning_version' });
  assert.deepEqual(history.items.map(row => row.planning_version), [1, 2, 3, 4, 5]);
  assert.deepEqual(history.items.map(row => row.payload.status), ['outline_ready', 'director_analyzing', 'awaiting_confirmation', 'confirmed', 'dispatched']);
  const dispatched = await first.get('tenant-1', 'program-1', 'package-1', 1);
  assert.equal(dispatched.userConfirmation?.confirmedBy, 'owner');
  assert.equal(dispatched.dispatch?.scheduleItems.length, 1);
  await assert.rejects(first.dispatch(dispatch), (error: unknown) => error instanceof SocialProgramError && error.code === 'weekly_agent_planning_version_conflict');
});
test('lost planning lease fences stale append and preserves the prior history', async () => {
  const dataStore = memoryStore(); await preparedPlanning(dataStore);
  let fence = true;
  const fencedStore: DataStore = { ...dataStore, async getById<T>(collection: string, id: string) {
    const row = await dataStore.getById<any>(collection, id);
    if (fence && collection === DURABLE_OPERATION_LEASE_COLLECTION && row) { fence = false; return { ...row, lease_token: 'successor-token' } as T; }
    return row as T | null;
  } };
  await assert.rejects(createWeeklyPlanningAuthority(fencedStore).mergeDetailedSchedule({ tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: 2, actor: 'business_agent' }), (error: unknown) => error instanceof SocialProgramError && error.code === 'weekly_agent_planning_lease_lost');
  assert.deepEqual((await dataStore.list<any>('social_weekly_agent_planning', { sort: 'planning_version' })).items.map(row => row.planning_version), [1, 2]);
  const recovered = await createWeeklyPlanningAuthority(dataStore).mergeDetailedSchedule({ tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: 2, actor: 'business_agent' });
  assert.equal(recovered.version, 3);
});
test('concurrent initialization creates one immutable outline', async () => {
  const dataStore = memoryStore();
  const results = await Promise.allSettled([createWeeklyPlanningAuthority(dataStore).initialize('tenant-1', pkg()), createWeeklyPlanningAuthority(dataStore).initialize('tenant-1', pkg())]);
  assertSingleWinner(results);
  assert.equal((await dataStore.list('social_weekly_agent_planning')).totalItems, 1);
  assert.equal((await createWeeklyPlanningAuthority(dataStore).initialize('tenant-1', pkg())).version, 1);
});
test('create-only version identity fences a delayed stale write after a successor commits', async () => {
  const dataStore = memoryStore(); await preparedPlanning(dataStore);
  let signalStarted!: () => void, releaseWrite!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const resume = new Promise<void>(resolve => { releaseWrite = resolve; });
  let delayFirst = true;
  const staleStore: DataStore = { ...dataStore, async create<T>(collection: string, data: Record<string, unknown>) {
    if (collection === 'social_weekly_agent_planning' && data.planning_version === 3 && delayFirst) {
      delayFirst = false; signalStarted(); await resume;
    }
    return dataStore.create<T>(collection, data);
  } };
  const input = { tenantId: 'tenant-1', programId: 'program-1', package: pkg(), expectedPlanningVersion: 2, actor: 'business_agent' as const };
  const stale = createWeeklyPlanningAuthority(staleStore).mergeDetailedSchedule(input);
  // Attach rejection handling before allowing the first operation to finish.
  const rejected = assert.rejects(stale, (error: unknown) => error instanceof SocialProgramError && error.code === 'weekly_agent_planning_version_conflict');
  await started;
  const lease = (await dataStore.list<any>(DURABLE_OPERATION_LEASE_COLLECTION)).items[0];
  await dataStore.delete(DURABLE_OPERATION_LEASE_COLLECTION, lease.id);
  const winner = await createWeeklyPlanningAuthority(dataStore).mergeDetailedSchedule({ ...input, now: new Date('2026-10-07T09:00:00Z') });
  releaseWrite(); await rejected;
  const history = await dataStore.list<any>('social_weekly_agent_planning', { sort: 'planning_version' });
  assert.deepEqual(history.items.map(row => row.planning_version), [1, 2, 3]);
  assert.deepEqual(history.items.at(-1).payload, winner, 'delayed stale creator cannot overwrite the successor history');
});
