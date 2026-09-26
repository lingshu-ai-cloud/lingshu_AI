import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import {
  assertNoWeeklyPackageDualWrite,
  assertUnifiedWeeklyWrite,
  projectOperatingWeeklyPackage,
  readLegacyWeeklyPlan,
} from './socialWeeklyPackageCompatibility.js';

const canonical = {
  packageId: 'weekly-1', programId: 'program-1', version: 3, status: 'active',
  weekStart: '2026-09-21', weekEnd: '2026-09-27', objective: '获得有效询盘',
  enterpriseProfileRef: null, businessContentGoalRef: null, monthlyPlanRef: null,
  workflows: [], workflowTasks: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [],
  capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: 25,
  socialContentPackage: {
    contentPackageId: 'content-1', operatingPackageId: 'weekly-1', version: 3, status: 'active',
    originalContentTarget: 2, adaptationVersionTarget: 2, publicationTaskTarget: 2,
    publicationTasks: [
      { publicationTaskId: 'pub-b', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null, platform: 'tiktok', accountId: 'account-1', accountPositioning: '专业', businessProposition: '稳定', cta: '咨询', factRefs: [], metricTargets: ['qualified_inquiries'], publishWindow: '2026-09-22T01:00:00Z', status: 'ready' },
      { publicationTaskId: 'pub-a', motherContentId: 'mother-2', adaptationOfPublicationTaskId: null, platform: 'instagram', accountId: 'account-2', accountPositioning: '案例', businessProposition: '可验证', cta: '留言', factRefs: [], metricTargets: ['views', 'qualified_inquiries'], publishWindow: null, status: 'planned' },
    ],
    weeklyBudgetCny: 100, perItemBudgetCny: 50, capacityNotes: [],
    authorization: { mode: 'bounded', accountIds: ['account-1', 'account-2'], maxPublishItems: 2, weekStart: '2026-09-21', weekEnd: '2026-09-27', allowRealPublishing: false, authorizedBy: 'owner', authorizedAt: '2026-09-21T00:00:00Z', revokedBy: null, revokedAt: null },
  },
  successCriteria: ['可归因询盘'], changeReason: null, previousVersion: 2, createdBy: 'agent', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z',
} satisfies WeeklyOperatingPackage;

test('canonical weekly package maps deterministically into the Director execution contract', () => {
  const projected = projectOperatingWeeklyPackage(canonical);
  assert.equal(projected.packageId, canonical.packageId);
  assert.equal(projected.version, '3');
  assert.equal(projected.originalContentCount, 2);
  assert.equal(projected.publicationTaskCount, 2);
  assert.deepEqual(projected.platforms, ['instagram', 'tiktok']);
  assert.deepEqual(projected.metricTargets, ['qualified_inquiries', 'views']);
  assert.equal(projected.publicationMatrix[0]?.accountRef, 'account-1');
});

test('legacy plan is a read-only projection and preserves unknown rather than inventing values', () => {
  const result = readLegacyWeeklyPlan({ id: 'legacy-1', tenant_id: 'tenant-1', plan: { version: '2' } });
  assert.equal(result.readonly, true);
  assert.equal(result.package.businessGoal, 'unknown');
  assert.equal(result.package.weeklyBudgetCny, null);
  assert.deepEqual(result.package.platforms, []);
  assert.deepEqual(result.missing, ['businessGoal', 'platforms']);
});

test('new writes are canonical-only and dual writes fail closed', () => {
  assert.doesNotThrow(() => assertUnifiedWeeklyWrite('social_weekly_operating_packages'));
  assert.throws(() => assertUnifiedWeeklyWrite('starter_social_content_plans'), /legacy_weekly_package_write_forbidden/);
  assert.throws(() => assertNoWeeklyPackageDualWrite([
    { collection: 'social_weekly_operating_packages', tenantId: 'tenant-1', operationId: 'op-1', objectId: 'weekly-1' },
    { collection: 'starter_social_content_plans', tenantId: 'tenant-1', operationId: 'op-1', objectId: 'legacy-1' },
  ]), /weekly_package_dual_write_detected/);
  assert.doesNotThrow(() => assertNoWeeklyPackageDualWrite([
    { collection: 'social_weekly_operating_packages', tenantId: 'tenant-1', operationId: 'op-1', objectId: 'weekly-1' },
    { collection: 'starter_social_content_plans', tenantId: 'tenant-2', operationId: 'op-1', objectId: 'legacy-1' },
  ]));
});
