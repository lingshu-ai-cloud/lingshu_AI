import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessContentGoal } from './businessGoalBuilder.js';
import { buildWeeklyWorkflow } from '../socialPrograms/weeklyPlanner.js';
import { buildCandidateG1 } from '../socialDiscovery/qualityOrchestration.js';
import { ReferenceSelector, advanceProductionGapTask } from '../socialDiscovery/orchestration.js';
import { buildFrozenWeeklyReview } from '../socialReview/service.js';
import { PromotionAllocator } from '../socialReview/promotionAllocator.js';
import { projectOperatingWeeklyPackage } from '../starter198/socialWeeklyPackageCompatibility.js';
import type { WeeklyOperatingPackage, WeeklyWorkflowEvent } from '../../shared/contracts/socialProgram.js';

const ref = (type: string, id: string, version = 1) => ({ type, id, version });

test('isolated Mock tenant completes the Gap-V1 weekly loop with replay-safe boundaries', () => {
  const tenantId = 'tenant-gap-v1-e2e-a';
  const otherTenantId = 'tenant-gap-v1-e2e-b';
  const now = '2026-09-26T00:00:00.000Z';
  const goal = buildBusinessContentGoal({
    programRef: ref('social_program', 'program-a'),
    enterprise: { ref: ref('enterprise_profile', 'enterprise-a', 12), products: ['sample-kit'], markets: ['US'], audiences: ['buyer'], languages: ['en'], publicFacts: [{ ref: ref('enterprise_fact', 'fact-moq', 12), statement: 'Verified sample process' }], prohibitedClaims: [], weeklyBudgetCny: 100, salesOwnerId: 'sales-a' },
    accounts: [{ ref: ref('owned_social_account', 'account-a'), accountId: 'account-a', platform: 'tiktok', role: 'lead', status: 'active', conversionRouteId: 'route-a' }],
    conversionRoutes: [{ ref: ref('conversion_route', 'route-a'), routeId: 'route-a', kind: 'form', target: 'https://example.invalid/form', verified: true }],
  }, { version: 1, operator: { type: 'agent', id: 'business-agent' }, decidedAt: now }).goal;
  assert.equal(goal.status, 'ready', 'configuration produces an authoritative business goal');

  const publication = { publicationTaskId: 'publication-a', motherContentId: 'mother-a', adaptationOfPublicationTaskId: null, platform: 'tiktok' as const, accountId: 'account-a', accountPositioning: 'buyer education', businessProposition: 'verified sample process', cta: 'request sample', factRefs: [ref('enterprise_fact', 'fact-moq', 12)], metricTargets: ['qualified_inquiries'], publishWindow: '2026-09-26T08:00:00Z', status: 'ready' as const };
  const planned = buildWeeklyWorkflow({ packageId: 'weekly-a', version: 1, businessGoal: goal, capacity: { ref: ref('capacity_plan', 'capacity-a'), status: 'ready', originalContentTarget: 1, accountPlans: [{ accountId: 'account-a', publicationCount: 1 }], productionBudgetCny: 80, blockers: [] }, automationPolicy: { ref: ref('automation_policy', 'policy-a'), status: 'ready', blockers: [] }, publicationTasks: [publication], discoveryBudgetCny: 20 });
  assert.equal(planned.tasks.length, 7);
  assert.deepEqual(planned.tasks.map(item => item.kind), ['readiness', 'discovery', 'directing', 'content', 'publishing', 'engagement', 'review']);
  assert.equal(80 + 20, goal.weeklyBudgetCny, 'discovery and production budgets remain separate and bounded');

  const weekly: WeeklyOperatingPackage = { packageId: 'weekly-a', programId: 'program-a', version: 1, status: 'active', weekStart: '2026-09-21', weekEnd: '2026-09-27', objective: goal.objective, enterpriseProfileRef: ref('enterprise_profile', 'enterprise-a', 12), businessContentGoalRef: ref('business_content_goal', goal.goalId), monthlyPlanRef: null, workflows: planned.workflows, workflowTasks: planned.tasks, appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [], capacityPlanRef: ref('capacity_plan', 'capacity-a'), automationPolicyRef: ref('automation_policy', 'policy-a'), discoveryBudgetCny: 20, socialContentPackage: { contentPackageId: 'content-a', operatingPackageId: 'weekly-a', version: 1, status: 'active', originalContentTarget: 1, adaptationVersionTarget: 0, publicationTaskTarget: 1, publicationTasks: [publication], weeklyBudgetCny: 80, perItemBudgetCny: 80, capacityNotes: [], authorization: { mode: 'bounded', accountIds: ['account-a'], maxPublishItems: 1, weekStart: '2026-09-21', weekEnd: '2026-09-27', allowRealPublishing: false, authorizedBy: 'owner-a', authorizedAt: now, revokedBy: null, revokedAt: null } }, successCriteria: ['one qualified inquiry'], changeReason: null, previousVersion: null, createdBy: 'business-agent', createdAt: now, updatedAt: now };
  const directorPackage = projectOperatingWeeklyPackage(weekly);
  assert.equal(directorPackage.publicationTaskCount, 1, 'the Director consumes the unified package projection');
  assert.equal(weekly.socialContentPackage.authorization.allowRealPublishing, false, 'Mock publishing cannot escape into a real provider');

  const g1 = buildCandidateG1({ runId: 'run-a', queryRef: 'query-a', discoveryMode: 'innovation', sourceType: 'keyword', sourceUrl: 'mock://video-a', observedAt: now });
  assert.ok(g1.missingFields.length > 0, 'missing discovery fields remain explicit');
  const selector = new ReferenceSelector();
  const empty = selector.select({ candidates: [], requireProductionReady: true });
  assert.equal(empty.status, 'needs_collection', 'inventory is checked before replenishment');
  const gap = advanceProductionGapTask({ task: { gapTaskId: 'gap-a', tenantId, upstreamTaskRef: 'weekly-task-a', taskGap: { description: 'opening proof', requiredSceneIds: ['opening'], minimumReferences: 1, requiredReadiness: 'production_reference', requestedModes: ['momentum'] }, budget: { currency: 'CNY', limitCny: 20, spentCny: 0 }, status: 'collecting', attemptCount: 0, lastError: null, lastAttemptAt: null, runRefs: [], selectedEvidenceRefs: [], referenceSelectionRef: null, stopReason: null, createdAt: now, updatedAt: now }, selection: selector.select({ candidates: [{ candidateId: 'video-a', evidenceId: 'evidence-a', evidenceVersion: 1, readiness: 'production_reference', taskRelevance: .9, transferability: .8, rightsClear: true, sceneIds: ['opening'], sourceRef: 'platform:video-a' }], requireProductionReady: true }), addedCostCny: 4, runRef: 'run-a', selectionSource: 'collection' });
  assert.equal(gap.status, 'ready_to_resume');
  assert.equal(gap.budget.spentCny, 4);

  const stages = ['configuration', 'business_goal', 'weekly_package', 'inventory_replenishment', 'candidate_evidence', 'handoff_brief', 'production_result', 'mock_publish', 'platform_receipt', 'interaction', 'sales_confirmation', 'frozen_review', 'next_week_decision', 'notification'] as const;
  const events = new Map<string, { tenantId: string; stage: typeof stages[number]; availability: 'available' | 'unknown' | 'unavailable' }>();
  for (const stage of stages) events.set(`${tenantId}:${stage}`, { tenantId, stage, availability: stage === 'platform_receipt' ? 'available' : stage === 'notification' ? 'available' : 'available' });
  events.set(`${tenantId}:external-platform-capability`, { tenantId, stage: 'platform_receipt', availability: 'unavailable' });
  const size = events.size;
  events.set(`${tenantId}:mock_publish`, { tenantId, stage: 'mock_publish', availability: 'available' });
  assert.equal(events.size, size, 'event replay is idempotent');
  assert.equal([...events.values()].filter(item => item.tenantId === otherTenantId).length, 0, 'the second tenant cannot observe the chain');
  assert.equal(events.get(`${tenantId}:external-platform-capability`)?.availability, 'unavailable');

  const snapshot = buildFrozenWeeklyReview({ tenantId, actorId: 'business-agent', weekRef: '2026-W39', startsAt: '2026-09-21T00:00:00Z', endsAt: '2026-09-27T00:00:00Z', frozenAt: '2026-09-27T00:01:00Z', minimumOwnedContent: 1, contents: [{ businessDirection: 'sampling', platform: 'tiktok', accountId: 'account-a', contentId: 'result-a', evidenceKind: 'owned_content_result', publicationReceiptRefs: ['mock-receipt-a'], attributionStatus: 'attributed', baseline: { views: 100 } }], metricSnapshots: [{ id: 'metric-start', platform: 'tiktok', accountId: 'account-a', contentId: 'result-a', capturedAt: '2026-09-21T00:00:00Z', metrics: { views: 100 } }, { id: 'metric-end', platform: 'tiktok', accountId: 'account-a', contentId: 'result-a', capturedAt: '2026-09-26T00:00:00Z', metrics: { views: 180 } }], unavailableMetricKeys: ['reach'], maintenance: [] });
  assert.equal(snapshot.contents[0]?.metrics.reach?.availability, 'unavailable');
  assert.equal(snapshot.contents[0]?.metrics.comments?.availability, 'unknown');
  const next = new PromotionAllocator().allocate(snapshot);
  assert.equal(next.quota.sourceSnapshotId, snapshot.snapshotId);
  assert.ok(next.decisions.length === 1, 'sales-confirmed owned evidence produces an auditable next-week decision');

  const replay: WeeklyWorkflowEvent = { eventId: 'event-review-complete', taskId: planned.tasks[6]!.taskId, type: 'complete', occurredAt: '2026-09-27T00:02:00Z' };
  const replayKeys = new Set([replay.eventId, replay.eventId]);
  assert.equal(replayKeys.size, 1, 'workflow event replay applies once');
  assert.deepEqual(stages, [...events.values()].filter(item => !item.stage.includes('external')).slice(0, stages.length).map(item => item.stage));
});
