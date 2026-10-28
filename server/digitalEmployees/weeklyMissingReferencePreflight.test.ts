import assert from 'node:assert/strict';
import test from 'node:test';
import { createDigitalEmployeeContentPlanning } from '../routes/digitalEmployeeContentPlanning.js';
import { normalizeVideoPlan } from '../../shared/contracts/videoCreationPlan.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';

test('existing-library shortage returns one actionable blocker before evidence reads or paid planning', async () => {
  const planning = createDigitalEmployeeContentPlanning({
    goalInput: () => ({}) as never,
    ensureFrozenEnterpriseProfileForRun: async () => { throw new Error('must not read or freeze'); },
    contentRoutingEvidence: async () => { throw new Error('must not inspect production evidence'); },
  } as unknown as Parameters<typeof createDigitalEmployeeContentPlanning>[0]);
  const video = normalizeVideoPlan({ route: 'clone', referenceId: '', productName: '产品 A',
    productId: 'sku-a', platform: 'facebook' });
  const pack = { revision: 1, referenceSourcePolicy: 'existing_library_only',
    tasks: [{ templateId: 'production', videoPlans: [video, { ...video, contentId: 'second' }] }],
  } as WeeklyPackage;
  const result = await planning.generateWeeklyTaskPreviews({ tenantId: 'tenant-a', goal: { id: 'goal-a' } as never,
    plan: { id: 'plan-a' } as never, pack, config: {} as never, planBody: {} });
  assert.equal(result.detailGeneration?.status, 'blocked');
  assert.equal(result.detailGeneration?.blockedCount, 2);
  assert.equal(result.detailGeneration?.blockers.length, 1);
  assert.match(result.detailGeneration?.blockers[0] || '', /2 条尚未绑定/);
});
